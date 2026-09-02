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
  assertOptions,
  assertPositiveInt,
  assertRange,
  assertRecord,
  assertTimeSignature,
  describeRejected,
} from '../validation/index.js';
import type { MeterData } from './internal.js';
import {
  BEAT_EPS,
  barBeatsOf,
  barIndexOf,
  barLengthOf,
  barStartOf,
  beatOfBarIndex,
  copyMeterData,
  copyTimeSignature,
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
 * Beat 0 is the first downbeat here as everywhere else: the opening signature
 * lays its bar lines from beat 0 whatever beat the first entry is written at, so
 * a map opening at the pickup it covers numbers its bars exactly as the bare
 * signature does. Every later entry starts a bar at the beat it takes effect.
 *
 * @category Rhythm & Meter
 */
export type MeterMap = MeterChange[];

export type { MeterData } from './internal.js';
// The one tolerance the beat axis is compared with, declared in the layer
// below every reader of it.
export { BEAT_EPS } from './internal.js';

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
 * @returns The validated signature, or the validated map, freshly allocated
 *   down to every grouping array — so a caller may keep and edit what it gets
 *   back without editing the meter it passed in, and without any two calls
 *   handing out the same object.
 * @throws If the value names no meter, or the meter it names is malformed.
 */
export function toMeterData(value: MeterLike, name = 'meter'): MeterData {
  return copyMeterData(readMeterData(value, name));
}

/**
 * {@link toMeterData} without the copy, for the library's own reads.
 *
 * The copy is what keeps a returned meter from aliasing the caller's, and the
 * functions below only read what they resolve — a positional question is asked
 * once per slot, and copying the map for each of them would cost more than
 * answering it.
 */
function readMeterData(value: MeterLike, name = 'meter'): MeterData {
  if (typeof value === 'string') {
    const parsed = tryParseTimeSignature(value);
    if (parsed.ok) {
      return parsed.value;
    }
    // The reading is the parser's, but the failure is reported against the
    // argument the caller filled: a caller holding several meters has to hear
    // which one it was, and `time signature` names none of them.
    throw new InvalidInputError(`${name} must name a time signature; ${parsed.error.message}`);
  }
  if (typeof value === 'object' && value !== null) {
    const data =
      !Array.isArray(value) && 'toJSON' in value && typeof value.toJSON === 'function'
        ? value.toJSON()
        : (value as MeterData);
    if (isMeterMap(data)) {
      return assertMeterMap(data, name);
    }
    // A value that carries no numerator names no meter at all, so it is refused
    // as the argument it is rather than as a signature missing a field: an
    // options object handed to the wrong parameter is not a malformed
    // numerator, and saying so sends the caller looking for the wrong fault.
    if (typeof data === 'object' && data !== null && 'numerator' in data) {
      return assertTimeSignature(data, name);
    }
  }
  throw new InvalidInputError(
    `${name} must be a time signature, a meter map, or a signature name; received ${describeRejected(value)}`,
  );
}

/**
 * The single signature a meter-shaped value names.
 *
 * A meter map is a run of changes and so names no one bar. The functions that
 * answer about a single signature take no beat to ask about, so they all read
 * the same one — the signature the piece opens in, which is the signature in
 * force at beat 0 — rather than each falling over a different field of the
 * array.
 */
function readSignature(value: MeterLike, name: string): TimeSignature {
  const resolved = readMeterData(value, name);
  return isMeterMap(resolved) ? meterAtChecked(0, resolved) : resolved;
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

/**
 * The meter assumed when a caller names none.
 *
 * Frozen, and copied on the way out of every function that hands a default
 * meter back: a shared default that a caller can write to is a default the
 * whole process then reads differently.
 */
const DEFAULT_TS: TimeSignature = Object.freeze({ numerator: 4, denominator: 4 });

/**
 * How far {@link metricGridUnit} divides a pulse to land on a meter change.
 *
 * The finest subdivision a bar is written in, which is what separates a change
 * placed inside a bar from one placed a floating hair off a beat.
 */
const MAX_CHANGE_DIVISIONS = 16;

/** Whether `value` is an integer multiple of `unit` (within a float tolerance). */
function isMultiple(value: number, unit: number): boolean {
  if (unit === 0) {
    return false;
  }
  const ratio = value / unit;
  return Math.abs(ratio - Math.round(ratio)) < BEAT_EPS;
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
  // a signature the rest of the library rejects only moves the failure. A
  // signature without a grouping omits the field rather than holding an
  // undefined one, so equality by own keys reads a parsed signature and one
  // written by hand as the same bar.
  const ts: TimeSignature =
    groupTokens.length > 1
      ? { numerator, denominator, grouping: groupTokens }
      : { numerator, denominator };
  return assertTimeSignature(ts, `time signature ${text}`);
}

/**
 * Render a time signature as `"n/d"`, or as `"a+b+c/d"` when it carries an
 * additive grouping and `grouping` is requested.
 *
 * The additive form is what {@link parseTimeSignature} reads back, and it adds
 * its terms to get the numerator — so only a grouping written in denominator
 * units can be rendered that way. A grouping counted in main pulses whose groups
 * are all the same length (9/8 as `[1, 1, 1]`, 12/8 as `[2, 2]`) states the
 * division the bare signature already has, so it falls back to the plain form at
 * no cost. One whose groups differ (12/8 as `[1, 1, 2]`) states an accent no
 * signature text can carry, and asking for the additive form of it is refused
 * rather than answered with a bar that weighs its pulses differently.
 *
 * The plain form drops the grouping, so a round trip through it reads 7/8 as
 * flat rather than as 2+2+3; ask for the additive form to keep it.
 *
 * @param ts The time signature, in any form that names one; a meter map is
 *   rendered as the signature it opens in.
 * @param opts Set `grouping: true` to render an additive grouping.
 * @returns The formatted signature.
 * @throws If `grouping: true` is asked of a grouping that no signature text can
 *   spell: one counted in main pulses, on a compound numerator, whose groups are
 *   not all the same length.
 * @example
 * ```ts
 * import { formatTimeSignature } from '@libraz/libcantus';
 * const aksak = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
 * formatTimeSignature(aksak); // '7/8'
 * formatTimeSignature(aksak, { grouping: true }); // '2+2+3/8'
 * ```
 * @category Rhythm & Meter
 */
export function formatTimeSignature(ts: MeterLike, opts: { grouping?: boolean } = {}): string {
  const asked = assertOptions(opts, 'opts');
  const signature = readSignature(ts, 'ts');
  const grouping = signature.grouping;
  if (asked.grouping === true && grouping !== undefined) {
    if (groupingSumOf(signature) === signature.numerator) {
      return `${grouping.join('+')}/${signature.denominator}`;
    }
    // A grouping counted in pulses adds up to the numerator only where a pulse
    // is one unit, so on a compound numerator it has no additive spelling. Where
    // its groups differ it is the only thing saying which pulses are accented,
    // and the plain form would hand back a bar whose weights are not this bar's.
    const pulseGrouping = pulseGroupingOf(signature);
    if (pulseGrouping !== undefined && !isUniformGrouping(pulseGrouping)) {
      throw new InvalidInputError(
        `ts carries a grouping no signature text can spell: ${grouping.join('+')} counted in the pulses of ${signature.numerator}/${signature.denominator}. Format it without the grouping to name the bar it is written in.`,
      );
    }
  }
  return `${signature.numerator}/${signature.denominator}`;
}

/**
 * Whether a meter is compound: its main pulses each divide into three, as in
 * 6/8, 9/8, 12/8, or 6/4. Compound meters are those whose numerator is a
 * multiple of three greater than three, independent of the denominator. Meters
 * like 3/8 and 3/4 (simple triples, numerator 3) are not compound, and neither
 * is a signature whose {@link TimeSignature.grouping} selects the additive
 * reading (9/8 as 2+2+2+3).
 *
 * @param ts The time signature, in any form that names one; a meter map is read
 *   as the signature it opens in.
 * @returns True for compound meters.
 * @category Rhythm & Meter
 */
export function isCompound(ts: MeterLike): boolean {
  const signature = readSignature(ts, 'ts');
  return isCompoundNumerator(signature.numerator) && !isAdditiveReading(signature);
}

/**
 * Length of a bar in quarter-note beats.
 *
 * @param ts The time signature, in any form that names one; a meter map has no
 *   single bar length, so it is read as the signature it opens in. Ask
 *   {@link beatsPerBarAt} for the bar a given beat falls in.
 * @returns The bar length in quarter notes.
 * @example
 * ```ts
 * import { beatsPerBar } from '@libraz/libcantus';
 * beatsPerBar('6/8'); // 3
 * ```
 * @category Rhythm & Meter
 */
export function beatsPerBar(ts: MeterLike): number {
  return barBeatsOf(readSignature(ts, 'ts'));
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
  return copyTimeSignature(meterAtChecked(beatInQuarters, readMeterData(meter)));
}

/** {@link meterAt} without re-reading an already resolved meter. */
function meterAtChecked(beatInQuarters: number, meter: MeterData): TimeSignature {
  if (!isMeterMap(meter)) {
    return meter;
  }
  const ts = meter[entryIndexOf(meter, beatInQuarters)]?.ts;
  if (ts === undefined) {
    // A validated map is a non-empty run whose first entry governs everything
    // before it, so there is always an entry in force. Reaching here means the
    // map was emptied or holed after it was read, and answering 4/4 would put
    // the whole position system on a bar the caller never named.
    throw new InvalidInputError(
      `meters names no time signature in force at beat ${beatInQuarters}; a meter map must stay a non-empty run of changes while it is being read`,
    );
  }
  return ts;
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
  return barStartChecked(beatInQuarters, readMeterData(meter));
}

/** {@link barStartBeat} without re-reading an already resolved meter. */
function barStartChecked(beatInQuarters: number, meter: MeterData): number {
  if (isMeterMap(meter)) {
    return barStartOf(meter, beatInQuarters);
  }
  const barLen = barBeatsOf(meter);
  return Math.floor(beatInQuarters / barLen + BEAT_EPS) * barLen;
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
  return barIndexChecked(beatInQuarters, readMeterData(meter));
}

/** {@link barIndexAt} without re-reading an already resolved meter. */
function barIndexChecked(beatInQuarters: number, meter: MeterData): number {
  if (isMeterMap(meter)) {
    return barIndexOf(meter, beatInQuarters);
  }
  return Math.floor(beatInQuarters / barBeatsOf(meter) + BEAT_EPS);
}

/**
 * Length in quarter-note beats of the bar containing a beat.
 *
 * The meter-map counterpart of {@link beatsPerBar}, which answers for one
 * signature and so cannot be asked about a piece that changes meter.
 *
 * The bar the beat is in, not the bar its signature nominally has: a change of
 * meter starts a new bar, so a bar interrupted by one is shorter than its own
 * signature says. Reading the signature's own length there would put the end of
 * the bar past where the next one begins, and every span measured in bars from
 * that point on would be counted against a bar length the music never had.
 *
 * @param beatInQuarters Absolute position in quarter-note beats.
 * @param meter A single signature, or the piece's meter map.
 * @returns The bar length in quarter notes.
 * @category Rhythm & Meter
 */
export function beatsPerBarAt(beatInQuarters: number, meter: MeterLike): number {
  assertFiniteNumber(beatInQuarters, 'beat');
  const data = readMeterData(meter);
  // A single signature has no interruption to be cut short by, so the two
  // readings agree there and the map walk is not paid for.
  return isMeterMap(data)
    ? barLengthOf(data, beatInQuarters)
    : barBeatsOf(meterAt(beatInQuarters, meter));
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
 * @returns The meter map to analyse against, freshly allocated down to every
 *   signature and grouping array, so writing to it changes nothing another
 *   caller reads; 4/4 throughout when neither `ts` nor `meters` is given.
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
  opts: { ts?: MeterLike; meters?: MeterLike },
  name = 'meters',
): MeterMap {
  assertRecord(opts, `${name} options`);
  if (opts.ts !== undefined && opts.meters !== undefined) {
    throw new InvalidInputError(
      `${name} and ts name the same thing; give one or the other, not both`,
    );
  }
  // A null is refused rather than defaulted: the coalescing below reads it as
  // absent, so a field a caller wrote `null` into — which is what a host with no
  // meter to give passes on — would silently be answered with the library's own
  // bar instead of with the meter the caller meant to name.
  for (const [field, value] of [
    ['meters', opts.meters],
    ['ts', opts.ts],
  ] as const) {
    if ((value as unknown) === null) {
      throw new InvalidInputError(
        `${field === 'meters' ? name : 'ts'} must name a meter, not null`,
      );
    }
  }
  const given = opts.meters ?? opts.ts;
  if (given === undefined) {
    return [{ startBeat: 0, ts: copyTimeSignature(DEFAULT_TS) }];
  }
  // Either field takes any meter-shaped value, so either may name the map: what
  // separates them is which name an error is reported under, not which shape is
  // accepted where.
  const resolved = toMeterData(given, opts.meters !== undefined ? name : 'ts');
  return isMeterMap(resolved) ? resolved : [{ startBeat: 0, ts: resolved }];
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
 * @param ts The time signature, in any form that names one; a meter map is read
 *   as the signature it opens in.
 * @returns The pulse count per bar.
 * @category Rhythm & Meter
 */
export function pulsesPerBar(ts: MeterLike): number {
  return pulseCountOf(readSignature(ts, 'ts'));
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
  return barPositionChecked(beatInQuarters, readMeterData(meter));
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
 * @param ts The time signature, in any form that names one; a meter map is read
 *   as the signature it opens in.
 * @returns The pulse length in quarter-note beats.
 * @example
 * ```ts
 * import { pulseBeats } from '@libraz/libcantus';
 * pulseBeats('6/8'); // 1.5
 * ```
 * @category Rhythm & Meter
 */
export function pulseBeats(ts: MeterLike): number {
  return pulseBeatsOf(readSignature(ts, 'ts'));
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
  // The bar is checked before the meter is read, so a position no meter could
  // hold is refused the same way whichever form the meter came in: which bar a
  // signature is asked about is the caller's own answer, and a single signature
  // hiding a NaN behind arithmetic that never touches it is the reading the map
  // form already rejects.
  const position = assertRecord<BarPosition>(pos, 'position');
  assertInteger(position.bar, 'position.bar');
  assertFiniteNumber(position.beat, 'position.beat');
  return pulseChecked(position, readMeterData(meter));
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
 * @returns The formatted position in one of two forms: `bar.beat` on a felt
 *   beat, e.g. `'3.2'` for bar 3, felt beat 2; and `bar.beat+fraction` between
 *   felt beats, e.g. `'3.2+0.5'` halfway from the second felt beat to the third.
 *   A reader of these strings has to take both, since most onsets of an ordinary
 *   piece fall between pulses.
 * @example
 * ```ts
 * import { formatBarPosition, parseTimeSignature } from '@libraz/libcantus';
 * formatBarPosition(7.5, parseTimeSignature('6/8')); // '3.2'
 * formatBarPosition(8.25, parseTimeSignature('6/8')); // '3.2+0.5'
 * ```
 * @category Rhythm & Meter
 */
export function formatBarPosition(beatInQuarters: number, meter: MeterLike, decimals = 2): string {
  assertInteger(decimals, 'decimals', 0, 100);
  assertFiniteNumber(beatInQuarters, 'beat');
  const resolved = readMeterData(meter);
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
  const pulsesInBar = Math.ceil(barLength / pulseBeatsOf(ts) - BEAT_EPS);
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
  const position = assertRecord<BarPosition>(pos, 'bar position');
  assertInteger(position.bar, 'bar position bar');
  assertFiniteNumber(position.beat, 'bar position beat');
  const resolved = readMeterData(meter);
  if (isMeterMap(resolved)) {
    return beatOfBarIndex(resolved, position.bar) + position.beat;
  }
  return position.bar * barBeatsOf(resolved) + position.beat;
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
 * beat 2 of a piece is a mid-bar accent in 4/4 and a plain main pulse in 3/4.
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
  const resolved = readMeterData(meter);
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
  // A grouping of equal-length groups states no accent only when it restates the
  // division its own meter already has. An additive reading has flattened the
  // bar into its units, so its groups are the only thing saying where the accents
  // are: 6/8 as [2, 2, 2] is felt on the head of each pair, and the midpoint the
  // compound reading would accent is not one of them.
  if (grouping !== undefined && (isAdditiveReading(ts) || !isUniformGrouping(grouping))) {
    return isGroupHead(grouping, pulseIndex) ? 2 : 1;
  }
  if (pulses % 2 === 0 && pulseIndex === pulses / 2) {
    return 2;
  }
  return 1;
}

/**
 * Length in quarter-note beats of the metric grid a meter states: the longest
 * step that lands on every main pulse the meter has.
 *
 * One signature answers with its own {@link pulseBeats} — a quarter in 4/4, a
 * dotted quarter in 6/8. A meter map answers with the longest step that is a
 * whole division of every signature it names, so a grid built on it lands on the
 * pulses of each of them rather than on the ones the piece opened in. A change
 * need not fall on a bar line of the signature before it, so the beat each of
 * them takes effect at divides the step too: a grid that steps over the onset of
 * a change lands on none of the pulses that follow it.
 *
 * This is the single derivation of the grid that everything metric is laid out
 * against: a slot grid that steps over pulses never sees what happens on them,
 * so the analysis reports a bar as one chord that no instrument ever played, and
 * a generator ranks a bar's positions by a bar length it does not have.
 * {@link metricWeight} says how strong a position is, and this says which
 * positions there are; nothing else derives either.
 *
 * @param meter A single signature, or the piece's meter map.
 * @returns The grid step in quarter-note beats — 1 in 4/4, 1.5 in 6/8.
 */
export function metricGridUnit(meter: MeterLike): number {
  const resolved = readMeterData(meter);
  if (!isMeterMap(resolved)) {
    return pulseBeatsOf(resolved);
  }
  let unit = 0;
  for (const change of resolved) {
    unit = commonStep(unit, pulseBeatsOf(change.ts));
  }
  if (unit <= 0) {
    return pulseBeatsOf(DEFAULT_TS);
  }
  const origin = resolved[0]?.startBeat ?? 0;
  let onChanges = unit;
  for (const change of resolved) {
    onChanges = commonStep(onChanges, Math.abs(change.startBeat - origin));
  }
  // An onset written a hair off a beat divides into a step no coarser than the
  // hair, and a grid that fine costs a slot per step of the piece while landing
  // on nothing anyone plays. Past the division limit the onset is read as
  // unmeasured and the grid keeps the step the pulses alone state.
  return onChanges * MAX_CHANGE_DIVISIONS >= unit - BEAT_EPS ? onChanges : unit;
}

/**
 * The longest step both lengths are a whole number of, or `b` when `a` is zero.
 *
 * Euclid over beat lengths, which are the small rationals a signature makes them
 * — halves, thirds and quarters of a beat — so the remainder reaches zero in a
 * few turns. A pair that does not divide within them falls back to the shorter
 * length, since a grid finer than either pulse buys nothing the pulses do not
 * already give and a runaway one costs a slot per subdivision of the piece.
 */
function commonStep(a: number, b: number): number {
  let longer = Math.max(a, b);
  let shorter = Math.min(a, b);
  for (let i = 0; i < 8 && shorter > BEAT_EPS; i += 1) {
    const remainder = longer - Math.floor(longer / shorter + BEAT_EPS) * shorter;
    longer = shorter;
    shorter = remainder > BEAT_EPS ? remainder : 0;
  }
  const smallest = a > 0 && b > 0 ? Math.min(a, b) : Math.max(a, b);
  return longer > BEAT_EPS && longer <= smallest + BEAT_EPS ? longer : smallest;
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
