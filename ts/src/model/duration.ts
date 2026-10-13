import type { DurationData, NoteValue, SpelledDuration, Tuplet } from '../core/duration/index.js';
import { beatsToDuration, beatsToTiedDurations, durationToBeats } from '../core/duration/index.js';

/**
 * A defensive copy of a written duration, with its dot count stated.
 *
 * The reading is the check: `durationToBeats` runs the duration module's own
 * validation — the base values it knows, the dot ceiling, the tuplet bounds —
 * so a duration arriving from a project file is held to exactly the rules a
 * duration built here is, without this layer restating any of them.
 */
function copyDuration(value: NoteValue | DurationData): SpelledDuration {
  durationToBeats(value);
  if (typeof value === 'string') {
    return { base: value, dots: 0 };
  }
  const spelled: SpelledDuration = { base: value.base, dots: value.dots ?? 0 };
  if (value.tuplet !== undefined) {
    spelled.tuplet = { actual: value.tuplet.actual, normal: value.tuplet.normal };
  }
  return spelled;
}

/**
 * An immutable written duration: the note value a score shows — a base value,
 * its augmentation dots, and an optional tuplet ratio — and the beats it
 * lasts. A thin convenience wrapper over the duration module's plain value.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Duration } from '@libraz/libcantus';
 * Duration.ofBeats(1.5).spelled; // { base: 'quarter', dots: 1 }
 * ```
 */
export class Duration {
  readonly #base: NoteValue;
  readonly #dots: number;
  readonly #tuplet: Tuplet | undefined;

  private constructor(value: NoteValue | DurationData) {
    const spelled = copyDuration(value);
    this.#base = spelled.base;
    this.#dots = spelled.dots;
    this.#tuplet = spelled.tuplet;
  }

  /**
   * Build a duration from its parts.
   *
   * @param base The base note value, from the whole note down to the
   *   sixty-fourth.
   * @param dots Augmentation dots; up to four are accepted.
   * @param tuplet Optional tuplet ratio: `{ actual: 3, normal: 2 }` writes
   *   three notes in the time of two.
   * @returns The duration.
   * @throws If the base value is unknown, the dot count is not an integer in
   *   0..4, or a tuplet side is not a positive integer.
   */
  static of(base: NoteValue, dots = 0, tuplet?: Tuplet): Duration {
    return new Duration(tuplet === undefined ? { base, dots } : { base, dots, tuplet });
  }

  /**
   * Spell a length in beats as the note value a score would show.
   *
   * The spelling is the conventional one: 1.5 beats is a dotted quarter rather
   * than a quarter tied to an eighth, and a third of a beat is an eighth
   * triplet rather than a twenty-fourth note.
   *
   * @param beats The length in beats.
   * @param options `beatUnit` sets what one beat is; a quarter note by
   *   default.
   * @returns The duration that spells the length.
   * @throws If the length is not positive, or — as a `NoSolutionError` — if no
   *   single note value spells it, as for 5 beats. Use
   *   {@link Duration.tieChain} for those.
   */
  static ofBeats(beats: number, options: { beatUnit?: NoteValue | DurationData } = {}): Duration {
    return new Duration(beatsToDuration(beats, options));
  }

  /**
   * Spell a length in beats as a chain of tied durations.
   *
   * A length with a single spelling comes back as a one-element chain.
   * Anything else is broken into plain and dotted values, longest first. The
   * chain knows nothing of barlines or beat grouping — an engraver splits
   * further at those — and it uses no tuplets.
   *
   * @param beats The length in beats.
   * @param options `beatUnit` sets what one beat is; a quarter note by
   *   default.
   * @returns The tied durations, longest first, summing to the length.
   * @throws If the length is not positive, if the chain would exceed the
   *   generation budget, or — as a `NoSolutionError` — if no chain of plain and
   *   dotted values sums to it.
   * @example
   * ```ts
   * import { Duration } from '@libraz/libcantus';
   * Duration.tieChain(5).map((value) => value.toString()); // ['whole', 'quarter']
   * ```
   */
  static tieChain(
    beats: number,
    options: { beatUnit?: NoteValue | DurationData } = {},
  ): Duration[] {
    return beatsToTiedDurations(beats, options).map((spelled) => new Duration(spelled));
  }

  /**
   * Wrap a plain duration, or a bare base value as shorthand for an undotted
   * one.
   *
   * @param data The plain duration.
   * @returns The wrapped duration.
   * @throws If the base value is unknown, the dot count is not an integer in
   *   0..4, or a tuplet side is not a positive integer.
   */
  static fromData(data: NoteValue | DurationData): Duration {
    return new Duration(data);
  }

  /**
   * Rebuild a duration from its {@link Duration.toJSON} output.
   *
   * @param data The serialized duration.
   * @returns The wrapped duration.
   * @throws If the base value is unknown, the dot count is not an integer in
   *   0..4, or a tuplet side is not a positive integer.
   */
  static fromJSON(data: NoteValue | DurationData): Duration {
    return new Duration(data);
  }

  /** The base note value, from the whole note down to the sixty-fourth. */
  get base(): NoteValue {
    return this.#base;
  }

  /** Augmentation dots, 0 when the value carries none. */
  get dots(): number {
    return this.#dots;
  }

  /** A copy of the tuplet ratio, or undefined outside a tuplet. */
  get tuplet(): Tuplet | undefined {
    return this.#tuplet === undefined
      ? undefined
      : { actual: this.#tuplet.actual, normal: this.#tuplet.normal };
  }

  /**
   * A copy of the written value, with the dot count always stated: the shape
   * the duration module spells a length as.
   */
  get spelled(): SpelledDuration {
    return this.toJSON();
  }

  /** A copy of the underlying plain duration, the same value as {@link Duration.spelled}. */
  get data(): SpelledDuration {
    return this.toJSON();
  }

  /**
   * The length of the written value in beats.
   *
   * @param options `beatUnit` sets what one beat is; a quarter note by
   *   default, so a dotted quarter reads as 1.5. Pass
   *   `{ base: 'quarter', dots: 1 }` to count in the felt beats of a compound
   *   meter.
   * @returns The length in beats.
   * @throws If the beat unit is not a duration the library reads.
   * @example
   * ```ts
   * import { Duration } from '@libraz/libcantus';
   * Duration.of('quarter', 1).beats(); // 1.5
   * ```
   */
  beats(options: { beatUnit?: NoteValue | DurationData } = {}): number {
    return durationToBeats(this.toJSON(), options);
  }

  /**
   * Whether another duration is written identically.
   *
   * Two values of the same length are not equal unless they are written the
   * same way: a dotted quarter and a quarter in the time of a triplet half
   * both last 1.5 beats and are different notations.
   *
   * @param other The duration to compare with.
   * @returns True when base, dots, and tuplet all match.
   */
  equals(other: Duration): boolean {
    // The other duration is read through its public surface rather than its
    // private fields: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    const b = other.data;
    return (
      this.#base === b.base &&
      this.#dots === b.dots &&
      this.#tuplet?.actual === b.tuplet?.actual &&
      this.#tuplet?.normal === b.tuplet?.normal
    );
  }

  /**
   * The plain duration, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(duration)` from collapsing to `{}`. The tuplet appears
   * only on a value that carries one, which is the shape the duration module
   * produces.
   *
   * @returns A copy of the base value, dot count, and tuplet.
   */
  toJSON(): SpelledDuration {
    return this.#tuplet === undefined
      ? { base: this.#base, dots: this.#dots }
      : {
          base: this.#base,
          dots: this.#dots,
          tuplet: { actual: this.#tuplet.actual, normal: this.#tuplet.normal },
        };
  }

  /**
   * The written value, so a template literal or a log line reads as the
   * duration.
   *
   * @returns The base value, a dot per augmentation dot, and the tuplet ratio
   *   when it has one, e.g. `'quarter.'` or `'eighth 3:2'`.
   */
  toString(): string {
    const dots = '.'.repeat(this.#dots);
    const ratio =
      this.#tuplet === undefined ? '' : ` ${this.#tuplet.actual}:${this.#tuplet.normal}`;
    return `${this.#base}${dots}${ratio}`;
  }
}
