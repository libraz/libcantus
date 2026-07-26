/**
 * Meter arithmetic shared by the meter module and the validation guards.
 *
 * These helpers never validate: they are the single definition of how a time
 * signature is read, so the guard that rejects a malformed signature and the
 * functions that use a validated one cannot drift apart. Everything here is
 * integer arithmetic on the numerator, so a bar's pulse count is exact rather
 * than the result of dividing two floats.
 */

import type { TimeSignature } from './index.js';

/** Length of one denominator unit in quarter-note beats. */
export function unitBeatsOf(ts: TimeSignature): number {
  return 4 / ts.denominator;
}

/**
 * Whether a numerator reads as compound: a multiple of three greater than
 * three, so its main pulses each divide into three.
 */
export function isCompoundNumerator(numerator: number): boolean {
  return numerator % 3 === 0 && numerator > 3;
}

/** Sum of an additive grouping, or undefined when there is none. */
export function groupingSumOf(ts: TimeSignature): number | undefined {
  const grouping = ts.grouping;
  if (grouping === undefined) {
    return undefined;
  }
  let sum = 0;
  for (const entry of grouping) {
    sum += entry;
  }
  return sum;
}

/**
 * Whether the signature's grouping counts denominator units rather than
 * compound pulses.
 *
 * A compound numerator normally groups into pulses of three — 9/8 is three
 * dotted-quarter pulses — but the same signature is also how additive metres
 * are written, where 9/8 means 2+2+2+3 quavers. A grouping that sums to the
 * numerator selects that additive reading.
 */
export function isAdditiveReading(ts: TimeSignature): boolean {
  const sum = groupingSumOf(ts);
  return (
    sum !== undefined && isCompoundNumerator(ts.numerator) && sum === ts.numerator && sum !== 0
  );
}

/** Number of main pulses per bar under the signature's effective reading. */
export function pulseCountOf(ts: TimeSignature): number {
  if (isAdditiveReading(ts)) {
    return ts.numerator;
  }
  return isCompoundNumerator(ts.numerator) ? ts.numerator / 3 : ts.numerator;
}

/** Length of one main pulse in quarter-note beats, under the same reading. */
export function pulseBeatsOf(ts: TimeSignature): number {
  return (ts.numerator * unitBeatsOf(ts)) / pulseCountOf(ts);
}

/** Length of a bar in quarter-note beats. */
export function barBeatsOf(ts: TimeSignature): number {
  return ts.numerator * unitBeatsOf(ts);
}
