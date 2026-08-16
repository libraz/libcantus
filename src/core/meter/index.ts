/**
 * Meter and time signatures: bar/beat arithmetic, simple vs. compound meters,
 * metric-accent hierarchy, and tuplet subdivision.
 *
 * Positions and durations are measured in quarter-note beats, matching the rest
 * of the library's beat convention (four quarter-note beats per bar in 4/4).
 * Beat 0 is the first downbeat, so a pickup sounds at negative beats, and a
 * piece that changes meter is described by a {@link MeterMap} rather than by
 * one signature.
 */

import { InvalidInputError, type ParseResult, parseFailure, unwrapParse } from '../errors/index.js';
import {
  assertFiniteNumber,
  assertInteger,
  assertMeterMap,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
} from '../validation/index.js';
import type { MeterData } from './internal.js';
import {
  barBeatsOf,
  barIndexOf,
  barLengthOf,
  barStartOf,
  beatOfBarIndex,
  entryIndexOf,
  groupingSumOf,
  isAdditiveReading,
  isCompoundNumerator,
  isMeterMap,
  pulseBeatsOf,
  pulseCountOf,
  pulseGroupingOf,
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
   * Optional grouping of the bar into felt beats, as positive integers. The
   * entries are group lengths, written either in the meter's main pulses —
   * `[2, 2, 3]` for a 2+2+3 reading of 7/8, `[3, 2]` for 5/8 — or, for a
   * compound numerator, in denominator units. They must sum to
   * {@link pulsesPerBar} in the first spelling and to the numerator in the
   * second; a pulse is one unit outside compound meters, where the two
   * spellings coincide.
   *
   * A compound numerator accepts both readings, and the shape of the grouping
   * says which is meant. Groups of nothing but threes spell the compound
   * division itself, so 9/8 as `[3, 3, 3]` (equivalently `[1, 1, 1]`) is the
   * ordinary three dotted-quarter pulses; any other grouping summing to the
   * numerator reads additively, so 9/8 as `[2, 2, 2, 3]` is nine quaver pulses
   * grouped aksak-fashion. {@link pulsesPerBar}, {@link pulseBeats} and
   * {@link isCompound} follow whichever reading the grouping selects.
   *
   * The head pulse of each group other than the downbeat is a secondary strong
   * pulse to {@link metricWeight}/{@link isStrongBeat}. A grouping whose groups
   * are all the same length states no accent the meter does not already have,
   * so it weighs exactly as an ungrouped bar does.
   */
  grouping?: number[];
};

/**
 * One time signature and the beat at which it takes effect.
 *
 * @category Rhythm & Meter
 */
export type MeterChange = {
  /** Absolute quarter-note beat the signature takes effect at. */
  startBeat: number;
  /** The signature in force from that beat until the next change. */
  ts: TimeSignature;
};

/**
 * A piece's meter over time: the signatures in force, in beat order.
 *
 * A meter change starts a new bar, so a span that does not divide evenly into
 * its own bars ends with a short bar rather than spilling across the change.
 * The first entry also governs everything before it, which is what reads a
 * pickup written at negative beats in the signature the piece opens in.
 *
 * @category Rhythm & Meter
 */
export type MeterMap = MeterChange[];

export type { MeterData } from './internal.js';

/**
 * Anything that names a meter: a signature text such as `'6/8'`, a plain
 * {@link TimeSignature}, a full {@link MeterMap}, or a value that serializes to
 * one of those such as the `Meter` class.
 *
 * Every meter-aware function takes this, so a piece in one meter reads as
 * `'4/4'` and a piece that changes meter reads as the map, without the caller
 * choosing a different function for each. Only a signature has a text form — a
 * meter map is a run of changes and is given as the data it is.
 *
 * @category Rhythm & Meter
 */
export type MeterLike =
  | string
  | TimeSignature
  | MeterMap
  | {
      /** The meter data this value stands for. */
      toJSON(): TimeSignature | MeterMap;
    };

/**
 * Resolve any meter-shaped value to the plain meter data the library reads.
 *
 * The counterpart of {@link toNoteData} for meters: an entry point takes
 * whatever form the caller has — the signature a meter field holds, the data
 * the meter module returns, the map of a piece that changes meter, or a `Meter`
 * instance — and gets one of two shapes back. An instance is accepted through
 * its `toJSON` method rather than by its type, so the core layer can read a
 * class it cannot import.
 *
 * Text is read by {@link parseTimeSignature} and nothing else, so every entry
 * point that takes a meter accepts exactly the signatures that parser accepts,
 * the additive `'2+2+3/8'` included and nothing besides. A meter map has no text
 * form — it is a run of changes, each with the beat it starts at — so text
 * always names a single signature.
 *
 * @param value A signature text, a plain time signature, a meter map, or a
 *   value whose `toJSON` returns one of those.
 * @param name What the meter is called in an error message, so a caller that
 *   holds several of them hears which one was malformed.
 * @returns The validated signature, or the validated map.
 * @throws If the value names no meter, or the meter it names is malformed.
 */
export function toMeterData(value: MeterLike, name = 'meter'): MeterData {
  if (typeof value === 'string') {
    return parseTimeSignature(value);
  }
  if (typeof value === 'object' && value !== null) {
    const data =
      !Array.isArray(value) && 'toJSON' in value && typeof value.toJSON === 'function'
        ? value.toJSON()
        : (value as MeterData);
    return isMeterMap(data) ? assertMeterMap(data, name) : assertTimeSignature(data, name);
  }
  throw new InvalidInputError(
    `${name} must be a time signature, a meter map, or a signature name; received ${typeof value}`,
  );
}

/**
 * A position expressed as a bar index and a quarter-note offset within the bar.
 *
 * @category Rhythm & Meter
 */
export type BarPosition = {
  /**
   * 0-based bar index, counting the first full bar as 0.
   * {@link formatBarPosition} renders it 1-based. A pickup sounds before that
   * bar, so its notes report bar -1.
   */
  bar: number;
  /**
   * Quarter-note offset from the start of the bar — not the felt beat. In 6/8
   * the second felt beat is at `beat: 1.5`; {@link barPositionToPulse} converts
   * to felt-beat numbering.
   */
  beat: number;
};

const EPS = 1e-9;

/** The meter assumed when a caller names none. */
const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };

/** Whether `value` is an integer multiple of `unit` (within a float tolerance). */
function isMultiple(value: number, unit: number): boolean {
  if (unit === 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < EPS;
}

/**
 * Parse a time signature such as `"4/4"` or `"6/8"`, or the additive `"2+2+3/8"`.
 *
 * @param text The signature text.
 * @returns The parsed time signature.
 * @throws If the text is not `n/d` with positive integers, or names a signature
 *   the library rejects. Use {@link tryParseTimeSignature} where failure is
 *   ordinary, such as a meter field read on every keystroke.
 * @example
 * ```ts
 * import { parseTimeSignature } from '@libraz/libcantus';
 * parseTimeSignature('6/8'); // { numerator: 6, denominator: 8 }
 * ```
 * @category Rhythm & Meter
 */
export function parseTimeSignature(text: string): TimeSignature {
  return unwrapParse(tryParseTimeSignature(text));
}

/**
 * Parse a time signature, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseTimeSignature} — that function is this one
 * with its error thrown — for the callers where text that does not parse yet is
 * the normal state of the input rather than a fault.
 *
 * @param text The signature text.
 * @returns The signature, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseTimeSignature } from '@libraz/libcantus';
 * const result = tryParseTimeSignature('7/8');
 * result.ok ? result.value.numerator : result.error.message;
 * ```
 * @category Rhythm & Meter
 */
export function tryParseTimeSignature(text: string): ParseResult<TimeSignature> {
  try {
    if (typeof text !== 'string') {
      throw new InvalidInputError(`time signature must be a string; received ${typeof text}`);
    }
    return { ok: true, value: readTimeSignature(text) };
  } catch (error) {
    return parseFailure(error);
  }
}

/** The reading both parsers share, throwing on anything it cannot read. */
function readTimeSignature(text: string): TimeSignature {
  const match = /^\s*((?:\d+\s*\+\s*)*\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) {
    throw new InvalidInputError(`Invalid time signature: ${text}`);
  }
  const groupTokens = (match[1] ?? '').split('+').map((token) => Number.parseInt(token.trim(), 10));
  const numerator = groupTokens.reduce((sum, value) => sum + value, 0);
  const denominator = Number.parseInt(match[2] ?? '', 10);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    throw new InvalidInputError(`Invalid time signature: ${text}`);
  }
  // The same signature every consumer validates, validated here too: parsing
  // a signature the rest of the library rejects only moves the failure.
  const grouping = groupTokens.length > 1 ? groupTokens : undefined;
  return assertTimeSignature({ numerator, denominator, grouping }, `time signature ${text}`);
}

/**
 * Render a time signature as `"n/d"`, or as `"a+b+c/d"` when it carries an
 * additive grouping and `grouping` is requested.
 *
 * The additive form is what {@link parseTimeSignature} reads back, and it adds
 * its terms to get the numerator — so only a grouping written in denominator
 * units can be rendered that way. A grouping counted in main pulses (9/8 as
 * `[1, 1, 1]`, 12/8 as `[2, 2]`) would come back as a different bar, so it
 * falls back to the plain form, which those groupings cost nothing: they select
 * the same reading the bare signature does.
 *
 * The plain form drops the grouping, so a round trip through it reads 7/8 as
 * flat rather than as 2+2+3; ask for the additive form to keep it.
 *
 * @param ts The time signature.
 * @param opts Set `grouping: true` to render an additive grouping.
 * @returns The formatted signature.
 * @example
 * ```ts
 * import { formatTimeSignature } from '@libraz/libcantus';
 * const aksak = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
 * formatTimeSignature(aksak); // '7/8'
 * formatTimeSignature(aksak, { grouping: true }); // '2+2+3/8'
 * ```
 * @category Rhythm & Meter
 */
export function formatTimeSignature(ts: TimeSignature, opts: { grouping?: boolean } = {}): string {
  assertTimeSignature(ts);
  if (opts.grouping === true && ts.grouping !== undefined && groupingSumOf(ts) === ts.numerator) {
    return `${ts.grouping.join('+')}/${ts.denominator}`;
  }
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
 * The time signature in force at a beat.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The signature governing that beat.
 * @example
 * ```ts
 * import { meterAt, parseTimeSignature } from '@libraz/libcantus';
 * const meters = [
 *   { startBeat: 0, ts: parseTimeSignature('4/4') },
 *   { startBeat: 8, ts: parseTimeSignature('3/4') },
 * ];
 * meterAt(9, meters); // { numerator: 3, denominator: 4 }
 * ```
 * @category Rhythm & Meter
 */
export function meterAt(beatInQuarters: number, meter: MeterLike): TimeSignature {
  assertFiniteNumber(beatInQuarters, 'beat');
  return meterAtChecked(beatInQuarters, toMeterData(meter));
}

/** {@link meterAt} without re-reading an already resolved meter. */
function meterAtChecked(beatInQuarters: number, meter: MeterData): TimeSignature {
  if (!isMeterMap(meter)) {
    return meter;
  }
  return meter[entryIndexOf(meter, beatInQuarters)]?.ts ?? DEFAULT_TS;
}

/**
 * Absolute beat at which the bar containing `beatInQuarters` begins.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The bar's first beat, negative inside a pickup.
 * @category Rhythm & Meter
 */
export function barStartBeat(beatInQuarters: number, meter: MeterLike): number {
  assertFiniteNumber(beatInQuarters, 'beat');
  return barStartChecked(beatInQuarters, toMeterData(meter));
}

/** {@link barStartBeat} without re-reading an already resolved meter. */
function barStartChecked(beatInQuarters: number, meter: MeterData): number {
  if (isMeterMap(meter)) {
    return barStartOf(meter, beatInQuarters);
  }
  const barLen = barBeatsOf(meter);
  return Math.floor(beatInQuarters / barLen + EPS) * barLen;
}

/**
 * Bar index of a beat: 0 for the first full bar, negative inside a pickup.
 *
 * Bars accumulate across meter changes, so the bar after a 4/4-to-3/4 change is
 * the next bar and not the first bar of a new count.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The 0-based bar index.
 * @example
 * ```ts
 * import { barIndexAt, parseTimeSignature } from '@libraz/libcantus';
 * const meters = [
 *   { startBeat: 0, ts: parseTimeSignature('4/4') },
 *   { startBeat: 8, ts: parseTimeSignature('3/4') },
 * ];
 * barIndexAt(11, meters); // 3
 * ```
 * @category Rhythm & Meter
 */
export function barIndexAt(beatInQuarters: number, meter: MeterLike): number {
  assertFiniteNumber(beatInQuarters, 'beat');
  return barIndexChecked(beatInQuarters, toMeterData(meter));
}

/** {@link barIndexAt} without re-reading an already resolved meter. */
function barIndexChecked(beatInQuarters: number, meter: MeterData): number {
  if (isMeterMap(meter)) {
    return barIndexOf(meter, beatInQuarters);
  }
  return Math.floor(beatInQuarters / barBeatsOf(meter) + EPS);
}

/**
 * Length in quarter-note beats of the bar containing a beat.
 *
 * The meter-map counterpart of {@link beatsPerBar}, which answers for one
 * signature and so cannot be asked about a piece that changes meter.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The bar length in quarter notes.
 * @category Rhythm & Meter
 */
export function beatsPerBarAt(beatInQuarters: number, meter: MeterLike): number {
  return barBeatsOf(meterAt(beatInQuarters, meter));
}

/**
 * Read the meter out of a pair of options that accept either form.
 *
 * Entry points take `meters` for a piece that changes meter and keep `ts` as
 * sugar for a piece that does not, so this is the one place that resolves the
 * pair — including the rule that naming both is an input error rather than one
 * of them silently winning.
 *
 * @param opts The options carrying `ts`, `meters`, or neither.
 * @param name What the options belong to, for the error message.
 * @returns The meter map to analyse against; 4/4 throughout when neither is given.
 * @throws If both `ts` and `meters` are given, or the map is malformed.
 * @example
 * ```ts
 * import { parseTimeSignature, resolveMeters } from '@libraz/libcantus';
 * resolveMeters({ ts: parseTimeSignature('3/4') });
 * // [{ startBeat: 0, ts: { numerator: 3, denominator: 4 } }]
 * ```
 * @category Rhythm & Meter
 */
export function resolveMeters(
  opts: { ts?: TimeSignature; meters?: MeterMap },
  name = 'meters',
): MeterMap {
  if (opts.ts !== undefined && opts.meters !== undefined) {
    throw new InvalidInputError(
      `${name} and ts name the same thing; give one or the other, not both`,
    );
  }
  if (opts.meters !== undefined) {
    return assertMeterMap(opts.meters, name);
  }
  const ts = opts.ts ?? DEFAULT_TS;
  assertTimeSignature(ts);
  return [{ startBeat: 0, ts }];
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

/** Whether `pulseIndex` is the head pulse of one of the groups, counted in pulses. */
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
 * Whether every group is the same length.
 *
 * Such a grouping divides the bar the way its own meter already divides it, so
 * it names no accent structure: 9/8 as `[1, 1, 1]` is the plain compound bar,
 * not three pulses of equal strength.
 */
function isUniformGrouping(grouping: number[]): boolean {
  return grouping.every((entry) => entry === grouping[0]);
}

/**
 * Convert an absolute quarter-note position to a bar index and in-bar offset.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The bar and in-bar quarter-note offset.
 * @example
 * ```ts
 * import { parseTimeSignature, beatToBarPosition } from '@libraz/libcantus';
 * const ts = parseTimeSignature('4/4');
 * beatToBarPosition(5, ts); // { bar: 1, beat: 1 }
 * ```
 * @category Rhythm & Meter
 */
export function beatToBarPosition(beatInQuarters: number, meter: MeterLike): BarPosition {
  assertFiniteNumber(beatInQuarters, 'beat');
  return barPositionChecked(beatInQuarters, toMeterData(meter));
}

/** {@link beatToBarPosition} without re-reading an already resolved meter. */
function barPositionChecked(beatInQuarters: number, meter: MeterData): BarPosition {
  return {
    bar: barIndexChecked(beatInQuarters, meter),
    beat: beatInQuarters - barStartChecked(beatInQuarters, meter),
  };
}

/**
 * Length of one felt beat (main pulse) in quarter-note beats.
 *
 * A quarter note in simple meters, a dotted quarter in compound ones, and one
 * denominator unit in an additive metre. Position displays, click tracks, and
 * score export are all written against this length.
 *
 * @param ts The time signature.
 * @returns The pulse length in quarter-note beats.
 * @example
 * ```ts
 * import { parseTimeSignature, pulseBeats } from '@libraz/libcantus';
 * pulseBeats(parseTimeSignature('6/8')); // 1.5
 * ```
 * @category Rhythm & Meter
 */
export function pulseBeats(ts: TimeSignature): number {
  assertTimeSignature(ts);
  return pulseBeatsOf(ts);
}

/**
 * The felt-beat number of a bar position, 1-based.
 *
 * {@link BarPosition.beat} is a quarter-note offset, so in 6/8 the second felt
 * beat reads as 1.5. This is the number a musician says and a position display
 * shows.
 *
 * @param pos The bar position.
 * @param meter A single signature, or the piece's meter map.
 * @returns The 1-based felt-beat number, fractional between pulses.
 * @example
 * ```ts
 * import { barPositionToPulse, parseTimeSignature } from '@libraz/libcantus';
 * barPositionToPulse({ bar: 0, beat: 1.5 }, parseTimeSignature('6/8')); // 2
 * ```
 * @category Rhythm & Meter
 */
export function barPositionToPulse(pos: BarPosition, meter: MeterLike): number {
  assertFiniteNumber(pos.beat, 'position.beat');
  return pulseChecked(pos, toMeterData(meter));
}

/** {@link barPositionToPulse} without re-reading an already resolved meter. */
function pulseChecked(pos: BarPosition, meter: MeterData): number {
  return pos.beat / pulseBeatsOf(meterAtBarChecked(pos.bar, meter)) + 1;
}

/** The signature governing a bar index, on an already resolved meter. */
function meterAtBarChecked(bar: number, meter: MeterData): TimeSignature {
  if (!isMeterMap(meter)) {
    return meter;
  }
  assertFiniteNumber(bar, 'position.bar');
  return meterAtChecked(beatOfBarIndex(meter, bar), meter);
}

/**
 * Render an absolute position as the `bar.beat` a DAW or a score shows:
 * 1-based bar, 1-based felt beat.
 *
 * The felt beats counted are the ones the bar actually has. A meter change
 * starts a new bar, so the bar it interrupts is short, and a position that
 * rounds past the end of a short bar reads as the downbeat of the next one
 * rather than as a beat the bar never reached.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @param decimals Digits of the fractional beat to keep.
 * @returns The formatted position, e.g. `'3.2'` for bar 3, felt beat 2.
 * @example
 * ```ts
 * import { formatBarPosition, parseTimeSignature } from '@libraz/libcantus';
 * formatBarPosition(7.5, parseTimeSignature('6/8')); // '3.2'
 * ```
 * @category Rhythm & Meter
 */
export function formatBarPosition(beatInQuarters: number, meter: MeterLike, decimals = 2): string {
  assertInteger(decimals, 'decimals', 0, 100);
  assertFiniteNumber(beatInQuarters, 'beat');
  const resolved = toMeterData(meter);
  const position = barPositionChecked(beatInQuarters, resolved);
  const ts = meterAtChecked(beatInQuarters, resolved);
  const pulse = pulseChecked(position, ts);
  const rounded = Number(pulse.toFixed(decimals));
  const barLength = isMeterMap(resolved)
    ? barLengthOf(resolved, beatInQuarters)
    : barBeatsOf(resolved);
  // A short bar has a whole final pulse only in the sense that the pulse it
  // started is cut off, so the count rounds up: 2 beats of 4/4 hold felt beats
  // 1 and 2, and anything past those belongs to the next bar.
  const pulsesInBar = Math.ceil(barLength / pulseBeatsOf(ts) - EPS);
  if (rounded >= pulsesInBar + 1) {
    return `${barIndexChecked(barStartChecked(beatInQuarters, resolved) + barLength, resolved) + 1}.1`;
  }
  const wholePulse = Math.floor(rounded);
  const fraction = Number((rounded - wholePulse).toFixed(decimals));
  return fraction === 0
    ? `${position.bar + 1}.${wholePulse}`
    : `${position.bar + 1}.${wholePulse}+${fraction}`;
}

/**
 * Convert a bar index and in-bar offset back to an absolute quarter-note
 * position.
 *
 * @param pos The bar position.
 * @param meter A single signature, or the piece's meter map.
 * @returns The absolute position in quarter-note beats.
 * @category Rhythm & Meter
 */
export function barPositionToBeat(pos: BarPosition, meter: MeterLike): number {
  assertInteger(pos.bar, 'bar position bar');
  assertFiniteNumber(pos.beat, 'bar position beat');
  const resolved = toMeterData(meter);
  if (isMeterMap(resolved)) {
    return beatOfBarIndex(resolved, pos.bar) + pos.beat;
  }
  return pos.bar * barBeatsOf(resolved) + pos.beat;
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
 * pulses). A grouping of equal-length groups (9/8 as `[1, 1, 1]`, 4/4 as
 * `[1, 1, 1, 1]`) states the division the meter already has, so it weighs as
 * an ungrouped bar rather than accenting every group head.
 *
 * Given a meter map, the weight follows the signature in force at that beat, so
 * beat 5 of a piece is a mid-bar accent in 4/4 and a plain main pulse in 3/4.
 * The downbeat is beat 0 however much pickup precedes it, so a note in the
 * pickup weighs as the upbeat it is rather than as a downbeat.
 *
 * @param beatInQuarters Absolute quarter-note position, or an in-bar offset
 *   when the meter is a single signature.
 * @param meter A single signature, or the piece's meter map.
 * @returns The metric weight (0–3).
 * @throws If the meter is malformed, including a grouping that is not a
 *   positive-integer list summing to the pulse count or the numerator.
 * @example
 * ```ts
 * import { parseTimeSignature, metricWeight } from '@libraz/libcantus';
 * const ts = parseTimeSignature('4/4');
 * metricWeight(0, ts); // 3 (the downbeat)
 * ```
 * @category Rhythm & Meter
 */
export function metricWeight(beatInQuarters: number, meter: MeterLike): number {
  assertFiniteNumber(beatInQuarters, 'beat');
  const resolved = toMeterData(meter);
  const ts = meterAtChecked(beatInQuarters, resolved);
  const beat = beatInQuarters - barStartChecked(beatInQuarters, resolved);
  const pulse = pulseBeatsOf(ts);
  if (!isMultiple(beat, pulse)) {
    return 0;
  }
  const pulses = pulseCountOf(ts);
  const pulseIndex = Math.round(beat / pulse) % pulses;
  if (pulseIndex === 0) {
    return 3;
  }
  const grouping = pulseGroupingOf(ts);
  if (grouping !== undefined && !isUniformGrouping(grouping)) {
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
 * @param beatInQuarters Absolute quarter-note position, or an in-bar offset
 *   when the meter is a single signature.
 * @param meter A single signature, or the piece's meter map.
 * @returns True on strong beats.
 * @category Rhythm & Meter
 */
export function isStrongBeat(beatInQuarters: number, meter: MeterLike): boolean {
  return metricWeight(beatInQuarters, meter) >= 2;
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
