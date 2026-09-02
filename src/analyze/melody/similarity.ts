/**
 * How alike two phrases are, when they stand in no named relation.
 *
 * A device the repertoire names is an account of how one phrase was made from
 * another; a similarity score is what is left to say when there is no such
 * account — that the two are near, and how near. The reading is an edit
 * distance over the intervals and over the onset gaps, so a phrase answered by
 * a slightly ornamented version of itself still reads as close.
 */

import { BEAT_EPS } from '../adjacency.js';
import type { MelodicPhrase } from './internal.js';
import {
  intervalsOf,
  onsetGaps,
  orderedNotes,
  phraseNotes,
  rhythmProfile,
  roundTo,
} from './internal.js';

/**
 * Interval difference, in semitones, at which two steps count as wholly
 * different in {@link melodicSimilarity}.
 *
 * A third answered by a fourth is nearly the same gesture; a third answered by a
 * minor seventh is not. The tritone is where the graded cost saturates, so
 * anything wider than half an octave apart costs the same as an outright
 * mismatch.
 */
const INTERVAL_TOLERANCE = 6;
/** Share of {@link melodicSimilarity} carried by the interval sequence. */
const PITCH_WEIGHT = 0.75;
/** Share of {@link melodicSimilarity} carried by the rhythmic profile. */
const RHYTHM_WEIGHT = 0.25;
/**
 * How alike two lines are, and how the answer was reached.
 *
 * @category Arrangement & Analysis
 */
export type MelodicComparison = {
  /** Overall likeness in [0, 1]; 1 for the same line, transposition included. */
  similarity: number;
  /** Likeness of the interval sequences alone, in [0, 1]. */
  pitchSimilarity: number;
  /** Likeness of the rhythmic profiles alone, in [0, 1]. */
  rhythmSimilarity: number;
  /** Why the lines scored what they did. */
  rationale: string;
};
/**
 * Edit distance between two sequences under a graded substitution cost.
 *
 * A flat cost would make a third answered by a fourth as wrong as a third
 * answered by a ninth; `cost` grades that, while an insertion or a deletion — a
 * note added or dropped — always costs one whole step.
 */
function gradedEditDistance(
  a: readonly number[],
  b: readonly number[],
  cost: (x: number, y: number) => number,
): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1);
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + cost(a[i - 1] ?? 0, b[j - 1] ?? 0);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (row[j - 1] ?? 0) + 1;
      row[j] = Math.min(substitution, deletion, insertion);
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}
/** Turn an edit distance into a likeness in [0, 1]. */
function distanceToSimilarity(distance: number, a: number, b: number): number {
  const longest = Math.max(a, b);
  if (longest === 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - distance / longest));
}
/** Cost of hearing one interval where another was expected. */
function intervalCost(x: number, y: number): number {
  return Math.min(1, Math.abs(x - y) / INTERVAL_TOLERANCE);
}
/**
 * Cost of hearing one onset gap where another was expected, measured in octaves
 * of tempo: a gap twice as long as expected costs a whole step, and the measure
 * is the same whichever of the two is the longer.
 */
function gapCost(x: number, y: number): number {
  if (!(x > BEAT_EPS) || !(y > BEAT_EPS)) {
    return Math.abs(x - y) > BEAT_EPS ? 1 : 0;
  }
  return Math.min(1, Math.abs(Math.log2(x / y)));
}
/**
 * Compare two lines and say why they scored what they did.
 *
 * The metric is a normalised edit distance over the interval sequence, weighted
 * against the same over the rhythmic profile. Intervals rather than pitches,
 * because the same tune in another key is the same tune; edit distance rather
 * than a step-by-step correlation, because a variant that adds a passing note or
 * drops one still has to line up with its model, and only an alignment-based
 * measure can do that. Substituting one interval for another costs by how far
 * apart they are rather than a flat step, so an answer that widens a third to a
 * fourth stays close to its model while one that replaces it with a leap does
 * not. The rhythm carries the smaller share: a melody is recognised mostly by
 * its pitch shape, but a figure in a wholly different rhythm is a different
 * figure.
 *
 * Both lines are expected to be monophonic, as {@link analyzeVoice} expects a
 * voice to be. Notes struck together are read as one event, the highest of them
 * standing for it, so a chord is reduced to its top voice rather than read as a
 * line of its own.
 *
 * @param a The first line: a motif, or plain note events.
 * @param b The second line.
 * @returns The overall likeness, the two terms behind it, and a rationale.
 * @example
 * ```ts
 * import { compareMelodies } from '@libraz/libcantus';
 * const line = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ];
 * compareMelodies(line, line).similarity; // 1
 * ```
 * @category Arrangement & Analysis
 */
export function compareMelodies(a: MelodicPhrase, b: MelodicPhrase): MelodicComparison {
  const left = orderedNotes(phraseNotes(a), 'melody a');
  const right = orderedNotes(phraseNotes(b), 'melody b');
  const leftIntervals = intervalsOf(left);
  const rightIntervals = intervalsOf(right);
  const pitchSimilarity = distanceToSimilarity(
    gradedEditDistance(leftIntervals, rightIntervals, intervalCost),
    leftIntervals.length,
    rightIntervals.length,
  );
  const leftGaps = rhythmProfile(onsetGaps(left)) ?? onsetGaps(left);
  const rightGaps = rhythmProfile(onsetGaps(right)) ?? onsetGaps(right);
  const rhythmSimilarity = distanceToSimilarity(
    gradedEditDistance(leftGaps, rightGaps, gapCost),
    leftGaps.length,
    rightGaps.length,
  );
  const similarity = PITCH_WEIGHT * pitchSimilarity + RHYTHM_WEIGHT * rhythmSimilarity;
  return {
    similarity,
    pitchSimilarity,
    rhythmSimilarity,
    rationale:
      `Interval shapes ${Math.round(pitchSimilarity * 100)}% alike, ` +
      `rhythms ${Math.round(rhythmSimilarity * 100)}% alike, ` +
      `weighted ${PITCH_WEIGHT}/${RHYTHM_WEIGHT} into ${roundTo(similarity, 3)}`,
  };
}
/**
 * How alike two lines are, in [0, 1].
 *
 * The number {@link compareMelodies} reaches, for callers that only want to rank
 * phrases: 1 for the same line — a transposition of it included, since the
 * measure is built on intervals — and lower the further two lines are from being
 * each other's variant. Symmetric in its arguments, and deterministic.
 *
 * @param a The first line: a motif, or plain note events.
 * @param b The second line.
 * @returns The likeness in [0, 1].
 * @example
 * ```ts
 * import { melodicSimilarity } from '@libraz/libcantus';
 * const line = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 * ];
 * melodicSimilarity(line, line); // 1
 * ```
 * @category Arrangement & Analysis
 */
export function melodicSimilarity(a: MelodicPhrase, b: MelodicPhrase): number {
  return compareMelodies(a, b).similarity;
}
