import { type ParseResult, unwrapParse } from '../core/errors/index.js';
import { isConsonantInterval } from '../core/interval/index.js';
import type { IntervalData, IntervalQualityLabel, SpelledInterval } from '../core/pitch/index.js';
import { intervalSemitones, toSpelledInterval, tryParseInterval } from '../core/pitch/index.js';
import type { Note } from './note.js';

/** Number of diatonic degrees an interval and its inversion span together. */
const INVERSION_SUM = 9;

/** Diatonic size of an octave, the largest simple interval. */
const OCTAVE_DEGREES = 8;

/**
 * The simple interval a diatonic number belongs to.
 *
 * Seven is subtracted while the number is larger than an octave, so the octave
 * and its multiples (8, 15, 22, ...) reduce to the octave rather than to the
 * unison: plain modulo-7 arithmetic folds them onto 1 and would then invert a
 * double octave as if it were a unison.
 */
function simpleDegree(numberValue: number): number {
  const reduced = ((numberValue - 1) % 7) + 1;
  return reduced === 1 && numberValue > 1 ? OCTAVE_DEGREES : reduced;
}

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
 * Interval.between(Note.parse('C4'), Note.parse('G4')).name; // 'P5'
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
    return Interval.fromData({ number: numberValue, quality, semitones });
  }

  /**
   * Wrap a plain spelled interval, as returned by the pitch module.
   *
   * The data is checked the way {@link Interval.of} checks its arguments: a
   * deserialized interval enters through here, and an unchecked one would be a
   * value no measurement produces — a `P5` spanning eight semitones names
   * itself a fifth while sounding a sixth.
   *
   * @param data The plain interval.
   * @returns The wrapped interval.
   * @throws If the number, quality, and span do not describe the same interval.
   */
  static fromData(data: IntervalData): Interval {
    // The direction is read off the canonical data rather than from the span's
    // sign: an interval can climb a letter while losing a semitone — C# up to
    // Dbb is a doubly diminished second — and only the pitch module's reading
    // of number, quality and span together tells that from a descent. The
    // canonical form always carries the flag, whichever way the interval goes.
    const checked = toSpelledInterval(data);
    return new Interval(checked.number, checked.quality, checked.semitones, checked.descending);
  }

  /**
   * Rebuild an interval from its {@link Interval.toJSON} output.
   *
   * @param data The serialized interval.
   * @returns The wrapped interval.
   * @throws If the number, quality, and span do not describe the same interval.
   */
  static fromJSON(data: IntervalData): Interval {
    return Interval.fromData(data);
  }

  /**
   * Parse an interval name such as `'P5'`, `'m3'`, `'AA4'`, or `'-m3'`.
   *
   * @param name The interval name; a leading `'-'` names the interval taken
   *   downward.
   * @returns The interval of that name, descending when the name is prefixed.
   * @throws If the name is not a quality label followed by a diatonic number.
   *   Use {@link Interval.tryParse} where failure is ordinary, such as an
   *   interval field read on every keystroke.
   */
  static parse(name: string): Interval {
    return unwrapParse(Interval.tryParse(name));
  }

  /**
   * Parse an interval name, reporting failure instead of throwing it.
   *
   * The same reading as {@link Interval.parse}, for the callers where a name
   * that does not parse yet is the normal state of the input rather than a
   * fault.
   *
   * @param name The interval name.
   * @returns The interval, or the error explaining why the text is not one.
   * @example
   * ```ts
   * import { Interval } from '@libraz/libcantus';
   * const result = Interval.tryParse('M5');
   * result.ok ? result.value.name : result.error.message; // a major fifth does not exist
   * ```
   */
  static tryParse(name: string): ParseResult<Interval> {
    const parsed = tryParseInterval(name);
    return parsed.ok ? { ok: true, value: Interval.fromData(parsed.value) } : parsed;
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

  /**
   * Whether the interval moves downward. A descending unison spans zero
   * semitones, so this flag is the only record of its direction.
   */
  get isDescending(): boolean {
    return this.#descending;
  }

  /**
   * A readable label composed of quality and number, e.g. `'P5'` or `'M3'`,
   * prefixed with `'-'` when the interval descends.
   *
   * The name is written in the grammar {@link Interval.parse} reads, so an
   * interval that has been logged, written to a column, or interpolated into a
   * template comes back as the same interval — direction included.
   */
  get name(): string {
    return `${this.#descending ? '-' : ''}${this.#quality}${this.#number}`;
  }

  /** A copy of the underlying plain interval data. */
  get data(): SpelledInterval {
    return this.toJSON();
  }

  /**
   * The interval's inversion: the complement that completes the octave.
   *
   * A compound interval is reduced to its simple form first, and the result is
   * always ascending — an inversion answers "what is left of the octave",
   * which has no direction of its own. The reduction keeps the octave and its
   * multiples on the octave, so the answer depends on the relation between the
   * two notes and not on how many octaves apart they happen to sit: a double
   * octave inverts to a unison exactly as a single octave does.
   *
   * @returns The inverted interval, e.g. `M3` becomes `m6`.
   * @throws For an augmented octave, whose complement would be a diminished
   *   unison: the letters do not move in a unison, so the pitch module reads
   *   that relation as the descending `'-A1'` and refuses the name. Every other
   *   interval inverts.
   */
  invert(): Interval {
    const numberValue = INVERSION_SUM - simpleDegree(this.#number);
    const quality = invertQuality(this.#quality);
    return Interval.of(numberValue, quality, intervalSemitones(numberValue, quality));
  }

  /**
   * The same interval taken in the opposite direction.
   *
   * The number and quality are untouched — only the direction changes, so an
   * ascending major third becomes a descending major third rather than its
   * inversion.
   *
   * @returns The interval with its direction flipped.
   * @example
   * ```ts
   * import { Interval } from '@libraz/libcantus';
   * Interval.parse('M3').negate().toString(); // '-M3'
   * ```
   */
  negate(): Interval {
    // The flag is flipped rather than derived from the negated span: a unison
    // spans zero semitones, whose negation is indistinguishable from itself.
    return new Interval(
      this.#number,
      this.#quality,
      this.#semitones === 0 ? 0 : -this.#semitones,
      !this.#descending,
    );
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
    // The other interval is read through its public accessors rather than its
    // private fields: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    return (
      this.#number === other.number &&
      this.#quality === other.quality &&
      this.#semitones === other.semitones &&
      this.#descending === other.isDescending
    );
  }

  /**
   * The plain interval data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(interval)` from collapsing to `{}`. The result is the
   * canonical shape the pitch module produces: `descending` is always there, so
   * a measured interval, a parsed name, and this method all serialize to the
   * same object and none of them leaves the direction to be guessed.
   *
   * @returns The diatonic number, quality, and semitone span, with `descending`
   *   telling which way the interval goes.
   */
  toJSON(): SpelledInterval {
    return {
      number: this.#number,
      quality: this.#quality,
      semitones: this.#semitones,
      descending: this.#descending,
    };
  }

  /**
   * The interval's name, so a template literal or a log line reads as the
   * interval.
   *
   * @returns The name, e.g. `'M3'` or `'-M3'` for the same third taken
   *   downward.
   */
  toString(): string {
    return this.name;
  }
}
