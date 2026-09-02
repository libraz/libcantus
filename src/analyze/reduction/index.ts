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
 * (passing) and a step away and back (neighbor). Defaulting to structural, and
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
import { assertOneOf } from '../../core/validation/index.js';
import type { Chord, ChordSegment } from '../../theory/chord/index.js';
import { isDominantChordOf } from '../../theory/tendency/index.js';
// Segment boundaries are computed, so the end of one and the start of the next
// meet to within rounding rather than exactly; a real gap is a rest, and chords
// either side of a rest embellish nothing.
import { BEAT_EPS } from '../adjacency.js';
import { isCadentialSixFour } from '../functional/cadence.js';
import type { CadenceResult } from '../functional/index.js';
import { detectCadence } from '../functional/index.js';
import { isAppliedDominant } from '../functional/tonicization.js';
import type { ChordTimeline } from '../timeline/index.js';
import type { KeyContext } from '../voice/index.js';
import { keyScaleAt } from '../voice/index.js';

/**
 * The place a chord holds in a progression.
 *
 * `'structural'` is the frame; `'passing'` and `'neighbor'` are the two
 * embellishing figures, spelled exactly as {@link TheoryLabel} spells them for
 * a note, so one legend covers both levels of analysis.
 *
 * @category Arrangement & Analysis
 */
export type ReductionLevel = 'structural' | 'passing' | 'neighbor';

/**
 * A chord with the place it holds, the beats it holds it for, and a short
 * rationale.
 *
 * One entry per timeline segment, in the same order. The entry carries the
 * segment's own beat range, so the chords that survive a filter still say when
 * they sound: holding the structural chords fixed is what a reharmonizer needs,
 * and it cannot hold a chord at a place the filter threw away.
 *
 * @category Arrangement & Analysis
 */
export type ReducedChord = {
  chord: Chord;
  startBeat: number;
  endBeat: number;
  level: ReductionLevel;
  rationale: string;
};

/**
 * What a reduction treats as the frame.
 *
 * `'function'` is the functional reading: the tonic, the dominant and the
 * chords that cadence are the frame. `'duration'` is the salience reading: a
 * chord is the frame when it outlasts the chords around it — its length beats
 * the median of the other chords' — whatever function it carries. Nothing
 * outlasts anything in an even harmonic rhythm, so a loop or a vamp protects no
 * chord by length and the two figures decide, as they do under either reading.
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
  | { kind: 'cadentialSixFour' }
  | { kind: 'cadenceArrival'; cadence: NonNullable<CadenceResult['type']> }
  | { kind: 'cadenceAgent'; cadence: NonNullable<CadenceResult['type']> }
  | { kind: 'salient' }
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'unfigured' }
  | { kind: 'passing' }
  | { kind: 'neighbor' };

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
  return Math.abs(after.startBeat - before.endBeat) <= BEAT_EPS;
}

/**
 * The length each segment has to beat to count as salient: the median of the
 * lengths of every *other* segment.
 *
 * Leaving the segment itself out is what keeps the reading from protecting
 * everything at once. A progression whose harmonic rhythm is even — the loop, the
 * modular vamp, the cue — has every segment sitting on the median, so measuring
 * against the median of the whole set would call every chord salient and reduce
 * nothing, in exactly the repertoire the salience reading exists for. Measured
 * against its neighbours, an even progression singles out nobody and the figures
 * decide, while a chord that genuinely outlasts the harmony around it still does.
 */
function salienceFloors(durations: readonly number[]): number[] {
  const order = durations
    .map((_, index) => index)
    .sort((a, b) => {
      const left = durations[a] ?? 0;
      const right = durations[b] ?? 0;
      return left - right || a - b;
    });
  const rankOf: number[] = new Array<number>(durations.length).fill(0);
  for (let rank = 0; rank < order.length; rank += 1) {
    rankOf[order[rank] ?? 0] = rank;
  }
  const floors: number[] = [];
  const remaining = durations.length - 1;
  for (let index = 0; index < durations.length; index += 1) {
    if (remaining <= 0) {
      floors.push(0);
      continue;
    }
    const skipped = rankOf[index] ?? 0;
    const at = (position: number): number =>
      durations[order[position < skipped ? position : position + 1] ?? 0] ?? 0;
    const middle = remaining >> 1;
    floors.push(remaining % 2 === 1 ? at(middle) : (at(middle - 1) + at(middle)) / 2);
  }
  return floors;
}

/**
 * Whether a chord stands on the key's tonic and is heard as the tonic.
 *
 * The root alone does not settle it. `C7` in C major stands on the tonic and
 * tonicizes the subdominant — the function layer already reads it as a dominant
 * — and this module's position is that a chord tonicizing something other than
 * the tonic is prolonging rather than framing, however it is spelled.
 */
function isTonicChord(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 0 && !isAppliedDominant(chord, key);
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
  // Asked before the tonic, because the cadential six-four is a tonic triad and
  // would otherwise be kept as one: it stands on the bass of the dominant that
  // follows and is that dominant, not the tonic framing the progression. A
  // six-four the bass leaves — the passing `IV-I64-IV` — answers false here and
  // is read as the inverted tonic it is.
  if (after !== undefined && isCadentialSixFour(segment.chord, after.chord, key)) {
    return { kind: 'cadentialSixFour' };
  }
  if (isTonicChord(segment.chord, key)) {
    return { kind: 'tonic' };
  }
  if (isDominantChordOf(segment.chord, key)) {
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
  return mod12(before.chord.rootPc) === mod12(after.chord.rootPc) ? { kind: 'neighbor' } : null;
}

/** The rationale for a reduction level, in the phrasing a note label uses. */
function describe(reason: ReductionReason): string {
  switch (reason.kind) {
    case 'tonic':
      return 'Structural: the tonic of the key, which the progression is heard against';
    case 'dominant':
      return 'Structural: the dominant of the key, the chord its tonic is approached from';
    case 'cadentialSixFour':
      return 'Structural: a tonic six-four on the bass of the dominant that follows, which prolongs that dominant rather than framing the tonic';
    case 'cadenceArrival':
      return `Structural: the arrival of a ${reason.cadence} cadence`;
    case 'cadenceAgent':
      return `Structural: the chord that drives a ${reason.cadence} cadence`;
    case 'salient':
      return 'Structural: it holds the harmony longer than the chords around it';
    case 'first':
      return 'Structural: the first chord of the progression frames it';
    case 'last':
      return 'Structural: the last chord of the progression frames it';
    case 'unfigured':
      return 'Structural: its root neither steps through to the next chord nor returns to the last, so it embellishes nothing';
    case 'passing':
      return 'Passing: its root steps in from the previous chord and on to the next in the same direction';
    case 'neighbor':
      return 'Neighbor: its root steps away from the surrounding harmony and returns to it';
  }
}

/** What a reading is given to decide whether a chord holds the frame. */
type FrameContext = {
  segment: ChordSegment;
  before: ChordSegment | undefined;
  after: ChordSegment | undefined;
  keyAt: (beat: number) => KeyScale;
  /** The length this segment has to outlast; see {@link salienceFloors}. */
  salienceFloor: number;
};

/**
 * What keeps a chord in the frame, one entry per reading of what a frame is.
 *
 * {@link ReductionBasis} describes the two readings; the entrance check reads
 * their names out of this table, so a reading cannot be added without becoming
 * accepted input in the same edit.
 */
const BASIS_READINGS: Record<ReductionBasis, (context: FrameContext) => ReductionReason | null> = {
  function: ({ segment, before, after, keyAt }) => functionalReason(segment, before, after, keyAt),
  duration: ({ segment, salienceFloor }) =>
    segment.endBeat - segment.startBeat > salienceFloor ? { kind: 'salient' } : null,
};

/** Every reading's name, read from the table so the two cannot drift apart. */
const REDUCTION_BASES = Object.keys(BASIS_READINGS) as ReductionBasis[];

/** The level a reason places a chord at. */
function levelOf(reason: ReductionReason): ReductionLevel {
  if (reason.kind === 'passing') {
    return 'passing';
  }
  return reason.kind === 'neighbor' ? 'neighbor' : 'structural';
}

/**
 * Reduce a chord progression to its frame, labelling every chord.
 *
 * One entry comes back per timeline segment, in the same order, so the two read
 * in step. Filtering the result to `'structural'` is the skeleton view — the
 * `I - IV - V - I` under a progression that spells far more chords than that —
 * and holding those chords fixed is what a reharmonizer needs in order to
 * rewrite the surface without moving the harmony. Each entry carries its own
 * `startBeat` and `endBeat`, so a filtered chord still knows where it sounds
 * once the segments it was read against are gone.
 *
 * A chord is structural unless one of two figures demotes it: its root stepping
 * in from the previous chord and on to the next in the same direction (passing),
 * or stepping away from a harmony that returns (neighbor). Chords carrying the
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
 * @throws If `opts.basis` is not one of the readings {@link ReductionBasis}
 *   names.
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
  const keyAt = keyScaleAt(key);
  const basis = assertOneOf(opts.basis ?? 'function', REDUCTION_BASES, 'reduction basis');
  const reading = BASIS_READINGS[basis];
  const segments = timeline.segments;
  const floors =
    basis === 'duration'
      ? salienceFloors(segments.map((segment) => segment.endBeat - segment.startBeat))
      : [];
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

    let reason = reading({ segment, before, after, keyAt, salienceFloor: floors[index] ?? 0 });
    if (reason === null && index === 0) {
      reason = { kind: 'first' };
    }
    if (reason === null && index === segments.length - 1) {
      reason = { kind: 'last' };
    }
    reason ??= figureReason(segment, before, after) ?? { kind: 'unfigured' };

    result.push({
      chord: segment.chord,
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
      level: levelOf(reason),
      rationale: describe(reason),
    });
  }

  return result;
}
