import {
  formatNote,
  midiToNote,
  type Note as NoteData,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  type SpelledInterval,
  spelledInterval,
} from '../core/pitch/index.js';
import { spellPitchClassBare } from './shared.js';

/** Defensive copy of a plain note. */
function copyNote(data: NoteData): NoteData {
  const copy: NoteData = { letter: data.letter, alter: data.alter };
  if (data.octave !== undefined) {
    copy.octave = data.octave;
  }
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
      throw new Error(`note ${this.name} has no octave, so it has no MIDI number`);
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
   * Transpose by a signed number of semitones.
   *
   * When the note carries an octave the transposition happens in MIDI space and
   * the result is spelled with a sharp preference. An octave-less note stays
   * octave-less: only its pitch class is moved. Transposing by zero is the
   * identity: the original spelling is preserved (no enharmonic respelling).
   *
   * @param semitones The signed semitone offset.
   * @returns The transposed note.
   */
  transpose(semitones: number): Note {
    if (semitones === 0) {
      return new Note(this.#data);
    }
    if (this.#data.octave !== undefined) {
      return Note.fromMidi(this.midi + semitones);
    }
    return new Note(spellPitchClassBare(this.pitchClass + semitones, 'sharp'));
  }

  /**
   * The spelled interval from this note to another.
   *
   * @param other The second note.
   * @returns The diatonic number, quality, and semitone span.
   */
  intervalTo(other: Note): SpelledInterval {
    return spelledInterval(this.#data, other.#data);
  }

  /**
   * Whether another note has the same letter, alteration, and octave.
   *
   * @param other The note to compare.
   * @returns True if the spellings are identical.
   */
  equals(other: Note): boolean {
    return (
      this.#data.letter === other.#data.letter &&
      this.#data.alter === other.#data.alter &&
      this.#data.octave === other.#data.octave
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
}
