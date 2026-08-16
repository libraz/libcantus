/**
 * Meter arithmetic shared by the meter module and the validation guards.
 *
 * These helpers never validate: they are the single definition of how a time
 * signature is read, so the guard that rejects a malformed signature and the
 * functions that use a validated one cannot drift apart. Everything here is
 * integer arithmetic on the numerator, so a bar's pulse count is exact rather
 * than the result of dividing two floats.
 */

import type { MeterLike, MeterMap, TimeSignature } from './index.js';

/**
 * Tolerance for the divisions below.
 *
 * A bar boundary reached by accumulating tuplet durations lands an epsilon
 * short of it, and a beat an epsilon short of a bar line belongs to the bar it
 * is arriving at, not to the one it is leaving.
 */
const EPS = 1e-9;

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
 * numerator is written in units and selects that additive reading, with one
 * exception: groups of nothing but threes spell the compound division itself
 * (9/8 as [3, 3, 3], 6/8 as [3, 3]), so they keep the compound reading rather
 * than flattening the bar into equal quaver pulses.
 */
export function isAdditiveReading(ts: TimeSignature): boolean {
  const grouping = ts.grouping;
  const sum = groupingSumOf(ts);
  if (grouping === undefined || sum === undefined || sum === 0) {
    return false;
  }
  if (!isCompoundNumerator(ts.numerator) || sum !== ts.numerator) {
    return false;
  }
  return !grouping.every((entry) => entry === 3);
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

/**
 * The signature's grouping measured in main pulses, or undefined when it has
 * none.
 *
 * A grouping is written either in main pulses (9/8 as [1, 1, 1], 7/8 as
 * [2, 2, 3]) or in denominator units (9/8 as [3, 3, 3] or [2, 2, 2, 3]), and
 * the two coincide wherever a pulse is one unit. Group heads are found by
 * counting pulses, so the unit spelling of a compound bar is divided down to
 * the pulses it describes.
 */
export function pulseGroupingOf(ts: TimeSignature): number[] | undefined {
  const grouping = ts.grouping;
  if (grouping === undefined) {
    return undefined;
  }
  const pulses = pulseCountOf(ts);
  if (groupingSumOf(ts) === pulses) {
    return grouping;
  }
  // The only accepted grouping that does not count pulses is the all-threes
  // spelling of a compound bar, whose groups are three units to the pulse.
  return grouping.map((entry) => entry / 3);
}

/** Length of a bar in quarter-note beats. */
export function barBeatsOf(ts: TimeSignature): number {
  return ts.numerator * unitBeatsOf(ts);
}

/** Whether a meter argument is a map of changes rather than one signature. */
export function isMeterMap(meter: MeterLike): meter is MeterMap {
  return Array.isArray(meter);
}

/**
 * Index of the map entry in force at a beat.
 *
 * The first entry also covers everything before it, so a pickup written at
 * negative beats is read in the signature the piece opens in.
 */
export function entryIndexOf(map: MeterMap, beat: number): number {
  let index = 0;
  for (let i = 1; i < map.length; i += 1) {
    if ((map[i]?.startBeat ?? Number.POSITIVE_INFINITY) > beat + EPS) {
      break;
    }
    index = i;
  }
  return index;
}

/**
 * Bars completed before the entry at `index`.
 *
 * A meter change starts a new bar, so a span that does not divide evenly into
 * its own bars still contributes a whole final bar — an incomplete bar before a
 * change is a bar all the same.
 */
function barsBeforeEntry(map: MeterMap, index: number): number {
  let bars = 0;
  for (let i = 0; i < index; i += 1) {
    const entry = map[i];
    const next = map[i + 1];
    if (entry === undefined || next === undefined) {
      break;
    }
    bars += Math.max(1, Math.ceil((next.startBeat - entry.startBeat) / barBeatsOf(entry.ts) - EPS));
  }
  return bars;
}

/** Absolute beat at which the bar containing `beat` begins. */
export function barStartOf(map: MeterMap, beat: number): number {
  const entry = map[entryIndexOf(map, beat)];
  if (entry === undefined) {
    return 0;
  }
  const barLen = barBeatsOf(entry.ts);
  return entry.startBeat + Math.floor((beat - entry.startBeat) / barLen + EPS) * barLen;
}

/**
 * Length in quarter-note beats of the bar containing `beat`.
 *
 * A meter change starts a new bar, so the bar it interrupts is shorter than its
 * own signature says: this is that bar's real length, which is what a position
 * display has to count felt beats against.
 */
export function barLengthOf(map: MeterMap, beat: number): number {
  const index = entryIndexOf(map, beat);
  const entry = map[index];
  if (entry === undefined) {
    return 0;
  }
  const full = barBeatsOf(entry.ts);
  const next = map[index + 1]?.startBeat;
  return next === undefined ? full : Math.min(full, next - barStartOf(map, beat));
}

/**
 * Bar index of a beat, counting the map's first bar as 0.
 *
 * Beats before that bar count backwards, which is what numbers a pickup bar as
 * bar -1 rather than folding it into the first full bar.
 */
export function barIndexOf(map: MeterMap, beat: number): number {
  const index = entryIndexOf(map, beat);
  const entry = map[index];
  if (entry === undefined) {
    return 0;
  }
  const barLen = barBeatsOf(entry.ts);
  return barsBeforeEntry(map, index) + Math.floor((beat - entry.startBeat) / barLen + EPS);
}

/** Absolute beat at which bar `barIndex` begins. */
export function beatOfBarIndex(map: MeterMap, barIndex: number): number {
  let base = 0;
  for (let i = 0; i < map.length; i += 1) {
    const entry = map[i];
    if (entry === undefined) {
      continue;
    }
    const barLen = barBeatsOf(entry.ts);
    const next = map[i + 1];
    if (next === undefined) {
      return entry.startBeat + (barIndex - base) * barLen;
    }
    const bars = Math.max(1, Math.ceil((next.startBeat - entry.startBeat) / barLen - EPS));
    if (barIndex < base + bars) {
      return entry.startBeat + (barIndex - base) * barLen;
    }
    base += bars;
  }
  return 0;
}
