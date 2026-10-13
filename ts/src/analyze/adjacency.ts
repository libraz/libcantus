/**
 * Whether two beats are the same instant, and whether one note follows another.
 *
 * Two questions are asked of the beat axis all over the analysis layer: "is this
 * the same beat as that one" and "does this note come straight after that one".
 * They take different tolerances — a beat boundary is exact arithmetic, while a
 * note played rather than entered on a grid lands a fraction of a beat off — and
 * asking either of them with the other's tolerance is what lets one pass see a
 * predecessor where another sees none. Both are answered here, as distances
 * between beats: a bucket index would put two beats a hair either side of a
 * bucket edge in different buckets and answer that they differ, which no
 * distance can.
 */

import { BEAT_EPS } from '../core/meter/index.js';

/**
 * Largest difference between two beats that are the same beat.
 *
 * Float residue rather than playing: what arithmetic over beat positions leaves
 * behind — a bar length times a bar count, a grid origin plus a whole number of
 * steps — and nothing musical is measured in it.
 *
 * Re-exported rather than declared, from the meter layer that has to compare
 * beats below every reader here. Two numbers that happen to be equal are not one
 * tolerance: a correction to either would leave the bar boundaries the meter
 * computes and the same instants the analysis reads a hair apart, and nothing
 * would report it.
 */
export { BEAT_EPS } from '../core/meter/index.js';

/**
 * Largest gap or overlap, in beats, at which one note still follows another.
 *
 * A part played in rather than entered on a grid — or one run through
 * humanization — leaves a few hundredths of a beat of silence between notes that
 * are heard as consecutive, and leaves an overlap of the same size where a
 * legato line is held past its successor's onset. Inside this bound the two are
 * adjacent; outside it there is a rest between them.
 */
export const HUMANIZE_ADJACENCY = 0.05;

/**
 * Whether two beats name the same instant.
 *
 * @param beat One beat.
 * @param other The beat to compare it with.
 * @returns True when the two are the same beat.
 */
export function sameInstant(beat: number, other: number): boolean {
  return Math.abs(beat - other) <= BEAT_EPS;
}

/**
 * Whether a note ending at `prevEnd` is heard as the one before `nextStart`.
 *
 * @param prevEnd Beat the earlier note ends on.
 * @param nextStart Beat the later note starts on.
 * @returns True when no audible rest separates them.
 */
export function adjacent(prevEnd: number, nextStart: number): boolean {
  return Math.abs(nextStart - prevEnd) <= HUMANIZE_ADJACENCY;
}

/**
 * Whether a note ending at `prevEnd` has finished by `beat`.
 *
 * The same tolerance as {@link adjacent}, asked one-sidedly: a line held a
 * hundredth of a beat past the next onset is one line, not two sounding at once.
 *
 * @param prevEnd Beat the note ends on.
 * @param beat The beat to ask about.
 * @returns True when the note no longer sounds there.
 */
export function hasEnded(prevEnd: number, beat: number): boolean {
  return prevEnd <= beat + HUMANIZE_ADJACENCY;
}
