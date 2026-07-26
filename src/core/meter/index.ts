/**
 * Meter and time signatures: bar/beat arithmetic, simple vs. compound meters,
 * metric-accent hierarchy, and tuplet subdivision.
 *
 * Positions and durations are measured in quarter-note beats, matching the rest
 * of the library's beat convention (four quarter-note beats per bar in 4/4).
 */

import {
  assertFiniteNumber,
  assertInteger,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
} from '../validation/index.js';
import {
  barBeatsOf,
  isAdditiveReading,
  isCompoundNumerator,
  pulseBeatsOf,
  pulseCountOf,
} from './internal.js';

/**
 * A time signature as a numerator over a note-value denominator.
 *
 * @category Rhythm & Meter
 */
export type TimeSignature = {
  numerator: number;
  denominator: number;
  /**
   * Optional additive grouping of the bar's main pulses, as the felt-beat
   * lengths in pulses — e.g. `[2, 2, 3]` for a 2+2+3 reading of 7/8, or
   * `[3, 2]` for 5/8. The entries must be positive integers summing to the
   * numerator.
   *
   * A compound numerator accepts both readings. 9/8 groups its three dotted
   * pulses as `[1, 1, 1]`, or reads additively as `[2, 2, 2, 3]` quavers; a
   * grouping that sums to the numerator selects the additive reading, so
   * aksak and other additive metres are expressible. {@link pulsesPerBar}
   * and {@link isCompound} follow whichever reading the grouping selects.
   *
   * When present, the head pulse of each group (other than the downbeat) is
   * treated as a secondary strong pulse by
   * {@link metricWeight}/{@link isStrongBeat}; when absent, all main pulses
   * are weighted equally as flat, evenly divided pulses.
   */
  grouping?: number[];
};

/**
 * A position expressed as a bar index and a quarter-note offset within the bar.
 *
 * @category Rhythm & Meter
 */
export type BarPosition = {
  bar: number;
  /** Quarter-note offset from the start of the bar. */
  beat: number;
};

const EPS = 1e-9;

/** Whether `value` is an integer multiple of `unit` (within a float tolerance). */
function isMultiple(value: number, unit: number): boolean {
  if (unit === 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < EPS;
}

/**
 * Parse a time signature such as `"4/4"` or `"6/8"`.
 *
 * @param text The signature text.
 * @returns The parsed time signature.
 * @throws If the text is not `n/d` with positive integers.
 * @example
 * ```ts
 * import { parseTimeSignature } from '@libraz/libcantus';
 * parseTimeSignature('6/8'); // { numerator: 6, denominator: 8 }
 * ```
 * @category Rhythm & Meter
 */
export function parseTimeSignature(text: string): TimeSignature {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) {
    throw new Error(`Invalid time signature: ${text}`);
  }
  const numerator = Number.parseInt(match[1] ?? '', 10);
  const denominator = Number.parseInt(match[2] ?? '', 10);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    throw new Error(`Invalid time signature: ${text}`);
  }
  return { numerator, denominator };
}

/**
 * Render a time signature as `"n/d"`.
 *
 * @category Rhythm & Meter
 */
export function formatTimeSignature(ts: TimeSignature): string {
  assertTimeSignature(ts);
  return `${ts.numerator}/${ts.denominator}`;
}

/**
 * Whether a meter is compound: its main pulses each divide into three, as in
 * 6/8, 9/8, 12/8, or 6/4. Compound meters are those whose numerator is a
 * multiple of three greater than three, independent of the denominator. Meters
 * like 3/8 and 3/4 (simple triples, numerator 3) are not compound, and neither
 * is a signature whose {@link TimeSignature.grouping} selects the additive
 * reading (9/8 as 2+2+2+3).
 *
 * @param ts The time signature.
 * @returns True for compound meters.
 * @category Rhythm & Meter
 */
export function isCompound(ts: TimeSignature): boolean {
  assertTimeSignature(ts);
  return isCompoundNumerator(ts.numerator) && !isAdditiveReading(ts);
}

/**
 * Length of a bar in quarter-note beats.
 *
 * @param ts The time signature.
 * @returns The bar length in quarter notes.
 * @category Rhythm & Meter
 */
export function beatsPerBar(ts: TimeSignature): number {
  assertTimeSignature(ts);
  return barBeatsOf(ts);
}

/**
 * Number of main pulses (felt beats) per bar: the numerator for simple meters,
 * a third of it for compound meters.
 *
 * For additive/irregular meters such as 7/8 or 5/8 this counts the raw pulses
 * (7 and 5 respectively), which are otherwise felt as flat, evenly divided and
 * equally accented pulses. To recover a 2+2+3 or 3+2 felt-beat grouping, set
 * {@link TimeSignature.grouping}; {@link metricWeight} then accents each
 * group's head pulse.
 *
 * @param ts The time signature.
 * @returns The pulse count per bar.
 * @category Rhythm & Meter
 */
export function pulsesPerBar(ts: TimeSignature): number {
  assertTimeSignature(ts);
  return pulseCountOf(ts);
}

/** Whether `pulseIndex` is the head pulse of one of the additive groups. */
function isGroupHead(grouping: number[], pulseIndex: number): boolean {
  let acc = 0;
  for (const g of grouping) {
    if (acc === pulseIndex) {
      return true;
    }
    acc += g;
  }
  return false;
}

/**
 * Convert an absolute quarter-note position to a bar index and in-bar offset.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param ts The time signature.
 * @returns The bar and in-bar quarter-note offset.
 * @example
 * ```ts
 * import { parseTimeSignature, beatToBarPosition } from '@libraz/libcantus';
 * const ts = parseTimeSignature('4/4');
 * beatToBarPosition(5, ts); // { bar: 1, beat: 1 }
 * ```
 * @category Rhythm & Meter
 */
export function beatToBarPosition(beatInQuarters: number, ts: TimeSignature): BarPosition {
  assertFiniteNumber(beatInQuarters, 'beat');
  assertTimeSignature(ts);
  const barLen = barBeatsOf(ts);
  const bar = Math.floor(beatInQuarters / barLen);
  return { bar, beat: beatInQuarters - bar * barLen };
}

/**
 * Convert a bar index and in-bar offset back to an absolute quarter-note
 * position.
 *
 * @param pos The bar position.
 * @param ts The time signature.
 * @returns The absolute position in quarter-note beats.
 * @category Rhythm & Meter
 */
export function barPositionToBeat(pos: BarPosition, ts: TimeSignature): number {
  assertInteger(pos.bar, 'bar position bar');
  assertFiniteNumber(pos.beat, 'bar position beat');
  assertTimeSignature(ts);
  return pos.bar * barBeatsOf(ts) + pos.beat;
}

/**
 * Metric weight of a position within its bar, on a 0–3 scale:
 * 3 the downbeat, 2 a secondary strong pulse, 1 any other main pulse, and 0 an
 * off-pulse subdivision.
 *
 * The secondary strong pulse is the bar's midpoint in even simple/compound
 * meters. For an additive/irregular meter with {@link TimeSignature.grouping}
 * set (e.g. `[2, 2, 3]` for 7/8), each group's head pulse other than the
 * downbeat is the secondary strong pulse instead; without a grouping every
 * non-downbeat main pulse of such a meter weighs 1 (flat, evenly divided
 * pulses).
 *
 * @param beatInQuarters Absolute or in-bar quarter-note position.
 * @param ts The time signature.
 * @returns The metric weight (0–3).
 * @throws If the time signature is malformed, including a grouping that is not
 *   a positive-integer list summing to the pulse count or the numerator.
 * @example
 * ```ts
 * import { parseTimeSignature, metricWeight } from '@libraz/libcantus';
 * const ts = parseTimeSignature('4/4');
 * metricWeight(0, ts); // 3 (the downbeat)
 * ```
 * @category Rhythm & Meter
 */
export function metricWeight(beatInQuarters: number, ts: TimeSignature): number {
  assertFiniteNumber(beatInQuarters, 'beat');
  assertTimeSignature(ts);
  const barLen = barBeatsOf(ts);
  const beat = beatInQuarters - Math.floor(beatInQuarters / barLen) * barLen;
  const pulse = pulseBeatsOf(ts);
  if (!isMultiple(beat, pulse)) {
    return 0;
  }
  const pulses = pulseCountOf(ts);
  const pulseIndex = Math.round(beat / pulse) % pulses;
  if (pulseIndex === 0) {
    return 3;
  }
  const grouping = ts.grouping;
  if (grouping !== undefined) {
    return isGroupHead(grouping, pulseIndex) ? 2 : 1;
  }
  if (pulses % 2 === 0 && pulseIndex === pulses / 2) {
    return 2;
  }
  return 1;
}

/**
 * Whether a position is metrically accented (weight 2 or more — a downbeat or a
 * secondary strong pulse).
 *
 * @param beatInQuarters Absolute or in-bar quarter-note position.
 * @param ts The time signature.
 * @returns True on strong beats.
 * @category Rhythm & Meter
 */
export function isStrongBeat(beatInQuarters: number, ts: TimeSignature): boolean {
  return metricWeight(beatInQuarters, ts) >= 2;
}

/**
 * Subdivide a span into `count` equal tuplet durations (e.g. an eighth-note
 * triplet is `tuplet(1, 3)`).
 *
 * @param totalBeats Total span in quarter-note beats.
 * @param count Number of equal parts.
 * @returns `count` equal durations summing to `totalBeats`.
 * @throws If `count` is not a positive integer.
 * @category Rhythm & Meter
 */
export function tuplet(totalBeats: number, count: number): number[] {
  assertRange(totalBeats, 0, Number.MAX_SAFE_INTEGER, 'tuplet total beats');
  assertPositiveInt(count, 'tuplet count');
  return new Array<number>(count).fill(totalBeats / count);
}
