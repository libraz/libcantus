/**
 * Shared interval reading for the counterpoint rules.
 *
 * The predicates, the species checker and the independence metric all need the
 * same two conversions — a pitch argument to a sounding pitch, and a spelled
 * interval to its consonance class — and importing them from one another would
 * make the module graph circular.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { ConsonanceClass } from '../../core/interval/index.js';
import { ConsonanceClass as Consonance } from '../../core/interval/index.js';
import type { IntervalQualityLabel, Note, SpelledInterval } from '../../core/pitch/index.js';
import { noteToMidi } from '../../core/pitch/index.js';
import {
  assertDegree,
  assertFlag,
  assertRecord,
  describeRejected,
} from '../../core/validation/index.js';

/**
 * Require an interval quality label.
 *
 * The label is open at both ends — an augmented interval is `'A'` repeated and a
 * diminished one `'d'` repeated, so there is no list to check against — but its
 * shape is closed: one of the three plain qualities, or a run of one glyph.
 */
function assertQualityLabel(quality: IntervalQualityLabel): IntervalQualityLabel {
  if (typeof quality !== 'string' || !/^(P|M|m|A+|d+)$/.test(quality)) {
    throw new InvalidInputError(
      `interval.quality must be an interval quality; received ${describeRejected(quality)}`,
    );
  }
  return quality;
}

/** The sounding pitch of a predicate argument, whichever form it arrived in. */
export function pitchOf(value: number | Note): number {
  return typeof value === 'number' ? value : noteToMidi(value);
}

/** Reduce a compound diatonic number to its simple form in [1, 7]. */
export function simpleIntervalNumber(numberValue: number): number {
  return ((Math.abs(numberValue) - 1) % 7) + 1;
}

/**
 * Classify a spelled interval by consonance, the way a counterpoint exercise
 * reads it.
 *
 * The spelling decides, not the semitone count: a diminished fourth is a
 * dissonance though it sounds like a major third, and an augmented fifth is a
 * dissonance though it sounds like a minor sixth. Only the perfect unison, fifth
 * and octave and the major and minor thirds and sixths are consonant. The
 * perfect fourth is context-dependent exactly as in {@link classifyInterval}.
 *
 * @param interval The spelled interval between the two voices.
 * @param twoVoice When true, the perfect fourth counts as a dissonance.
 * @returns The counterpoint quality of the interval.
 * @example
 * ```ts
 * import { classifySpelledInterval, ConsonanceClass, parseInterval } from '@libraz/libcantus';
 * classifySpelledInterval(parseInterval('d4')); // ConsonanceClass.Dissonance
 * classifySpelledInterval(parseInterval('M3')); // ConsonanceClass.ImperfectConsonance
 * ```
 * @category Voicing & Counterpoint
 */
export function classifySpelledInterval(
  interval: SpelledInterval,
  twoVoice = true,
): ConsonanceClass {
  // The record check alone leaves the two fields the answer is read from
  // unread, and an interval carrying neither would classify as a dissonance —
  // the same verdict a real tritone gets, and one a counterpoint report acts on.
  assertFlag(twoVoice, 'twoVoice');
  const read = assertRecord<SpelledInterval>(interval, 'interval');
  const simple = simpleIntervalNumber(assertDegree(read.number, 'interval.number'));
  const quality = assertQualityLabel(read.quality);
  if (quality === 'P') {
    if (simple === 1 || simple === 5) {
      return Consonance.PerfectConsonance;
    }
    if (simple === 4) {
      return twoVoice ? Consonance.Dissonance : Consonance.ImperfectConsonance;
    }
    return Consonance.Dissonance;
  }
  if ((quality === 'M' || quality === 'm') && (simple === 3 || simple === 6)) {
    return Consonance.ImperfectConsonance;
  }
  return Consonance.Dissonance;
}
