import { InvalidInputError, type ParseResult, unwrapParse } from '../core/errors/index.js';
import {
  formatNote,
  type IntervalLike,
  midiToNote,
  type Note as NoteData,
  type NoteNameOptions,
  noteToMidi,
  noteToPitchClass,
  spelledInterval,
  toSpelledInterval,
  transposeByInterval,
  transposeNote,
  tryParseNote,
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

/** A bare natural letter name, the only text {@link Note.of} reads. */
const NATURAL_LETTER = /^[A-G]$/;

/**
 * The letter number a `Note.of` letter argument names.
 *
 * A letter name is read through the note parser rather than a table of its
 * own, so the letter ordering has one definition. Anything the parser would
 * have to interpret — an accidental, an octave, a non-English glyph — is
 * refused here instead, because `of` builds from parts and `parse` reads text.
 */
function letterNumberOf(letter: number | string): number {
  if (typeof letter === 'number') {
    // Left to copyNote, which rejects the same out-of-range letters a plain
    // note object arriving from outside is rejected for.
    return letter;
  }
  if (!NATURAL_LETTER.test(letter)) {
    throw new InvalidInputError(
      `Note.of takes a letter number 0..6 or a bare letter name 'C'..'B'; received ${JSON.stringify(letter)}. Use Note.parse(${JSON.stringify(letter)}) to read a note name with an accidental or an octave.`,
    );
  }
  return unwrapParse(tryParseNote(letter)).letter;
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
 * Note.parse('C4').transpose(7).name; // 'G4'
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
   * Build a note from its parts, without reading any text.
   *
   * The parts are the fields a note holds, so nothing here is interpreted:
   * {@link Note.parse} is what reads `'Bb'` or `'C#4'`, and a letter name given
   * here may carry neither an accidental nor an octave.
   *
   * @param letter The diatonic letter, as a number 0..6 (C..B) or a bare
   *   natural letter name `'C'`..`'B'`.
   * @param alter The chromatic alteration in semitones; defaults to natural.
   * @param octave The octave (scientific pitch notation); omit it for a bare
   *   pitch class.
   * @returns The note.
   * @throws If the letter is out of range, if a letter name carries an
   *   accidental or an octave, or if the alteration or octave is out of range.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * Note.of(1, -1, 4).name; // 'Db4'
   * Note.parse('G').name; // 'G'
   * ```
   */
  static of(letter: number | string, alter = 0, octave?: number): Note {
    const data: NoteData = { letter: letterNumberOf(letter), alter };
    if (octave !== undefined) {
      data.octave = octave;
    }
    return new Note(data);
  }

  /**
   * Parse a note name (e.g. `'C#4'`, `'Bb'`, `'F##3'`), in any of the
   * supported note-name systems.
   *
   * The system is detected from the name itself unless one is given, exactly as
   * {@link Key.parse} reads a key name: `'gis'` is a G sharp, while a bare
   * `'B'` is the English B natural until `'german'` says otherwise.
   *
   * @param text The note text.
   * @param opts `system` reads the name in that notation system instead of
   *   detecting it.
   * @returns The parsed note.
   * @throws If the text is not a valid note. Use {@link Note.tryParse} where
   *   failure is ordinary, such as a note field read on every keystroke.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * Note.parse('gis').name; // 'G#'
   * Note.parse('B', { system: 'german' }).name; // 'Bb'
   * ```
   */
  static parse(text: string, opts?: NoteNameOptions): Note {
    return unwrapParse(Note.tryParse(text, opts));
  }

  /**
   * Parse a note name, reporting failure instead of throwing it.
   *
   * The same reading as {@link Note.parse}, for the callers where text that
   * does not name a note yet is the normal state of the input rather than a
   * fault.
   *
   * @param name The note text.
   * @param opts `system` reads the name in that notation system instead of
   *   detecting it.
   * @returns The note, or the error explaining why the text is not one.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * const result = Note.tryParse('C#4');
   * result.ok ? result.value.midi : result.error.message; // 61
   * ```
   */
  static tryParse(name: string, opts?: NoteNameOptions): ParseResult<Note> {
    const parsed = tryParseNote(name, opts);
    return parsed.ok ? { ok: true, value: new Note(parsed.value) } : parsed;
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

  /**
   * The note rendered as scientific pitch notation in English, e.g. `'G4'` or
   * `'Bb'`. Use {@link Note.format} to write it in another notation system.
   */
  get name(): string {
    return formatNote(this.#data);
  }

  /**
   * The note name written in a notation system.
   *
   * The counterpart of {@link Note.parse}: a getter cannot take an argument, so
   * the system is named here instead of on {@link Note.name}.
   *
   * @param opts `system` writes the name in that notation system instead of
   *   English.
   * @returns The note name, including the octave when the note has one.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * Note.parse('G#').format({ system: 'german' }); // 'gis'
   * Note.parse('G#').format({ system: 'japanese' }); // '嬰ト'
   * ```
   */
  format(opts?: NoteNameOptions): string {
    return formatNote(this.#data, opts);
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
   * Note.parse('Ab4').transpose(2).name; // 'Bb4'
   * Note.parse('Ab4').transpose(2, { spelling: 'sharp' }).name; // 'A#4'
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
   * @param interval An interval name (e.g. `'A2'`, `'-m3'`), plain interval
   *   data, or an {@link Interval}; a descending interval moves down.
   * @returns The transposed note.
   * @example
   * ```ts
   * import { Interval, Note } from '@libraz/libcantus';
   * Note.parse('C4').transposeBy('A2').name; // 'D#4'
   * Note.parse('C4').transposeBy(Interval.parse('A2')).name; // 'D#4'
   * Note.parse('C4').transposeBy('A4').name; // 'F#4', not 'Gb4'
   * ```
   */
  transposeBy(interval: IntervalLike): Note {
    return new Note(transposeByInterval(this.#data, toSpelledInterval(interval)));
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
   * @param opts `system` writes the name in that notation system instead of
   *   English, as {@link Key.toString} does for a key.
   * @returns The spelled name, e.g. `'Bb3'`.
   * @example
   * ```ts
   * import { Note } from '@libraz/libcantus';
   * Note.parse('G#4').toString({ system: 'japanese' }); // '嬰ト4'
   * ```
   */
  toString(opts?: NoteNameOptions): string {
    return this.format(opts);
  }
}
