import { InvalidInputError } from '../core/errors/index.js';
import {
  formatNote,
  midiToNote,
  type Note as NoteData,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  spelledInterval,
  transposeByInterval,
  transposeNote,
} from '../core/pitch/index.js';
import { Interval } from './interval.js';

/**
 * Defensive copy of a plain note, with the letter checked.
 *
 * Formatting and pitch-class arithmetic reduce the letter modulo 7, but
 * `equals` compares it directly: an unreduced letter produces two notes that
 * print the same name and report the same pitch class yet compare unequal.
 */
function copyNote(data: NoteData): NoteData {
  if (!Number.isInteger(data.letter) || data.letter < 0 || data.letter > 6) {
    throw new InvalidInputError(
      `note letter must be an integer in [0, 6]; received ${data.letter}`,
    );
  }
  const copy: NoteData = { letter: data.letter, alter: data.alter };
  if (data.octave !== undefined) {
    copy.octave = data.octave;
  }
  // Delegate alteration and octave bounds to the same guard used by the core
  // pitch functions. The class must not accept data its own methods reject.
  noteToPitchClass(copy);
  return copy;
}

/**
 * An immutable spelled note: a diatonic letter plus a chromatic alteration and
 * an optional octave. Wraps the plain note object and delegates to the pitch
 * module; every transformation returns a new instance.
 *
 * @category Class API
 * @example
 * ```ts
 * import { Note } from '@libraz/libcantus';
 * Note.of('C4').transpose(7).name; // 'G4'
 * ```
 */
export class Note {
  readonly #data: NoteData;

  /**
   * Wrap a plain note object.
   *
   * @param data The spelled note; it is copied, never retained or mutated.
   * @throws If `letter` is not an integer in 0..6.
   */
  constructor(data: NoteData) {
    this.#data = copyNote(data);
  }

  /**
   * Parse scientific pitch notation (e.g. `'C#4'`, `'Bb'`, `'F##3'`).
   *
   * @param name The note text.
   * @returns The parsed note.
   * @throws If the text is not a valid note.
   */
  static of(name: string): Note {
    return new Note(parseNote(name));
  }

  /**
   * Name a MIDI number (middle C = C4 = 60) as a note.
   *
   * @param midi The MIDI number.
   * @param spelling Whether to prefer sharps or flats for black keys.
   * @returns The spelled note, with octave.
   */
  static fromMidi(midi: number, spelling: 'sharp' | 'flat' = 'sharp'): Note {
    return new Note(midiToNote(midi, spelling));
  }

  /**
   * Wrap an existing plain note object.
   *
   * @param data The plain note.
   * @returns The wrapped note.
   * @throws If `letter` is not an integer in 0..6.
   */
  static fromData(data: NoteData): Note {
    return new Note(data);
  }

  /** The note rendered as scientific pitch notation, e.g. `'G4'` or `'Bb'`. */
  get name(): string {
    return formatNote(this.#data);
  }

  /** The pitch class (0..11), ignoring octave. */
  get pitchClass(): number {
    return noteToPitchClass(this.#data);
  }

  /**
   * The MIDI number (middle C = C4 = 60).
   *
   * @throws If the note has no octave and therefore no fixed pitch.
   */
  get midi(): number {
    if (this.#data.octave === undefined) {
      throw new InvalidInputError(`note ${this.name} has no octave, so it has no MIDI number`);
    }
    return noteToMidi(this.#data);
  }

  /** The diatonic letter number: 0..6 for C..B. */
  get letter(): number {
    return this.#data.letter;
  }

  /** The chromatic alteration in semitones: -1 flat, 0 natural, +1 sharp, ... */
  get alter(): number {
    return this.#data.alter;
  }

  /** The octave (scientific pitch notation), or undefined for a bare pitch class. */
  get octave(): number | undefined {
    return this.#data.octave;
  }

  /** A copy of the underlying plain note object. */
  get data(): NoteData {
    return copyNote(this.#data);
  }

  /**
   * Transpose by a signed number of semitones, keeping the spelling.
   *
   * The letter moves by the diatonic distance of the conventional interval for
   * that many semitones, so `Ab4` up a major second is `Bb4` rather than `A#4`
   * and a flat key stays on the flat side. An octave-less note stays
   * octave-less: only its pitch class is moved. Transposing by zero is the
   * identity: the original spelling is preserved (no enharmonic respelling).
   *
   * @param semitones The signed semitone offset.
   * @param opts `spelling` forces the result onto the sharp or flat side
   *   instead of following this note's letter.
   * @returns The transposed note.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * Note.of('Ab4').transpose(2).name; // 'Bb4'
   * Note.of('Ab4').transpose(2, { spelling: 'sharp' }).name; // 'A#4'
   * ```
   */
  transpose(semitones: number, opts?: { spelling?: 'sharp' | 'flat' }): Note {
    if (semitones === 0 && opts?.spelling === undefined) {
      return new Note(this.#data);
    }
    return new Note(transposeNote(this.#data, semitones, opts));
  }

  /**
   * The spelled interval from this note to another.
   *
   * @param other The second note.
   * @returns The interval, which {@link Interval.toJSON} unwraps to plain data.
   */
  intervalTo(other: Note): Interval {
    // Read the other note through its public accessor rather than its private
    // field: a bundler that emits two copies of this class — as a CommonJS
    // build without shared chunks does for the root and /model entries — would
    // otherwise throw on the brand check.
    return Interval.fromData(spelledInterval(this.#data, other.data));
  }

  /**
   * Transpose by a spelled interval, keeping the spelling the interval names.
   *
   * Unlike {@link Note.transpose}, which picks a letter from the semitone
   * count, the interval's diatonic number decides the letter: C up an
   * augmented second is D#, not Eb.
   *
   * @param interval The interval to apply; a descending interval moves down.
   * @returns The transposed note.
   * @example
   * ```ts
   * import { Interval, Note } from '@libraz/libcantus';
   * Note.of('C4').transposeBy(Interval.parse('A2')).name; // 'D#4'
   * ```
   */
  transposeBy(interval: Interval): Note {
    return new Note(transposeByInterval(this.#data, interval.toJSON()));
  }

  /**
   * Rebuild a note from its {@link Note.toJSON} output.
   *
   * @param data The serialized note.
   * @returns The wrapped note.
   * @throws If `letter` is not an integer in 0..6.
   */
  static fromJSON(data: NoteData): Note {
    return new Note(data);
  }

  /**
   * Whether another note has the same letter, alteration, and octave.
   *
   * @param other The note to compare.
   * @returns True if the spellings are identical.
   */
  equals(other: Note): boolean {
    const b = other.data;
    return (
      this.#data.letter === b.letter &&
      this.#data.alter === b.alter &&
      this.#data.octave === b.octave
    );
  }

  /**
   * The plain note data, for JSON serialization.
   *
   * Private class fields do not serialize, so an explicit `toJSON` keeps
   * `JSON.stringify(note)` from collapsing to `{}`.
   *
   * @returns A copy of the underlying plain note object.
   */
  toJSON(): NoteData {
    return this.data;
  }

  /**
   * The note's name, so a template literal or a log line reads as the note.
   *
   * @returns The spelled name, e.g. `'Bb3'`.
   */
  toString(): string {
    return this.name;
  }
}
