import { assertFiniteNumber } from '../validation/index.js';

/**
 * Counterpoint classification of a harmonic interval by consonance.
 *
 * Distinct from a spelled interval's quality label — see
 * {@link IntervalQualityLabel}, which names the `'P'` / `'M'` / `'m'` / `'A'` /
 * `'d'` spelling of an interval rather than how it sounds against another
 * voice.
 *
 * @see {@link IntervalQualityLabel}
 * @category Pitch & Intervals
 */
export enum ConsonanceClass {
  PerfectConsonance = 0,
  ImperfectConsonance = 1,
  Dissonance = 2,
}

/**
 * Reduce an interval to a simple interval class in the range [0, 11].
 *
 * Every public predicate in this module funnels through here, so a non-finite
 * interval is rejected once rather than silently classifying as a dissonance.
 */
function simpleInterval(semitones: number): number {
  assertFiniteNumber(semitones, 'semitones');
  return Math.abs(Math.round(semitones)) % 12;
}

/**
 * Classify an interval for counterpoint evaluation.
 *
 * The interval is reduced modulo 12, so compound intervals classify as their
 * simple equivalents. The perfect fourth (5) is context-dependent: with
 * `twoVoice` (the default) it classifies as a dissonance, matching
 * {@link isConsonantInterval}; otherwise it is an imperfect consonance.
 *
 * @param semitones Interval size in semitones (may be negative or compound).
 * @param twoVoice When true, the perfect fourth is treated as dissonant.
 * @returns The counterpoint quality of the interval.
 * @example
 * ```ts
 * import { classifyInterval, ConsonanceClass } from '@libraz/libcantus';
 * classifyInterval(7); // ConsonanceClass.PerfectConsonance
 * classifyInterval(5); // ConsonanceClass.Dissonance (two-voice)
 * classifyInterval(5, false); // ConsonanceClass.ImperfectConsonance
 * ```
 * @category Pitch & Intervals
 */
export function classifyInterval(semitones: number, twoVoice = true): ConsonanceClass {
  const pc = simpleInterval(semitones);
  if (pc === 0 || pc === 7) {
    return ConsonanceClass.PerfectConsonance;
  }
  if (pc === 3 || pc === 4 || pc === 8 || pc === 9) {
    return ConsonanceClass.ImperfectConsonance;
  }
  if (pc === 5) {
    return twoVoice ? ConsonanceClass.Dissonance : ConsonanceClass.ImperfectConsonance;
  }
  return ConsonanceClass.Dissonance;
}

/**
 * Test whether an interval is a perfect interval (unison/octave or fifth).
 *
 * @param semitones Interval size in semitones (may be negative or compound).
 * @returns True for the unison/octave (0) and the perfect fifth (7) mod 12.
 * @category Pitch & Intervals
 */
export function isPerfectInterval(semitones: number): boolean {
  const pc = simpleInterval(semitones);
  return pc === 0 || pc === 7;
}

/**
 * Test whether an interval is consonant.
 *
 * The consonant set is {0, 3, 4, 5, 7, 8, 9} mod 12. In two-voice counterpoint
 * the perfect fourth (5) is treated as a dissonance, so `twoVoice` set to true
 * excludes it.
 *
 * @param semitones Interval size in semitones (may be negative or compound).
 * @param twoVoice When true, the perfect fourth is treated as dissonant.
 * @returns True if the interval is consonant in the given context.
 * @category Pitch & Intervals
 */
export function isConsonantInterval(semitones: number, twoVoice = true): boolean {
  const pc = simpleInterval(semitones);
  if (pc === 5) {
    return !twoVoice;
  }
  return pc === 0 || pc === 3 || pc === 4 || pc === 7 || pc === 8 || pc === 9;
}
