/**
 * Reading a piece into a {@link ReferenceProfile}.
 *
 * The profile is assembled from analyses the library already runs — chord and
 * key inference, hypermeter, phrases, sections, reduction, motifs and rhythm —
 * each run exactly once and all read against one span: every analysis is handed
 * the same `totalBeats`, so the phrases, sections and both rhythm readings
 * describe the same stretch of music. The harmonic reading enters as a bundle
 * of its own, so a caller already holding one (a score's kept chord analysis,
 * an arrangement's session) builds the profile from it without inferring the
 * harmony a second time.
 */

import type { MeterLike, MeterMap } from '../../core/meter/index.js';
import { resolveMeters } from '../../core/meter/index.js';
import { pitchClassOf } from '../../core/pitch/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertNoteEvents, assertOptions, assertRange } from '../../core/validation/index.js';
import type { KeyLike, ResolvedKey } from '../../theory/scale/index.js';
import { majorKey, resolveKey, scaleOf } from '../../theory/scale/index.js';
import { BEAT_EPS } from '../adjacency.js';
import type { FormSection } from '../form/index.js';
import {
  hypermeter,
  phrasesFromTimeline,
  sectionsFromNotes,
  structuralCadences,
} from '../form/index.js';
import { barSpanOf, firstSoundingBeat } from '../form/internal.js';
import { functionOf } from '../functional/function.js';
import { chordToRoman } from '../functional/roman.js';
import { barGridStart } from '../grid.js';
import type { KeyRegion } from '../keys/index.js';
import { keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../keys/index.js';
import { melodicContour } from '../melody/contour.js';
import type { MotifGraph } from '../melody/graph.js';
import { motifGraph } from '../melody/graph.js';
import { orderedNotes } from '../melody/internal.js';
import { extractMotifs } from '../melody/motifs.js';
import { reduceProgression } from '../reduction/index.js';
import { analyzeRhythm } from '../rhythm/index.js';
import type { ChordTimeline, ChordTimelineResult } from '../timeline/index.js';
import { assertChordTimeline, chordTimelineFromNotes, detectCadences } from '../timeline/index.js';
import type {
  ReferenceCadence,
  ReferenceChord,
  ReferenceKeyRegion,
  ReferenceMelody,
  ReferenceMotif,
  ReferencePhrase,
  ReferencePhraseMelody,
  ReferenceProfile,
} from './types.js';
import { REFERENCE_PROFILE_VERSION } from './types.js';

/**
 * Options for {@link analyzeReference}.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceProfileOptions = {
  /**
   * A single time signature held across the whole span, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * The meter as it changes over the span.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterLike;
  /**
   * The key, when it is already known: read as one key across the whole span,
   * as {@link chordTimelineFromNotes} reads it. Omit it to have the keys
   * searched for over time.
   *
   * @defaultValue the keys inferred from the notes over time
   */
  key?: KeyLike;
  /**
   * The harmony, given rather than inferred — the shape an arrangement's
   * `timeline` option takes. The key regions are still read from `key` or,
   * without one, from the notes.
   *
   * @defaultValue inferred from the notes
   */
  timeline?: ChordTimeline;
  /**
   * The melodic line. Omit it to read the top line of `notes`, where notes
   * struck together are one event and the highest of them stands for it.
   *
   * @defaultValue the top line of the notes
   */
  melody?: readonly NoteEvent[];
  /**
   * End of the analysed span in beats.
   *
   * @defaultValue the end of the last note or chord segment
   */
  totalBeats?: number;
  /**
   * Upper bound on the work each analysis may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * The harmonic reading a profile is built on: the chord timeline, the key
 * regions it was read against, and the key held longest across them.
 *
 * {@link ChordTimelineResult} carries all three, and so does anything that
 * contains one, so a caller already holding a chord analysis hands it over as
 * it is.
 */
export type ReferenceReadings = Pick<ChordTimelineResult, 'timeline' | 'keys' | 'prevailingKey'>;

/**
 * The span every analysis is read over: from the bar-grid start of the
 * earliest onset or chord segment, to `totalBeats` or else the later of the
 * last note's end and the last segment's end — the span
 * {@link phrasesFromTimeline} reads, so the phrases tile it exactly.
 */
function spanOf(
  sounding: readonly NoteEvent[],
  timeline: ChordTimeline,
  meters: MeterMap,
  totalBeats: number | undefined,
): { startBeat: number; endBeat: number } {
  const segments = timeline.segments;
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const firstOnset = firstSoundingBeat(sounding, firstSegment?.startBeat ?? 0);
  const startBeat = barGridStart(
    Math.min(firstOnset, firstSegment?.startBeat ?? firstOnset),
    meters,
  );
  const notesEnd = sounding.reduce(
    (end, note) => Math.max(end, note.startBeat + note.durationBeat),
    lastSegment?.endBeat ?? 0,
  );
  return { startBeat, endBeat: Math.max(startBeat, totalBeats ?? notesEnd) };
}

/** Whether two keys hold the same pitch classes, the identity `prevailingKeyOf` weighs by. */
function sameKey(a: ResolvedKey, b: ResolvedKey): boolean {
  return (
    pitchClassOf(a.scale.rootPc) === pitchClassOf(b.scale.rootPc) &&
    a.scale.modeMask12 === b.scale.modeMask12
  );
}

/**
 * Index of the key region a chord is read against: the region holding its
 * midpoint, or else the first region in the prevailing key.
 */
function keyIndexAt(
  regions: readonly ReferenceKeyRegion[],
  beat: number,
  prevailing: ResolvedKey,
): number {
  const holding = regions.findIndex((region) => region.startBeat <= beat && beat < region.endBeat);
  if (holding >= 0) {
    return holding;
  }
  return Math.max(
    0,
    regions.findIndex((region) => sameKey(region.key, prevailing)),
  );
}

/** Duration-weighted mean pitch of notes that all sound for a positive length. */
function weightedMean(notes: readonly NoteEvent[]): number {
  let weighted = 0;
  let total = 0;
  for (const note of notes) {
    weighted += note.pitch * note.durationBeat;
    total += note.durationBeat;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * How the line reads within one phrase, from the line's notes whose onsets
 * fall in it, each cut off at the phrase's end; null when fewer than two do.
 */
export function phraseMelody(
  line: readonly NoteEvent[],
  startBeat: number,
  endBeat: number,
  lineMean: number,
  meters: MeterMap,
  budget: number | undefined,
): ReferencePhraseMelody | null {
  const inside = line
    .filter((note) => note.startBeat >= startBeat - BEAT_EPS && note.startBeat < endBeat - BEAT_EPS)
    .map((note) => ({
      ...note,
      durationBeat: Math.min(note.startBeat + note.durationBeat, endBeat) - note.startBeat,
    }));
  const first = inside[0];
  if (first === undefined || inside.length < 2) {
    return null;
  }
  let low = first.pitch;
  let peak = first;
  for (const note of inside) {
    low = Math.min(low, note.pitch);
    if (note.pitch > peak.pitch) {
      peak = note;
    }
  }
  const length = endBeat - startBeat;
  const outline: number[] = [];
  for (let k = 0; k < 8; k += 1) {
    const at = startBeat + ((k + 0.5) * length) / 8;
    // The note sounding at the sample point, or the last one before it: a rest holds.
    let held = first;
    for (const note of inside) {
      if (note.startBeat > at + BEAT_EPS) {
        break;
      }
      held = note;
    }
    outline.push(held.pitch - lineMean);
  }
  const rhythm = analyzeRhythm(inside, { meters, totalBeats: endBeat, budget });
  return {
    shape: melodicContour(inside).shape,
    low,
    high: peak.pitch,
    mean: weightedMean(inside),
    peakPitch: peak.pitch,
    peakPosition: Math.min(1, Math.max(0, (peak.startBeat - startBeat) / length)),
    outline,
    onsetDensity: rhythm.onsetDensity,
    restRatio: rhythm.restRatio,
  };
}

/** Index of the section a beat falls in, or null when none holds it. */
function sectionAt(sections: readonly FormSection[], beat: number): number | null {
  const index = sections.findIndex(
    (section) => beat >= section.startBeat - BEAT_EPS && beat < section.endBeat - BEAT_EPS,
  );
  return index < 0 ? null : index;
}

/**
 * The harmonic reading for {@link analyzeReference}: inferred from the notes,
 * or, when a timeline is given, that timeline read against the stated key or
 * the keys searched for in the notes.
 *
 * @param notes The notes the harmony is read from.
 * @param opts The options {@link analyzeReference} was given.
 * @returns The timeline, its key regions, and the prevailing key.
 */
export function readingsFor(
  notes: readonly NoteEvent[],
  opts: ReferenceProfileOptions = {},
): ReferenceReadings {
  const asked = assertOptions(opts, 'reference options');
  const meters = resolveMeters(asked, 'reference meters');
  const budget = asked.budget;
  if (asked.timeline === undefined) {
    return chordTimelineFromNotes(notes, {
      meters,
      key: asked.key,
      totalBeats: asked.totalBeats,
      budget,
    });
  }
  const timeline = assertChordTimeline(asked.timeline, 'reference timeline');
  let keys: KeyRegion[];
  if (asked.key === undefined) {
    keys = keyTimelineFromNotes(notes, { meters, totalBeats: asked.totalBeats, budget });
  } else {
    // A stated key is taken as read across the span, as chord inference takes it.
    const sounding = assertNoteEvents(notes, 'reference notes', {
      allowNonPositiveDuration: true,
      budget,
    }).filter((note) => note.durationBeat > 0);
    const span = spanOf(sounding, timeline, meters, asked.totalBeats);
    keys = [
      {
        startBeat: span.startBeat,
        endBeat: span.endBeat,
        key: resolveKey(asked.key),
        confidence: 1,
      },
    ];
  }
  return { timeline, keys, prevailingKey: prevailingKeyOf(keys) ?? resolveKey(majorKey(0)) };
}

/**
 * Build a profile from a harmonic reading already in hand.
 *
 * `readings` must have been read from the same notes, meter, key and span the
 * options name; nothing here re-derives the harmony to check.
 *
 * @param notes The notes the form, harmony and (without `opts.melody`) melody are read from.
 * @param readings The chord timeline and key regions to read the harmony from.
 * @param opts The meter, the melody, the span's end and the budget.
 * @returns The profile.
 */
export function referenceFromReadings(
  notes: readonly NoteEvent[],
  readings: ReferenceReadings,
  opts: ReferenceProfileOptions = {},
): ReferenceProfile {
  const asked = assertOptions(opts, 'reference options');
  const meters = resolveMeters(asked, 'reference meters');
  const budget = asked.budget;
  const sounding = assertNoteEvents(notes, 'reference notes', {
    allowNonPositiveDuration: true,
    budget,
  }).filter((note) => note.durationBeat > 0);
  if (asked.totalBeats !== undefined) {
    assertRange(asked.totalBeats, 0, Number.MAX_SAFE_INTEGER, 'reference totalBeats');
  }
  const line = orderedNotes(asked.melody ?? notes, 'reference melody', budget);
  const { timeline, prevailingKey } = readings;

  const span = spanOf(sounding, timeline, meters, asked.totalBeats);
  const spanEnd = span.endBeat;
  // Named keys for numerals, functions and motif relations; pitch classes for
  // the analyses that take a key context.
  const keyAt = keyLookup(readings.keys, prevailingKey);
  const scaleAt = (beat: number) => scaleOf(keyAt(beat));

  const cadenceBeats = detectCadences(timeline, scaleAt).map((hit) => hit.atBeat);
  const grouping = hypermeter(sounding, meters, { cadenceBeats, totalBeats: spanEnd, budget });
  const phrases = phrasesFromTimeline(timeline, notes, {
    meters,
    key: scaleAt,
    hypermeter: grouping,
    totalBeats: spanEnd,
    budget,
  });
  const cadences = new Map<number, ReferenceCadence>();
  for (const closing of structuralCadences(phrases)) {
    const type = closing.cadence.type;
    if (type !== null) {
      cadences.set(closing.phraseIndex, {
        atBeat: closing.atBeat,
        type,
        weight: closing.weight,
      });
    }
  }
  const sections = sectionsFromNotes(notes, {
    meters,
    unitBars: grouping.groupBars,
    totalBeats: spanEnd,
    budget,
  });

  // A timeline with no key region under it — one given with no notes to key
  // it — is read in the prevailing key throughout, and the region records that.
  const keys: ReferenceKeyRegion[] =
    readings.keys.length === 0 && timeline.segments.length > 0
      ? [
          {
            startBeat: span.startBeat,
            endBeat: spanEnd,
            key: resolveKey(prevailingKey),
            confidence: 0,
          },
        ]
      : readings.keys.map((region) => ({
          startBeat: region.startBeat,
          endBeat: region.endBeat,
          key: resolveKey(region.key),
          confidence: region.confidence,
        }));
  const chords: ReferenceChord[] = reduceProgression(timeline, scaleAt).map((reduced) => {
    const index = keyIndexAt(keys, (reduced.startBeat + reduced.endBeat) / 2, prevailingKey);
    const key = (keys[index] as ReferenceKeyRegion).key;
    return {
      startBeat: reduced.startBeat,
      endBeat: reduced.endBeat,
      key: index,
      roman: chordToRoman(reduced.chord, key),
      function: functionOf(reduced.chord, key),
      level: reduced.level,
    };
  });
  const chordOnsets: NoteEvent[] = timeline.segments.map((segment) => ({
    pitch: 60,
    startBeat: segment.startBeat,
    durationBeat: segment.endBeat - segment.startBeat,
  }));
  const harmonyRhythm = analyzeRhythm(chordOnsets, { meters, totalBeats: spanEnd, budget });

  const motifs = extractMotifs(line, { budget });
  const graph: MotifGraph = motifGraph(line, motifs, { key: prevailingKey, budget });
  let register: ReferenceMelody['register'] = null;
  if (line.length > 0) {
    const pitches = line.map((note) => note.pitch);
    register = {
      low: Math.min(...pitches),
      high: Math.max(...pitches),
      mean: weightedMean(line),
    };
  }
  const lineMean = register?.mean ?? 0;
  const referenceMotifs: ReferenceMotif[] = motifs.map((motif) => {
    const first = motif.occurrences[0];
    return {
      intervals: motif.intervals,
      rhythm: motif.rhythm,
      unitBeats:
        motif.notes.length < 2
          ? 0
          : (motif.notes[1] as NoteEvent).startBeat - (motif.notes[0] as NoteEvent).startBeat,
      spanBeats: first === undefined ? 0 : first.endBeat - first.startBeat,
      occurrences: motif.occurrences.length,
    };
  });

  const referencePhrases: ReferencePhrase[] = phrases.map((phrase, index) => ({
    startBeat: phrase.startBeat,
    endBeat: phrase.endBeat,
    bars: barSpanOf(phrase.startBeat, phrase.endBeat, meters),
    section: sectionAt(sections, phrase.startBeat),
    confidence: phrase.confidence,
    cadence: cadences.get(index) ?? null,
    melody: phraseMelody(line, phrase.startBeat, phrase.endBeat, lineMean, meters, budget),
    motifNodes: graph.nodes.flatMap((node, nodeIndex) =>
      node.startBeat >= phrase.startBeat - BEAT_EPS && node.startBeat < phrase.endBeat - BEAT_EPS
        ? [nodeIndex]
        : [],
    ),
  }));

  return {
    profileVersion: REFERENCE_PROFILE_VERSION,
    span: {
      startBeat: span.startBeat,
      endBeat: spanEnd,
      bars: barSpanOf(span.startBeat, spanEnd, meters),
    },
    meters,
    form: {
      hypermeter: { groupBars: grouping.groupBars, confidence: grouping.confidence },
      sections,
      phrases: referencePhrases,
    },
    harmony: { keys, chords, rhythm: harmonyRhythm },
    melody: {
      register,
      shape: line.length < 2 ? null : melodicContour(line).shape,
      motifs: referenceMotifs,
      graph,
      rhythm: analyzeRhythm(line, { meters, totalBeats: spanEnd, budget }),
    },
  };
}

/**
 * Read a piece's structure into a {@link ReferenceProfile}: its form, phrase
 * shapes, harmonic function and rhythm, motif derivations and melodic rhythm,
 * without the notes themselves.
 *
 * The melody is the `melody` option when given, and otherwise the top line of
 * the notes — notes struck together read as one event, the highest standing
 * for it — so a piano part read whole answers for its upper voice. The harmony
 * is the `timeline` option when given, and otherwise inferred from all the
 * notes. The motif search expects quantized onsets.
 *
 * The sections are cut on the hyperbar grouping the phrase reading settles
 * on, which weighs where the harmony cadences; `sectionsFromNotes` alone
 * groups without the cadences, so the two can differ.
 *
 * @param notes The piece's notes, in any order. Notes that never sound are dropped.
 * @param opts The meter, key, harmony, melody, span end and budget; see
 *   {@link ReferenceProfileOptions}.
 * @returns The profile.
 * @throws {InvalidInputError} If the notes or an option cannot be read.
 * @throws {BudgetExceededError} If an analysis would exceed the budget.
 * @example
 * ```ts
 * import { analyzeReference } from '@libraz/libcantus';
 * const triad = (pitches: number[], startBeat: number) =>
 *   pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
 * const notes = [
 *   ...triad([60, 64, 67], 0),
 *   ...triad([65, 69, 72], 4),
 *   ...triad([67, 71, 74], 8),
 *   ...triad([60, 64, 67], 12),
 * ];
 * const profile = analyzeReference(notes, { key: 'C major' });
 * profile.harmony.chords.map((chord) => chord.roman); // ['I', 'IV', 'V', 'I']
 * profile.span.bars; // 4
 * ```
 * @category Arrangement & Analysis
 */
export function analyzeReference(
  notes: readonly NoteEvent[],
  opts?: ReferenceProfileOptions,
): ReferenceProfile {
  return referenceFromReadings(notes, readingsFor(notes, opts), opts);
}
