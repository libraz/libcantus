/**
 * Harmonic reduction: which chords carry the progression and which decorate it.
 *
 * `analyzeVoice` can say that a note is a passing tone; a timeline is flat, so
 * nothing could say the same of a chord. This is that answer one level up — the
 * middle chord of `Cmaj7 - C#dim7 - Dm7` is an embellishment, and the frame
 * under `I - IV - #ivo7 - V - I` is `I - IV - V - I`.
 *
 * **The position taken here.** What counts as structural is a theoretical
 * choice, not a fact, and this module makes the functional one: *a chord is
 * structural unless it is demonstrably an embellishment of its neighbours*. The
 * frame is what carries harmonic function in the prevailing key — the tonic, the
 * dominant, and the chords that cadence — so those are never reduced away; a
 * chord that tonicizes something other than the tonic is prolonging, not
 * framing, however dominant its sonority. Everything else keeps its place unless
 * its root traces one of two figures against the chords around it, the same two
 * figures {@link analyzeVoice} matches at the note level: a step through
 * (passing) and a step away and back (auxiliary). Defaulting to structural, and
 * demoting only on evidence, is what keeps a reduction from quietly deleting
 * harmony it merely failed to recognize.
 *
 * The salience reading — that the frame is whatever lasts longest, regardless of
 * function — is the main alternative, and it is a live one for repertoire where
 * function is weak. {@link ReduceProgressionOptions.basis} switches to it: the
 * figures stay the same, only what protects a chord from them changes.
 *
 * Both readings are deterministic: the same timeline and key always reduce the
 * same way.
 */

import { pitchClassOf as mod12 } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordSegment } from '../../theory/chord/index.js';
import type { CadenceResult } from '../functional/index.js';
import { detectCadence } from '../functional/index.js';
import type { ChordTimeline } from '../timeline/index.js';
import type { KeyContext } from '../voice/index.js';

/**
 * Tolerance for treating two segments as touching in time.
 *
 * Segment boundaries are computed, so the end of one and the start of the next
 * meet to within rounding rather than exactly; a real gap is a rest, and chords
 * either side of a rest embellish nothing.
 */
const ADJACENCY_EPS = 1e-9;

/**
 * The place a chord holds in a progression.
 *
 * `'structural'` is the frame; `'passing'` and `'auxiliary'` are the two
 * embellishing figures, named as {@link TheoryLabel} names them for a note.
 *
 * @category Arrangement & Analysis
 */
export type ReductionLevel = 'structural' | 'passing' | 'auxiliary';

/**
 * A chord with the place it holds and a short rationale.
 *
 * One entry per timeline segment, in the same order, so a caller can read the
 * two in step — which is how a reharmonizer holds the structural chords fixed
 * and rewrites the rest.
 *
 * @category Arrangement & Analysis
 */
export type ReducedChord = {
  chord: Chord;
  level: ReductionLevel;
  rationale: string;
};

/**
 * What a reduction treats as the frame.
 *
 * `'function'` is the functional reading: the tonic, the dominant and the
 * chords that cadence are the frame. `'duration'` is the salience reading: the
 * chords that hold the harmony at least as long as the median chord are the
 * frame, whatever function they carry.
 *
 * @category Arrangement & Analysis
 */
export type ReductionBasis = 'function' | 'duration';

/**
 * Options for {@link reduceProgression}.
 *
 * @category Arrangement & Analysis
 */
export type ReduceProgressionOptions = {
  /**
   * Which reading decides what the frame is; see {@link ReductionBasis}.
   *
   * @defaultValue `'function'`
   */
  basis?: ReductionBasis;
};

/** Cadences whose arrival is the tonic or the substitute standing in for it. */
const TONIC_ARRIVING: ReadonlySet<string> = new Set(['authentic', 'plagal', 'modal', 'deceptive']);

/** Why a chord was kept in the frame, or which figure demoted it. */
type ReductionReason =
  | { kind: 'tonic' }
  | { kind: 'dominant' }
  | { kind: 'cadenceArrival'; cadence: NonNullable<CadenceResult['type']> }
  | { kind: 'cadenceAgent'; cadence: NonNullable<CadenceResult['type']> }
  | { kind: 'salient' }
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'unfigured' }
  | { kind: 'passing' }
  | { kind: 'auxiliary' };

/** Signed semitone distance between two pitch classes, in [-6, 5]. */
function signedStep(fromPc: number, toPc: number): number {
  return ((mod12(toPc) - mod12(fromPc) + 18) % 12) - 6;
}

/** Whether a root motion is a step: a semitone or a whole tone, either way. */
function isStep(distance: number): boolean {
  const size = Math.abs(distance);
  return size === 1 || size === 2;
}

/** Whether two segments touch, so that the motion between them is heard. */
function touches(before: ChordSegment, after: ChordSegment): boolean {
  return Math.abs(after.startBeat - before.endBeat) <= ADJACENCY_EPS;
}

/** Median of a list of durations, averaging the middle pair on an even count. */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Whether a chord stands on the key's tonic. */
function isTonicChord(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 0;
}

/**
 * Whether a chord is the key's own dominant.
 *
 * The major third is what makes it one: the minor v of a natural-minor key
 * carries no leading tone and frames nothing the tonic is approached from.
 */
function isDominantChord(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 7 && chord.intervals.some((iv) => mod12(iv) === 4);
}

/**
 * Why a chord belongs to the frame under the functional reading, or null when
 * nothing keeps it there.
 *
 * A cadence protects both of its chords, but asymmetrically: the arrival of any
 * cadence is a goal, while the chord driving one only holds the frame when the
 * cadence reaches the tonic. That asymmetry is what lets a chromatic chord slip
 * into a half cadence — `IV - #ivo7 - V` — and still be heard as passing,
 * while the dominant it arrives on is not.
 */
function functionalReason(
  segment: ChordSegment,
  before: ChordSegment | undefined,
  after: ChordSegment | undefined,
  keyAt: (beat: number) => KeyScale,
): ReductionReason | null {
  const key = keyAt(segment.startBeat);
  if (isTonicChord(segment.chord, key)) {
    return { kind: 'tonic' };
  }
  if (isDominantChord(segment.chord, key)) {
    return { kind: 'dominant' };
  }
  if (before !== undefined) {
    const arrival = detectCadence(before.chord, segment.chord, key).type;
    if (arrival !== null) {
      return { kind: 'cadenceArrival', cadence: arrival };
    }
  }
  if (after !== undefined) {
    const agent = detectCadence(segment.chord, after.chord, keyAt(after.startBeat)).type;
    if (agent !== null && TONIC_ARRIVING.has(agent)) {
      return { kind: 'cadenceAgent', cadence: agent };
    }
  }
  return null;
}

/** The figure a chord's root traces against its neighbours, or null for none. */
function figureReason(
  segment: ChordSegment,
  before: ChordSegment | undefined,
  after: ChordSegment | undefined,
): ReductionReason | null {
  if (before === undefined || after === undefined) {
    return null;
  }
  const incoming = signedStep(before.chord.rootPc, segment.chord.rootPc);
  const outgoing = signedStep(segment.chord.rootPc, after.chord.rootPc);
  if (!isStep(incoming) || !isStep(outgoing)) {
    return null;
  }
  // A step in and a step on in the same direction passes through; a step away
  // from a harmony that comes back is a neighbour to it.
  if (incoming > 0 === outgoing > 0) {
    return { kind: 'passing' };
  }
  return mod12(before.chord.rootPc) === mod12(after.chord.rootPc) ? { kind: 'auxiliary' } : null;
}

/** The rationale for a reduction level, in the phrasing a note label uses. */
function describe(reason: ReductionReason): string {
  switch (reason.kind) {
    case 'tonic':
      return 'Structural: the tonic of the key, which the progression is heard against';
    case 'dominant':
      return 'Structural: the dominant of the key, the chord its tonic is approached from';
    case 'cadenceArrival':
      return `Structural: the arrival of a ${reason.cadence} cadence`;
    case 'cadenceAgent':
      return `Structural: the chord that drives a ${reason.cadence} cadence`;
    case 'salient':
      return 'Structural: it holds the harmony at least as long as the median chord';
    case 'first':
      return 'Structural: the first chord of the progression frames it';
    case 'last':
      return 'Structural: the last chord of the progression frames it';
    case 'unfigured':
      return 'Structural: its root neither steps through to the next chord nor returns to the last, so it embellishes nothing';
    case 'passing':
      return 'Passing: its root steps in from the previous chord and on to the next in the same direction';
    case 'auxiliary':
      return 'Auxiliary: its root steps away from the surrounding harmony and returns to it';
  }
}

/** The level a reason places a chord at. */
function levelOf(reason: ReductionReason): ReductionLevel {
  if (reason.kind === 'passing') {
    return 'passing';
  }
  return reason.kind === 'auxiliary' ? 'auxiliary' : 'structural';
}

/**
 * Reduce a chord progression to its frame, labelling every chord.
 *
 * One entry comes back per timeline segment, in the same order, so the two read
 * in step. Filtering the result to `'structural'` is the skeleton view — the
 * `I - IV - V - I` under a progression that spells far more chords than that —
 * and holding those chords fixed is what a reharmonizer needs in order to
 * rewrite the surface without moving the harmony.
 *
 * A chord is structural unless one of two figures demotes it: its root stepping
 * in from the previous chord and on to the next in the same direction (passing),
 * or stepping away from a harmony that returns (auxiliary). Chords carrying the
 * frame are never demoted, and what carries the frame is the module's stated
 * theoretical position — see {@link ReductionBasis} for the reading this takes
 * by default and the one it can be switched to.
 *
 * Chords separated by a rest form no figure across it, the way
 * {@link detectCadences} pairs no chords across one.
 *
 * @param timeline The chord timeline to reduce.
 * @param key The prevailing key, or the key in force at a given beat, for music
 *   that modulates.
 * @param opts Which reading decides the frame; see
 *   {@link ReduceProgressionOptions}.
 * @returns One labelled chord per segment, in time order.
 * @example
 * ```ts
 * import { chordTimelineFromChords, majorKey, reduceProgression } from '@libraz/libcantus';
 * const timeline = chordTimelineFromChords(
 *   [
 *     { rootPc: 0, quality: 'maj7', startBeat: 0 },
 *     { rootPc: 1, quality: 'dim7', startBeat: 4 },
 *     { rootPc: 2, quality: 'min7', startBeat: 8 },
 *   ],
 *   12,
 * );
 * reduceProgression(timeline, majorKey(0)).map((entry) => entry.level);
 * // ['structural', 'passing', 'structural']
 * ```
 * @category Arrangement & Analysis
 */
export function reduceProgression(
  timeline: ChordTimeline,
  key: KeyContext,
  opts: ReduceProgressionOptions = {},
): ReducedChord[] {
  // A KeyScale is a plain object, so a callable value can only be the per-beat
  // form; normalising here keeps the reading below segment-oriented.
  const keyAt: (beat: number) => KeyScale = typeof key === 'function' ? key : () => key;
  const basis = opts.basis ?? 'function';
  const segments = timeline.segments;
  const salienceFloor =
    basis === 'duration'
      ? median(segments.map((segment) => segment.endBeat - segment.startBeat))
      : 0;
  const result: ReducedChord[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    const previous = segments[index - 1];
    const following = segments[index + 1];
    const before = previous !== undefined && touches(previous, segment) ? previous : undefined;
    const after = following !== undefined && touches(segment, following) ? following : undefined;

    let reason: ReductionReason | null = null;
    if (basis === 'duration') {
      if (segment.endBeat - segment.startBeat >= salienceFloor) {
        reason = { kind: 'salient' };
      }
    } else {
      reason = functionalReason(segment, before, after, keyAt);
    }
    if (reason === null && index === 0) {
      reason = { kind: 'first' };
    }
    if (reason === null && index === segments.length - 1) {
      reason = { kind: 'last' };
    }
    reason ??= figureReason(segment, before, after) ?? { kind: 'unfigured' };

    result.push({ chord: segment.chord, level: levelOf(reason), rationale: describe(reason) });
  }

  return result;
}
