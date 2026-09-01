/**
 * Pitch spelling: letter-name notes, enharmonic-aware conversion, and spelled
 * intervals.
 *
 * The rest of the library works in pitch classes (0..11), which cannot tell a
 * G# from an Ab or an augmented fourth from a diminished fifth. This module adds
 * an explicit spelling layer — a note is a diatonic letter plus a chromatic
 * alteration — so interval quality (P/M/m/A/d) and enharmonic identity are
 * preserved.
 */

import { InvalidInputError, type ParseResult, parseFailure, unwrapParse } from '../errors/index.js';
import {
  assertFiniteNumber,
  assertInteger,
  assertOneOf,
  describeRejected,
} from '../validation/index.js';
import type { KeyName, NoteNameOptions } from './naming.js';
import { readKeyName, readNoteName, writeKeyName, writeNoteName } from './naming.js';

export type { KeyName, NoteNameOptions, NoteNameSystem } from './naming.js';
export { detectNoteNameSystem } from './naming.js';

/** Semitone offset of each natural letter above C: C D E F G A B. */
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Widest alteration a note may carry.
 *
 * Six accidentals already exceeds anything common practice writes, and the
 * bound is what keeps an unvalidated number from reaching `String.repeat`.
 */
const MAX_ALTER = 6;

/**
 * Validate the fields of a spelled note once, at a public entry point.
 *
 * The letter is required in its own range rather than reduced on the way in:
 * a caller who built a note by letter arithmetic (`base.letter + 2`) would
 * otherwise hold a value that prints like a library-made note but compares
 * unequal to it, so the unreduced letter is refused where it is written rather
 * than where it later fails to match.
 */
function assertNote(note: Note, name: string): Note {
  assertInteger(note.letter, `${name}.letter`, 0, 6);
  assertInteger(note.alter, `${name}.alter`, -MAX_ALTER, MAX_ALTER);
  if (note.octave !== undefined) {
    assertInteger(note.octave, `${name}.octave`, -100, 100);
  }
  return note;
}

/**
 * A spelled note: a diatonic letter, a chromatic alteration, and an optional
 * octave.
 *
 * - `letter` is 0..6 for C..B.
 * - `alter` is the number of semitones of alteration: -2 double-flat, -1 flat,
 *   0 natural, +1 sharp, +2 double-sharp.
 * - `octave` follows scientific pitch notation (middle C = C4 = MIDI 60). When
 *   absent, the note denotes a bare pitch class.
 *
 * @category Pitch & Intervals
 */
export type Note = {
  letter: number;
  alter: number;
  octave?: number;
};

/**
 * The quality label of a spelled interval: perfect, major, minor, or one or
 * more augmentations or diminutions.
 *
 * This names how an interval is *spelled*. It is a different notion from
 * {@link ConsonanceClass}, which classifies how an interval *sounds* against
 * another voice.
 *
 * @see {@link ConsonanceClass}
 * @category Pitch & Intervals
 */
export type IntervalQualityLabel = 'P' | 'M' | 'm' | `A${string}` | `d${string}`;

/**
 * A spelled interval: a diatonic number, a quality label, and its semitone span.
 *
 * @category Pitch & Intervals
 */
export type SpelledInterval = {
  /** Diatonic size: 1 = unison, 2 = second, ... 8 = octave, and beyond. */
  number: number;
  /** Quality label: 'P', 'M', 'm', or repeated 'A'/'d' for (multiply) aug/dim. */
  quality: IntervalQualityLabel;
  /** Signed semitone distance from the first note to the second. */
  semitones: number;
  /**
   * True when the diatonic letters move down, and absent otherwise — an
   * ascending interval leaves the key out rather than carrying `false`, so
   * every producer of this type returns the same object for the same interval.
   * The flag is not redundant with the sign of the span: a descending unison
   * spans zero semitones, and a letter can rise while the pitch falls.
   */
  descending?: boolean;
};

/**
 * Reduce a MIDI pitch, a bare pitch class, or any signed offset to a pitch
 * class in [0, 11].
 *
 * This is the library's single definition of pitch-class arithmetic: every
 * layer routes through it so a fractional pitch reduces the same way
 * everywhere. A non-integral input is rounded to the nearest semitone first, so
 * a microtonal 60.6 reads as C# rather than C.
 *
 * @param value A MIDI pitch, pitch class, or signed semitone offset.
 * @returns The pitch class in [0, 11].
 * @example
 * ```ts
 * import { pitchClassOf } from '@libraz/libcantus';
 * pitchClassOf(61); // 1
 * pitchClassOf(-1); // 11
 * pitchClassOf(60.6); // 1
 * ```
 * @category Pitch & Intervals
 */
export function pitchClassOf(value: number): number {
  assertFiniteNumber(value, 'pitch');
  return ((Math.round(value) % 12) + 12) % 12;
}

/** Reduce any integer to a pitch class in [0, 11]. */
const mod12 = pitchClassOf;

/**
 * Reduce a letter number or letter offset to a diatonic letter in [0, 6]
 * (0 = C .. 6 = B).
 *
 * @param value A letter number or signed letter offset.
 * @returns The diatonic letter in [0, 6].
 * @category Pitch & Intervals
 */
export function diatonicLetterOf(value: number): number {
  assertFiniteNumber(value, 'diatonic letter');
  return ((Math.round(value) % 7) + 7) % 7;
}

/**
 * The pitch class of a diatonic letter with no accidental (C = 0, D = 2, ...).
 *
 * @param letter A letter number or signed letter offset; reduced to [0, 6].
 * @returns The natural pitch class of that letter.
 * @category Pitch & Intervals
 */
export function naturalPitchClassOf(letter: number): number {
  return LETTER_SEMITONES[diatonicLetterOf(letter)] ?? 0;
}

/** Reduce any integer to [0, 7). */
const mod7 = diatonicLetterOf;

/**
 * Parse a note name into a {@link Note}, in any supported notation system.
 *
 * English (the default when a name could be read in more than one system)
 * accepts a letter (case-insensitive) followed by any number of same-direction
 * accidentals and an optional octave, e.g. `"C"`, `"C#4"`, `"Bb"`, `"F##3"`,
 * `"Ebb2"`. Both `#` and `x` (double-sharp) are accepted for sharps; `b` for
 * flats. Mixing sharps and flats (e.g. `"C#b"`) is rejected.
 *
 * Without a `system` the name is attributed by {@link detectNoteNameSystem},
 * which reads a name any two systems could claim as English: `"B"` is the B
 * natural, never the German B flat. German is chosen only for a German-only
 * name such as `"H"`, `"fis"` or `"es"`.
 *
 * A scientific octave may follow the name in every system (`"gis4"`,
 * `"嬰ト4"`), which is what makes formatting and parsing exact inverses for an
 * octave-bearing note.
 *
 * @param text The note name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The parsed note.
 * @throws If the text is not a valid note in the given (or detected) system.
 *   Use {@link tryParseNote} where failure is ordinary, such as a note field
 *   read on every keystroke.
 * @example
 * ```ts
 * import { parseNote, noteToMidi, noteToPitchClass } from '@libraz/libcantus';
 * noteToMidi(parseNote('C#4')); // 61
 * noteToPitchClass(parseNote('gis')); // 8 — the German G sharp
 * noteToPitchClass(parseNote('B', { system: 'german' })); // 10 — the German B flat
 * ```
 * @category Pitch & Intervals
 */
export function parseNote(text: string, opts?: NoteNameOptions): Note {
  return unwrapParse(tryParseNote(text, opts));
}

/**
 * Parse a note name, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseNote} — that function is this one with its
 * error thrown — for the callers where a name that does not parse yet is the
 * normal state of the input rather than a fault.
 *
 * @param text The note name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The note, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseNote } from '@libraz/libcantus';
 * const result = tryParseNote('C#4');
 * result.ok ? result.value.letter : result.error.message;
 * ```
 * @category Pitch & Intervals
 */
export function tryParseNote(text: string, opts?: NoteNameOptions): ParseResult<Note> {
  try {
    if (typeof text !== 'string') {
      throw new InvalidInputError(`note must be a string; received ${typeof text}`);
    }
    return { ok: true, value: assertNote(readNoteName(text, opts), `note ${text}`) };
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * Render a {@link Note} as a note name, in any supported notation system.
 *
 * The inverse of {@link parseNote} when both are given the same `system`,
 * including double accidentals and octaves. Without one, {@link parseNote}
 * detects the system and reads a bare `B` as the English B natural, so a German
 * B flat written as `'b'` does not survive a round trip that names no system.
 *
 * @param note The note to format.
 * @param opts `system` writes the name in that notation system instead of
 *   English.
 * @returns The note name, including the octave when present.
 * @example
 * ```ts
 * import { formatNote, parseNote } from '@libraz/libcantus';
 * formatNote(parseNote('C#4')); // 'C#4'
 * formatNote(parseNote('G#'), { system: 'german' }); // 'gis'
 * formatNote(parseNote('G#'), { system: 'japanese' }); // '嬰ト'
 * ```
 * @category Pitch & Intervals
 */
export function formatNote(note: Note, opts?: NoteNameOptions): string {
  assertNote(note, 'note');
  return writeNoteName({ letter: mod7(note.letter), alter: note.alter, octave: note.octave }, opts);
}

/**
 * Parse a key name such as `'C major'`, `'gis moll'` or `'嬰ト短調'`.
 *
 * The name is a tonic followed by a mode word, in any of the supported
 * notation systems; German also accepts its hyphenated form (`'gis-Moll'`).
 * Without a `system` the name is attributed by {@link detectNoteNameSystem},
 * so a mode word is itself enough to pick one: `'B dur'` is B flat major while
 * `'B major'` is B major.
 *
 * German carries the mode twice, in the word and in the case of the tonic
 * (`C dur`, `c moll`). When the two disagree the word wins — `'C moll'` is C
 * minor — because the word is what the writer said and the case only what they
 * typed. A German name with no mode word is decided by its case alone
 * (`'gis'` is G sharp minor, `'Gis'` G sharp major); a bare tonic in any other
 * system names a major key.
 *
 * @param text The key name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The spelled tonic and the mode.
 * @throws If the text is not a key name in the given (or detected) system, if
 *   it mixes two systems, or if the tonic carries an octave. Use
 *   {@link tryParseKeyName} where failure is ordinary, such as a key field read
 *   on every keystroke.
 * @example
 * ```ts
 * import { formatNote, parseKeyName } from '@libraz/libcantus';
 * const key = parseKeyName('gis moll');
 * formatNote(key.tonic); // 'G#'
 * key.mode; // 'minor'
 * ```
 * @category Scales
 */
export function parseKeyName(text: string, opts?: NoteNameOptions): KeyName {
  return unwrapParse(tryParseKeyName(text, opts));
}

/**
 * Parse a key name, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseKeyName} — that function is this one with its
 * error thrown — for the callers where a name that does not parse yet is the
 * normal state of the input rather than a fault.
 *
 * @param text The key name.
 * @param opts `system` reads the name in that notation system instead of
 *   detecting it.
 * @returns The key, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseKeyName } from '@libraz/libcantus';
 * const result = tryParseKeyName('gis moll');
 * result.ok ? result.value.mode : result.error.message; // 'minor'
 * ```
 * @category Scales
 */
export function tryParseKeyName(text: string, opts?: NoteNameOptions): ParseResult<KeyName> {
  try {
    if (typeof text !== 'string') {
      throw new InvalidInputError(`key name must be a string; received ${typeof text}`);
    }
    const key = readKeyName(text, opts);
    assertNote(key.tonic, `key ${text}`);
    return { ok: true, value: key };
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * Render a spelled tonic and a mode as a key name.
 *
 * The inverse of {@link parseKeyName}. German is written the way it is read,
 * with the mode in the case of the tonic as well as in the word.
 *
 * @param key The spelled tonic and mode; any octave on the tonic is dropped,
 *   since a key has no register.
 * @param opts `system` writes the name in that notation system instead of
 *   English.
 * @returns The key name.
 * @throws If the tonic or the mode is not valid.
 * @example
 * ```ts
 * import { formatKeyName, parseNote } from '@libraz/libcantus';
 * formatKeyName({ tonic: parseNote('G#'), mode: 'minor' }); // 'G# minor'
 * formatKeyName({ tonic: parseNote('G#'), mode: 'minor' }, { system: 'german' }); // 'gis moll'
 * ```
 * @category Scales
 */
export function formatKeyName(key: KeyName, opts?: NoteNameOptions): string {
  assertNote(key.tonic, 'key.tonic');
  const mode = assertOneOf(key.mode, ['major', 'minor'], 'key.mode');
  return writeKeyName(
    { tonic: { letter: mod7(key.tonic.letter), alter: key.tonic.alter }, mode },
    opts,
  );
}

/**
 * Pitch class (0..11) of a note, ignoring octave.
 *
 * @param note The note.
 * @returns The pitch class.
 * @example
 * ```ts
 * import { noteToPitchClass, parseNote } from '@libraz/libcantus';
 * noteToPitchClass(parseNote('Db')); // 1
 * ```
 * @category Pitch & Intervals
 */
export function noteToPitchClass(note: Note): number {
  assertNote(note, 'note');
  const natural = LETTER_SEMITONES[mod7(note.letter)] ?? 0;
  return mod12(natural + note.alter);
}

/**
 * MIDI number of a note (middle C = C4 = 60).
 *
 * @param note The note; must carry an octave.
 * @returns The MIDI number.
 * @throws If the note has no octave.
 * @example
 * ```ts
 * import { noteToMidi, parseNote } from '@libraz/libcantus';
 * noteToMidi(parseNote('A4')); // 69
 * ```
 * @category Pitch & Intervals
 */
export function noteToMidi(note: Note): number {
  assertNote(note, 'note');
  if (note.octave === undefined) {
    throw new InvalidInputError('noteToMidi requires an octave');
  }
  const natural = LETTER_SEMITONES[mod7(note.letter)] ?? 0;
  return (note.octave + 1) * 12 + natural + note.alter;
}

/**
 * Letter and alteration of each pitch class, by the side a black key is named
 * from when a bare MIDI number carries no spelling of its own.
 */
const SPELLINGS = {
  sharp: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0],
    [3, 0],
    [3, 1],
    [4, 0],
    [4, 1],
    [5, 0],
    [5, 1],
    [6, 0],
  ],
  flat: [
    [0, 0],
    [1, -1],
    [1, 0],
    [2, -1],
    [2, 0],
    [3, 0],
    [4, -1],
    [4, 0],
    [5, -1],
    [5, 0],
    [6, -1],
    [6, 0],
  ],
} as const satisfies Record<'sharp' | 'flat', readonly (readonly [number, number])[]>;

/** The spellings a caller may ask for, read off the table rather than repeated. */
const SPELLING_NAMES = Object.keys(SPELLINGS) as (keyof typeof SPELLINGS)[];

/**
 * Name a MIDI number as a {@link Note}, choosing sharp or flat spelling.
 *
 * The input is rounded to the nearest integer but is not clamped to the MIDI
 * range 0..127: out-of-range values extrapolate linearly (e.g. `-1` -> `B-2`,
 * `128` -> `G#9`) and remain an exact inverse of {@link noteToMidi}.
 *
 * @param midi The MIDI number.
 * @param spelling Whether to prefer sharps or flats for black keys.
 * @returns The spelled note, with octave.
 * @throws If `spelling` is neither `'sharp'` nor `'flat'`; a name the table does
 *   not carry would otherwise be spelled as one of them without saying which.
 * @example
 * ```ts
 * import { midiToNote, formatNote } from '@libraz/libcantus';
 * formatNote(midiToNote(61)); // 'C#4'
 * formatNote(midiToNote(61, 'flat')); // 'Db4'
 * ```
 * @category Pitch & Intervals
 */
export function midiToNote(midi: number, spelling: 'sharp' | 'flat' = 'sharp'): Note {
  assertFiniteNumber(midi, 'midi');
  const side = assertOneOf(spelling, SPELLING_NAMES, 'midi spelling');
  const rounded = Math.round(midi);
  const pc = mod12(rounded);
  const octave = Math.floor(rounded / 12) - 1;
  const entry = SPELLINGS[side][pc] ?? [0, 0];
  return { letter: entry[0], alter: entry[1], octave };
}

/**
 * Diatonic letter distance of the conventional ascending interval for each
 * semitone step within an octave: P1, m2, M2, m3, M3, P4, A4, P5, m6, M6, m7, M7.
 */
const LETTER_STEPS_BY_SEMITONE = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6] as const;

/**
 * Transpose a note by a signed number of semitones, keeping its spelling.
 *
 * The letter moves by the diatonic distance of the conventional interval for
 * that many semitones and the accidental is recomputed for the new letter, so
 * enharmonic identity survives: `Ab4` up a major second is `Bb4`, not `A#4`, and
 * the operation is an exact inverse of itself. An octave-less note stays
 * octave-less.
 *
 * A bare semitone count cannot distinguish an augmented fourth from a diminished
 * fifth; pass `spelling` to override the letter distance when the enharmonic
 * choice matters.
 *
 * @param note The note to transpose.
 * @param semitones The signed semitone offset.
 * @param opts `spelling` forces the result onto the sharp or flat side instead
 *   of following the source note's letter.
 * @returns The transposed note.
 * @example
 * ```ts
 * import { transposeNote, formatNote, parseNote } from '@libraz/libcantus';
 * formatNote(transposeNote(parseNote('Ab4'), 2)); // 'Bb4'
 * formatNote(transposeNote(parseNote('Ab4'), 2, { spelling: 'sharp' })); // 'A#4'
 * ```
 * @category Pitch & Intervals
 */
export function transposeNote(
  note: Note,
  semitones: number,
  opts?: { spelling?: 'sharp' | 'flat' },
): Note {
  if (!Number.isFinite(semitones)) {
    throw new InvalidInputError(`semitones must be a finite number; received ${semitones}`);
  }
  const steps = Math.round(semitones);
  if (opts?.spelling !== undefined) {
    return note.octave === undefined
      ? bareOf(midiToNote(60 + mod12(noteToPitchClass(note) + steps), opts.spelling))
      : midiToNote(noteToMidi(note) + steps, opts.spelling);
  }
  const direction = steps < 0 ? -1 : 1;
  const magnitude = Math.abs(steps);
  const octaves = Math.floor(magnitude / 12);
  const withinOctave = magnitude % 12;
  // Descending motion reverses the conventional ascending letter distance.
  // Deriving it from floor(negative / 12) treated -6 as a descending fourth,
  // so transpose(+n) followed by transpose(-n) changed the letter spelling.
  const letterSteps = direction * ((LETTER_STEPS_BY_SEMITONE[withinOctave] ?? 0) + 7 * octaves);
  const absoluteLetter = mod7(note.letter) + letterSteps;
  const letter = mod7(absoluteLetter);
  const natural = LETTER_SEMITONES[letter] ?? 0;
  if (note.octave === undefined) {
    return { letter, alter: alterFor(natural, mod12(noteToPitchClass(note) + steps)) };
  }
  const octave = note.octave + Math.floor(absoluteLetter / 7);
  return { letter, alter: noteToMidi(note) + steps - ((octave + 1) * 12 + natural), octave };
}

/** Drop the octave from a spelled note. */
function bareOf(note: Note): Note {
  return { letter: note.letter, alter: note.alter };
}

/** Shortest signed alteration taking a letter's natural pitch class to `pc`. */
function alterFor(natural: number, pc: number): number {
  const d = mod12(pc - natural);
  return d > 6 ? d - 12 : d;
}

/** Reference semitone span of a perfect/major simple interval by diatonic number. */
const SIMPLE_REFERENCE = [0, 0, 2, 4, 5, 7, 9, 11] as const;

/** Whether a simple diatonic number (1..7 within an octave) is a perfect kind. */
function isPerfectNumber(simpleNumber: number): boolean {
  return simpleNumber === 1 || simpleNumber === 4 || simpleNumber === 5;
}

/** Quality label from a diatonic number and its actual semitone span. */
function qualityFromSpan(numberValue: number, semitones: number): IntervalQualityLabel {
  const octaves = Math.floor((numberValue - 1) / 7);
  const simple = numberValue - 7 * octaves;
  const reference = (SIMPLE_REFERENCE[simple] ?? 0) + 12 * octaves;
  const delta = semitones - reference;
  const repeat = (glyph: 'A' | 'd', count: number): IntervalQualityLabel =>
    `${glyph}${glyph.repeat(Math.min(count, MAX_ALTER * 2) - 1)}`;
  if (isPerfectNumber(simple)) {
    if (delta === 0) {
      return 'P';
    }
    return delta > 0 ? repeat('A', delta) : repeat('d', -delta);
  }
  if (delta === 0) {
    return 'M';
  }
  if (delta === -1) {
    return 'm';
  }
  return delta > 0 ? repeat('A', delta) : repeat('d', -delta - 1);
}

/**
 * Widest diatonic interval number the library measures.
 *
 * It is the widest {@link spelledInterval} can produce over the MIDI range:
 * C-1 to G9 climbs 74 letters, which is a 75th. Rejecting anything narrower
 * would make a value one public function returns impossible to hand to another.
 */
const MAX_INTERVAL_NUMBER = 75;

/**
 * The semitone span of the interval named by a diatonic number and a quality.
 *
 * The inverse of the quality derivation in {@link spelledInterval}: it turns a
 * name back into a distance, which is what transposing by a named interval or
 * parsing one from text needs.
 *
 * @param numberValue Diatonic size: 1 = unison, 2 = second, ... 8 = octave.
 * @param quality Quality label: `'P'`, `'M'`, `'m'`, or repeated `'A'`/`'d'`.
 * @returns The unsigned semitone span.
 * @throws If the quality cannot apply to the number, such as a major fifth or a
 *   diminished unison.
 * @example
 * ```ts
 * import { intervalSemitones } from '@libraz/libcantus';
 * intervalSemitones(5, 'P'); // 7
 * ```
 * @category Pitch & Intervals
 */
export function intervalSemitones(numberValue: number, quality: IntervalQualityLabel): number {
  assertInteger(numberValue, 'interval number', 1, MAX_INTERVAL_NUMBER);
  const octaves = Math.floor((numberValue - 1) / 7);
  const simple = numberValue - 7 * octaves;
  const reference = (SIMPLE_REFERENCE[simple] ?? 0) + 12 * octaves;
  const perfect = isPerfectNumber(simple);
  if (quality === 'P' || quality === 'M') {
    if (perfect !== (quality === 'P')) {
      throw new InvalidInputError(
        `an interval of ${numberValue} cannot be ${quality === 'P' ? 'perfect' : 'major'}`,
      );
    }
    return reference;
  }
  if (quality === 'm') {
    if (perfect) {
      throw new InvalidInputError(
        `a perfect-class interval cannot be minor; received ${numberValue}`,
      );
    }
    return reference - 1;
  }
  if (/^A+$/.test(quality)) {
    return reference + quality.length;
  }
  if (/^d+$/.test(quality)) {
    if (numberValue === 1) {
      // The letters do not move in a unison, so narrowing one takes it past
      // zero and back up the other side: `spelledInterval` reads C down to Cb
      // as a descending augmented unison, and no measurement in the library
      // produces a diminished one. Accepting the name would return a span
      // indistinguishable from the augmented unison's.
      throw new InvalidInputError(
        `a unison cannot be diminished; a unison narrowed by a semitone descends, so name it '-${'A'.repeat(quality.length)}1'`,
      );
    }
    return Math.abs(reference - quality.length - (perfect ? 0 : 1));
  }
  throw new InvalidInputError(`unknown interval quality ${describeRejected(quality)}`);
}

/** Interval name grammar: an optional descent marker, a quality, a number. */
const INTERVAL_NAME_PATTERN = /^(-?)(P|M|m|A+|d+)(\d+)$/;

/**
 * Parse an interval name such as `'P5'`, `'m3'`, `'AA4'`, or `'-m3'`.
 *
 * A leading `'-'` names the same interval taken downward: the span is negated
 * and `descending` is set. The flag is not redundant with the sign — a
 * descending unison spans zero semitones, so only the flag records that the
 * letters move down.
 *
 * @param name The interval name: an optional `'-'`, a quality label, and a
 *   diatonic number. Surrounding whitespace is ignored.
 * @returns The spelled interval. An ascending name carries a non-negative span
 *   and no `descending` flag.
 * @throws If the name is not a quality label followed by a number, or the two
 *   cannot describe the same interval. Use {@link tryParseInterval} where
 *   failure is ordinary, such as an interval field read on every keystroke.
 * @example
 * ```ts
 * import { parseInterval } from '@libraz/libcantus';
 * parseInterval('m3'); // { number: 3, quality: 'm', semitones: 3 }
 * parseInterval('-m3'); // { number: 3, quality: 'm', semitones: -3, descending: true }
 * ```
 * @category Pitch & Intervals
 */
export function parseInterval(name: string): SpelledInterval {
  return unwrapParse(tryParseInterval(name));
}

/**
 * Parse an interval name, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseInterval} — that function is this one with
 * its error thrown — for the callers where a name that does not parse yet is
 * the normal state of the input rather than a fault.
 *
 * @param name The interval name.
 * @returns The interval, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseInterval } from '@libraz/libcantus';
 * const result = tryParseInterval('M5');
 * result.ok ? result.value.semitones : result.error.message; // a fifth cannot be major
 * ```
 * @category Pitch & Intervals
 */
export function tryParseInterval(name: string): ParseResult<SpelledInterval> {
  try {
    const match = typeof name === 'string' ? name.trim().match(INTERVAL_NAME_PATTERN) : null;
    const quality = match?.[2] as IntervalQualityLabel | undefined;
    const numberValue = Number(match?.[3]);
    if (quality === undefined || !Number.isFinite(numberValue)) {
      throw new InvalidInputError(
        `interval must be a quality followed by a number, such as 'P5'; received ${describeRejected(name)}`,
      );
    }
    const span = intervalSemitones(numberValue, quality);
    if (match?.[1] !== '-') {
      return { ok: true, value: { number: numberValue, quality, semitones: span } };
    }
    // Negating a zero span yields -0, which compares unequal to 0 under
    // Object.is and would leak into every equality check downstream.
    return {
      ok: true,
      value: { number: numberValue, quality, semitones: span === 0 ? 0 : -span, descending: true },
    };
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * Anything that names a spelled interval: an interval name, plain interval
 * data, or a value that serializes to interval data such as the `Interval`
 * class.
 *
 * @category Pitch & Intervals
 */
export type IntervalLike =
  | string
  | SpelledInterval
  | {
      /** The interval data this value stands for. */
      toJSON(): SpelledInterval;
    };

/**
 * Whether an interval's letters move down.
 *
 * Data that carries the flag decides it there. Without one the span's sign
 * answers it, except where the quality says otherwise: an interval can climb a
 * letter while losing a semitone — C# up to Dbb is a doubly diminished second —
 * and reading such a span as a descent would spell the result on the wrong
 * letter. The exception is taken only when the ascending reading names the very
 * quality the interval carries, so plain data such as `{ P5, -7 }` still reads
 * as the descending fifth it is.
 */
function isDescendingInterval(interval: SpelledInterval): boolean {
  if (interval.descending !== undefined) {
    return interval.descending;
  }
  const span = Math.round(interval.semitones);
  if (span < 0 && qualityFromSpan(interval.number, span) === interval.quality) {
    return false;
  }
  return span < 0;
}

/** Validate plain interval data and return it in the canonical shape. */
function normalizedInterval(data: SpelledInterval): SpelledInterval {
  assertInteger(data.number, 'interval.number', 1);
  assertFiniteNumber(data.semitones, 'interval.semitones');
  const expected = intervalSemitones(data.number, data.quality);
  if (Math.abs(data.semitones) !== expected) {
    throw new InvalidInputError(
      `${data.quality}${data.number} spans ${expected} semitones; received ${data.semitones}`,
    );
  }
  const normalized: SpelledInterval = {
    number: data.number,
    quality: data.quality,
    semitones: data.semitones,
  };
  // An ascending interval leaves the flag out entirely, so a parsed name, this
  // function, and `spelledInterval` all produce the same object.
  if (isDescendingInterval(data)) {
    normalized.descending = true;
  }
  return normalized;
}

/**
 * Resolve any interval-shaped value to plain {@link SpelledInterval} data.
 *
 * This is what lets an entry point accept an interval name, the plain data the
 * pitch module returns, or an `Interval` instance without every caller
 * branching on the form. An instance is accepted through its `toJSON` method
 * rather than by its type, because the core layer cannot import the model layer
 * that defines the class.
 *
 * @param value An interval name, plain interval data, or a value whose `toJSON`
 *   returns interval data.
 * @returns The validated interval data, carrying `descending` only when the
 *   interval descends.
 * @throws If the value is not interval-shaped, or its number, quality, and span
 *   do not describe the same interval.
 * @example
 * ```ts
 * import { toSpelledInterval } from '@libraz/libcantus';
 * toSpelledInterval('P5'); // { number: 5, quality: 'P', semitones: 7 }
 * toSpelledInterval({ number: 5, quality: 'P', semitones: -7 });
 * // { number: 5, quality: 'P', semitones: -7, descending: true }
 * ```
 * @category Pitch & Intervals
 */
export function toSpelledInterval(value: IntervalLike): SpelledInterval {
  if (typeof value === 'string') {
    return parseInterval(value);
  }
  if (typeof value === 'object' && value !== null) {
    const data = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : value;
    return normalizedInterval(data as SpelledInterval);
  }
  throw new InvalidInputError(
    `interval must be a name or spelled interval data; received ${typeof value}`,
  );
}

/**
 * Anything that names a spelled note: a note name, plain note data, a MIDI
 * number, or a value that serializes to note data such as the `Note` class.
 *
 * @category Pitch & Intervals
 */
export type NoteLike =
  | string
  | number
  | Note
  | {
      /** The note data this value stands for. */
      toJSON(): Note;
    };

/**
 * Resolve any note-shaped value to plain {@link Note} data.
 *
 * The counterpart of {@link toSpelledInterval} for notes: an entry point takes
 * whatever form the caller has — the name a text field holds, the MIDI number a
 * device sends, the data the pitch module returns, or a `Note` instance — and
 * gets one shape back. An instance is accepted through its `toJSON` method
 * rather than by its type, because the core layer cannot import the model layer
 * that defines the class.
 *
 * A number is read as MIDI and spelled with sharps, the same reading
 * {@link midiToNote} takes by default. Where a key is known the caller spells
 * it there instead — `spellPitch` reads the key — because no single default
 * suits both a G# in E major and an Ab in Eb major.
 *
 * @param value A note name, a MIDI number, plain note data, or a value whose
 *   `toJSON` returns note data.
 * @returns The validated note data, carrying `octave` only when the value has
 *   one.
 * @throws If the value is not note-shaped, or its letter, alteration, or octave
 *   fall outside the range a spelled note holds.
 * @example
 * ```ts
 * import { toNoteData } from '@libraz/libcantus';
 * toNoteData('Eb4'); // { letter: 2, alter: -1, octave: 4 }
 * toNoteData(60); // { letter: 0, alter: 0, octave: 4 }
 * ```
 * @category Pitch & Intervals
 */
export function toNoteData(value: NoteLike): Note {
  if (typeof value === 'string') {
    return parseNote(value);
  }
  if (typeof value === 'number') {
    return midiToNote(value);
  }
  if (typeof value === 'object' && value !== null) {
    const data = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : value;
    const note = assertNote(data as Note, 'note');
    // A fresh object, so a caller's own note cannot become library state and
    // the result carries `octave` only when the note has one.
    return note.octave === undefined
      ? { letter: note.letter, alter: note.alter }
      : { letter: note.letter, alter: note.alter, octave: note.octave };
  }
  throw new InvalidInputError(
    `note must be a name, a MIDI number, or spelled note data; received ${typeof value}`,
  );
}

/**
 * Transpose a note by a spelled interval, keeping the spelling the interval
 * names.
 *
 * Unlike {@link transposeNote}, which picks a letter from the semitone count,
 * the diatonic number decides the letter here: transposing C by an augmented
 * second gives D#, not Eb.
 *
 * @param note The note to transpose.
 * @param interval The interval to apply; a negative span transposes downward.
 * @returns The transposed note, octave-less if the source was.
 * @example
 * ```ts
 * import { formatNote, parseInterval, parseNote, transposeByInterval } from '@libraz/libcantus';
 * formatNote(transposeByInterval(parseNote('C4'), parseInterval('A2'))); // 'D#4'
 * ```
 * @category Pitch & Intervals
 */
export function transposeByInterval(note: Note, interval: SpelledInterval): Note {
  assertNote(note, 'note');
  // `spelledInterval` accepts the full supported octave range, so accepting
  // only 64 here made a value produced by that sibling public function
  // impossible to apply back to its source note.
  assertInteger(interval.number, 'interval.number', 1);
  assertFiniteNumber(interval.semitones, 'interval.semitones');
  const letterSteps = (interval.number - 1) * (isDescendingInterval(interval) ? -1 : 1);
  const absoluteLetter = mod7(note.letter) + letterSteps;
  const letter = mod7(absoluteLetter);
  const natural = LETTER_SEMITONES[letter] ?? 0;
  const steps = Math.round(interval.semitones);
  if (note.octave === undefined) {
    return { letter, alter: alterFor(natural, mod12(noteToPitchClass(note) + steps)) };
  }
  const octave = note.octave + Math.floor(absoluteLetter / 7);
  return { letter, alter: noteToMidi(note) + steps - ((octave + 1) * 12 + natural), octave };
}

/** Diatonic ladder index of a note (letter + 7 * octave when octave-bearing). */
function diatonicIndex(note: Note): number {
  return mod7(note.letter) + 7 * (note.octave ?? 0);
}

/**
 * The spelled interval from one note to another.
 *
 * When both notes carry octaves, the interval reflects their full signed
 * distance (so `C4 -> C5` is a perfect octave). When either lacks an octave the
 * interval is measured within a single ascending octave from `a` to `b`.
 *
 * @param a The lower/first note.
 * @param b The upper/second note.
 * @returns The diatonic number, quality, and semitone span.
 * @example
 * ```ts
 * import { spelledInterval, parseNote } from '@libraz/libcantus';
 * spelledInterval(parseNote('C4'), parseNote('G4'));
 * // { number: 5, quality: 'P', semitones: 7 }
 * ```
 * @category Pitch & Intervals
 */
export function spelledInterval(a: Note, b: Note): SpelledInterval {
  assertNote(a, 'a');
  assertNote(b, 'b');
  // Two octave-bearing notes measure their full signed distance; two
  // octave-less ones measure a single ascending octave. One of each has no
  // defined answer, and silently picking either reading gives a number the
  // caller cannot interpret.
  if ((a.octave === undefined) !== (b.octave === undefined)) {
    throw new InvalidInputError(
      'spelledInterval needs both notes to carry an octave or neither to; received one of each',
    );
  }
  const octaved = a.octave !== undefined && b.octave !== undefined;
  let letterSteps: number;
  let semitones: number;
  if (octaved) {
    letterSteps = diatonicIndex(b) - diatonicIndex(a);
    // Signed pitch distance from a to b, so a note below a yields a negative span.
    semitones = noteToMidi(b) - noteToMidi(a);
  } else {
    letterSteps = mod7(b.letter - a.letter);
    let rawSemis = mod12(noteToPitchClass(b) - noteToPitchClass(a));
    // Lift the chromatic span into the octave nearest the diatonic reference so
    // wraparound intervals stay consistent with the diatonic number instead of
    // collapsing modulo 12. The correction is bidirectional: an upward wrap
    // (e.g. Ab -> G# = augmented seventh) adds an octave, while a same-letter or
    // downward chromatic step (e.g. E -> Eb, F# -> F, C -> Cb = descending
    // diminished/augmented unison) subtracts one so the sign follows pitch
    // direction instead of returning a garbage stack of augmentations.
    const reference = SIMPLE_REFERENCE[letterSteps + 1] ?? 0;
    if (reference - rawSemis > 6) {
      rawSemis += 12;
    } else if (rawSemis - reference > 6) {
      rawSemis -= 12;
    }
    semitones = rawSemis;
  }
  const absSteps = Math.abs(letterSteps);
  const number = absSteps + 1;
  // The span is measured in the direction the letters move, not as a magnitude:
  // C# up to Dbb steps up one letter but down one semitone, which is a doubly
  // diminished second, not a minor one. `semitones` keeps its own sign.
  //
  // A unison is the exception: the letters do not move, so there is no
  // direction to measure against and the quality names the chromatic
  // alteration alone — C down to Cb is a descending augmented unison.
  const directedSpan =
    letterSteps === 0 ? Math.abs(semitones) : letterSteps > 0 ? semitones : -semitones;
  const interval: SpelledInterval = {
    number,
    quality: qualityFromSpan(number, directedSpan),
    semitones,
  };
  // An ascending interval leaves the flag out entirely, so a parsed name,
  // `normalizedInterval`, and this function all produce the same object for the
  // same interval.
  if (letterSteps < 0 || (letterSteps === 0 && semitones < 0)) {
    interval.descending = true;
  }
  return interval;
}
