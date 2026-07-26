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

/** Semitone offset of each natural letter above C: C D E F G A B. */
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** Letter glyphs indexed by letter number (0 = C .. 6 = B). */
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

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
 * A spelled interval: a diatonic number, a quality label, and its semitone span.
 *
 * @category Pitch & Intervals
 */
export type SpelledInterval = {
  /** Diatonic size: 1 = unison, 2 = second, ... 8 = octave, and beyond. */
  number: number;
  /** Quality label: 'P', 'M', 'm', or repeated 'A'/'d' for (multiply) aug/dim. */
  quality: string;
  /** Signed semitone distance from the first note to the second. */
  semitones: number;
};

/** Reduce any integer to a pitch class in [0, 11]. */
function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Reduce any integer to [0, 7). */
function mod7(n: number): number {
  return ((n % 7) + 7) % 7;
}

/**
 * Parse scientific pitch notation into a {@link Note}.
 *
 * Accepts a letter (case-insensitive) followed by any number of same-direction
 * accidentals and an optional octave, e.g. `"C"`, `"C#4"`, `"Bb"`, `"F##3"`,
 * `"Ebb2"`. Both `#` and `x` (double-sharp) are accepted for sharps; `b` for
 * flats. Mixing sharps and flats (e.g. `"C#b"`) is rejected.
 *
 * @param text The note text.
 * @returns The parsed note.
 * @throws If the text is not a valid note.
 * @example
 * ```ts
 * import { parseNote, noteToMidi } from '@libraz/libcantus';
 * const n = parseNote('C#4');
 * noteToMidi(n); // 61
 * ```
 * @category Pitch & Intervals
 */
export function parseNote(text: string): Note {
  const match = /^([A-Ga-g])([#x]*|b*)(-?\d+)?$/.exec(text.trim());
  if (!match) {
    throw new Error(`Invalid note: ${text}`);
  }
  const letterGlyph = (match[1] ?? '').toUpperCase();
  const letter = LETTER_NAMES.indexOf(letterGlyph as (typeof LETTER_NAMES)[number]);
  let alter = 0;
  for (const ch of match[2] ?? '') {
    if (ch === '#') {
      alter += 1;
    } else if (ch === 'x') {
      alter += 2;
    } else if (ch === 'b') {
      alter -= 1;
    }
  }
  const note: Note = { letter, alter };
  if (match[3] !== undefined) {
    note.octave = Number.parseInt(match[3], 10);
  }
  return note;
}

/** Render an alteration as accidental glyphs (`##`, `b`, empty for natural). */
function formatAlter(alter: number): string {
  if (alter > 0) {
    return '#'.repeat(alter);
  }
  if (alter < 0) {
    return 'b'.repeat(-alter);
  }
  return '';
}

/**
 * Render a {@link Note} as scientific pitch notation.
 *
 * @param note The note to format.
 * @returns The note text, including the octave when present.
 * @example
 * ```ts
 * import { formatNote, parseNote } from '@libraz/libcantus';
 * formatNote(parseNote('C#4')); // 'C#4'
 * ```
 * @category Pitch & Intervals
 */
export function formatNote(note: Note): string {
  const glyph = LETTER_NAMES[mod7(note.letter)] ?? 'C';
  const octave = note.octave === undefined ? '' : String(note.octave);
  return `${glyph}${formatAlter(note.alter)}${octave}`;
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
  if (note.octave === undefined) {
    throw new Error('noteToMidi requires an octave');
  }
  const natural = LETTER_SEMITONES[mod7(note.letter)] ?? 0;
  return (note.octave + 1) * 12 + natural + note.alter;
}

/** Preferred spelling when naming a black key from a bare MIDI number. */
const SHARP_SPELLING: readonly [number, number][] = [
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
];

const FLAT_SPELLING: readonly [number, number][] = [
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
];

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
 * @example
 * ```ts
 * import { midiToNote, formatNote } from '@libraz/libcantus';
 * formatNote(midiToNote(61)); // 'C#4'
 * formatNote(midiToNote(61, 'flat')); // 'Db4'
 * ```
 * @category Pitch & Intervals
 */
export function midiToNote(midi: number, spelling: 'sharp' | 'flat' = 'sharp'): Note {
  const rounded = Math.round(midi);
  const pc = mod12(rounded);
  const octave = Math.floor(rounded / 12) - 1;
  const table = spelling === 'sharp' ? SHARP_SPELLING : FLAT_SPELLING;
  const entry = table[pc] ?? [0, 0];
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
    throw new RangeError(`semitones must be a finite number; received ${semitones}`);
  }
  const steps = Math.round(semitones);
  if (opts?.spelling !== undefined) {
    return note.octave === undefined
      ? bareOf(midiToNote(60 + mod12(noteToPitchClass(note) + steps), opts.spelling))
      : midiToNote(noteToMidi(note) + steps, opts.spelling);
  }
  const octaves = Math.floor(steps / 12);
  const letterSteps = (LETTER_STEPS_BY_SEMITONE[steps - 12 * octaves] ?? 0) + 7 * octaves;
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
function qualityFromSpan(numberValue: number, semitones: number): string {
  const octaves = Math.floor((numberValue - 1) / 7);
  const simple = numberValue - 7 * octaves;
  const reference = (SIMPLE_REFERENCE[simple] ?? 0) + 12 * octaves;
  const delta = semitones - reference;
  if (isPerfectNumber(simple)) {
    if (delta === 0) {
      return 'P';
    }
    return delta > 0 ? 'A'.repeat(delta) : 'd'.repeat(-delta);
  }
  if (delta === 0) {
    return 'M';
  }
  if (delta === -1) {
    return 'm';
  }
  return delta > 0 ? 'A'.repeat(delta) : 'd'.repeat(-delta - 1);
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
  // Quality comes from the absolute chromatic span; semitones keeps its sign.
  const quality = qualityFromSpan(number, Math.abs(semitones));
  return { number, quality, semitones };
}
