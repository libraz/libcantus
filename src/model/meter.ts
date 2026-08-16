import type { ParseResult } from '../core/errors/index.js';
import type { BarPosition, TimeSignature } from '../core/meter/index.js';
import {
  beatsPerBar,
  beatToBarPosition,
  formatBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  tryParseTimeSignature,
  tuplet,
} from '../core/meter/index.js';
import { assertTimeSignature } from '../core/validation/index.js';

/**
 * A defensive copy of a plain time signature, checked the way every meter
 * function checks it.
 *
 * Data arriving from a project file, a plugin, or a hand-edited JSON enters
 * here, so it is held to the rules a parsed signature is held to: an unchecked
 * numerator of zero or of `NaN` would divide every bar this class measures.
 */
function copyTimeSignature(ts: TimeSignature): TimeSignature {
  assertTimeSignature(ts);
  return ts.grouping === undefined
    ? { numerator: ts.numerator, denominator: ts.denominator }
    : { numerator: ts.numerator, denominator: ts.denominator, grouping: [...ts.grouping] };
}

/**
 * An immutable time signature: a numerator over a note-value denominator, with
 * the optional grouping that gives an additive metre its felt beats. A thin
 * convenience wrapper over the meter module's plain time signature.
 *
 * One signature, not a piece's meter over time: a piece that changes meter is
 * described by a meter map, which the meter module's own functions read.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Meter } from '@libraz/libcantus';
 * Meter.parse('6/8').isCompound; // true
 * ```
 */
export class Meter {
  readonly #ts: TimeSignature;

  private constructor(ts: TimeSignature) {
    this.#ts = copyTimeSignature(ts);
  }

  /**
   * Build a meter from its parts.
   *
   * @param numerator Beats in a bar, counted in denominator units.
   * @param denominator The note value one unit is written as, e.g. 8 for an
   *   eighth note.
   * @param grouping Optional grouping of the bar into felt beats, as positive
   *   integers summing to the pulse count or to the numerator — `[2, 2, 3]`
   *   for a 2+2+3 reading of 7/8.
   * @returns The meter.
   * @throws If the numerator or denominator is not a positive integer, or the
   *   grouping sums to neither the pulse count nor the numerator.
   */
  static of(numerator: number, denominator: number, grouping?: number[]): Meter {
    return new Meter(
      grouping === undefined ? { numerator, denominator } : { numerator, denominator, grouping },
    );
  }

  /**
   * Parse a time signature such as `'4/4'`, `'6/8'`, or the additive `'2+2+3/8'`.
   *
   * @param text The signature text.
   * @returns The meter that text names.
   * @throws If the text is not `n/d` with positive integers, or names a
   *   signature the library rejects. Use {@link Meter.tryParse} where failure
   *   is ordinary, such as a meter field read on every keystroke.
   */
  static parse(text: string): Meter {
    return new Meter(parseTimeSignature(text));
  }

  /**
   * Parse a time signature, reporting failure instead of throwing it.
   *
   * The same reading as {@link Meter.parse} — that method is this one with its
   * error thrown — for the callers where text that does not parse yet is the
   * normal state of the input rather than a fault.
   *
   * @param text The signature text.
   * @returns The meter, or the error explaining why the text is not one.
   * @example
   * ```ts
   * import { Meter } from '@libraz/libcantus';
   * const result = Meter.tryParse('7/8');
   * result.ok ? result.value.pulsesPerBar : result.error.message; // 7
   * ```
   */
  static tryParse(text: string): ParseResult<Meter> {
    const parsed = tryParseTimeSignature(text);
    return parsed.ok ? { ok: true, value: new Meter(parsed.value) } : parsed;
  }

  /**
   * Wrap a plain time signature, as the meter module produces it.
   *
   * @param data The plain time signature.
   * @returns The wrapped meter.
   * @throws If the signature is not one the library accepts.
   */
  static fromData(data: TimeSignature): Meter {
    return new Meter(data);
  }

  /**
   * Rebuild a meter from its {@link Meter.toJSON} output.
   *
   * @param data The serialized time signature.
   * @returns The wrapped meter.
   * @throws If the signature is not one the library accepts.
   */
  static fromJSON(data: TimeSignature): Meter {
    return new Meter(data);
  }

  /** Beats in a bar, counted in denominator units: the 6 of 6/8. */
  get numerator(): number {
    return this.#ts.numerator;
  }

  /** The note value one unit is written as: the 8 of 6/8. */
  get denominator(): number {
    return this.#ts.denominator;
  }

  /** A copy of the felt-beat grouping, or undefined when the bar is ungrouped. */
  get grouping(): number[] | undefined {
    return this.#ts.grouping === undefined ? undefined : [...this.#ts.grouping];
  }

  /** A copy of the underlying plain time signature. */
  get data(): TimeSignature {
    return this.toJSON();
  }

  /**
   * Whether the meter is compound: its main pulses each divide into three, as
   * in 6/8, 9/8, or 12/8. A simple triple such as 3/4 is not compound, and
   * neither is a signature whose grouping selects the additive reading.
   */
  get isCompound(): boolean {
    return isCompound(this.#ts);
  }

  /** Length of a bar in quarter-note beats. */
  get beatsPerBar(): number {
    return beatsPerBar(this.#ts);
  }

  /** Main pulses (felt beats) in a bar: 3 in 6/8, 4 in 4/4. */
  get pulsesPerBar(): number {
    return pulsesPerBar(this.#ts);
  }

  /**
   * Length of one felt beat in quarter-note beats: a quarter note in simple
   * meters, a dotted quarter in compound ones.
   */
  get pulseBeats(): number {
    return pulseBeats(this.#ts);
  }

  /**
   * Render the signature as `'n/d'`, or as `'a+b+c/d'` when it carries an
   * additive grouping and one is asked for.
   *
   * @param opts Set `grouping: true` to render an additive grouping. A
   *   grouping counted in main pulses cannot be written additively and falls
   *   back to the plain form.
   * @returns The formatted signature.
   * @example
   * ```ts
   * import { Meter } from '@libraz/libcantus';
   * Meter.of(7, 8, [2, 2, 3]).format({ grouping: true }); // '2+2+3/8'
   * ```
   */
  format(opts: { grouping?: boolean } = {}): string {
    return formatTimeSignature(this.#ts, opts);
  }

  /**
   * Metric weight of a position within its bar, on a 0–3 scale: 3 the
   * downbeat, 2 a secondary strong pulse, 1 any other main pulse, and 0 an
   * off-pulse subdivision.
   *
   * @param beatInQuarters Position in quarter-note beats; a position past the
   *   end of a bar is read in the bar it falls in.
   * @returns The metric weight (0–3).
   * @throws If the position is not finite.
   */
  weightAt(beatInQuarters: number): number {
    return metricWeight(beatInQuarters, this.#ts);
  }

  /**
   * Whether a position is metrically accented — a downbeat or a secondary
   * strong pulse.
   *
   * @param beatInQuarters Position in quarter-note beats.
   * @returns True on strong beats.
   * @throws If the position is not finite.
   */
  isStrongBeat(beatInQuarters: number): boolean {
    return isStrongBeat(beatInQuarters, this.#ts);
  }

  /**
   * Convert a position in quarter-note beats to a bar index and in-bar offset.
   *
   * @param beatInQuarters Position in quarter-note beats.
   * @returns The 0-based bar and the quarter-note offset within it.
   * @throws If the position is not finite.
   */
  barPositionAt(beatInQuarters: number): BarPosition {
    return beatToBarPosition(beatInQuarters, this.#ts);
  }

  /**
   * Render a position as the `bar.beat` a DAW or a score shows: 1-based bar,
   * 1-based felt beat.
   *
   * @param beatInQuarters Position in quarter-note beats.
   * @param decimals Digits of the fractional beat to keep.
   * @returns The formatted position, e.g. `'3.2'` for bar 3, felt beat 2.
   * @throws If the position is not finite or `decimals` is not an integer in
   *   0..100.
   * @example
   * ```ts
   * import { Meter } from '@libraz/libcantus';
   * Meter.parse('6/8').formatPosition(7.5); // '3.2'
   * ```
   */
  formatPosition(beatInQuarters: number, decimals = 2): string {
    return formatBarPosition(beatInQuarters, this.#ts, decimals);
  }

  /**
   * Subdivide a span into equal tuplet durations — an eighth-note triplet is
   * `tuplet(1, 3)`.
   *
   * @param totalBeats Total span in quarter-note beats.
   * @param count Number of equal parts.
   * @returns `count` equal durations summing to `totalBeats`.
   * @throws If the span is negative or `count` is not a positive integer.
   */
  tuplet(totalBeats: number, count: number): number[] {
    return tuplet(totalBeats, count);
  }

  /**
   * Whether another meter is the same signature, grouping included.
   *
   * 6/8 and 3/4 fill a bar with the same six eighth notes and are not equal:
   * they group them differently, and every weight this class reports follows
   * the grouping.
   *
   * @param other The meter to compare with.
   * @returns True when numerator, denominator, and grouping all match.
   */
  equals(other: Meter): boolean {
    // The other meter is read through its public surface rather than its
    // private field: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    const b = other.data;
    const grouping = this.#ts.grouping;
    if (grouping === undefined || b.grouping === undefined) {
      return (
        this.#ts.numerator === b.numerator &&
        this.#ts.denominator === b.denominator &&
        grouping === b.grouping
      );
    }
    return (
      this.#ts.numerator === b.numerator &&
      this.#ts.denominator === b.denominator &&
      grouping.length === b.grouping.length &&
      grouping.every((entry, index) => entry === b.grouping?.[index])
    );
  }

  /**
   * The plain time signature, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(meter)` from collapsing to `{}`. The grouping appears only
   * on a meter that carries one, which is the shape the meter module's own
   * parser produces.
   *
   * @returns A copy of the numerator, denominator, and grouping.
   */
  toJSON(): TimeSignature {
    return copyTimeSignature(this.#ts);
  }

  /**
   * The signature, so a template literal or a log line reads as the meter.
   *
   * @returns The plain form, e.g. `'6/8'`; ask {@link Meter.format} for the
   *   additive one.
   */
  toString(): string {
    return this.format();
  }
}
