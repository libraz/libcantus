import { sortedNoteEvents } from '../../core/event-index/index.js';
import type { MeterLike, MeterMap } from '../../core/meter/index.js';
import {
  beatsPerBarAt,
  metricGridUnit,
  metricWeight,
  resolveMeters,
} from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import type { NoteEventAssertOptions } from '../../core/validation/index.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertNoteEvents,
  assertRange,
} from '../../core/validation/index.js';
import type { Chord, ChordQuality, ChordSpan } from '../../theory/chord/index.js';
import { chordFromSpan, chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import type { KeyLike } from '../../theory/scale/index.js';
import {
  isScaleTone,
  majorKey,
  type ResolvedKey,
  resolveKey,
  scaleOf,
} from '../../theory/scale/index.js';
import type { ChordMatch } from '../detect/index.js';
import { detectChord } from '../detect/index.js';
import { augmentedSixthFromPitchClasses } from '../functional/augmented-sixth.js';
import { isCadentialSixFour } from '../functional/cadence.js';
import type { CadenceResult } from '../functional/index.js';
import { detectCadence } from '../functional/index.js';
import { gridForNotes } from '../grid.js';
import type { SlotGrid, WindowWeights } from '../histogram.js';
import { bucketNotesBySlot, windowWeights } from '../histogram.js';
import type { KeyRegion } from '../keys/index.js';
import { attachPivots, keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../keys/index.js';
import type { KeyContext } from '../voice/index.js';
import { keyScaleAt } from '../voice/index.js';

export type { ChordSegment } from '../../theory/chord/index.js';

import type { ChordSegment } from '../../theory/chord/index.js';

/**
 * A beat-indexed sequence of chord segments.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimeline = {
  /** The chord sounding at a beat, or null when no segment covers it. */
  at: (beat: number) => Chord | null;
  segments: ChordSegment[];
};

/**
 * Build a chord timeline from placed chords.
 *
 * Each chord spans from its `startBeat` to the next chord's `startBeat`; the last
 * chord runs to `totalBeats`. Segments with no positive length (from duplicate
 * onsets or a last chord at or past `totalBeats`) are dropped. `at(beat)` returns
 * the covering segment's chord, or null when the beat lies outside every segment.
 *
 * @param chords Placed chords in time order.
 * @param totalBeats End of the timeline in beats.
 * @returns A queryable chord timeline.
 * @category Arrangement & Analysis
 */
export function chordTimelineFromChords(
  chords: readonly ChordSpan[],
  totalBeats: number,
): ChordTimeline {
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'timeline totalBeats');
  assertGenerationBudget(chords.length, 'timeline chords');
  for (let index = 0; index < chords.length; index += 1) {
    // Unbounded below, like a note onset: a chord may sound in the pickup.
    assertRange(
      chords[index]?.startBeat ?? Number.NaN,
      -Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      `chords[${index}].startBeat`,
    );
  }
  const sorted = [...chords]
    .filter((chord) => chord.startBeat < totalBeats)
    .sort((a, b) => a.startBeat - b.startBeat);
  const segments: ChordSegment[] = sorted
    .map((gc, i) => {
      const next = sorted[i + 1];
      const nextBeat = next ? next.startBeat : totalBeats;
      const endBeat = Math.min(totalBeats, Math.max(gc.startBeat, nextBeat));
      return {
        startBeat: gc.startBeat,
        endBeat,
        chord: chordFromSpan(gc),
      };
    })
    .filter((seg) => seg.endBeat > seg.startBeat);

  return { at: segmentLookup(segments), segments };
}

/**
 * The chord sounding at a beat, or null where nothing is.
 *
 * A segment covers `[startBeat, endBeat)`, so the beat a chord gives way on
 * answers with the chord arriving rather than the one leaving. Segments are
 * disjoint and in beat order, so the covering one is found by binary search
 * rather than by a scan: this is the inner loop of arrangement analysis, which
 * queries it once per note per chord change.
 *
 * The class-side timeline answers `at(beat)` through this same search, so the
 * function and the class cannot come to differ over where a chord starts.
 *
 * @param segments The segments to search, disjoint and in beat order.
 * @param beat The beat to read.
 * @returns The covering segment's chord, or null outside every segment.
 * @throws If `beat` is not finite.
 */
export function chordAtBeat(segments: readonly ChordSegment[], beat: number): Chord | null {
  assertFiniteNumber(beat, 'timeline query beat');
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((segments[middle]?.startBeat ?? Number.POSITIVE_INFINITY) <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const candidate = segments[low - 1];
  return candidate !== undefined && beat >= candidate.startBeat && beat < candidate.endBeat
    ? candidate.chord
    : null;
}

/** Build the `at(beat)` lookup a {@link ChordTimeline} carries. */
function segmentLookup(segments: ChordSegment[]): (beat: number) => Chord | null {
  return (beat) => chordAtBeat(segments, beat);
}

const EPS = 1e-9;

/** Fraction of the strongest pitch-class weight below which a pc is noise. */
const NOISE_THRESHOLD_RATIO = 0.2;

/** Maximum number of pitch classes fed to chord detection per window. */
const MAX_DETECTION_PCS = 6;

/** Confidence multiplier applied when the chosen chord match is inexact. */
const INEXACT_CONFIDENCE_FACTOR = 0.85;

/** Score bonus for a match whose tones are all in the key. */
const DIATONIC_BONUS = 0.5;

/** Score bonus for an exact match (no extra and no missing tones). */
const EXACT_BONUS = 0.5;

/**
 * Score penalty per sounding pitch class a match leaves unexplained.
 *
 * Larger than {@link DIATONIC_BONUS} deliberately: key membership may separate
 * two readings that account for the same notes, but it may not buy the
 * discarding of a note that sounded. Were the two the same size, a dominant
 * voiced without its fifth would read as the triad the key happens to contain —
 * C E Bb in C major as `C`, which drops the tritone the chord exists for and
 * asserts a G nobody played.
 */
const EXTRA_TONE_PENALTY = 0.6;

/**
 * Score penalty per chord tone the voicing omits.
 *
 * {@link detectChord} admits one absent tone and only the perfect fifth, so this
 * is the cost of a shell voicing rather than of a misreading — small, because
 * dropping the fifth is ordinary practice, and non-zero, so a complete voicing
 * still outranks an incomplete reading of the same notes.
 */
const OMITTED_TONE_PENALTY = 0.15;

/**
 * Standing a match's root earns from being the sounding bass, on the 0..1 scale
 * a root's share of the window's weight is measured on.
 *
 * The bass is the strongest single indicator of a root there is, so a candidate
 * it puts in root position is not judged on how loudly that root happens to be
 * sounding: a shell voicing whose seventh is the loudest thing in the window
 * still has its root underneath it, and reading it from the loudest pitch class
 * instead re-roots the chord onto a tone that is merely prominent.
 *
 * Short of 1 because the bass is evidence rather than proof — a pitch class that
 * actually carries the window's weight still outranks a bass that does not,
 * which is what keeps a chord voiced in inversion from being re-rooted onto its
 * own bass note.
 */
const BASS_ROOT_STANDING = 0.95;

/**
 * Semitones in an octave, as the boundary between a chord's core tones and the
 * extensions written above them: a ninth is a second an octave up.
 */
const OCTAVE = 12;

/**
 * How {@link chordTimelineFromNotes} decides where one chord ends and the next
 * begins.
 *
 * `'dynamic'` searches for the boundaries the notes actually imply, so a bar
 * holding two chords yields two segments and a bar holding one yields one.
 * `'grid'` cuts a segment every `harmonicRhythm` beats regardless of what
 * sounds, which is only right when the harmonic rhythm is known to be fixed.
 *
 * @category Arrangement & Analysis
 */
export type ChordSegmentation = 'dynamic' | 'grid';

/**
 * Options controlling {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineOptions = {
  /**
   * Key context held across the whole span. Omit it to have the key searched
   * for over time with {@link keyTimelineFromNotes}, which is what lets a piece
   * that modulates be analysed against the key actually in force.
   *
   * Taken in whatever form the caller holds a key, and kept whole: the region
   * built from it carries the spelling and the scale form it was named with, so
   * an Ab minor stated here is an Ab minor in the result.
   */
  key?: KeyLike;
  /**
   * A single time signature held across the whole span, as sugar for a
   * one-element `meters`; defaults to 4/4. Giving both is an input error.
   *
   * @defaultValue `4/4`
   */
  ts?: MeterLike;
  /**
   * The meter as it changes over the span. Bar lines, downbeats and metric
   * weight all follow the signature in force at the beat in question, so a
   * piece that changes meter is not read in the one it opened in.
   *
   * @defaultValue 4/4 throughout
   */
  meters?: MeterLike;
  /**
   * Length of the pickup in beats, when the piece starts with one.
   *
   * The first downbeat is beat 0 whatever precedes it, so an upbeat is written
   * at negative beats — a one-beat pickup in 4/4 sounds at beat -1. Declaring
   * its length rejects a note that starts before the pickup does; leave it
   * unset to accept any finite onset.
   *
   * @defaultValue no declared pickup
   */
  pickupBeats?: number;
  /**
   * Where chord boundaries may fall; defaults to `'dynamic'`.
   *
   * @defaultValue `'dynamic'`
   */
  segmentation?: ChordSegmentation;
  /**
   * Expected chord length in beats; defaults to the length of the opening bar.
   *
   * Under `'grid'` segmentation this is the exact window length. Under
   * `'dynamic'` it is a prior: the longer a chord is expected to last, the more
   * evidence a change needs before the search will place one.
   *
   * @defaultValue the length of the opening bar
   */
  harmonicRhythm?: number;
  /**
   * Resolution the `'dynamic'` search looks for changes at, in beats; defaults
   * to one main pulse of the meter — a quarter in 4/4, a dotted quarter in 6/8.
   * Lower it to catch changes on off-beats, at the cost of proportionally more
   * work. Values above `harmonicRhythm` are clamped to it, and the option is
   * ignored under `'grid'` segmentation.
   *
   * The search reads it as a resolution rather than as an exact slot length: it
   * rounds down to a whole division of the meter's pulse, so `0.6` in 4/4 is
   * read in half-beats. That keeps every pulse of the meter, and the bar lines
   * with them, on the grid whatever resolution is asked for, and with them every
   * change a coarser setting found. A resolution coarser than one pulse is
   * therefore read as one pulse rather than stepping over the beats a change is
   * heard on.
   *
   * @defaultValue one main pulse of the meter
   */
  minChordBeats?: number;
  /**
   * End of the analyzed span in beats; defaults to the end of the last note.
   *
   * @defaultValue the end of the last note
   */
  totalBeats?: number;
  /**
   * Upper bound on the work this call may do — note counts, windows, and
   * candidate counts are each checked against it before anything is allocated.
   *
   * Raise it to analyse a piece larger than the default allows; the default is
   * {@link DEFAULT_GENERATION_BUDGET}, chosen so a runaway input fails fast
   * rather than blocking the thread.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * The result of {@link chordTimelineFromNotes}.
 *
 * @category Arrangement & Analysis
 */
export type ChordTimelineResult = {
  /** The inferred timeline, with adjacent identical chords merged. */
  timeline: ChordTimeline;
  /**
   * The key regions the analysis ran against, in time order. A piece that does
   * not modulate yields one region covering the whole span; a given `key`
   * yields exactly one region too, since the caller has already answered the
   * question. Either way the first region starts where the analysis does, which
   * is before beat 0 when the piece opens with a pickup. Pivot chords are filled
   * in where the chords support one.
   */
  keys: KeyRegion[];
  /**
   * The key held longest across {@link ChordTimelineResult.keys} — the one to
   * print on a key signature or hand to a generator that takes a single key.
   */
  prevailingKey: ResolvedKey;
  /** One confidence value in [0, 1] per segment, in segment order. */
  segmentConfidence: number[];
};

/** A window's inferred chord and its confidence, or null for an empty window. */
type WindowChord = {
  chord: Chord;
  confidence: number;
  /**
   * The augmented-sixth reading of the very same tones, when they spell one over
   * the sounding bass.
   *
   * A window cannot tell whether that reading is the one the music supports,
   * because what decides it is where the harmony goes next. So both readings are
   * carried out of the window and {@link resolvesOntoDominant} settles which one
   * the segment reports.
   */
  augmented?: { chord: Chord; confidence: number };
};

/**
 * Score a chord match against a window's pitch-class weights: a root that
 * carries weight or stands in the bass, in-key tones, and exactness all raise
 * the score; a sounding pitch class the chord does not name and a chord tone the
 * voicing omits both lower it.
 *
 * The two costs are not the same size. What sounded is the evidence, so leaving
 * a pitch class out of the reading costs more than the key can make up, while
 * the absent perfect fifth {@link detectChord} allows costs little — that is
 * what keeps a shell voicing named by the chord it plays rather than by the
 * triad its key prefers.
 */
function scoreMatch(
  match: ChordMatch,
  weights: number[],
  maxWeight: number,
  key: KeyScale,
  pedalPc: number | null,
): number {
  const rootWeight = maxWeight > 0 ? (weights[match.rootPc] ?? 0) / maxWeight : 0;
  // `inversion === 0` is exactly "the sounding bass is this candidate's root".
  // It is null when the window offered no usable bass, so a bass that was
  // filtered out as noise lifts nothing.
  const rootStanding =
    match.inversion === 0 ? Math.max(rootWeight, BASS_ROOT_STANDING) : rootWeight;
  const chord = makeChord(match.rootPc, match.quality);
  const account = matchAccount(match, chord, pedalPc);
  let score = rootStanding;
  if (chordPitchClasses(chord).every((pc) => isScaleTone(pc, key))) {
    score += DIATONIC_BONUS;
  }
  if (account.exact) {
    score += EXACT_BONUS;
  }
  score -= EXTRA_TONE_PENALTY * account.extras;
  score -= OMITTED_TONE_PENALTY * account.missing;
  return score;
}

/**
 * The qualities a slash chord's upper structure is written in.
 *
 * A complete plain triad over a foreign bass is what the notation exists for —
 * `F/G`, `Dm/G`, `C/D` — and it is how such a bar is written on a chart. An
 * altered or extended upper structure over a foreign bass is not: whatever those
 * tones spell, they are read as a chord of their own rather than as a triad
 * standing on someone else's bass.
 */
const SLASH_UPPER_QUALITIES: ReadonlySet<ChordQuality> = new Set<ChordQuality>(['maj', 'min']);

/**
 * Whether a candidate reads the window as a triad standing on a foreign bass.
 *
 * Every tone of the triad sounds, the bass is the one thing outside it, and the
 * bass is heard nowhere above it. That is a slash chord, and the bass is part of
 * the reading rather than a pitch class it failed to name.
 */
function isSlashReading(match: ChordMatch, pedalPc: number | null): boolean {
  return (
    pedalPc !== null &&
    match.inversion === null &&
    match.missingPcs.length === 0 &&
    match.extraPcs.length === 1 &&
    match.extraPcs[0] === pedalPc &&
    SLASH_UPPER_QUALITIES.has(match.quality)
  );
}

/** How much of a window a candidate accounts for, and what it costs to. */
type MatchAccount = {
  /** Sounding pitch classes the candidate does not name. */
  extras: number;
  /** Chord tones nothing voices. */
  missing: number;
  /** Whether the candidate accounts for the window exactly. */
  exact: boolean;
};

/**
 * Whether a candidate names a pitch class as an upper extension — a tone voiced
 * an octave or more above the root, which is what a ninth, an eleventh or a
 * thirteenth is — rather than as one of its core tones.
 */
function namesAsExtension(chord: Chord, pc: number): boolean {
  return chord.intervals.some((iv) => iv >= OCTAVE && pitchClass(chord.rootPc + iv) === pc);
}

/**
 * Weigh a candidate against the window with the pedal bass set aside.
 *
 * A ninth, an eleventh or a thirteenth is a tone voiced above the chord. When the
 * only thing sounding that pitch class is the bass, the reading naming it an
 * extension has not explained the bass at all: it is short the tone it claims,
 * and the bass it was supposed to account for is still unaccounted for. Both are
 * charged, so the reading loses to the slash chord that says what the input
 * played — otherwise the two readings of `G2 + F4 A4 C5` are separated by the
 * exactness bonus alone and the ninth nobody played wins every time.
 *
 * The slash reading, for its part, is not charged for the bass at all: it names
 * it, in the only place a chord symbol can. It earns no exactness either, since
 * the chord proper does not contain the bass, so a reading that does contain
 * every sounding tone still outranks it.
 */
function matchAccount(match: ChordMatch, chord: Chord, pedalPc: number | null): MatchAccount {
  const unvoiced = pedalPc !== null && namesAsExtension(chord, pedalPc) ? 1 : 0;
  const named = isSlashReading(match, pedalPc) ? 1 : 0;
  return {
    extras: match.extraPcs.length - named + unvoiced,
    missing: match.missingPcs.length + unvoiced,
    exact: match.exact && unvoiced === 0,
  };
}

/**
 * Whether the window's bass pitch class is heard only underneath the harmony.
 *
 * The upper structure is everything sounding above the lowest note that is not
 * the bass pitch class itself; a bass doubled at the octave is still a bass. When
 * the pitch class never reaches into that structure, no voice above the chord
 * sounds it, and the extended readings that would name it a ninth or an eleventh
 * have nothing to name.
 */
function bassSoundsOnlyBelow(
  notes: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
  bassPc: number,
): boolean {
  let upperFloor = Number.POSITIVE_INFINITY;
  let highestBass = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    const overlap =
      Math.min(note.startBeat + note.durationBeat, windowEnd) -
      Math.max(note.startBeat, windowStart);
    if (overlap <= EPS) {
      continue;
    }
    if (pitchClass(note.pitch) === bassPc) {
      highestBass = Math.max(highestBass, note.pitch);
    } else {
      upperFloor = Math.min(upperFloor, note.pitch);
    }
  }
  return highestBass <= upperFloor;
}

/** Confidence of a chord for a window: chord-tone weight over total weight. */
function chordConfidence(
  chord: Chord,
  weights: number[],
  totalWeight: number,
  exact: boolean,
): number {
  const tones = new Set(chordPitchClasses(chord));
  let chordWeight = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    if (tones.has(pc)) {
      chordWeight += weights[pc] ?? 0;
    }
  }
  const raw = totalWeight > 0 ? chordWeight / totalWeight : 0;
  const confidence = Math.min(1, Math.max(0, raw));
  return exact ? confidence : confidence * INEXACT_CONFIDENCE_FACTOR;
}

/**
 * Infer the chord sounding in one window from the notes overlapping it.
 *
 * Builds a pitch-class weight histogram (overlap duration x velocity x
 * metric-accent bonus for onsets inside the window), keeps the significantly
 * weighted pitch classes, and picks the best {@link detectChord} match by the
 * standing of its root — the weight it carries, or the bass it stands in — plus
 * key membership, exactness, and how much of the window it accounts for.
 */
function analyzeWindow(
  notes: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
  meters: MeterMap,
  key: ResolvedKey,
): WindowChord | null {
  const { weights, totalWeight, maxWeight, lowestPitch } = windowWeights(
    notes,
    windowStart,
    windowEnd,
    meters,
  );
  if (totalWeight <= EPS) {
    return null;
  }

  // Keep pitch classes with meaningful weight, strongest first.
  const ranked = weights
    .map((weight, pc) => ({ pc, weight }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight || a.pc - b.pc);
  const selected = ranked
    .filter(({ weight }) => weight >= maxWeight * NOISE_THRESHOLD_RATIO)
    .slice(0, MAX_DETECTION_PCS)
    .map(({ pc }) => pc);

  // Feed detection with the window's true bass as the lowest pitch so inversion
  // detection works. If that pitch class was removed as noise, detection must
  // become unordered instead: promoting the strongest remaining tone to bass
  // manufactures a slash chord that the input never established.
  const bassPc = pitchClass(lowestPitch);
  const hasBass = selected.includes(bassPc);
  const detectionPitches = hasBass
    ? selected.map((pc) => (pc === bassPc ? pc : pc + 12))
    : selected;

  // A bass heard nowhere above the harmony is a bass, whatever pitch class it
  // carries, so no reading may spend it twice — once as the slash the input
  // played and once as an extension it did not.
  const pedalPc =
    hasBass && bassSoundsOnlyBelow(notes, windowStart, windowEnd, bassPc) ? bassPc : null;

  const matches = detectChord(detectionPitches, { input: hasBass ? 'midi' : 'pitchClass' });
  let bestMatch: ChordMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const score = scoreMatch(match, weights, maxWeight, scaleOf(key), pedalPc);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }
  if (bestMatch) {
    const chord = makeChord(bestMatch.rootPc, bestMatch.quality, bestMatch.bassPc);
    const account = matchAccount(
      bestMatch,
      makeChord(bestMatch.rootPc, bestMatch.quality),
      pedalPc,
    );
    const reading: WindowChord = {
      chord: shared(chord),
      confidence: chordConfidence(chord, weights, totalWeight, account.exact),
    };
    // An augmented sixth is a bass and an interval rather than a stack of
    // thirds, so no tertian match can carry one: over the lowered submediant
    // the same pitch classes are read as bVI7, whose seventh is spelled a
    // semitone below where the augmented sixth is. What those tones could spell
    // is worked out here, where the sounding bass and the key are both known;
    // whether they do is not a question this window can answer, so the reading
    // is offered alongside the tertian one rather than taken over it.
    const augmented = hasBass ? augmentedSixthFromPitchClasses(selected, bassPc, key) : null;
    if (augmented !== null) {
      // Its tones are exactly the window's, so it explains them exactly.
      reading.augmented = {
        chord: shared(augmented),
        confidence: chordConfidence(augmented, weights, totalWeight, true),
      };
    }
    return reading;
  }

  return null;
}

/**
 * A chord that more than one analysis holds at once.
 *
 * A window's reading is cached and handed to the next analysis of the same
 * span, so one object reaches both the analysis made before an edit and the one
 * made after it. The earlier analysis is what a host keeps in order to undo, and
 * an undo state that the next edit can rewrite is not a snapshot: renaming a
 * root for display in the current timeline would silently rename it in the one
 * being held. Freezing says so where the object is made, rather than leaving
 * every reader to copy defensively.
 */
function shared(chord: Chord): Chord {
  Object.freeze(chord.intervals);
  return Object.freeze(chord);
}

/** Semitones from a tonic up to its dominant. */
const DOMINANT_ABOVE_TONIC = 7;

/**
 * Whether the augmented-sixth reading offered at `index` is the one the music
 * supports.
 *
 * The family is defined by an outward resolution onto the dominant, so the
 * reading is accepted only where the harmony gets there: straight onto V or V7,
 * or through a dominant preparation already standing on the dominant in the bass
 * — the cadential six-four, which is the dominant arriving under a suspension
 * rather than another chord in the way. Anything else the same tones move to,
 * the tonic above all, is an ordinary bVI7 acting as a backdoor dominant or a
 * chromatic mediant, and its seventh is a minor seventh.
 *
 * A candidate with no harmony sounding after it ends the piece with its
 * resolution still to come, which is silence rather than evidence against it.
 * A rest between the two chords is read the same way, and a window repeating the
 * candidate's own chord is the same harmony held on across a boundary.
 */
function resolvesOntoDominant(
  readings: readonly (WindowChord | null)[],
  index: number,
  key: KeyScale,
): boolean {
  const dominantPc = pitchClass(key.rootPc + DOMINANT_ABOVE_TONIC);
  const candidate = readings[index]?.chord;
  for (let i = index + 1; i < readings.length; i += 1) {
    const next = readings[i];
    if (!next) {
      continue;
    }
    const chord = next.chord;
    if (candidate !== undefined && sameChord(chord, candidate)) {
      continue;
    }
    if (pitchClass(chord.bassPc ?? chord.rootPc) !== dominantPc) {
      return false;
    }
    if (pitchClass(chord.rootPc) === dominantPc) {
      return true;
    }
    // Standing on the dominant bass without being the dominant is the
    // preparation the dominant arrives through, so the dominant it prepares is
    // what the next window still has to hold.
  }
  return true;
}

/** Whether two chords are the same root, quality, and bass. */
function sameChord(a: Chord, b: Chord): boolean {
  return a.rootPc === b.rootPc && a.quality === b.quality && a.bassPc === b.bassPc;
}

/**
 * Chord qualities the boundary search considers.
 *
 * This lexicon only has to be rich enough to tell "the harmony changed here"
 * from "it did not": the chord a segment finally reports comes from
 * {@link analyzeWindow} over the settled span, which searches the full quality
 * table. Adding rarer qualities here would slow every slot down without
 * changing where the boundaries land.
 */
const SEGMENTATION_QUALITIES: readonly ChordQuality[] = [
  'maj',
  'min',
  'dim',
  'aug',
  'dom7',
  'maj7',
  'min7',
  'm7b5',
  'dim7',
  'sus4',
  '6',
  'min6',
];

/**
 * The 12 x {@link SEGMENTATION_QUALITIES} lexicon, built once and held flat.
 *
 * Candidate `c` has root `LEXICON_ROOTS[c]` and sounds the pitch classes in
 * `LEXICON_TONES` from `LEXICON_TONE_START[c]` up to `LEXICON_TONE_START[c + 1]`.
 * The search scores every candidate against every slot of the piece, so the
 * inner loop reads a flat table rather than chasing one object and one array per
 * candidate.
 */
const LEXICON_SIZE = 12 * SEGMENTATION_QUALITIES.length;
const LEXICON_ROOTS = new Int32Array(LEXICON_SIZE);
const LEXICON_TONE_START = new Int32Array(LEXICON_SIZE + 1);
const LEXICON_TONES: Int32Array = (() => {
  const tones: number[] = [];
  let candidate = 0;
  for (let rootPc = 0; rootPc < 12; rootPc += 1) {
    for (const quality of SEGMENTATION_QUALITIES) {
      LEXICON_ROOTS[candidate] = rootPc;
      LEXICON_TONE_START[candidate] = tones.length;
      tones.push(...chordPitchClasses(makeChord(rootPc, quality)));
      candidate += 1;
    }
  }
  LEXICON_TONE_START[candidate] = tones.length;
  return Int32Array.from(tones);
})();

/** Weight of a slot's non-chord tones, relative to its chord tones. */
const OUTSIDE_TONE_PENALTY = 1;

/** Penalty per absent chord tone, in units of the candidate's average tone weight. */
const MISSING_TONE_PENALTY = 0.5;

/** Extra credit for the candidate's root carrying weight of its own. */
const ROOT_PRESENCE_BONUS = 0.3;

/**
 * Cost of one chord change, as a fraction of the evidence an expected-length
 * chord carries. A change has to improve the fit by at least this much to be
 * worth making, which is what keeps passing tones and appoggiaturas from
 * splitting a segment.
 */
const CHANGE_COST = 0.35;

/** How much of the change cost a maximally strong beat waives. */
const STRONG_BEAT_DISCOUNT = 0.5;

/** The largest value {@link metricWeight} returns (a downbeat). */
const MAX_METRIC_WEIGHT = 3;

/**
 * Score how well one lexicon candidate explains a slot's weights.
 *
 * Chord tones earn their weight, everything else sounding costs it, and each
 * chord tone that never sounds costs a share of what the candidate would have
 * earned had it been complete — so a triad is not rewarded for the two thirds
 * of itself that are missing.
 */
function candidateScore(
  candidate: number,
  weights: readonly number[],
  totalWeight: number,
): number {
  const first = LEXICON_TONE_START[candidate] ?? 0;
  const last = LEXICON_TONE_START[candidate + 1] ?? first;
  let covered = 0;
  let missing = 0;
  for (let index = first; index < last; index += 1) {
    const weight = weights[LEXICON_TONES[index] ?? 0] ?? 0;
    covered += weight;
    if (weight <= EPS) {
      missing += 1;
    }
  }
  const outside = totalWeight - covered;
  const averageToneWeight = totalWeight / (last - first);
  return (
    covered -
    OUTSIDE_TONE_PENALTY * outside -
    MISSING_TONE_PENALTY * missing * averageToneWeight +
    ROOT_PRESENCE_BONUS * (weights[LEXICON_ROOTS[candidate] ?? 0] ?? 0)
  );
}

/** A half-open span of slots the boundary search settled on. */
type BoundarySpan = { startBeat: number; endBeat: number };

/**
 * The grid the span is examined in is the shared {@link SlotGrid}: equal slots
 * of `slotBeats`, starting at `origin`. The origin is 0 for a piece that starts
 * on the downbeat, negative for one that starts with a pickup, and the excerpt's
 * own first slot for one lifted from later in a piece; {@link gridForNotes}
 * places it, and the key search cuts its own slots on a grid of the same shape.
 */

/** First beat of slot `index`. */
function beatOfSlot(grid: SlotGrid, index: number): number {
  return grid.origin + index * grid.slotBeats;
}

/** Index of the slot containing `beat`, unclamped. */
function slotOfBeat(grid: SlotGrid, beat: number): number {
  return (beat - grid.origin) / grid.slotBeats;
}

/**
 * The tables the boundary search runs on, sized once for the whole piece.
 *
 * Every field is indexed by absolute slot, so a run of slots is searched by
 * bounds rather than by being copied out — and a cell of the recurrence is a
 * pair of numbers in a typed array rather than an object. The score table is
 * also the only part of the search that depends on what the notes are, which is
 * what lets an unchanged slot's row be carried over from a previous analysis.
 */
export type BoundaryTables = {
  /** Fit of slot `i` to candidate `c`, at `scores[i * LEXICON_SIZE + c]`. */
  scores: Float64Array;
  /** Chosen predecessor of slot `i`, candidate `c`, at the same index. */
  back: Int32Array;
  /** The two rolling cost rows the recurrence alternates between. */
  costs: Float64Array;
  spare: Float64Array;
  /** The winning candidate of each slot, filled by the backward pass. */
  path: Int32Array;
};

/** Allocate the boundary-search tables for a piece of `slotCount` slots. */
export function createBoundaryTables(slotCount: number): BoundaryTables {
  return {
    scores: new Float64Array(slotCount * LEXICON_SIZE),
    back: new Int32Array(slotCount * LEXICON_SIZE),
    costs: new Float64Array(LEXICON_SIZE),
    spare: new Float64Array(LEXICON_SIZE),
    path: new Int32Array(slotCount),
  };
}

/**
 * Score one slot against the whole lexicon, into its row of the score table.
 *
 * A slot carrying no weight scores zero everywhere, which is what the row
 * already holds, so silence costs nothing to score.
 */
export function scoreSlot(tables: BoundaryTables, slot: WindowWeights, index: number): void {
  const base = index * LEXICON_SIZE;
  if (slot.totalWeight <= EPS) {
    tables.scores.fill(0, base, base + LEXICON_SIZE);
    return;
  }
  for (let c = 0; c < LEXICON_SIZE; c += 1) {
    tables.scores[base + c] = candidateScore(c, slot.weights, slot.totalWeight);
  }
}

/**
 * Choose chord boundaries over one run of slots by dynamic programming.
 *
 * Every slot is scored against the whole lexicon; the optimal path trades the
 * per-slot fit against a fixed cost per chord change, discounted on strong
 * beats so that a change lands on the bar line rather than a beat either side
 * of it. Because the change cost is the same whichever candidate is left
 * behind, the previous stage collapses to "stay on this candidate" versus
 * "come from the cheapest one", which keeps the search linear in the lexicon
 * rather than quadratic.
 */
function chooseBoundaries(
  tables: BoundaryTables,
  from: number,
  to: number,
  grid: SlotGrid,
  meters: MeterMap,
  changeCost: number,
): BoundarySpan[] {
  const width = to - from;
  if (width <= 0) {
    return [];
  }
  const { scores, back, path } = tables;
  // Costs are negated scores, so the search minimises.
  let costs = tables.costs;
  let next = tables.spare;
  for (let c = 0; c < LEXICON_SIZE; c += 1) {
    costs[c] = -(scores[from * LEXICON_SIZE + c] ?? 0);
  }
  for (let i = 1; i < width; i += 1) {
    let cheapest = Number.POSITIVE_INFINITY;
    let cheapestIndex = 0;
    for (let c = 0; c < LEXICON_SIZE; c += 1) {
      const cost = costs[c] ?? Number.POSITIVE_INFINITY;
      if (cost < cheapest) {
        cheapest = cost;
        cheapestIndex = c;
      }
    }
    const slotStart = beatOfSlot(grid, from + i);
    const accent = metricWeight(slotStart, meters);
    const penalty = changeCost * (1 - (STRONG_BEAT_DISCOUNT * accent) / MAX_METRIC_WEIGHT);
    const rowBase = (from + i) * LEXICON_SIZE;
    const change = cheapest + penalty;
    for (let c = 0; c < LEXICON_SIZE; c += 1) {
      const stay = costs[c] ?? Number.POSITIVE_INFINITY;
      // Ties hold the current chord: a change has to be strictly better.
      const carried = stay <= change ? stay : change;
      back[rowBase + c] = stay <= change ? c : cheapestIndex;
      next[c] = carried - (scores[rowBase + c] ?? 0);
    }
    const previous = costs;
    costs = next;
    next = previous;
  }

  let best = 0;
  for (let c = 1; c < LEXICON_SIZE; c += 1) {
    if ((costs[c] ?? Number.POSITIVE_INFINITY) < (costs[best] ?? Number.POSITIVE_INFINITY)) {
      best = c;
    }
  }
  let current = best;
  for (let i = width - 1; i >= 0; i -= 1) {
    path[from + i] = current;
    if (i > 0) {
      current = back[(from + i) * LEXICON_SIZE + current] ?? current;
    }
  }

  const spans: BoundarySpan[] = [];
  let runStart = 0;
  for (let i = 1; i <= width; i += 1) {
    if (i === width || path[from + i] !== path[from + runStart]) {
      spans.push({
        startBeat: beatOfSlot(grid, from + runStart),
        endBeat: beatOfSlot(grid, from + i),
      });
      runStart = i;
    }
  }
  return spans;
}

/**
 * The slot length a requested resolution is read at: a whole division of the
 * meter's own grid, never coarser than the caller asked for.
 *
 * A change is discounted on strong beats, and the strongest of them are the main
 * pulses of the meter. A grid that steps over those beats never earns the
 * discount, so the search reports no change anywhere and a run of alternating
 * harmony comes back as one segment naming a chord that never sounded — which is
 * what a grid counted in quarters does to a compound meter, where the pulse is a
 * dotted quarter and the quarters fall between the beats a player feels.
 * Dividing the pulse keeps every pulse in the span, and the bar lines with them,
 * on the grid at every resolution: that is what makes the resolution a knob
 * rather than a trap, since every setting finds the changes the coarser settings
 * found.
 *
 * @param gridUnit The meter's grid step in beats, from {@link metricGridUnit}.
 * @param minChordBeats Shortest chord the caller will accept, in beats.
 * @param harmonicRhythm Expected chord length in beats; a resolution coarser
 *   than one expected chord is read as that chord, since a search cannot report
 *   a boundary it never looks for.
 * @returns The slot length, which divides the meter's grid step exactly.
 */
function slotBeatsWithin(gridUnit: number, minChordBeats: number, harmonicRhythm: number): number {
  const resolution = Math.min(minChordBeats, harmonicRhythm);
  const divisions = Math.max(1, Math.ceil(gridUnit / resolution - EPS));
  return gridUnit / divisions;
}

/** One span per slot: the fixed grid, unchanged. */
function gridSpans(slotCount: number, grid: SlotGrid): BoundarySpan[] {
  return Array.from({ length: slotCount }, (_, i) => ({
    startBeat: beatOfSlot(grid, i),
    endBeat: beatOfSlot(grid, i + 1),
  }));
}

/**
 * Place chord boundaries where the notes imply them.
 *
 * Silence long enough to be a chord of its own ends the run: nothing sounds
 * across it, so nothing may be merged across it either, and `at(beat)` answers
 * null there. A shorter rest is absorbed — a chord is not over because the
 * players took a breath.
 */
function dynamicSpans(
  slotWeights: readonly WindowWeights[],
  tables: BoundaryTables,
  grid: SlotGrid,
  harmonicRhythm: number,
  meters: MeterMap,
): BoundarySpan[] {
  const slotBeats = grid.slotBeats;
  const slotCount = slotWeights.length;
  let soundingSlots = 0;
  let weightSum = 0;
  for (let i = 0; i < slotCount; i += 1) {
    const weight = slotWeights[i]?.totalWeight ?? 0;
    if (weight > EPS) {
      soundingSlots += 1;
      weightSum += weight;
    }
  }
  if (soundingSlots === 0) {
    return [];
  }
  // The change cost is expressed in the same weight units the slot scores are,
  // scaled to one expected chord's worth of evidence: a change must be worth
  // that much of the fit before the search will make it, whatever the absolute
  // loudness or note lengths of the piece happen to be.
  //
  // A slot's weight is proportional to its length, so the mean cancels the
  // slots-per-chord factor and the cost depends on `harmonicRhythm` alone. That
  // is what makes `minChordBeats` a resolution knob rather than a sensitivity
  // one: asking for finer slots finds a boundary in more places, but does not
  // change how much evidence placing one takes.
  const meanSlotWeight = weightSum / soundingSlots;
  const changeCost = CHANGE_COST * meanSlotWeight * (harmonicRhythm / slotBeats);

  const silent = slotWeights.map((slot) => slot.totalWeight <= EPS);
  const breaks = new Array<boolean>(slotCount).fill(false);
  for (let i = 0; i < slotCount; ) {
    if (!silent[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < slotCount && silent[end]) {
      end += 1;
    }
    if ((end - i) * slotBeats >= harmonicRhythm - EPS) {
      for (let k = i; k < end; k += 1) {
        breaks[k] = true;
      }
    }
    i = end;
  }

  const spans: BoundarySpan[] = [];
  for (let i = 0; i < slotCount; ) {
    if (breaks[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < slotCount && !breaks[end]) {
      end += 1;
    }
    spans.push(...chooseBoundaries(tables, i, end, grid, meters, changeCost));
    i = end;
  }
  return spans;
}

/** The distinct notes overlapping a span, gathered from the slots it covers. */
function notesOfSpan(
  slotNotes: readonly NoteEvent[][],
  span: BoundarySpan,
  grid: SlotGrid,
): NoteEvent[] {
  const first = Math.round(slotOfBeat(grid, span.startBeat));
  const lastExclusive = Math.round(slotOfBeat(grid, span.endBeat));
  if (lastExclusive - first === 1) {
    return [...(slotNotes[first] ?? [])];
  }
  // A note held across several slots appears in each of them; the histogram
  // weighs by overlap, so counting it twice would double its influence.
  const seen = new Set<NoteEvent>();
  for (let i = first; i < lastExclusive; i += 1) {
    for (const note of slotNotes[i] ?? []) {
      seen.add(note);
    }
  }
  return [...seen];
}

/**
 * Infer a chord timeline from raw multi-track notes.
 *
 * Chord boundaries are searched for rather than assumed: the span is examined
 * in slots of one main pulse, subdivided as finely as `minChordBeats` asks for,
 * and the change points that best explain the notes
 * are chosen, trading each slot's harmonic fit against a cost per chord change
 * that a strong beat discounts. A bar holding two chords therefore yields two
 * segments and a bar holding one yields one, without the caller having to know
 * the harmonic rhythm in advance. Pass `segmentation: 'grid'` to cut a segment
 * every `harmonicRhythm` beats instead.
 *
 * Each settled segment's chord is inferred from a pitch-class weight histogram
 * of the notes overlapping it (weight = overlap duration x velocity x
 * metric-accent bonus for onsets in the segment). Adjacent segments carrying
 * the identical chord are merged; a stretch with no notes produces no segment,
 * so `at(beat)` returns null there. Each segment carries a confidence in [0, 1]
 * — the fraction of its weight explained by chord tones, reduced when the match
 * is inexact, and duration-weighted across anything merged into it.
 *
 * Notes with a zero or negative duration never sound, so they are dropped at
 * ingest: they contribute to neither the key inference, the span, nor any
 * window's histogram.
 *
 * Bar lines, downbeats and the metric accents the boundary search discounts by
 * all follow the signature in force at the beat in question, so a piece that
 * changes meter is read in the meter it is actually in. The first downbeat is
 * beat 0, so a pickup is written at negative beats and the search still finds
 * the bar lines where the score has them.
 *
 * @param notes The notes to analyze (any number of tracks, flattened).
 * @param opts Analysis options; see {@link ChordTimelineOptions}.
 * @returns The inferred timeline, the key regions it ran against, the key that
 *   prevails across them, and per-segment confidences.
 * @throws If `harmonicRhythm` is not positive.
 * @example
 * ```ts
 * import { chordTimelineFromNotes } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 2 }, // C
 *   { pitch: 64, startBeat: 0, durationBeat: 2 }, // E
 *   { pitch: 67, startBeat: 0, durationBeat: 2 }, // G
 * ];
 * const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
 * timeline.at(0); // the chord inferred over beat 0, or null
 * prevailingKey; // the key held longest across the piece
 * ```
 * @category Arrangement & Analysis
 */
export function chordTimelineFromNotes(
  notes: readonly NoteEvent[],
  opts: ChordTimelineOptions = {},
): ChordTimelineResult {
  return analyzeTimeline(notes, opts).result;
}

/**
 * The slot-level evidence one chord-timeline analysis drew from the notes.
 *
 * Everything here is a pure function of the notes overlapping one slot, so a
 * slot the edit cannot reach carries over to the next analysis unchanged. The
 * grid itself is recorded alongside, because a carried-over row only means the
 * same thing if the slot it indexes still covers the same beats.
 *
 * Not part of the public surface: it is the private state of an incremental
 * re-analysis, and a caller holding it could pair it with notes it was never
 * derived from.
 */
export type TimelineEvidence = {
  /** The grid the slots were cut on. */
  grid: SlotGrid;
  slotCount: number;
  totalBeats: number;
  segmentation: ChordSegmentation;
  harmonicRhythm: number;
  /** Whether the key was given rather than searched for. */
  keyGiven: boolean;
  slotWeights: WindowWeights[];
  /**
   * The score table the analysis ran on, or undefined once a later analysis has
   * taken it over.
   *
   * Only one re-analysis may carry a given table forward: the carrying pass
   * writes the edited slots straight into it rather than reallocating a table
   * the size of the piece per edit, which leaves the evidence it came from with
   * rows that no longer describe its own notes. An evidence whose table has
   * moved on therefore lends nothing, and an analysis carrying it re-derives
   * every slot — the same answer, over the work a first analysis does.
   */
  tables: BoundaryTables | undefined;
  /**
   * The chord inferred over each settled span, keyed by the span's bounds and
   * the key it was read in — the two things besides the span's notes that
   * {@link analyzeWindow} depends on.
   */
  windows: Map<string, WindowChord | null>;
};

/** A half-open run of slots whose contents an edit may have changed. */
export type DirtySlots = { from: number; to: number };

/**
 * How many slots either side of an edit are treated as dirty on top of the
 * slots it actually overlaps.
 *
 * The evidence itself needs none: a slot's histogram sees exactly the notes
 * overlapping it, so an edit confined to `[startBeat, endBeat)` cannot change a
 * slot it does not touch. The extra slot is there so that an onset landing a
 * floating-point hair either side of a slot boundary cannot leave a stale row
 * behind, which would be wrong output rather than merely slow output.
 */
const DIRTY_SLOT_MARGIN = 1;

/**
 * The slots an edit over `[startBeat, endBeat)` may have changed.
 *
 * @param evidence Evidence from the analysis being updated, whose grid the
 *   slots are numbered on.
 * @param startBeat First beat the edit touched.
 * @param endBeat End of the beats the edit touched, exclusive.
 * @returns The half-open run of slots to recompute.
 */
export function dirtySlotsFor(
  evidence: TimelineEvidence,
  startBeat: number,
  endBeat: number,
): DirtySlots {
  const first = Math.floor(slotOfBeat(evidence.grid, startBeat)) - DIRTY_SLOT_MARGIN;
  const lastExclusive = Math.ceil(slotOfBeat(evidence.grid, endBeat)) + DIRTY_SLOT_MARGIN;
  return {
    from: Math.max(0, Math.min(evidence.slotCount, first)),
    to: Math.max(0, Math.min(evidence.slotCount, lastExclusive)),
  };
}

/** Whether every slot a span covers lies outside the dirty run. */
function spanIsClean(
  grid: SlotGrid,
  span: BoundarySpan,
  dirtyFrom: number,
  dirtyTo: number,
): boolean {
  const first = Math.round(slotOfBeat(grid, span.startBeat));
  const lastExclusive = Math.round(slotOfBeat(grid, span.endBeat));
  return lastExclusive <= dirtyFrom || first >= dirtyTo;
}

/** Identity of a key, for keying the per-span chord cache. */
function keyId(key: KeyScale): string {
  return `${key.rootPc}:${key.modeMask12}`;
}

/** Cache key of one settled span read in one key. */
function windowId(startBeat: number, endBeat: number, key: KeyScale): string {
  return `${startBeat}|${endBeat}|${keyId(key)}`;
}

/**
 * Whether previous evidence describes the same grid as this analysis, and so
 * may have rows carried over from it. A different grid means slot `i` no longer
 * covers the beats it did, which would silently pair a row with the wrong slot.
 */
function evidenceFits(
  previous: TimelineEvidence,
  grid: SlotGrid,
  slotCount: number,
  totalBeats: number,
  segmentation: ChordSegmentation,
  harmonicRhythm: number,
  keyGiven: boolean,
): boolean {
  return (
    previous.grid.origin === grid.origin &&
    previous.grid.slotBeats === grid.slotBeats &&
    previous.slotCount === slotCount &&
    previous.totalBeats === totalBeats &&
    previous.segmentation === segmentation &&
    previous.harmonicRhythm === harmonicRhythm &&
    previous.keyGiven === keyGiven
  );
}

/**
 * Infer a chord timeline, carrying over every slot the edit cannot reach.
 *
 * The dependency margin is worked out per stage rather than guessed at once:
 *
 * - A slot's histogram sees exactly the notes overlapping it, so the slots
 *   whose evidence an edit can change are the slots overlapping the edited
 *   beats — margin zero, rounded outward to whole slots.
 * - The boundary search has no finite margin inside a run. It is a Viterbi over
 *   the run's slots, so the winning path at any slot depends on every other
 *   slot of the run; and its change cost is calibrated on the mean weight of
 *   every sounding slot in the piece, which couples the runs to each other.
 *   The recurrence is therefore re-run over the whole piece — pure arithmetic
 *   over the carried-over score table, with no per-cell allocation.
 * - A settled span's chord depends only on the notes overlapping it, so it is
 *   carried over when the span's bounds, its key, and its slots are all
 *   unchanged. Bounds may move anywhere within a run, so which spans qualify is
 *   read off the freshly chosen boundaries rather than assumed.
 *
 * @param notes The notes to analyze.
 * @param opts Analysis options.
 * @param previous Evidence from the analysis being updated, when there is one.
 * @param dirty The slots the edit may have changed; every slot when omitted.
 * @returns The analysis and the evidence behind it.
 */
export function analyzeTimeline(
  notes: readonly NoteEvent[],
  opts: ChordTimelineOptions = {},
  previous?: TimelineEvidence,
  dirty?: DirtySlots,
): { result: ChordTimelineResult; evidence: TimelineEvidence } {
  const meters = resolveMeters(opts, 'timeline meters');
  const harmonicRhythm = opts.harmonicRhythm ?? beatsPerBarAt(0, meters);
  assertRange(harmonicRhythm, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'harmonic rhythm');
  const segmentation = opts.segmentation ?? 'dynamic';
  // One pulse by default, whatever the pulse of this meter is: a chord is not
  // expected to change faster than the meter is felt, and a resolution written
  // in quarters would step over the pulses of every compound meter.
  const gridUnit = metricGridUnit(meters);
  const minChordBeats = opts.minChordBeats ?? gridUnit;
  assertRange(minChordBeats, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'minChordBeats');
  const budget = opts.budget;
  const noteOptions: NoteEventAssertOptions = { allowNonPositiveDuration: true, budget };
  if (opts.pickupBeats !== undefined) {
    assertRange(opts.pickupBeats, 0, Number.MAX_SAFE_INTEGER, 'timeline pickupBeats');
    noteOptions.minStartBeat = -opts.pickupBeats;
  }
  assertNoteEvents(notes, 'timeline notes', noteOptions);
  // Zero/negative-length notes never sound; drop them before any inference.
  // What the passes below read is the sequence in onset order, so that is what
  // is built: none of them asks which note sounds at a beat, and an index would
  // charge every analysis for lookups it never makes.
  const sounding = sortedNoteEvents(notes.filter((note) => note.durationBeat > 0));
  const lastNoteEnd = sounding.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
  const totalBeats = opts.totalBeats ?? lastNoteEnd;
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'timeline totalBeats');
  const slotBeats =
    segmentation === 'grid'
      ? harmonicRhythm
      : slotBeatsWithin(gridUnit, minChordBeats, harmonicRhythm);
  const { origin, startBeat: musicStart } = gridForNotes(sounding, slotBeats);
  const grid: SlotGrid = { origin, slotBeats };
  // A given key is taken as read across the whole span: the caller has already
  // answered the question, and second-guessing it would make the option mean
  // "a hint" when it reads as an instruction. Its one region starts where the
  // music does rather than at beat 0, so a piece opening with a pickup is
  // covered from its first note however the key was arrived at — and the two
  // paths name the same beat, since the search reads its origin from the same
  // place. Otherwise the key is searched for over time, so a piece that
  // modulates is not analysed against the wrong key for every bar after it does.
  const keys: KeyRegion[] =
    opts.key !== undefined
      ? [
          {
            startBeat: musicStart,
            endBeat: totalBeats,
            key: resolveKey(opts.key),
            confidence: 1,
          },
        ]
      : keyTimelineFromNotes(sounding, { meters, totalBeats, budget });
  const prevailingKey = prevailingKeyOf(keys) ?? resolveKey(majorKey(0));
  const keyAt = keyLookup(keys, prevailingKey);
  // The pitch classes of the key in force. A window's chord is chosen by how
  // its notes score against those, and the cache is keyed on them; the
  // spelling the key carries reaches the caller through the regions, which
  // hold it whole.
  const scaleAt = (beat: number) => scaleOf(keyAt(beat));

  const segments: ChordSegment[] = [];
  const segmentConfidence: number[] = [];
  const slotCount = Math.max(0, Math.ceil((totalBeats - grid.origin) / slotBeats - EPS));
  const dynamic = segmentation === 'dynamic';
  // The boundary search allocates and fills one lexicon row per slot, so what
  // the budget has to bound is the table about to be built rather than the slot
  // count alone: a slot count inside the budget stands for a table the whole
  // lexicon wider. A grid cuts its segments from the grid itself and builds no
  // table, so it is charged for its slots and nothing more.
  assertGenerationBudget(
    dynamic ? slotCount * LEXICON_SIZE : slotCount,
    'timeline windows',
    budget,
  );
  const slotNotes = bucketNotesBySlot(sounding, grid, slotCount, {
    name: 'timeline note-to-window memberships',
    budget,
  });

  const carried =
    previous !== undefined &&
    dirty !== undefined &&
    previous.tables !== undefined &&
    evidenceFits(
      previous,
      grid,
      slotCount,
      totalBeats,
      segmentation,
      harmonicRhythm,
      opts.key !== undefined,
    )
      ? previous
      : undefined;
  const dirtyFrom = carried === undefined ? 0 : Math.max(0, dirty?.from ?? 0);
  const dirtyTo = carried === undefined ? slotCount : Math.min(slotCount, dirty?.to ?? slotCount);

  // A grid cuts its segments from the grid alone, so it consults no candidate
  // and needs no row per slot: an empty table keeps the evidence's shape without
  // the megabytes a search would have filled. A carried-over table is taken over
  // rather than copied — the rows the edit cannot reach are already what this
  // analysis would write into them, and reallocating the table would cost one
  // the size of the piece per edit.
  const tables = carried?.tables ?? createBoundaryTables(dynamic ? slotCount : 0);
  if (carried !== undefined) {
    // The evidence lending the table gives it up: the edited rows are about to
    // say what these notes say rather than what its own did.
    carried.tables = undefined;
  }
  const slotWeights: WindowWeights[] = new Array<WindowWeights>(slotCount);
  for (let i = 0; i < slotCount; i += 1) {
    const reusable = i < dirtyFrom || i >= dirtyTo ? carried?.slotWeights[i] : undefined;
    if (reusable !== undefined) {
      slotWeights[i] = reusable;
      continue;
    }
    const start = beatOfSlot(grid, i);
    const weights = windowWeights(
      slotNotes[i] ?? [],
      start,
      Math.min(start + slotBeats, totalBeats),
      meters,
    );
    slotWeights[i] = weights;
    if (dynamic) {
      scoreSlot(tables, weights, i);
    }
  }

  const spans =
    segmentation === 'grid'
      ? gridSpans(slotCount, grid)
      : dynamicSpans(slotWeights, tables, grid, harmonicRhythm, meters);

  const windows = new Map<string, WindowChord | null>();
  // The chord of every settled span, read before any of them is reported: an
  // augmented sixth is told from the bVI7 it sounds like by where the harmony
  // goes next, which is a question about the span after this one.
  const readings: (WindowChord | null)[] = [];
  const readingKeys: KeyScale[] = [];
  const readingBounds: { start: number; end: number }[] = [];
  for (const span of spans) {
    // The slot before the pickup is analyzed — its notes are the pickup's — but
    // the stretch of it that precedes the first note holds nothing, so the
    // segment is reported from where the music starts, as the last one is
    // reported to where it ends.
    const start = Math.max(span.startBeat, musicStart);
    const end = Math.min(span.endBeat, totalBeats);
    const spanKey = scaleAt(start);
    // The window is analysed against the key whole. Its pitch classes decide
    // which chord the notes are read as, but an augmented sixth is spelled
    // rather than scored, and a key reduced on the way in would spell one from
    // whichever side of the circle those pitch classes read best as: the Ab
    // minor the caller named would hand back the sharps of a G# minor.
    const spanKeyWhole = keyAt(start);
    const id = windowId(start, end, spanKey);
    // A span whose slots are all clean holds exactly the notes it held before,
    // so its chord and confidence are the same numbers over the same input.
    const cached =
      carried !== undefined && spanIsClean(grid, span, dirtyFrom, dirtyTo)
        ? carried.windows.get(id)
        : undefined;
    const inferred =
      cached !== undefined
        ? cached
        : analyzeWindow(notesOfSpan(slotNotes, span, grid), start, end, meters, spanKeyWhole);
    // What is cached is the window's own reading, both spellings and all: an
    // edit elsewhere can change which of them the music supports without
    // changing a note this span holds.
    windows.set(id, inferred);
    readings.push(inferred);
    readingKeys.push(spanKey);
    readingBounds.push({ start, end });
  }

  // Settle the augmented sixths against what follows them, in the key each was
  // read in — the resolution belongs to the key the chord stands in.
  for (let i = 0; i < readings.length; i += 1) {
    const offered = readings[i]?.augmented;
    const spanKey = readingKeys[i];
    if (
      offered !== undefined &&
      spanKey !== undefined &&
      resolvesOntoDominant(readings, i, spanKey)
    ) {
      readings[i] = offered;
    }
  }

  for (let i = 0; i < readings.length; i += 1) {
    const inferred = readings[i];
    const bounds = readingBounds[i];
    if (!inferred || bounds === undefined) {
      continue;
    }
    const { start, end } = bounds;
    const last = segments[segments.length - 1];
    if (last && sameChord(last.chord, inferred.chord) && Math.abs(last.endBeat - start) < EPS) {
      // Merge into the previous segment, blending confidence by duration.
      const lastLength = last.endBeat - last.startBeat;
      const length = end - start;
      const lastConfidence = segmentConfidence[segmentConfidence.length - 1] ?? 0;
      segmentConfidence[segmentConfidence.length - 1] =
        (lastConfidence * lastLength + inferred.confidence * length) / (lastLength + length);
      last.endBeat = end;
    } else {
      segments.push({ startBeat: start, endBeat: end, chord: inferred.chord });
      segmentConfidence.push(inferred.confidence);
    }
  }

  return {
    result: {
      timeline: { at: segmentLookup(segments), segments },
      keys: attachPivots(keys, segments),
      prevailingKey,
      segmentConfidence,
    },
    evidence: {
      grid,
      slotCount,
      totalBeats,
      segmentation,
      harmonicRhythm,
      keyGiven: opts.key !== undefined,
      slotWeights,
      tables,
      windows,
    },
  };
}

/**
 * A cadence found between two consecutive timeline segments.
 *
 * @category Arrangement & Analysis
 */
export type CadenceHit = {
  /** The beat where the cadence arrives (the second chord's onset). */
  atBeat: number;
  /**
   * The cadence formed by the pair. Its `type` is never null: a pair forming no
   * cadence is not a hit. A timeline names no voicing, so `strength` is null for
   * an authentic cadence whose chords are both in root position.
   */
  cadence: CadenceResult;
  from: Chord;
  to: Chord;
};

/**
 * Find cadences between consecutive segments of a chord timeline.
 *
 * Each temporally adjacent segment pair is classified with
 * {@link detectCadence}; pairs forming no cadence are skipped. Segments
 * separated by a gap (a rest in the timeline) are not a chord-to-chord
 * progression, so they are never paired.
 *
 * The segment before the pair is passed as the approach, which is what tells a
 * cadential six-four from an inverted tonic: `I I64 V I` is one cadence
 * arriving on the final tonic, described from the six-four the dominant was
 * already sounding under, rather than a half cadence onto the dominant
 * followed by an authentic one. A passing six-four — one whose dominant is not
 * what follows it — is unaffected, and so is a pair whose predecessor is
 * separated from it by a rest.
 *
 * @param timeline The chord timeline to scan.
 * @param key The prevailing key, or the key in force at a given beat.
 * @returns The cadences found, in time order.
 * @example
 * ```ts
 * import { chordTimelineFromNotes, detectCadences } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 67, startBeat: 0, durationBeat: 4 }, // G, a dominant
 *   { pitch: 60, startBeat: 4, durationBeat: 4 }, // C, the tonic
 * ];
 * const { timeline, prevailingKey } = chordTimelineFromNotes(notes);
 * const cadences = detectCadences(timeline, prevailingKey);
 * ```
 * @category Arrangement & Analysis
 */
export function detectCadences(timeline: ChordTimeline, key: KeyContext): CadenceHit[] {
  // A cadence belongs to the key it arrives in, so a modulating piece is asked
  // for the key at the arrival beat rather than for one key for the whole span.
  const keyAt = keyScaleAt(key);
  const hits: CadenceHit[] = [];
  for (let i = 1; i < timeline.segments.length; i += 1) {
    const prev = timeline.segments[i - 1];
    const cur = timeline.segments[i];
    if (!prev || !cur) {
      continue;
    }
    if (Math.abs(cur.startBeat - prev.endBeat) > EPS) {
      continue; // A rest separates the chords; no cadential motion across it.
    }
    // The chord before the pair, when it sounded straight into it: a six-four
    // across a rest was not still sounding when the dominant arrived.
    const before = timeline.segments[i - 2];
    const approach =
      before !== undefined && Math.abs(prev.startBeat - before.endBeat) <= EPS
        ? before.chord
        : undefined;
    const key = keyAt(cur.startBeat);
    const cadence = detectCadence(prev.chord, cur.chord, key, {
      ...(approach === undefined ? {} : { approach }),
    });
    if (cadence.type === null) {
      continue;
    }
    // A cadential six-four comes to rest on the dominant it stands on, which is
    // the half cadence that closes an antecedent phrase. Where that dominant
    // goes on to resolve, the six-four opened the cadence the resolution names,
    // so the pair is reported once, at the arrival — the reading the approach
    // chord already gives that resolution.
    if (cadence.type === 'half' && isCadentialSixFour(prev.chord, cur.chord, key)) {
      const next = timeline.segments[i + 1];
      if (next !== undefined && Math.abs(next.startBeat - cur.endBeat) <= EPS) {
        const onward = detectCadence(cur.chord, next.chord, keyAt(next.startBeat)).type;
        if (onward === 'authentic' || onward === 'deceptive') {
          continue;
        }
      }
    }
    hits.push({ atBeat: cur.startBeat, cadence, from: prev.chord, to: cur.chord });
  }
  return hits;
}
