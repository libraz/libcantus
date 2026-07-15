/**
 * Tuning and microtonality: frequency conversion, cents, arbitrary equal
 * temperaments (EDO), and just-intonation ratios.
 *
 * The rest of the library reasons in twelve-tone pitch classes, which is a
 * deliberate scope choice for tonal theory. This module is the escape hatch for
 * anyone who needs actual frequencies, cents, non-12 equal temperaments, or the
 * acoustic (just) tuning behind the tempered intervals.
 */

import {
  assertFiniteNumber,
  assertInteger,
  assertPositiveInt,
  assertRange,
} from '../validation/index.js';

/**
 * An equal-tempered tuning: a reference pitch and a number of equal divisions of
 * the octave. With `divisions === 12` a step index is an ordinary MIDI number.
 *
 * @category Pitch & Intervals
 */
export type Tuning = {
  /** Step index (MIDI number when `divisions` is 12) whose frequency is `refFreq`. */
  refStep: number;
  /** Frequency in Hz of `refStep`. */
  refFreq: number;
  /** Equal divisions of the octave (12 standard; e.g. 19 or 31 for microtonal). */
  divisions: number;
};

/**
 * Standard twelve-tone equal temperament, A4 (MIDI 69) = 440 Hz.
 *
 * @category Pitch & Intervals
 */
export const TWELVE_TET: Tuning = { refStep: 69, refFreq: 440, divisions: 12 };

function assertTuning(tuning: Tuning): Tuning {
  assertFiniteNumber(tuning.refStep, 'tuning.refStep');
  assertRange(tuning.refFreq, Number.MIN_VALUE, Number.MAX_VALUE, 'tuning.refFreq');
  assertPositiveInt(tuning.divisions, 'tuning.divisions');
  return tuning;
}

/**
 * Build an equal temperament with `n` divisions of the octave.
 *
 * @param n Divisions of the octave (e.g. 19, 24, 31).
 * @param refFreq Reference frequency in Hz (default 440).
 * @param refStep Step index of the reference (default 69).
 * @returns The tuning.
 * @example
 * ```ts
 * import { edo, frequencyOf } from '@libraz/libcantus';
 * const et19 = edo(19); // { refStep: 69, refFreq: 440, divisions: 19 }
 * frequencyOf(70, et19); // one 19-EDO step above A4
 * ```
 * @category Pitch & Intervals
 */
export function edo(n: number, refFreq = 440, refStep = 69): Tuning {
  assertPositiveInt(n, 'EDO divisions');
  assertRange(refFreq, Number.MIN_VALUE, Number.MAX_VALUE, 'reference frequency');
  assertFiniteNumber(refStep, 'reference step');
  return { refStep, refFreq, divisions: n };
}

/**
 * Frequency in Hz of a step index under a tuning.
 *
 * @param step Step index (a MIDI number under 12-EDO).
 * @param tuning The tuning (default 12-TET).
 * @returns The frequency in Hz.
 * @example
 * ```ts
 * import { frequencyOf } from '@libraz/libcantus';
 * frequencyOf(69); // 440 (A4 in 12-TET)
 * frequencyOf(60); // middle C in Hz
 * ```
 * @category Pitch & Intervals
 */
export function frequencyOf(step: number, tuning: Tuning = TWELVE_TET): number {
  assertFiniteNumber(step, 'step');
  assertTuning(tuning);
  const result = tuning.refFreq * 2 ** ((step - tuning.refStep) / tuning.divisions);
  return assertRange(result, Number.MIN_VALUE, Number.MAX_VALUE, 'frequency result');
}

/**
 * Nearest step index to a frequency under a tuning (the inverse of
 * {@link frequencyOf}, rounded).
 *
 * @param freq Frequency in Hz.
 * @param tuning The tuning (default 12-TET).
 * @returns The nearest step index.
 * @category Pitch & Intervals
 */
export function nearestStep(freq: number, tuning: Tuning = TWELVE_TET): number {
  assertRange(freq, Number.MIN_VALUE, Number.MAX_VALUE, 'frequency');
  assertTuning(tuning);
  return Math.round(tuning.refStep + tuning.divisions * Math.log2(freq / tuning.refFreq));
}

/**
 * Interval in cents between two frequencies.
 *
 * @param a Lower/first frequency in Hz.
 * @param b Upper/second frequency in Hz.
 * @returns Cents from `a` to `b` (negative if `b` is lower).
 * @category Pitch & Intervals
 */
export function centsBetweenFreq(a: number, b: number): number {
  assertRange(a, Number.MIN_VALUE, Number.MAX_VALUE, 'first frequency');
  assertRange(b, Number.MIN_VALUE, Number.MAX_VALUE, 'second frequency');
  return 1200 * (Math.log2(b) - Math.log2(a));
}

/**
 * Cents spanned by a number of equal-temperament steps.
 *
 * @param steps Number of steps.
 * @param tuning The tuning (default 12-TET).
 * @returns The cents.
 * @category Pitch & Intervals
 */
export function centsOfSteps(steps: number, tuning: Tuning = TWELVE_TET): number {
  assertFiniteNumber(steps, 'steps');
  assertTuning(tuning);
  return assertFiniteNumber((steps * 1200) / tuning.divisions, 'cents result');
}

/**
 * Cents of a frequency ratio, e.g. `ratioToCents(3, 2)` ≈ 701.955 for the just
 * perfect fifth.
 *
 * @param numerator Ratio numerator.
 * @param denominator Ratio denominator.
 * @returns The interval in cents.
 * @category Pitch & Intervals
 */
export function ratioToCents(numerator: number, denominator: number): number {
  assertRange(numerator, Number.MIN_VALUE, Number.MAX_VALUE, 'ratio numerator');
  assertRange(denominator, Number.MIN_VALUE, Number.MAX_VALUE, 'ratio denominator');
  return 1200 * (Math.log2(numerator) - Math.log2(denominator));
}

/**
 * Five-limit just-intonation ratios for the twelve interval classes above a
 * unison, indexed by semitone class (0..12).
 *
 * @category Pitch & Intervals
 */
export const JUST_RATIOS: Record<number, [number, number]> = {
  0: [1, 1],
  1: [16, 15],
  2: [9, 8],
  3: [6, 5],
  4: [5, 4],
  5: [4, 3],
  6: [45, 32],
  7: [3, 2],
  8: [8, 5],
  9: [5, 3],
  10: [9, 5],
  11: [15, 8],
  12: [2, 1],
};

/**
 * Cents by which a five-limit just interval departs from its 12-TET tempering
 * (positive means the just interval is wider).
 *
 * @param semitoneClass Semitone class in [0, 12].
 * @returns The deviation in cents.
 * @throws If `semitoneClass` is not an integer in [0, 12].
 * @category Pitch & Intervals
 */
export function justDeviationCents(semitoneClass: number): number {
  assertInteger(semitoneClass, 'semitone class', 0, 12);
  const ratio = JUST_RATIOS[semitoneClass];
  if (!ratio) {
    throw new RangeError(`semitone class has no just ratio: ${semitoneClass}`);
  }
  return ratioToCents(ratio[0], ratio[1]) - semitoneClass * 100;
}
