/**
 * Meter arithmetic shared by the meter module and the validation guards.
 *
 * These helpers never validate: they are the single definition of how a time
 * signature is read, so the guard that rejects a malformed signature and the
 * functions that use a validated one cannot drift apart. Everything here is
 * integer arithmetic on the numerator, so a bar's pulse count is exact rather
 * than the result of dividing two floats.
 */

import type { MeterChange, MeterMap, TimeSignature } from './index.js';

/**
 * A meter in the plain data the library reads it as: one signature, or the map
 * of a piece that changes meter.
 *
 * What {@link MeterLike} resolves to, and the type every function below the
 * entry points works in — the text form is read once, at the boundary.
 *
 * @category Rhythm & Meter
 */
export type MeterData = TimeSignature | MeterMap;

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
export function isMeterMap(meter: MeterData): meter is MeterMap {
  return Array.isArray(meter);
}

/** A fresh signature, sharing neither its object nor its grouping array. */
export function copyTimeSignature(ts: TimeSignature): TimeSignature {
  return ts.grouping === undefined
    ? { numerator: ts.numerator, denominator: ts.denominator }
    : { numerator: ts.numerator, denominator: ts.denominator, grouping: [...ts.grouping] };
}

/** A fresh map, sharing no entry and no signature with the one given. */
export function copyMeterMap(map: MeterMap): MeterMap {
  const copy: MeterMap = new Array<MeterChange>(map.length);
  for (let i = 0; i < map.length; i += 1) {
    const entry = map[i];
    copy[i] =
      entry === undefined
        ? { startBeat: 0, ts: { numerator: 4, denominator: 4 } }
        : { startBeat: entry.startBeat, ts: copyTimeSignature(entry.ts) };
  }
  return copy;
}

/** A fresh copy of whichever meter shape the data is. */
export function copyMeterData(data: MeterData): MeterData {
  return isMeterMap(data) ? copyMeterMap(data) : copyTimeSignature(data);
}

/**
 * The bar arithmetic of one meter map, precomputed so that a positional
 * question costs a binary search rather than a walk.
 *
 * Every entry is read once here and never again: a per-slot analysis pass asks
 * thousands of positional questions of the same map, and re-deriving the bars
 * before an entry on each of them is what makes such a pass quadratic in the
 * number of meter changes.
 */
type MeterIndex = {
  /** Onsets in map order, as they read when the index was built. */
  startBeats: number[];
  /** Bar length in quarter-note beats of each entry's signature. */
  barBeats: number[];
  /** Bars completed before each entry — the prefix sum of the spans above. */
  barsBefore: number[];
  /** Whether the map had passed validation when the index was built. */
  validated: boolean;
};

/**
 * Indexes held against the identity of the map they describe.
 *
 * A caller keeps its own array and may write to it after the library has read
 * it, so an index is only trusted while the map still has the length and the
 * end onsets it was built from; anything else rebuilds. The index answers out
 * of its own snapshot rather than out of the caller's array, so a map written
 * to in place mid-analysis reads as it did when it was validated instead of
 * producing a position derived from half of each.
 */
const INDEX_CACHE = new WeakMap<MeterMap, MeterIndex>();

/** Whether a cached index still describes the array it was built from. */
function describesMap(index: MeterIndex, map: MeterMap): boolean {
  const last = map.length - 1;
  return (
    index.startBeats.length === map.length &&
    index.startBeats[0] === map[0]?.startBeat &&
    index.startBeats[last] === map[last]?.startBeat
  );
}

/**
 * Build and cache the index of a map.
 *
 * A meter change starts a new bar, so a span that does not divide evenly into
 * its own bars still contributes a whole final bar — an incomplete bar before a
 * change is a bar all the same.
 */
function buildMeterIndex(map: MeterMap, validated: boolean): MeterIndex {
  const startBeats = new Array<number>(map.length);
  const barBeats = new Array<number>(map.length);
  const barsBefore = new Array<number>(map.length);
  let bars = 0;
  for (let i = 0; i < map.length; i += 1) {
    const entry = map[i];
    const startBeat = entry?.startBeat ?? 0;
    const barLen = entry === undefined ? 0 : barBeatsOf(entry.ts);
    startBeats[i] = startBeat;
    barBeats[i] = barLen;
    barsBefore[i] = bars;
    const next = map[i + 1];
    if (next !== undefined && barLen > 0) {
      bars += Math.max(1, Math.ceil((next.startBeat - startBeat) / barLen - EPS));
    }
  }
  const index: MeterIndex = { startBeats, barBeats, barsBefore, validated };
  INDEX_CACHE.set(map, index);
  return index;
}

/** The map's index, built on first use and rebuilt when the map has changed. */
function meterIndexOf(map: MeterMap): MeterIndex {
  const cached = INDEX_CACHE.get(map);
  return cached !== undefined && describesMap(cached, map) ? cached : buildMeterIndex(map, false);
}

/**
 * Whether the map has already passed validation and is unchanged since.
 *
 * The guard that lets a per-slot pass re-enter a validating entry point without
 * paying for the whole map on every slot.
 */
export function isValidatedMeterMap(map: MeterMap): boolean {
  const cached = INDEX_CACHE.get(map);
  return cached?.validated === true && describesMap(cached, map);
}

/** Record that a map passed validation, and precompute its bar arithmetic. */
export function rememberValidatedMeterMap(map: MeterMap): void {
  buildMeterIndex(map, true);
}

/**
 * Index of the last entry whose key is at or before `value`, at least 0.
 *
 * Both keys a map is searched by — onsets and bars completed — are strictly
 * increasing, so the entry in force is found by halving the range.
 */
function lastAtOrBefore(keys: readonly number[], value: number): number {
  let low = 1;
  let high = keys.length - 1;
  let index = 0;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if ((keys[mid] ?? Number.POSITIVE_INFINITY) <= value) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return index;
}

/**
 * Index of the map entry in force at a beat.
 *
 * The first entry also covers everything before it, so a pickup written at
 * negative beats is read in the signature the piece opens in.
 */
export function entryIndexOf(map: MeterMap, beat: number): number {
  return lastAtOrBefore(meterIndexOf(map).startBeats, beat + EPS);
}

/** Absolute beat at which the bar containing `beat` begins. */
export function barStartOf(map: MeterMap, beat: number): number {
  const index = meterIndexOf(map);
  const at = lastAtOrBefore(index.startBeats, beat + EPS);
  const startBeat = index.startBeats[at];
  const barLen = index.barBeats[at];
  if (startBeat === undefined || barLen === undefined || barLen === 0) {
    return 0;
  }
  return startBeat + Math.floor((beat - startBeat) / barLen + EPS) * barLen;
}

/**
 * Length in quarter-note beats of the bar containing `beat`.
 *
 * A meter change starts a new bar, so the bar it interrupts is shorter than its
 * own signature says: this is that bar's real length, which is what a position
 * display has to count felt beats against.
 */
export function barLengthOf(map: MeterMap, beat: number): number {
  const index = meterIndexOf(map);
  const at = lastAtOrBefore(index.startBeats, beat + EPS);
  const full = index.barBeats[at];
  if (full === undefined) {
    return 0;
  }
  const next = index.startBeats[at + 1];
  return next === undefined ? full : Math.min(full, next - barStartOf(map, beat));
}

/**
 * Bar index of a beat, counting the map's first bar as 0.
 *
 * Beats before that bar count backwards, which is what numbers a pickup bar as
 * bar -1 rather than folding it into the first full bar.
 */
export function barIndexOf(map: MeterMap, beat: number): number {
  const index = meterIndexOf(map);
  const at = lastAtOrBefore(index.startBeats, beat + EPS);
  const startBeat = index.startBeats[at];
  const barLen = index.barBeats[at];
  if (startBeat === undefined || barLen === undefined || barLen === 0) {
    return 0;
  }
  return (index.barsBefore[at] ?? 0) + Math.floor((beat - startBeat) / barLen + EPS);
}

/** Absolute beat at which bar `barIndex` begins. */
export function beatOfBarIndex(map: MeterMap, barIndex: number): number {
  const index = meterIndexOf(map);
  const at = lastAtOrBefore(index.barsBefore, barIndex);
  const startBeat = index.startBeats[at];
  const barLen = index.barBeats[at];
  if (startBeat === undefined || barLen === undefined) {
    return 0;
  }
  return startBeat + (barIndex - (index.barsBefore[at] ?? 0)) * barLen;
}
