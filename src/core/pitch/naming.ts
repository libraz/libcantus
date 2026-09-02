/**
 * Note-name notation systems.
 *
 * A pitch has one identity but many written names: the note an English score
 * calls `G#` is `gis` in German, `嬰ト` in Japanese and `sol diesis` in Italian.
 * This module holds each system's table — letters, accidental affixes and mode
 * words — so a name can be read and written in the system a source actually
 * uses, and so a name of unknown origin can be attributed to one.
 *
 * The tables live together because attribution needs them together: `B` is a B
 * natural in English but a B flat in German, and only a table that knows both
 * can say so.
 */

import { InvalidInputError } from '../errors/index.js';
import { assertOneOf, assertOptions, describeRejected } from '../validation/index.js';
import type { Note } from './index.js';

/**
 * A system of written note names.
 *
 * - `english`: C D E F G A B, `#` sharp and `b` flat (`C#`, `Bb`, `F##`).
 * - `german`: C D E F G A H, `-is` sharp and `-es` flat (`cis`, `des`), with B
 *   for B flat and H for B natural.
 * - `japanese`: the katakana 音名 ハ ニ ホ ヘ ト イ ロ, prefixed 嬰 sharp and
 *   変 flat.
 * - `italian`: the solfège syllables do re mi fa sol la si, followed by
 *   `diesis` or `bemolle`.
 * - `fixedDo`: the same syllables read as fixed-do note names; identical to
 *   `italian`, and named separately because callers ask for it by that name.
 *
 * @category Pitch & Intervals
 */
export type NoteNameSystem = 'english' | 'german' | 'japanese' | 'italian' | 'fixedDo';

/** Every system name, for validating a caller-supplied one. */
const NOTE_NAME_SYSTEMS = [
  'english',
  'german',
  'japanese',
  'italian',
  'fixedDo',
] as const satisfies readonly NoteNameSystem[];

/**
 * Which notation system to read or write a name in.
 *
 * @category Pitch & Intervals
 */
export type NoteNameOptions = {
  /**
   * The system. Omitted on parsing, the system is detected from the name
   * itself; omitted on formatting, the name is written in English.
   */
  system?: NoteNameSystem;
};

/**
 * A key named the way a score names it: a spelled tonic and a mode.
 *
 * This is what a key *name* carries. It is deliberately not a key/scale: a name
 * fixes the tonic's spelling and says major or minor, and nothing more.
 *
 * @category Scales
 */
export type KeyName = {
  /** The spelled tonic, without an octave. */
  tonic: Note;
  /** Which of the two modes the name gives. */
  mode: 'major' | 'minor';
};

/**
 * The systems auto-detection chooses between, in precedence order.
 *
 * English comes first because it is the only pair with a genuine clash: `B` is
 * a B natural in English and a B flat in German, so a name that either system
 * could read is read as English unless it carries a German-only cue.
 */
const DETECTION_ORDER = ['english', 'german', 'japanese', 'italian'] as const;

/** A system with a table of its own; `fixedDo` shares the Italian one. */
type NamingTable = (typeof DETECTION_ORDER)[number];

/** The table a system reads from: fixed-do names are the Italian syllables. */
function tableOf(system: NoteNameSystem): NamingTable {
  return system === 'fixedDo' ? 'italian' : system;
}

/** English letter glyphs, indexed by letter number (0 = C .. 6 = B). */
const ENGLISH_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** German letter glyphs; the seventh letter is H, since B is the B flat. */
const GERMAN_LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'h'] as const;

/** Japanese 音名, written in katakana in the イロハ order. */
const JAPANESE_LETTERS = ['ハ', 'ニ', 'ホ', 'ヘ', 'ト', 'イ', 'ロ'] as const;

/** Italian and fixed-do solfège syllables. */
const ITALIAN_LETTERS = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'] as const;

/** Letter numbers whose German flat elides to a bare `s`: E -> es, A -> as. */
const GERMAN_ELIDING_LETTERS = [2, 5];

/** Letter number of A, the letter that also writes its double flat as `asas`. */
const A_LETTER = 5;

/** Letter number of B, the one letter German and English disagree about. */
const B_LETTER = 6;

/** The mode words each system writes, keyed by mode. */
const MODE_WORDS: Record<NamingTable, Record<'major' | 'minor', string>> = {
  english: { major: 'major', minor: 'minor' },
  german: { major: 'dur', minor: 'moll' },
  japanese: { major: '長調', minor: '短調' },
  italian: { major: 'maggiore', minor: 'minore' },
};

/** Japanese accidental marks: 嬰 raises, 変 lowers, 重 doubles the mark it precedes. */
const JAPANESE_SHARP = '嬰';
const JAPANESE_FLAT = '変';
const JAPANESE_DOUBLE = '重';

/** Italian accidental words, and the word that doubles the one after it. */
const ITALIAN_SHARP = 'diesis';
const ITALIAN_FLAT = 'bemolle';
const ITALIAN_DOUBLE = 'doppio';

/**
 * The most accidentals a written name carries.
 *
 * Notation stops at the double accidental, and so does every letter-and-mark
 * name in these tables; past it there is no spelling to read.
 */
export const MAX_NAME_ACCIDENTALS = 2;

/** Longest glyph in a table's letters. */
function longestGlyph(glyphs: readonly string[]): number {
  return Math.max(...glyphs.map((glyph) => glyph.length));
}

/** Longest letter each table writes. */
const MAX_LETTER_LENGTH: Record<NamingTable, number> = {
  english: longestGlyph(ENGLISH_LETTERS),
  german: longestGlyph(GERMAN_LETTERS),
  japanese: longestGlyph(JAPANESE_LETTERS),
  italian: longestGlyph(ITALIAN_LETTERS),
};

/** Longest one accidental takes in each table, its separator included. */
const MAX_ACCIDENTAL_LENGTH: Record<NamingTable, number> = {
  /** `#`, `x` and `b`. */
  english: 1,
  /** The `-is` and `-es` affixes, whose first mark may elide to a bare `s`. */
  german: 2,
  /** 嬰 and 変; 重 stands in for the second mark of a double, not beside it. */
  japanese: 1,
  /** A space and the accidental word; `doppio` covers two marks in one word. */
  italian: 1 + Math.max(ITALIAN_SHARP.length, ITALIAN_FLAT.length),
};

/**
 * The greatest number of characters a bare note name takes in a system.
 *
 * A name is a letter and at most two accidentals, so its length has a ceiling
 * that depends only on the system. A caller looking for a name at the front of
 * a longer text — the root of a chord symbol — offers the prefixes up to this
 * length rather than every prefix the text has.
 *
 * @param system The system the name is written in.
 * @returns The greatest length such a name has.
 */
export function maxNoteNameLength(system: NoteNameSystem): number {
  const table = tableOf(assertSystem(system));
  return MAX_LETTER_LENGTH[table] + MAX_NAME_ACCIDENTALS * MAX_ACCIDENTAL_LENGTH[table];
}

/** Trim and collapse internal whitespace, so `'do  diesis'` reads as one name. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Reject a system this module has no table for. */
function assertSystem(system: NoteNameSystem): NoteNameSystem {
  return assertOneOf(system, NOTE_NAME_SYSTEMS, 'system');
}

/**
 * Scientific pitch notation: a letter, any number of same-direction
 * accidentals, an optional octave. `x` is a double sharp; mixing `#` and `b` is
 * refused by the alternation rather than silently cancelling out.
 */
const ENGLISH_PATTERN = /^([A-Ga-g])([#x]*|b*)(-?\d+)?$/;

/** Read an English name, or null when the text is not one. */
function parseEnglish(text: string): Note | null {
  const match = text.match(ENGLISH_PATTERN);
  if (match === null) {
    return null;
  }
  const glyph = (match[1] ?? '').toUpperCase();
  const letter = ENGLISH_LETTERS.indexOf(glyph as (typeof ENGLISH_LETTERS)[number]);
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

/** Write an English name, without its octave. */
function formatEnglish(note: Note): string {
  const glyph = ENGLISH_LETTERS[note.letter] ?? 'C';
  if (note.alter > 0) {
    return `${glyph}${'#'.repeat(note.alter)}`;
  }
  return note.alter < 0 ? `${glyph}${'b'.repeat(-note.alter)}` : glyph;
}

/**
 * How many flats a German flat suffix carries, or null when it is not one.
 *
 * The first mark elides to a bare `s` after E and A (`es`, `as`) and is a full
 * `es` elsewhere (`ces`, `ges`); every further `es` adds another flat, so
 * `eses` is a double flat. After A the doubled form `asas` is read too, since
 * both it and `ases` are written for the A double flat.
 */
function germanFlats(letter: number, suffix: string): number | null {
  let rest = suffix;
  if (GERMAN_ELIDING_LETTERS.includes(letter) && rest.startsWith('s')) {
    rest = rest.slice(1);
  } else if (rest.startsWith('es')) {
    rest = rest.slice(2);
  } else {
    return null;
  }
  let flats = 1;
  while (rest.length > 0) {
    if (rest.startsWith('es') || (letter === A_LETTER && rest.startsWith('as'))) {
      rest = rest.slice(2);
      flats += 1;
    } else {
      return null;
    }
  }
  return flats;
}

/** Read a German name, or null when the text is not one. */
function parseGerman(text: string): Note | null {
  const lower = text.toLowerCase();
  // B alone is the B flat; every other name on that letter is written on H, so
  // `bis` and `bes` are not German names at all.
  if (lower === 'b') {
    return { letter: B_LETTER, alter: -1 };
  }
  const letter = GERMAN_LETTERS.indexOf(lower.slice(0, 1) as (typeof GERMAN_LETTERS)[number]);
  if (letter < 0) {
    return null;
  }
  const suffix = lower.slice(1);
  if (suffix === '') {
    return { letter, alter: 0 };
  }
  if (/^(?:is)+$/.test(suffix)) {
    return { letter, alter: suffix.length / 2 };
  }
  const flats = germanFlats(letter, suffix);
  return flats === null ? null : { letter, alter: -flats };
}

/** Write a German name, without its octave. */
function formatGerman(note: Note): string {
  const glyph = GERMAN_LETTERS[note.letter] ?? 'c';
  if (note.alter >= 0) {
    return `${glyph}${'is'.repeat(note.alter)}`;
  }
  const flats = -note.alter;
  if (note.letter === B_LETTER) {
    // The B flat is B; anything flatter is written on H, as heses.
    return flats === 1 ? 'b' : `h${'es'.repeat(flats)}`;
  }
  const first = GERMAN_ELIDING_LETTERS.includes(note.letter) ? `${glyph}s` : `${glyph}es`;
  return `${first}${'es'.repeat(flats - 1)}`;
}

/** Read a Japanese name, or null when the text is not one. */
function parseJapanese(text: string): Note | null {
  let rest = text;
  let alter = 0;
  let direction = 0;
  while (rest.length > 0) {
    const doubled = rest.startsWith(JAPANESE_DOUBLE);
    const mark = doubled ? rest.slice(1, 2) : rest.slice(0, 1);
    const step = mark === JAPANESE_SHARP ? 1 : mark === JAPANESE_FLAT ? -1 : 0;
    if (step === 0) {
      break;
    }
    // 嬰 and 変 cancelling each other out is not a spelling anyone writes.
    if (direction !== 0 && direction !== step) {
      return null;
    }
    direction = step;
    alter += doubled ? step * 2 : step;
    rest = rest.slice(doubled ? 2 : 1);
  }
  const letter = JAPANESE_LETTERS.indexOf(rest as (typeof JAPANESE_LETTERS)[number]);
  return letter < 0 ? null : { letter, alter };
}

/** Write a Japanese name, without its octave. */
function formatJapanese(note: Note): string {
  const glyph = JAPANESE_LETTERS[note.letter] ?? 'ハ';
  const marks = Math.abs(note.alter);
  if (marks === 0) {
    return glyph;
  }
  const mark = note.alter > 0 ? JAPANESE_SHARP : JAPANESE_FLAT;
  // 重 is the written form of a double accidental; past that there is no
  // convention to follow, so the mark simply repeats.
  return `${marks === 2 ? `${JAPANESE_DOUBLE}${mark}` : mark.repeat(marks)}${glyph}`;
}

/** Read an Italian (fixed-do) name, or null when the text is not one. */
function parseItalian(text: string): Note | null {
  const words = text.toLowerCase().split(' ');
  const letter = ITALIAN_LETTERS.indexOf(words[0] as (typeof ITALIAN_LETTERS)[number]);
  if (letter < 0) {
    return null;
  }
  let alter = 0;
  let direction = 0;
  let doubled = false;
  for (const word of words.slice(1)) {
    if (word === ITALIAN_DOUBLE) {
      if (doubled) {
        return null;
      }
      doubled = true;
      continue;
    }
    const step = word === ITALIAN_SHARP ? 1 : word === ITALIAN_FLAT ? -1 : 0;
    if (step === 0 || (direction !== 0 && direction !== step)) {
      return null;
    }
    direction = step;
    alter += doubled ? step * 2 : step;
    doubled = false;
  }
  return doubled ? null : { letter, alter };
}

/** Write an Italian (fixed-do) name, without its octave. */
function formatItalian(note: Note): string {
  const glyph = ITALIAN_LETTERS[note.letter] ?? 'do';
  const marks = Math.abs(note.alter);
  if (marks === 0) {
    return glyph;
  }
  const word = note.alter > 0 ? ITALIAN_SHARP : ITALIAN_FLAT;
  const accidental =
    marks === 2 ? `${ITALIAN_DOUBLE} ${word}` : Array.from({ length: marks }, () => word).join(' ');
  return `${glyph} ${accidental}`;
}

/** Whether a character is one of the ten digits an octave is written with. */
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Split a trailing scientific octave off a name written in words or glyphs.
 *
 * The digits are scanned backwards from the end, and the minus sign taken by
 * hand, rather than matched by a pattern with a lazy prefix: the pattern reads
 * the same names but restarts at every position of a name that has no octave,
 * which costs the square of the length on text that is not a name at all.
 */
function splitOctave(text: string): { name: string; octave: number | undefined } {
  let start = text.length;
  while (start > 0 && isDigit(text.charAt(start - 1))) {
    start -= 1;
  }
  if (start === text.length) {
    return { name: text, octave: undefined };
  }
  const signed = start > 0 && text.charAt(start - 1) === '-' ? start - 1 : start;
  return { name: text.slice(0, signed), octave: Number.parseInt(text.slice(signed), 10) };
}

/** Read a name in one system, or null when that system does not accept it. */
function parseIn(text: string, system: NoteNameSystem): Note | null {
  const table = tableOf(system);
  if (table === 'english') {
    return parseEnglish(text);
  }
  const { name, octave } = splitOctave(text);
  const parser =
    table === 'german' ? parseGerman : table === 'japanese' ? parseJapanese : parseItalian;
  const note = parser(name);
  if (note === null) {
    return null;
  }
  return octave === undefined ? note : { ...note, octave };
}

/**
 * Drop the separators a mode word is written against the tonic with.
 *
 * Scanned backwards rather than matched by an unanchored pattern, which would
 * retry from every position of a text made entirely of separators.
 */
function trimSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && /[\s-]/.test(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}

/** A key name split into its tonic text and the mode its mode word gives. */
type ModeSplit = {
  tonic: string;
  mode: 'major' | 'minor' | undefined;
  system: NamingTable | undefined;
};

/**
 * Split a trailing mode word off a key name.
 *
 * Every system's words are tried and the longest match wins, so the mode word
 * also says which system the name is written in. German writes the word against
 * the tonic with a hyphen as often as with a space (`gis-Moll`), so both
 * separators go with it; Japanese writes no separator at all.
 */
function splitModeWord(text: string): ModeSplit {
  const lower = text.toLowerCase();
  let best: { word: string; mode: 'major' | 'minor'; system: NamingTable } | undefined;
  for (const system of DETECTION_ORDER) {
    for (const mode of ['major', 'minor'] as const) {
      const word = MODE_WORDS[system][mode];
      if (lower.endsWith(word) && (best === undefined || word.length > best.word.length)) {
        best = { word, mode, system };
      }
    }
  }
  if (best === undefined) {
    return { tonic: text, mode: undefined, system: undefined };
  }
  return {
    tonic: trimSeparators(text.slice(0, text.length - best.word.length)),
    mode: best.mode,
    system: best.system,
  };
}

/**
 * Which system a name is written in, or null when no system reads it.
 *
 * A name several systems accept goes to the first of `DETECTION_ORDER`, which
 * is what keeps a bare `B` an English B natural rather than a German B flat. A
 * mode word overrides that, because `dur` and `moll` are cues no other system
 * has — so `B dur` is B flat major. When the mode word belongs to a system that
 * cannot read the tonic, the name mixes two systems and there is nothing to
 * prefer, so it is rejected.
 */
function resolveSystem(text: string): NoteNameSystem | null {
  const { tonic, system: wordSystem } = splitModeWord(text);
  // Each system is asked only until one answers: a name attributed to the first
  // of them says nothing about the rest, and the whole list is needed only to
  // name the systems in the message a mixed name is rejected with.
  if (wordSystem === undefined) {
    for (const system of DETECTION_ORDER) {
      if (parseIn(tonic, system) !== null) {
        return system;
      }
    }
    return null;
  }
  if (parseIn(tonic, wordSystem) !== null) {
    return wordSystem;
  }
  const accepted = DETECTION_ORDER.filter((system) => parseIn(tonic, system) !== null);
  if (accepted.length === 0) {
    return null;
  }
  throw new InvalidInputError(
    `${describeRejected(text)} mixes note-name systems: ${describeRejected(tonic)} is ` +
      `${accepted.join(' or ')} but its mode word is ${wordSystem}`,
  );
}

/**
 * The notation system a note name or key name is written in.
 *
 * A name several systems could read is attributed to the first of English,
 * German, Japanese, Italian that reads it — so `B` is the English B natural,
 * and German is chosen only for a name carrying a German-only cue (`H`, an
 * `-is`/`-es` ending, or `dur`/`moll`). Because the fixed-do syllables are the
 * Italian ones, detection reports `'italian'` for them; `'fixedDo'` is only ever
 * a system a caller asks for by name.
 *
 * @param text The note name or key name.
 * @returns The system that reads it.
 * @throws If no system reads the name, or the name mixes two systems — a German
 *   tonic under an English mode word, say.
 * @example
 * ```ts
 * import { detectNoteNameSystem } from '@libraz/libcantus';
 * detectNoteNameSystem('B'); // 'english' — never the German B flat
 * detectNoteNameSystem('gis moll'); // 'german'
 * detectNoteNameSystem('嬰ト短調'); // 'japanese'
 * ```
 * @category Pitch & Intervals
 */
export function detectNoteNameSystem(text: string): NoteNameSystem {
  if (typeof text !== 'string') {
    throw new InvalidInputError(`name must be a string; received ${typeof text}`);
  }
  const system = resolveSystem(normalize(text));
  if (system === null) {
    throw new InvalidInputError(`no note-name system reads ${describeRejected(text)}`);
  }
  return system;
}

/** Read a note name, in the given system or in the one the name is written in. */
export function readNoteName(text: string, opts?: NoteNameOptions): Note {
  const name = normalize(text);
  const system = opts?.system === undefined ? resolveSystem(name) : assertSystem(opts.system);
  const note = system === null ? null : parseIn(name, system);
  if (note === null) {
    throw new InvalidInputError(`Invalid note: ${describeRejected(text)}`);
  }
  return note;
}

/**
 * Write a note name in the given system, English by default.
 *
 * The letter must already be reduced to 0..6; the public entry point does that.
 */
export function writeNoteName(note: Note, opts?: NoteNameOptions): string {
  const asked = assertOptions(opts, 'opts');
  const system = asked.system === undefined ? 'english' : assertSystem(asked.system);
  const table = tableOf(system);
  const name =
    table === 'german'
      ? formatGerman(note)
      : table === 'japanese'
        ? formatJapanese(note)
        : table === 'italian'
          ? formatItalian(note)
          : formatEnglish(note);
  return note.octave === undefined ? name : `${name}${note.octave}`;
}

/**
 * The mode a key name with no mode word carries.
 *
 * German writes the mode in the case of the tonic — `C` is C major and `c` is C
 * minor — which is the only convention here that a bare tonic decides.
 * Everywhere else a tonic alone names a major key.
 */
function impliedMode(system: NoteNameSystem, tonic: string): 'major' | 'minor' {
  return tableOf(system) === 'german' && /^[a-h]/.test(tonic) ? 'minor' : 'major';
}

/** Read a key name, in the given system or in the one the name is written in. */
export function readKeyName(text: string, opts?: NoteNameOptions): KeyName {
  const name = normalize(text);
  const split = splitModeWord(name);
  const system = opts?.system === undefined ? resolveSystem(name) : assertSystem(opts.system);
  if (system !== null && split.system !== undefined && split.system !== tableOf(system)) {
    throw new InvalidInputError(
      `${describeRejected(text)} is not a ${system} key name: its mode word is ${split.system}`,
    );
  }
  const tonic = system === null ? null : parseIn(split.tonic, system);
  if (tonic === null || system === null) {
    throw new InvalidInputError(`Invalid key name: ${describeRejected(text)}`);
  }
  if (tonic.octave !== undefined) {
    throw new InvalidInputError(`a key name carries no octave; received ${describeRejected(text)}`);
  }
  // An explicit mode word outranks the German case convention, so `C moll` is C
  // minor: the word is what the writer said, the case only what they typed.
  return { tonic, mode: split.mode ?? impliedMode(system, split.tonic) };
}

/**
 * Write a key name in the given system, English by default.
 *
 * The tonic's letter must already be reduced to 0..6 and its octave dropped;
 * the public entry point does both.
 */
export function writeKeyName(key: KeyName, opts?: NoteNameOptions): string {
  const asked = assertOptions(opts, 'opts');
  const system = asked.system === undefined ? 'english' : assertSystem(asked.system);
  const table = tableOf(system);
  const word = MODE_WORDS[table][key.mode];
  const tonic = writeNoteName(key.tonic, { system });
  if (table === 'japanese') {
    return `${tonic}${word}`;
  }
  if (table === 'german') {
    // German carries the mode in the case of the tonic as well as in the word.
    const cased =
      key.mode === 'major' ? `${tonic.slice(0, 1).toUpperCase()}${tonic.slice(1)}` : tonic;
    return `${cased} ${word}`;
  }
  return `${tonic} ${word}`;
}
