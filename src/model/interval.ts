import { InvalidInputError } from '../core/errors/index.js';
import { isConsonantInterval } from '../core/interval/index.js';
import type { IntervalQualityLabel, SpelledInterval } from '../core/pitch/index.js';
import { intervalSemitones, parseInterval } from '../core/pitch/index.js';
import type { Note } from './note.js';

/** Number of diatonic degrees an interval and its inversion span together. */
const INVERSION_SUM = 9;

/** The quality an interval's inversion carries. */
function invertQuality(quality: IntervalQualityLabel): IntervalQualityLabel {
  if (quality === 'P') {
    return 'P';
  }
  if (quality === 'M') {
    return 'm';
  }
  if (quality === 'm') {
    return 'M';
  }
  return quality.startsWith('A')
    ? (`d${'d'.repeat(quality.length - 1)}` as IntervalQualityLabel)
    : (`A${'A'.repeat(quality.length - 1)}` as IntervalQualityLabel);
}

/**
 * An immutable spelled interval value: a diatonic number, a quality label, and
 * a signed semitone span. A thin convenience wrapper over the pitch module's
 * plain interval result.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Interval, Note } from '@libraz/libcantus';
 * Interval.between(Note.of('C4'), Note.of('G4')).name; // 'P5'
 * ```
 */
export class Interval {
  readonly #number: number;
  readonly #quality: IntervalQualityLabel;
  readonly #semitones: number;
  readonly #descending: boolean;

  private constructor(
    numberValue: number,
    quality: IntervalQualityLabel,
    semitones: number,
    descending = semitones < 0,
  ) {
    this.#number = numberValue;
    this.#quality = quality;
    this.#semitones = semitones;
    this.#descending = descending;
  }

  /**
   * The spelled interval between two notes.
   *
   * @param a The first note.
   * @param b The second note.
   * @returns The interval from `a` to `b`.
   */
  static between(a: Note, b: Note): Interval {
    return a.intervalTo(b);
  }

  /**
   * Build an interval from explicit components.
   *
   * @param numberValue Diatonic size: 1 = unison, 2 = second, ... 8 = octave.
   * @param quality Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`.
   * @param semitones Signed semitone span; its magnitude must be the span the
   *   number and quality describe.
   * @returns The interval.
   * @throws If the three components do not describe the same interval — a
   *   `P5` spanning 8 semitones is not a value any other method can produce.
   */
  static of(numberValue: number, quality: IntervalQualityLabel, semitones: number): Interval {
    const expected = intervalSemitones(numberValue, quality);
    if (Math.abs(semitones) !== expected) {
      throw new InvalidInputError(
        `${quality}${numberValue} spans ${expected} semitones; received ${semitones}`,
      );
    }
    return new Interval(numberValue, quality, semitones);
  }

  /**
   * Wrap a plain spelled interval, as returned by the pitch module.
   *
   * @param data The plain interval.
   * @returns The wrapped interval.
   */
  static fromData(data: SpelledInterval): Interval {
    return new Interval(
      data.number,
      data.quality,
      data.semitones,
      data.descending ?? data.semitones < 0,
    );
  }

  /**
   * Rebuild an interval from its {@link Interval.toJSON} output.
   *
   * @param data The serialized interval.
   * @returns The wrapped interval.
   */
  static fromJSON(data: SpelledInterval): Interval {
    return Interval.fromData(data);
  }

  /**
   * Parse an interval name such as `'P5'`, `'m3'`, or `'AA4'`.
   *
   * @param name The interval name.
   * @returns The ascending interval of that name.
   * @throws If the name is not a quality label followed by a diatonic number.
   */
  static parse(name: string): Interval {
    return Interval.fromData(parseInterval(name));
  }

  /** Diatonic size: 1 = unison, 2 = second, ... 8 = octave, and beyond. */
  get number(): number {
    return this.#number;
  }

  /** Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`. */
  get quality(): IntervalQualityLabel {
    return this.#quality;
  }

  /** Signed semitone span. */
  get semitones(): number {
    return this.#semitones;
  }

  /** A readable label composed of quality and number, e.g. `'P5'` or `'M3'`. */
  get name(): string {
    return `${this.#quality}${this.#number}`;
  }

  /**
   * The interval's inversion: the complement that completes the octave.
   *
   * A compound interval is reduced to its simple form first, and the result is
   * always ascending — an inversion answers "what is left of the octave",
   * which has no direction of its own.
   *
   * @returns The inverted interval, e.g. `M3` becomes `m6`.
   */
  invert(): Interval {
    // An octave inverts to a unison and vice versa. Other compound intervals
    // reduce to their simple class before inversion (M10 -> m6).
    const simple = this.#number === 8 ? 8 : ((this.#number - 1) % 7) + 1;
    const numberValue = INVERSION_SUM - simple;
    const quality = invertQuality(this.#quality);
    return Interval.of(numberValue, quality, intervalSemitones(numberValue, quality));
  }

  /**
   * Whether the interval is consonant.
   *
   * @param twoVoice When true, the perfect fourth counts as a dissonance,
   *   matching two-voice counterpoint.
   * @returns True if the interval is consonant in that context.
   */
  isConsonant(twoVoice = true): boolean {
    return isConsonantInterval(this.#semitones, twoVoice);
  }

  /**
   * Whether another interval is spelled identically.
   *
   * Enharmonic equivalents are not equal: an augmented second and a minor
   * third span the same distance but are different intervals.
   *
   * @param other The interval to compare with.
   * @returns True when number, quality, and span all match.
   */
  equals(other: Interval): boolean {
    return (
      this.#number === other.number &&
      this.#quality === other.quality &&
      this.#semitones === other.semitones &&
      this.#descending === other.#descending
    );
  }

  /**
   * The plain interval data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(interval)` from collapsing to `{}`.
   *
   * @returns The diatonic number, quality, and semitone span.
   */
  toJSON(): SpelledInterval {
    return this.#descending
      ? {
          number: this.#number,
          quality: this.#quality,
          semitones: this.#semitones,
          descending: true,
        }
      : this.#semitones < 0
        ? {
            number: this.#number,
            quality: this.#quality,
            semitones: this.#semitones,
            descending: false,
          }
        : { number: this.#number, quality: this.#quality, semitones: this.#semitones };
  }

  /**
   * The interval's name, so a template literal or a log line reads as the
   * interval.
   *
   * @returns The name, e.g. `'M3'`.
   */
  toString(): string {
    return this.name;
  }
}
