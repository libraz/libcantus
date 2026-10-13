import type { NoteLike } from '../core/pitch/index.js';
import { noteToMidi, toNoteData } from '../core/pitch/index.js';
import type { TuningTable } from '../core/tuning/index.js';
import {
  centsBetweenFreq,
  centsFromNearestStep,
  centsOfSteps,
  centsToRatio,
  edo,
  frequencyOf,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  stepOf,
  stepsOfCents,
  TWELVE_TET,
} from '../core/tuning/index.js';
import { assertFiniteNumber } from '../core/validation/index.js';
import { assertDataObject } from './shared.js';

/**
 * An immutable equal temperament: a reference pitch and a number of equal
 * divisions of the octave, with the conversions of the tuning module bound to
 * it. A thin convenience wrapper over a plain {@link TuningTable}.
 *
 * Every conversion still takes a temperament of its own, defaulting to this
 * one, so nothing the tuning functions offer is out of reach from the class —
 * two temperaments can be read from a single object.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Tuning } from '@libraz/libcantus';
 * Tuning.edo(19).divisions; // 19
 * Tuning.twelveTet().frequencyOf('A4'); // 440
 * ```
 */
export class Tuning {
  readonly #table: TuningTable;

  private constructor(table: TuningTable) {
    this.#table = table;
  }

  /**
   * Wrap a plain tuning table.
   *
   * Every field is read off the table, so a deserialized or hand-written one
   * cannot enter carrying a division count or a reference frequency no
   * frequency follows from. None of the three has a default here, unlike
   * {@link Tuning.edo}: a table that lost its reference frequency on the way
   * through storage is refused rather than quietly retuned to A=440.
   *
   * @param table The plain tuning table.
   * @returns The wrapped tuning.
   * @throws If a field is missing, the divisions are not a positive integer,
   *   the reference frequency is not a finite positive number, or the reference
   *   step is not finite.
   * @example
   * ```ts
   * import { TWELVE_TET, Tuning } from '@libraz/libcantus';
   * Tuning.of(TWELVE_TET).divisions; // 12
   * ```
   */
  static of(table: TuningTable): Tuning {
    // The tuning module's own constructor does the checking and returns a
    // fresh table, so a caller's object cannot become library state.
    const given = assertDataObject<TuningTable>(table, 'tuning table');
    // The fields are checked before edo() is handed them: its reference
    // frequency and step are optional positional arguments, so a missing one
    // would take the library's default instead of naming the field it is.
    assertFiniteNumber(given.divisions, 'tuning table.divisions');
    assertFiniteNumber(given.refFreq, 'tuning table.refFreq');
    assertFiniteNumber(given.refStep, 'tuning table.refStep');
    return new Tuning(edo(given.divisions, given.refFreq, given.refStep));
  }

  /**
   * Build an equal temperament with `divisions` divisions of the octave.
   *
   * @param divisions Divisions of the octave (e.g. 19, 24, 31).
   * @param refFreq Reference frequency in Hz; 440 by default.
   * @param refStep Step index of the reference; 69 by default, the MIDI number
   *   of A4.
   * @returns The tuning.
   * @throws If the divisions are not a positive integer, the reference
   *   frequency is not a finite positive number, or the reference step is not
   *   finite. A negative or fractional reference step is accepted: it is what a
   *   tuner reading or a pitch-bend calibration lands on.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Math.round(Tuning.edo(19).centsOfSteps(1)); // 63
   * ```
   */
  static edo(divisions: number, refFreq?: number, refStep?: number): Tuning {
    return new Tuning(edo(divisions, refFreq, refStep));
  }

  /**
   * Standard twelve-tone equal temperament, A4 (MIDI 69) = 440 Hz.
   *
   * @returns The tuning in which a step index is an ordinary MIDI number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().stepOf(440); // 69
   * ```
   */
  static twelveTet(): Tuning {
    return Tuning.of(TWELVE_TET);
  }

  /**
   * Rebuild a tuning from the plain table {@link Tuning.data} hands out.
   *
   * @param data The plain tuning table.
   * @returns The wrapped tuning.
   * @throws If the table describes no temperament; see {@link Tuning.of}.
   */
  static fromData(data: TuningTable): Tuning {
    return Tuning.of(data);
  }

  /**
   * Rebuild a tuning from its {@link Tuning.toJSON} output.
   *
   * @param data The serialized tuning table.
   * @returns The wrapped tuning.
   * @throws If the table describes no temperament; see {@link Tuning.of}.
   */
  static fromJSON(data: TuningTable): Tuning {
    return Tuning.of(data);
  }

  /**
   * Cents of a frequency ratio, e.g. 3:2 for the just perfect fifth.
   *
   * A ratio is a relation between two frequencies rather than a place in a
   * temperament, so this is the same figure under every tuning.
   *
   * @param numerator Ratio numerator.
   * @param denominator Ratio denominator.
   * @returns The interval in cents.
   * @throws If either side is not a finite positive number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Math.round(Tuning.ratioToCents(3, 2)); // 702
   * ```
   */
  static ratioToCents(numerator: number, denominator: number): number {
    return ratioToCents(numerator, denominator);
  }

  /**
   * The frequency ratio an interval in cents spans, the inverse of
   * {@link Tuning.ratioToCents}. Multiply a frequency by it to move the pitch
   * by that many cents.
   *
   * @param cents The interval in cents.
   * @returns The frequency ratio.
   * @throws If `cents` is not finite, or the ratio it spans falls outside the
   *   range a number holds.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.centsToRatio(0); // 1
   * ```
   */
  static centsToRatio(cents: number): number {
    return centsToRatio(cents);
  }

  /**
   * Interval in cents between two frequencies.
   *
   * @param a Lower/first frequency in Hz.
   * @param b Upper/second frequency in Hz.
   * @returns Cents from `a` to `b`, negative when `b` is lower.
   * @throws If either frequency is not a finite positive number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Math.round(Tuning.centsBetweenFreq(440, 880)); // 1200
   * ```
   */
  static centsBetweenFreq(a: number, b: number): number {
    return centsBetweenFreq(a, b);
  }

  /**
   * Cents by which a five-limit just interval departs from its 12-TET
   * tempering; positive means the just interval is the wider one.
   *
   * @param semitoneClass Semitone class in [0, 12].
   * @returns The deviation in cents.
   * @throws If `semitoneClass` is not an integer in [0, 12].
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Math.round(Tuning.justDeviationCents(7)); // 2
   * ```
   */
  static justDeviationCents(semitoneClass: number): number {
    return justDeviationCents(semitoneClass);
  }

  /** Step index whose frequency is {@link Tuning.refFreq}. */
  get refStep(): number {
    return this.#table.refStep;
  }

  /** Frequency in Hz of {@link Tuning.refStep}. */
  get refFreq(): number {
    return this.#table.refFreq;
  }

  /** Equal divisions of the octave; 12 is the standard temperament. */
  get divisions(): number {
    return this.#table.divisions;
  }

  /** A copy of the underlying plain tuning table. */
  get data(): TuningTable {
    return this.toJSON();
  }

  /**
   * Frequency in Hz of a note.
   *
   * The note's MIDI number is read as a step index, which is how the tuning
   * module numbers steps: under twelve divisions the two coincide, and under
   * any other the step index keeps counting from the same reference.
   *
   * @param note A note name, a MIDI number, plain note data, or a `Note`; it
   *   must carry an octave, since a bare pitch class has no frequency.
   * @param tuning A temperament to read the note under instead of this one.
   * @returns The frequency in Hz.
   * @throws If the value is not a note, has no octave, or the frequency falls
   *   outside the range a number holds.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * import { Tuning } from '@libraz/libcantus';
   * const tuning = Tuning.twelveTet();
   * tuning.frequencyOf('A4'); // 440
   * tuning.frequencyOf(69); // 440
   * tuning.frequencyOf(Note.parse('A4')); // 440
   * ```
   */
  frequencyOf(note: NoteLike, tuning: TuningTable = this.#table): number {
    return frequencyOf(noteToMidi(toNoteData(note)), tuning);
  }

  /**
   * Frequency in Hz of a step index.
   *
   * The step-numbered form of {@link Tuning.frequencyOf}, for the steps of a
   * temperament that no twelve-tone note names.
   *
   * @param step Step index; a MIDI number under twelve divisions.
   * @param tuning A temperament to read the step under instead of this one.
   * @returns The frequency in Hz.
   * @throws If the step is not finite, or the frequency falls outside the range
   *   a number holds.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * const et19 = Tuning.edo(19);
   * et19.frequencyOfStep(69); // 440
   * et19.frequencyOfStep(70) > 440; // true
   * ```
   */
  frequencyOfStep(step: number, tuning: TuningTable = this.#table): number {
    return frequencyOf(step, tuning);
  }

  /**
   * Nearest step index to a frequency, the rounded inverse of
   * {@link Tuning.frequencyOfStep}.
   *
   * @param freq Frequency in Hz.
   * @param tuning A temperament to read the frequency under instead of this one.
   * @returns The nearest step index.
   * @throws If the frequency is not a finite positive number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().nearestStep(442); // 69
   * ```
   */
  nearestStep(freq: number, tuning: TuningTable = this.#table): number {
    return nearestStep(freq, tuning);
  }

  /**
   * Step index of a frequency, unrounded.
   *
   * The exact inverse of {@link Tuning.frequencyOfStep}, keeping how far off
   * the pitch sits — the figure a tuner display or a pitch-bend amount is built
   * on, which {@link Tuning.nearestStep} rounds away.
   *
   * @param freq Frequency in Hz.
   * @param tuning A temperament to read the frequency under instead of this one.
   * @returns The fractional step index.
   * @throws If the frequency is not a finite positive number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().stepOf(442) > 69; // true
   * ```
   */
  stepOf(freq: number, tuning: TuningTable = this.#table): number {
    return stepOf(freq, tuning);
  }

  /**
   * How far a frequency sits from its nearest step, in cents; positive means
   * sharp of the step, negative flat.
   *
   * @param freq Frequency in Hz.
   * @param tuning A temperament to read the frequency under instead of this one.
   * @returns The signed deviation in cents.
   * @throws If the frequency is not a finite positive number.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Math.round(Tuning.twelveTet().centsFromNearestStep(442)); // 8
   * ```
   */
  centsFromNearestStep(freq: number, tuning: TuningTable = this.#table): number {
    return centsFromNearestStep(freq, tuning);
  }

  /**
   * Cents spanned by a number of steps.
   *
   * @param steps Number of steps.
   * @param tuning A temperament to measure the steps in instead of this one.
   * @returns The cents.
   * @throws If the step count is not finite.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().centsOfSteps(1); // 100
   * ```
   */
  centsOfSteps(steps: number, tuning: TuningTable = this.#table): number {
    return centsOfSteps(steps, tuning);
  }

  /**
   * Steps spanned by an interval in cents, unrounded — the inverse of
   * {@link Tuning.centsOfSteps}.
   *
   * @param cents The interval in cents.
   * @param tuning A temperament to measure the interval in instead of this one.
   * @returns The fractional step count.
   * @throws If the cents are not finite.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().stepsOfCents(700); // 7
   * ```
   */
  stepsOfCents(cents: number, tuning: TuningTable = this.#table): number {
    return stepsOfCents(cents, tuning);
  }

  /**
   * Whether another tuning divides the octave the same way from the same
   * reference pitch.
   *
   * @param other The tuning to compare with.
   * @returns True when reference step, reference frequency, and divisions all
   *   match.
   */
  equals(other: Tuning): boolean {
    // The other tuning is read through its public accessors rather than its
    // private field: a bundler that emits two copies of this class — as a
    // CommonJS build without shared chunks does for the root and /model
    // entries — would otherwise throw on the brand check.
    return (
      this.#table.refStep === other.refStep &&
      this.#table.refFreq === other.refFreq &&
      this.#table.divisions === other.divisions
    );
  }

  /**
   * The plain tuning table, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(tuning)` from collapsing to `{}`.
   *
   * @returns A copy of the reference step, reference frequency, and divisions.
   */
  toJSON(): TuningTable {
    return {
      refStep: this.#table.refStep,
      refFreq: this.#table.refFreq,
      divisions: this.#table.divisions,
    };
  }

  /**
   * The temperament as a readable label, so a template literal or a log line
   * reads as the tuning.
   *
   * @returns The divisions and the reference pitch, e.g.
   *   `'12-EDO (step 69 = 440 Hz)'`.
   * @example
   * ```ts
   * import { Tuning } from '@libraz/libcantus';
   * Tuning.twelveTet().toString(); // '12-EDO (step 69 = 440 Hz)'
   * ```
   */
  toString(): string {
    return `${this.#table.divisions}-EDO (step ${this.#table.refStep} = ${this.#table.refFreq} Hz)`;
  }
}
