/**
 * Phrases: the unit of music one bar larger than the chord.
 *
 * Every other analysis in this library is local — a chord against the next
 * chord, a note against the chord under it — and that is the ceiling on what it
 * can say. A cadence is a cadence because it falls at the end of a phrase, so
 * two chords read in isolation cannot settle how much weight one carries. This
 * module draws the boundaries, then ranks the cadences that sit on them.
 *
 * No single signal draws a phrase boundary reliably, so three are combined: the
 * cadences the harmony forms, the rests and long notes the melody breathes at,
 * and the points where the music starts saying something it has said before. A
 * boundary is reported with the evidence behind it and a confidence, because a
 * phrase reading is an interpretation and pretending otherwise would be worse
 * than useless to a caller deciding whether to trust it.
 */

import type { MeterLike, MeterMap } from '../../core/meter/index.js';
import {
  barIndexAt,
  barPositionToBeat,
  beatsPerBarAt,
  resolveMeters,
} from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertArray,
  assertGenerationBudget,
  assertNoteEvents,
  assertPositiveInt,
  assertRange,
  assertRecord,
  dropSilentNotes,
} from '../../core/validation/index.js';
import { scaleOf } from '../../theory/scale/index.js';
import { BEAT_EPS, beatKey, withinBeats } from '../adjacency.js';
import type { CadenceResult } from '../functional/index.js';
import { timelineSpan } from '../grid.js';
import { detectModulations, keyLookup, prevailingKeyOrDefault } from '../keys/index.js';
import { melodicSimilarity } from '../melody/index.js';
import { roundTo } from '../melody/internal.js';
import type { CadenceHit, ChordTimeline } from '../timeline/index.js';
import { assertChordTimeline, detectCadences } from '../timeline/index.js';
import type { KeyContext } from '../voice/index.js';
import type { CadenceSpan, Hypermeter } from './hypermeter.js';
import { cadenceSpans, hypermeterOver } from './hypermeter.js';
import { barSpanOf, clamp01, combineEvidence, resolveSpanEnd, sliceBars } from './internal.js';

/**
 * A reason a phrase boundary was placed where it was.
 *
 * @category Arrangement & Analysis
 */
export type PhraseSignal =
  /** A cadence closed on the beat the boundary falls at. */
  | 'cadence'
  /** The melody stopped sounding long enough to have taken a breath. */
  | 'rest'
  /** A note was held long enough to read as an arrival. */
  | 'longNote'
  /** The music began repeating material heard immediately before. */
  | 'repetition'
  /** The boundary falls on a hypermetric downbeat. */
  | 'hypermeter'
  /** The music ends here, which closes whatever phrase was open. */
  | 'pieceEnd';

/**
 * One phrase: a span of music closed by a boundary, and the evidence for it.
 *
 * @category Arrangement & Analysis
 */
export type Phrase = {
  /** First beat of the phrase; negative when the phrase begins in a pickup. */
  startBeat: number;
  /** End of the phrase, exclusive. */
  endBeat: number;
  /**
   * The cadence closing the phrase, or null when the boundary rests on the
   * melody and the metre alone.
   */
  cadence: CadenceHit | null;
  /** Why the closing boundary was placed here, strongest evidence first. */
  signals: PhraseSignal[];
  /**
   * How well evidenced the phrase is, in [0, 1]: how strong its closing
   * boundary is, and how close its length is to the length expected of a
   * phrase in this piece.
   */
  confidence: number;
  /**
   * How much structural weight the closing cadence carries, in [0, 1]; 0 for a
   * phrase that no cadence closes.
   *
   * This is the number that answers "which cadence matters most": it grades the
   * cadence by how conclusive its type is, then by where the phrase it closes
   * sits — a cadence ending the piece or landing on a hypermetric boundary
   * closes more than one in the middle of a hyperbar.
   * {@link structuralCadences} ranks by it.
   */
  structuralWeight: number;
  /** A short reading of the phrase in words. */
  rationale: string;
};

/**
 * Options for {@link phrasesFromTimeline}.
 *
 * @category Arrangement & Analysis
 */
export type PhraseOptions = {
  /**
   * A single time signature held across the whole span, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * The meter as it changes over the span. Bar lines and hypermetric downbeats
   * follow the signature in force at the beat in question, so a piece that
   * changes metre is cut at its own bar lines; the length defaults below are
   * lengths rather than positions, and each is taken once from the meter the
   * span opens in.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterLike;
  /**
   * Key context for cadence detection: one key for the whole span, or the key
   * in force at a given beat. Omit it to have the key searched for over time,
   * so a piece that modulates has each cadence read in the key it arrives in.
   *
   * @defaultValue the key inferred from the notes over time
   */
  key?: KeyContext;
  /**
   * End of the analysed span in beats; defaults to the end of the last note or
   * timeline segment.
   *
   * @defaultValue the end of the input
   */
  totalBeats?: number;
  /**
   * Length a phrase is expected to run, in beats; defaults to one hyperbar.
   *
   * This is a prior, not a rule: a boundary is placed where the evidence puts
   * it, and this decides how much evidence an irregular length has to carry
   * before it is preferred to a regular one. Set it to two hyperbars for music
   * whose phrases are periods.
   *
   * @defaultValue one hyperbar of the opening meter
   */
  expectedPhraseBeats?: number;
  /**
   * Shortest phrase that may be reported, in beats; defaults to one bar of the
   * opening meter.
   *
   * @defaultValue one bar of the opening meter
   */
  minPhraseBeats?: number;
  /**
   * Silence at least this long divides phrases; defaults to half a bar of the
   * opening meter.
   *
   * @defaultValue half a bar of the opening meter
   */
  restBeats?: number;
  /**
   * A note held at least this long reads as an arrival and closes a phrase;
   * defaults to one bar of the opening meter.
   *
   * @defaultValue one bar of the opening meter
   */
  longNoteBeats?: number;
  /**
   * A hypermeter already computed for this piece, to be used instead of
   * inferring one. Pass it when the caller has already asked for the grouping,
   * or to impose a grouping the search would not have chosen.
   *
   * @defaultValue inferred from the notes and the cadences found
   */
  hypermeter?: Hypermeter;
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * A cadence ranked by how much of the structure it closes.
 *
 * @category Arrangement & Analysis
 */
export type StructuralCadence = {
  /** Index of the phrase this cadence closes, in the array it came from. */
  phraseIndex: number;
  /** The beat the cadence arrives on. */
  atBeat: number;
  /** The beat the phrase it closes ends at. */
  endBeat: number;
  /** The cadence itself. */
  cadence: CadenceResult;
  /** Structural weight in [0, 1]; {@link Phrase.structuralWeight}. */
  weight: number;
  /** Why it weighs what it does. */
  rationale: string;
};

/**
 * How strongly each cadence type marks a boundary.
 *
 * This grades the cadence as a punctuation mark, not as a close: a half cadence
 * ends an antecedent as audibly as an authentic one ends a consequent, which is
 * why it scores near it here and far below it in {@link CADENCE_CLOSURE}. A
 * deceptive cadence scores lowest of all because its whole effect is to
 * withhold the ending it prepared, so the phrase usually runs on past it.
 */
export const CADENCE_BOUNDARY_STRENGTH: Record<NonNullable<CadenceResult['type']>, number> = {
  authentic: 0.9,
  modal: 0.75,
  plagal: 0.7,
  phrygian: 0.65,
  half: 0.6,
  deceptive: 0.45,
};

/**
 * How much of the structure each cadence type closes.
 *
 * The perfect authentic cadence is the only one that ends anything outright;
 * everything else leaves the music open to some degree, and the half cadence
 * most of all — it ends a phrase by pointing at the next one.
 */
export const CADENCE_CLOSURE: Record<NonNullable<CadenceResult['type']>, number> = {
  authentic: 0.85,
  modal: 0.6,
  plagal: 0.55,
  phrygian: 0.4,
  half: 0.35,
  deceptive: 0.3,
};

/** Weight of a full-bar rest as a boundary signal. */
export const REST_STRENGTH = 0.6;

/** Weight of a held note as a boundary signal. */
export const LONG_NOTE_STRENGTH = 0.4;

/** Weight of immediate repetition as a boundary signal. */
export const REPETITION_STRENGTH = 0.5;

/** How alike two adjacent spans must be before the second is heard as a restart. */
export const REPETITION_THRESHOLD = 0.75;

/** Weight of a hypermetric downbeat as a boundary signal. */
export const HYPERMETER_STRENGTH = 0.25;

/** Weight of the end of the music as a boundary signal. */
export const PIECE_END_STRENGTH = 0.5;

/**
 * What a phrase boundary has to be worth before one is placed.
 *
 * The search adds up boundary evidence and length fit across a whole reading,
 * so without a cost per cut it would cut wherever cutting was not actively
 * wrong. Set just above the best length fit alone, so that a boundary needs
 * some evidence of its own: metre may confirm a phrase ending, but it may not
 * declare one. A boundary worth exactly this much is break-even, and a
 * break-even boundary is not taken — see {@link choosePhrasePath}.
 *
 * Not part of the public surface; exported so the search's break-even point can
 * be stated exactly rather than approximated.
 */
export const PHRASE_CUT_COST = 1.3;

/** Share of a phrase's confidence carried by its closing boundary. */
export const CLOSING_SHARE = 0.65;

/** Bonus for a cadence that closes the last phrase of the piece. */
export const FINAL_PHRASE_BONUS = 0.15;

/** Bonus for a cadence whose phrase ends on a hypermetric boundary. */
export const HYPERMETRIC_CLOSE_BONUS = 0.1;

/** How much of an authentic cadence's closure survives an imperfect grading. */
export const IMPERFECT_CLOSURE_FACTOR = 0.8;

/** How much of a cadence's weight survives resolving onto an inverted tonic. */
export const EVADED_FACTOR = 0.6;

/** Order the boundary signals are reported in when they are equally strong. */
export const SIGNAL_ORDER: readonly PhraseSignal[] = [
  'cadence',
  'rest',
  'repetition',
  'longNote',
  'pieceEnd',
  'hypermeter',
];

/** A candidate boundary and everything that argues for it. */
type Boundary = {
  beat: number;
  strengths: Map<PhraseSignal, number>;
  cadence: CadenceHit | null;
};

/** Record a signal at a beat, keeping the strongest claim made for it. */
function addSignal(
  boundaries: Map<number, Boundary>,
  beat: number,
  signal: PhraseSignal,
  strength: number,
  cadence: CadenceHit | null = null,
): void {
  // Beats arrive from bar arithmetic and from note ends, which land an epsilon
  // apart on the same boundary; keying on a rounded beat merges them.
  const key = beatKey(beat);
  const existing = boundaries.get(key);
  const boundary = existing ?? { beat, strengths: new Map(), cadence: null };
  boundary.strengths.set(signal, Math.max(boundary.strengths.get(signal) ?? 0, strength));
  if (cadence !== null && boundary.cadence === null) {
    boundary.cadence = cadence;
  }
  boundaries.set(key, boundary);
}

/** What a boundary is worth, with and without the cadence it carries. */
type BoundaryReading = {
  /** Total strength of every signal. */
  strength: number;
  /** Total strength of the signals other than the cadence. */
  uncredited: number;
  /** The signals, strongest first. */
  signals: PhraseSignal[];
};

/** Total strength of a boundary, and its signals strongest first. */
function readBoundary(boundary: Boundary): BoundaryReading {
  const signals = [...boundary.strengths.entries()].sort(
    (a, b) => b[1] - a[1] || SIGNAL_ORDER.indexOf(a[0]) - SIGNAL_ORDER.indexOf(b[0]),
  );
  return {
    strength: combineEvidence(signals.map(([, strength]) => strength)),
    uncredited: combineEvidence(
      signals.filter(([signal]) => signal !== 'cadence').map(([, strength]) => strength),
    ),
    signals: signals.map(([signal]) => signal),
  };
}

/**
 * Whether a phrase from `startBeat` to `endBeat` is closed by a cadence
 * arriving at `atBeat`: only one that arrived inside it is.
 */
function closesPhrase(atBeat: number, startBeat: number, endBeat: number): boolean {
  return withinBeats(atBeat, startBeat, endBeat);
}

/**
 * How well a length matches what a phrase is expected to run.
 *
 * 1 at the expected length, 0 at twice or none of it, and negative beyond —
 * a phrase three times the expected length is not merely unsurprising, it is
 * evidence that a boundary was missed.
 */
function lengthFit(length: number, expected: number): number {
  if (!(expected > 0)) {
    return 0;
  }
  return Math.max(-1, 1 - Math.abs(length - expected) / expected);
}

/**
 * Choose which of the candidate stops become phrase boundaries.
 *
 * A reading is worth the evidence at every boundary it takes, plus how well
 * each phrase's length matches what a phrase is expected to run, less a cost
 * per cut. The best reading is found by dynamic programming over the stops,
 * since a boundary's worth depends on where the previous one fell.
 *
 * Predecessors are considered in time order, and only a strictly better reading
 * displaces the one already found. Two readings that score the same therefore
 * settle on the earlier predecessor — the longer phrase, with one boundary
 * fewer — because a search may not invent a boundary that the evidence does not
 * prefer to having none. The rule is a property of the comparison, not of the
 * order the loop happens to run in.
 *
 * Not part of the public surface: it takes the stops and strengths some other
 * pass already derived, so exposing it would invite callers to pair the two by
 * hand.
 *
 * A stop whose cadence arrived before the phrase that would end there began is
 * worth only its other evidence: the cadence closes the phrase it arrived in.
 *
 * @param beats Beat of each stop, ascending; index 0 is the span's start and
 *   the last is its end.
 * @param strengths Boundary evidence at each stop, in the same order.
 * @param minPhraseBeats Shortest phrase the search may report.
 * @param expected Length a phrase is expected to run, in beats.
 * @param held Per stop, the beat its cadence arrived on and the evidence left
 *   without that cadence; omitted, every stop is worth its full strength.
 * @returns The chosen stop indices after the start, in time order.
 */
export function choosePhrasePath(
  beats: readonly number[],
  strengths: readonly number[],
  minPhraseBeats: number,
  expected: number,
  held?: { arrivals: readonly number[]; uncredited: readonly number[] },
): number[] {
  const value = new Array<number>(beats.length).fill(Number.NEGATIVE_INFINITY);
  const cameFrom = new Array<number>(beats.length).fill(-1);
  value[0] = 0;
  for (let j = 1; j < beats.length; j += 1) {
    const endBeat = beats[j] ?? 0;
    for (let i = 0; i < j; i += 1) {
      if (!Number.isFinite(value[i] ?? Number.NEGATIVE_INFINITY)) {
        continue;
      }
      const length = endBeat - (beats[i] ?? 0);
      if (length < minPhraseBeats - BEAT_EPS) {
        continue;
      }
      const credited =
        held === undefined || closesPhrase(held.arrivals[j] ?? endBeat, beats[i] ?? 0, endBeat);
      const strength = credited ? (strengths[j] ?? 0) : (held.uncredited[j] ?? 0);
      const gain = (value[i] ?? 0) + strength + lengthFit(length, expected) - PHRASE_CUT_COST;
      if (gain > (value[j] ?? Number.NEGATIVE_INFINITY)) {
        value[j] = gain;
        cameFrom[j] = i;
      }
    }
  }

  const last = beats.length - 1;
  const path: number[] = [];
  if (last > 0 && Number.isFinite(value[last] ?? Number.NEGATIVE_INFINITY)) {
    for (let i = last; i > 0; i = cameFrom[i] ?? 0) {
      path.push(i);
    }
    path.reverse();
  } else if (last > 0) {
    // Nothing reached the end — the span is shorter than one phrase — so the
    // whole of it is the phrase.
    path.push(last);
  }
  return path;
}

/**
 * The cadences of a timeline that mark a boundary, each once, with the span its
 * arrival chord sounds through and the strength its type marks a boundary with.
 *
 * Phrase boundaries and the hyperbar ends the phrases are fitted against are
 * both read from these spans, so a held arrival is credited alike by both.
 *
 * Not part of the public surface.
 *
 * @param timeline The chord timeline the cadences are read from.
 * @param key The key context to read them against.
 * @returns The cadences and their spans, index for index, in time order.
 */
export function boundaryCadences(
  timeline: ChordTimeline,
  key: KeyContext,
): { hits: CadenceHit[]; spans: CadenceSpan[] } {
  const hits = detectCadences(timeline, key).filter((hit) => hit.cadence.type !== null);
  const spans = cadenceSpans(
    hits.map((hit) => ({
      atBeat: hit.atBeat,
      strength: CADENCE_BOUNDARY_STRENGTH[hit.cadence.type as NonNullable<CadenceResult['type']>],
    })),
    timeline.segments,
  );
  return { hits, spans };
}

/**
 * The key context cadences are read against: `key` when one is given,
 * otherwise the keys the timeline's chords modulate through.
 *
 * Not part of the public surface.
 *
 * @param key The key the caller gave, if any.
 * @param timeline The chord timeline the cadences are read from.
 * @param meters The meter map the span is read in.
 * @param totalBeats End of the analysed span; omitted, the end of the last chord.
 * @param budget Upper bound on the work this may do.
 * @returns The key context.
 */
export function keyContextFor(
  key: KeyContext | undefined,
  timeline: ChordTimeline,
  meters: MeterLike,
  totalBeats: number | undefined,
  budget: number | undefined,
): KeyContext {
  if (key !== undefined) {
    return key;
  }
  // Read from the chords the cadences are formed of, as the timeline's own
  // modulations are: a dominant passed through on the way to a cadence is not a
  // key of its own, and reading it as one would turn its V-I into no cadence.
  const regions = detectModulations(timeline.segments, { meters, totalBeats, budget });
  // The pitch classes alone: a phrase boundary is argued from cadences and
  // scale membership, neither of which reads how the key is written.
  const keyAt = keyLookup(regions, prevailingKeyOrDefault(regions));
  return (beat) => scaleOf(keyAt(beat));
}

/**
 * Boundaries argued for by a cadence's arrival chord held across bar lines.
 *
 * A chord held past a bar line closes its phrase at that line as well as where
 * it stops sounding: the tonic a period's consequent opens on is the same tonic
 * the antecedent cadenced to, and reading the arrival only at the end of the
 * held chord would leave the seam between the two with no cadence on it. Every
 * bar line the chord sounds across is such a seam, however many bars separate
 * it from the arrival.
 */
function heldCadenceBoundaries(
  boundaries: Map<number, Boundary>,
  hit: CadenceHit,
  span: CadenceSpan,
  meters: MeterMap,
  spanEnd: number,
): void {
  // Bar lines past the end of the span bound no phrase.
  const firstLine = barIndexAt(span.atBeat, meters) + 1;
  const lastLine = barIndexAt(Math.min(span.endBeat, spanEnd), meters);
  // The lines lie inside the span, whose bar count the form bars check has bounded.
  for (let bar = firstLine; bar <= lastLine; bar += 1) {
    const line = barPositionToBeat({ bar, beat: 0 }, meters);
    if (line < span.endBeat - BEAT_EPS) {
      addSignal(boundaries, line, 'cadence', span.strength, hit);
    }
  }
}

/** Boundaries argued for by silence in the melody. */
function restBoundaries(
  boundaries: Map<number, Boundary>,
  notes: readonly NoteEvent[],
  meters: MeterMap,
  restBeats: number,
): void {
  const ordered = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  let covered = Number.NEGATIVE_INFINITY;
  for (const note of ordered) {
    const gap = note.startBeat - covered;
    if (Number.isFinite(covered) && gap >= restBeats - BEAT_EPS) {
      const bar = beatsPerBarAt(note.startBeat, meters);
      addSignal(
        boundaries,
        note.startBeat,
        'rest',
        REST_STRENGTH * clamp01(bar > 0 ? gap / bar : 1),
      );
    }
    covered = Math.max(covered, note.startBeat + note.durationBeat);
  }
}

/** Boundaries argued for by immediate repetition of the preceding span. */
function repetitionBoundaries(
  boundaries: Map<number, Boundary>,
  notes: readonly NoteEvent[],
  meters: MeterMap,
  spanStart: number,
  spanEnd: number,
  windowBeats: number,
  budget: number | undefined,
): void {
  if (!(windowBeats > 0)) {
    return;
  }
  const slices = sliceBars(notes, meters, spanStart, spanEnd, budget);
  assertGenerationBudget(slices.length * notes.length, 'form repetition comparisons', budget);
  const onsetsIn = (from: number, to: number): NoteEvent[] =>
    notes.filter((note) => withinBeats(note.startBeat, from, to));
  // Comparing the two windows runs an edit distance over their notes, so the
  // work is the product of what each side holds rather than one unit per slice.
  // It is charged as it is incurred, so a passage dense enough to matter is
  // refused before its distance is run rather than after.
  let comparisons = 0;
  for (const slice of slices) {
    const beat = slice.startBeat;
    if (beat - windowBeats < spanStart - BEAT_EPS || beat + windowBeats > spanEnd + BEAT_EPS) {
      continue;
    }
    const before = onsetsIn(beat - windowBeats, beat);
    const after = onsetsIn(beat, beat + windowBeats);
    // One note is a pitch, not a figure; two identical single notes would score
    // a perfect likeness and mark a boundary at every held tone.
    if (before.length < 2 || after.length < 2) {
      continue;
    }
    comparisons += before.length * after.length;
    assertGenerationBudget(comparisons, 'form repetition melody comparisons', budget);
    const similarity = melodicSimilarity(before, after);
    if (similarity >= REPETITION_THRESHOLD) {
      addSignal(boundaries, beat, 'repetition', REPETITION_STRENGTH * similarity);
    }
  }
}

/** Grade a cadence by how much of the structure it closes. */
function structuralWeightOf(
  cadence: CadenceHit | null,
  confidence: number,
  aligned: boolean,
  isLast: boolean,
): number {
  if (cadence === null || cadence.cadence.type === null) {
    return 0;
  }
  const result = cadence.cadence;
  let base = CADENCE_CLOSURE[result.type as NonNullable<CadenceResult['type']>];
  if (result.type === 'authentic') {
    if (result.strength === 'perfect') {
      base = 1;
    } else if (result.strength === 'imperfect') {
      base *= IMPERFECT_CLOSURE_FACTOR;
    }
  }
  if (result.evaded) {
    base *= EVADED_FACTOR;
  }
  let weight = base * confidence;
  if (isLast) {
    weight += FINAL_PHRASE_BONUS;
  }
  if (aligned) {
    weight += HYPERMETRIC_CLOSE_BONUS;
  }
  return clamp01(weight);
}

/** Name a cadence the way a rationale reads it. */
function describeCadence(cadence: CadenceHit | null): string {
  if (cadence === null || cadence.cadence.type === null) {
    return 'no cadence';
  }
  const { type, strength } = cadence.cadence;
  const graded = strength === null ? type : `${strength} ${type}`;
  return `a ${graded} cadence at beat ${cadence.atBeat}`;
}

/**
 * Split a piece into phrases.
 *
 * Three kinds of evidence are gathered independently and then reconciled. The
 * harmony contributes its cadences, each closing at the end of the chord it
 * arrives on, and at every bar line that chord is held across — a tonic still
 * sounding into the next phrase closed this one at the bar line. The
 * cadence reported for a phrase is always one that arrived inside it. The
 * melody contributes the rests it breathes at and the notes it
 * holds long enough to read as arrivals. Repetition contributes the beats where
 * the music restarts material it has just played. The metre contributes its
 * hypermetric downbeats, which confirm a boundary but never declare one on
 * their own.
 *
 * The boundaries are then chosen together rather than one at a time: the
 * reading that best trades each boundary's evidence against how regular the
 * phrase lengths come out is selected by dynamic programming, at a fixed cost
 * per cut. That is what stops a phrase being declared at every plausible beat,
 * and what lets a well-evidenced irregular phrase survive next to regular ones.
 *
 * The result is contiguous: phrases abut, and together they cover the span from
 * the first note to the end of the music. A cadence found in the middle of a
 * phrase is not lost — it is still reachable through {@link detectCadences} —
 * but only the cadences the reading puts at phrase ends are ranked by
 * {@link structuralCadences}.
 *
 * @param timeline The chord timeline the cadences are read from.
 * @param notes The melody, for its rests, held notes and repetitions. Notes
 *   that never sound are dropped.
 * @param opts Analysis options; see {@link PhraseOptions}.
 * @returns The phrases, in time order; one phrase covering the whole span when
 *   the span is too short to divide, and none at all when nothing sounds —
 *   silence is no material to hear a phrase in.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, phrasesFromTimeline } from '@libraz/libcantus';
 * // Four bars of C - F - G - C. Triads rather than single notes: one line at a
 * // time names no harmony, so nothing would cadence.
 * const triad = (pitches: number[], startBeat: number) =>
 *   pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
 * const notes = [
 *   ...triad([60, 64, 67], 0),
 *   ...triad([65, 69, 72], 4),
 *   ...triad([67, 71, 74], 8),
 *   ...triad([60, 64, 67], 12),
 * ];
 * const { timeline } = chordTimelineFromNotes(notes);
 * const phrases = phrasesFromTimeline(timeline, notes);
 * phrases[phrases.length - 1]?.cadence?.cadence.type; // 'authentic'
 * phrases[phrases.length - 1]?.cadence?.atBeat; // 12, inside the phrase it closes
 * ```
 * @category Arrangement & Analysis
 */
export function phrasesFromTimeline(
  timeline: ChordTimeline,
  notes: readonly NoteEvent[],
  opts: PhraseOptions = {},
): Phrase[] {
  assertChordTimeline(timeline);
  const meters = resolveMeters(opts, 'phrase meters');
  assertNoteEvents(notes, 'phrase notes', {
    allowNonPositiveDuration: true,
    budget: opts.budget,
  });
  if (opts.hypermeter !== undefined) {
    // The one structured option, held to the contract its own type states: a
    // confidence outside [0, 1] scales the metrical signal past the cost of a
    // cut, which would let the metre declare a boundary rather than confirm
    // one, and a fractional group is not a number of bars.
    assertRange(opts.hypermeter.confidence, 0, 1, 'phrase hypermeter confidence');
    assertPositiveInt(opts.hypermeter.groupBars, 'phrase hypermeter groupBars');
  }
  const sounding = dropSilentNotes(notes);
  // The pickup rule the whole analysis shares, so the first beat this reports
  // is the one sections and hypermeter report for the same notes.
  const { startBeat: spanStart, notesEnd } = timelineSpan(sounding, timeline.segments, meters);
  const spanEnd = resolveSpanEnd(opts.totalBeats, spanStart, notesEnd, 'phrase totalBeats');
  if (spanEnd <= spanStart + BEAT_EPS) {
    // Nothing sounds, so there is no material to hear a phrase in — the answer
    // `sectionsFromNotes` gives an empty span. A phrase of no length, closed by
    // nothing, would be a marker rather than a phrase.
    return [];
  }

  const barBeats = beatsPerBarAt(Math.max(0, spanStart), meters);
  const restBeats = opts.restBeats ?? barBeats / 2;
  assertRange(restBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'phrase restBeats');
  const longNoteBeats = opts.longNoteBeats ?? barBeats;
  assertRange(longNoteBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'phrase longNoteBeats');
  const minPhraseBeats = opts.minPhraseBeats ?? barBeats;
  assertRange(minPhraseBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'phrase minPhraseBeats');

  const key = keyContextFor(opts.key, timeline, meters, spanEnd, opts.budget);
  const { hits: cadences, spans } = boundaryCadences(timeline, key);
  const grouping =
    opts.hypermeter ??
    hypermeterOver(sounding, meters, { totalBeats: spanEnd, budget: opts.budget }, () => spans);
  // The hyperbar the span opens in, not the one the piece opens in. Bar 0 is
  // always the bar beginning at beat 0 of the meter map, so measuring the group
  // from there hands an excerpt starting after a change of meter the bar length
  // of a meter it never sounds in — and that wrong length is the prior every
  // phrase in it is fitted against. The bar the span itself opens in is the
  // anchor the line above already uses.
  const firstBar = barIndexAt(Math.max(0, spanStart), meters);
  const hyperBeats = Math.max(
    barBeats,
    barPositionToBeat({ bar: firstBar + grouping.groupBars, beat: 0 }, meters) -
      barPositionToBeat({ bar: firstBar, beat: 0 }, meters),
  );
  const expected = opts.expectedPhraseBeats ?? hyperBeats;
  assertRange(expected, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'phrase expectedPhraseBeats');

  const boundaries = new Map<number, Boundary>();
  cadences.forEach((hit, index) => {
    const span = spans[index] as CadenceSpan;
    addSignal(boundaries, span.endBeat, 'cadence', span.strength, hit);
    heldCadenceBoundaries(boundaries, hit, span, meters, spanEnd);
  });
  restBoundaries(boundaries, sounding, meters, restBeats);
  for (const note of sounding) {
    if (note.durationBeat >= longNoteBeats - BEAT_EPS) {
      addSignal(boundaries, note.startBeat + note.durationBeat, 'longNote', LONG_NOTE_STRENGTH);
    }
  }
  repetitionBoundaries(boundaries, sounding, meters, spanStart, spanEnd, hyperBeats, opts.budget);
  for (const downbeat of grouping.downbeats) {
    addSignal(boundaries, downbeat, 'hypermeter', HYPERMETER_STRENGTH * grouping.confidence);
  }
  addSignal(boundaries, spanEnd, 'pieceEnd', PIECE_END_STRENGTH);

  // The span's own ends are boundaries whether or not anything argues for them,
  // so the phrases cover the music rather than only its well-marked middle.
  const candidates = [...boundaries.values()]
    .filter(
      (boundary) => boundary.beat > spanStart + BEAT_EPS && boundary.beat < spanEnd - BEAT_EPS,
    )
    .map((boundary) => ({ boundary, reading: readBoundary(boundary) }))
    // A stop nothing argues for is not a boundary that a length can buy. A
    // hypermeter position read with no confidence registers at strength zero,
    // and the path search weighs a cut by the two lengths it makes as well as
    // by the evidence: over a pedal point or a drone, where no cadence and no
    // harmonic novelty argue anywhere, the length term alone put boundaries in
    // the reading that a caller cannot tell from evidenced ones.
    .filter(({ reading }) => reading.strength > 0)
    .sort((a, b) => a.boundary.beat - b.boundary.beat);
  const endBoundary = boundaries.get(beatKey(spanEnd)) ?? {
    beat: spanEnd,
    strengths: new Map<PhraseSignal, number>(),
    cadence: null,
  };
  const startBoundary: Boundary = { beat: spanStart, strengths: new Map(), cadence: null };
  const stops: Boundary[] = [
    startBoundary,
    ...candidates.map(({ boundary }) => boundary),
    endBoundary,
  ];
  assertGenerationBudget(stops.length * stops.length, 'form phrase boundary pairs', opts.budget);

  const readings = [
    readBoundary(startBoundary),
    ...candidates.map(({ reading }) => reading),
    readBoundary(endBoundary),
  ];
  const path = choosePhrasePath(
    stops.map((stop) => stop.beat),
    readings.map((reading) => reading.strength),
    minPhraseBeats,
    expected,
    {
      arrivals: stops.map((stop) => stop.cadence?.atBeat ?? stop.beat),
      uncredited: readings.map((reading) => reading.uncredited),
    },
  );

  const downbeatKeys = new Set(grouping.downbeats.map(beatKey));
  const phrases: Phrase[] = [];
  let from = 0;
  for (let n = 0; n < path.length; n += 1) {
    const to = path[n] ?? stops.length - 1;
    const startBeat = stops[from]?.beat ?? spanStart;
    const stop = stops[to];
    const endBeat = stop?.beat ?? spanEnd;
    const reading = readings[to] ?? { strength: 0, uncredited: 0, signals: [] as PhraseSignal[] };
    const length = endBeat - startBeat;
    const isLast = n === path.length - 1;
    // A cadence that arrived before this phrase began cannot be the one closing
    // it: its chord was still sounding at the boundary, which is a held arrival
    // and not a second one. The cadence belongs to the phrase it arrived in, so
    // a reported `cadence.atBeat` always lies inside `[startBeat, endBeat)`.
    const closing = stop?.cadence ?? null;
    const cadence =
      closing !== null && closesPhrase(closing.atBeat, startBeat, endBeat) ? closing : null;
    // Read from the signals the phrase reports, so a dropped cadence adds nothing.
    const closingStrength = cadence === null ? reading.uncredited : reading.strength;
    const confidence = clamp01(
      CLOSING_SHARE * closingStrength +
        (1 - CLOSING_SHARE) * Math.max(0, lengthFit(length, expected)),
    );
    const structuralWeight = structuralWeightOf(
      cadence,
      confidence,
      downbeatKeys.has(beatKey(endBeat)),
      isLast,
    );
    // The signals say what the boundary was read from, so a cadence dropped as
    // belonging to an earlier phrase is dropped from them too: reporting a
    // phrase closing on no cadence whose boundary came `from cadence` states
    // both halves of one fact and contradicts itself.
    const signals =
      cadence === null ? reading.signals.filter((signal) => signal !== 'cadence') : reading.signals;
    const bars = roundTo(barSpanOf(startBeat, endBeat, meters), 2);
    phrases.push({
      startBeat,
      endBeat,
      cadence,
      signals,
      confidence,
      structuralWeight,
      rationale:
        `Phrase of ${bars} bar(s) closing on ${describeCadence(cadence)}; ` +
        `boundary from ${signals.length === 0 ? 'the end of the span' : signals.join(', ')}`,
    });
    from = to;
  }
  return phrases;
}

/**
 * Rank the cadences that close phrases by how much structure they close.
 *
 * This is the question the phrase layer exists to answer. Two chords alone
 * cannot say whether a V-to-I is the end of the piece or a passing confirmation
 * halfway through a hyperbar; a phrase reading can, because it knows what the
 * cadence closes and where that sits. Phrases no cadence closes are left out.
 *
 * @param phrases The phrases, as {@link phrasesFromTimeline} returns them.
 * @returns The cadences, heaviest first; ties keep the earlier one.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, phrasesFromTimeline, structuralCadences } from '@libraz/libcantus';
 * const triad = (pitches: number[], startBeat: number) =>
 *   pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
 * const notes = [
 *   ...triad([60, 64, 67], 0),
 *   ...triad([65, 69, 72], 4),
 *   ...triad([67, 71, 74], 8),
 *   ...triad([60, 64, 67], 12),
 * ];
 * const { timeline } = chordTimelineFromNotes(notes);
 * const ranked = structuralCadences(phrasesFromTimeline(timeline, notes));
 * ranked[0]?.cadence.type; // 'authentic' — the cadence carrying the most weight
 * ranked[0]?.atBeat; // 12
 * ```
 * @category Arrangement & Analysis
 */
export function structuralCadences(phrases: readonly Phrase[]): StructuralCadence[] {
  assertArray(phrases, 'phrases');
  const ranked: StructuralCadence[] = [];
  for (let index = 0; index < phrases.length; index += 1) {
    const phrase = assertRecord<Phrase>(phrases[index], `phrases[${index}]`);
    if (
      phrase.cadence === null ||
      phrase.cadence === undefined ||
      phrase.cadence.cadence.type === null
    ) {
      continue;
    }
    const hit = phrase.cadence;
    ranked.push({
      phraseIndex: index,
      atBeat: hit.atBeat,
      endBeat: phrase.endBeat,
      cadence: hit.cadence,
      weight: phrase.structuralWeight,
      rationale: `Closes ${describeCadence(hit)} on a phrase of confidence ${roundTo(
        phrase.confidence,
        2,
      )}`,
    });
  }
  return ranked.sort((a, b) => b.weight - a.weight || a.atBeat - b.atBeat);
}
