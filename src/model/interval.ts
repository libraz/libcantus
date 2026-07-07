import type { SpelledInterval } from '../core/pitch/index.js';
import type { Note } from './note.js';

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
  readonly #quality: string;
  readonly #semitones: number;

  private constructor(numberValue: number, quality: string, semitones: number) {
    this.#number = numberValue;
    this.#quality = quality;
    this.#semitones = semitones;
  }

  /**
   * The spelled interval between two notes.
   *
   * @param a The first note.
   * @param b The second note.
   * @returns The interval from `a` to `b`.
   */
  static between(a: Note, b: Note): Interval {
    const spelled = a.intervalTo(b);
    return new Interval(spelled.number, spelled.quality, spelled.semitones);
  }

  /**
   * Build an interval from explicit components.
   *
   * @param numberValue Diatonic size: 1 = unison, 2 = second, ... 8 = octave.
   * @param quality Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`.
   * @param semitones Signed semitone span.
   * @returns The interval.
   */
  static of(numberValue: number, quality: string, semitones: number): Interval {
    return new Interval(numberValue, quality, semitones);
  }

  /** Diatonic size: 1 = unison, 2 = second, ... 8 = octave, and beyond. */
  get number(): number {
    return this.#number;
  }

  /** Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`. */
  get quality(): string {
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
   * The plain interval data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(interval)` from collapsing to `{}`.
   *
   * @returns The diatonic number, quality, and semitone span.
   */
  toJSON(): SpelledInterval {
    return { number: this.#number, quality: this.#quality, semitones: this.#semitones };
  }
}
