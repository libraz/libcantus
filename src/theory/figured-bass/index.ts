/**
 * Figured bass: read a bass note and its figures as the chord they name.
 *
 * The figures are intervals above the bass, and every interval a figure does
 * not alter is the one the key's own scale gives. That is the whole rule of the
 * notation, and the reason a realization needs the key: the same `6` names a
 * major triad over one degree of C major and a diminished one over another.
 *
 * The bass arrives spelled, so the intervals above it are spelled too. The
 * third above a G in C minor is the Bb the signature gives, and the bare `#`
 * that raises it names B natural rather than an enharmonic Cb — which is what
 * makes the figures of a real exercise readable as written.
 */

import { InvalidInputError, NoSolutionError } from '../../core/errors/index.js';
import type { Note, NoteLike } from '../../core/pitch/index.js';
import {
  diatonicLetterOf as mod7,
  pitchClassOf as mod12,
  noteToPitchClass,
  toNoteData,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../chord/index.js';
import { chordQualities, makeChord } from '../chord/index.js';
import { type KeyLike, scaleTonesInDegreeOrder, spelledKeyOf, toKeyScale } from '../scale/index.js';
import { noteNames, spellChord, spellScale } from '../spelling/index.js';
import { type ChordLike, toChordData } from '../symbol/index.js';

/** Smallest interval a figure may name above the bass: a second. */
const MIN_FIGURE_NUMBER = 2;

/** Largest interval a figure may name above the bass: a ninth. */
const MAX_FIGURE_NUMBER = 9;

/** The octave figure, which names the bass itself and so adds no chord tone. */
const OCTAVE_FIGURE = 8;

/** Number of tones in the largest stack a figure can name: a seventh chord. */
const MAX_STACK_SIZE = 4;

/** How an accidental on a figure alters the interval the key would give. */
type FigureAccidental = 'none' | 'sharp' | 'doubleSharp' | 'flat' | 'doubleFlat' | 'natural';

/** One written figure: an interval above the bass and the accidental on it. */
type Figure = { number: number; accidental: FigureAccidental };

/** A figure that moves to another over the same bass, such as `4-3`. */
type FigureMotion = { from: Figure; to: Figure };

/** The figures a written string names: the static ones and the moving ones. */
type ParsedFigures = { figures: Figure[]; motions: FigureMotion[] };

/** Two-character accidental prefixes, matched before the single-character ones. */
const DOUBLE_ACCIDENTALS: Record<string, FigureAccidental> = {
  '##': 'doubleSharp',
  '♯♯': 'doubleSharp',
  bb: 'doubleFlat',
  '♭♭': 'doubleFlat',
};

/**
 * Single-character accidental prefixes. `+` is the typed form of the slashed or
 * crossed figure, which raises its interval exactly as `#` does.
 */
const SINGLE_ACCIDENTALS: Record<string, FigureAccidental> = {
  '#': 'sharp',
  '♯': 'sharp',
  '+': 'sharp',
  b: 'flat',
  '♭': 'flat',
  n: 'natural',
  '♮': 'natural',
};

/** Characters that merely separate stacked figures, as the slash in `6/4` does. */
const FIGURE_SEPARATORS = new Set([' ', '\t', ',', '/']);

/** Characters that link a figure to the figure it moves to, as in `4-3`. */
const MOTION_MARKS = new Set(['-', '–']);

/** Glyph for each alteration a figure can report against the key, in semitones. */
const ACCIDENTAL_GLYPHS: Record<number, string> = {
  1: '#',
  2: '##',
  '-1': 'b',
  '-2': 'bb',
};

/** An error naming the figure string that was rejected. */
function invalidFigures(figures: string, detail: string): InvalidInputError {
  return new InvalidInputError(`figured bass ${JSON.stringify(figures)} ${detail}`);
}

/** The alteration an accidental produces from the one the key gives. */
function alteredBy(diatonicAlter: number, accidental: FigureAccidental): number {
  switch (accidental) {
    case 'sharp':
      return diatonicAlter + 1;
    case 'doubleSharp':
      return diatonicAlter + 2;
    case 'flat':
      return diatonicAlter - 1;
    case 'doubleFlat':
      return diatonicAlter - 2;
    // A natural sign names the natural note, whatever the key would have given.
    case 'natural':
      return 0;
    default:
      return diatonicAlter;
  }
}

/**
 * Read one figure — an optional accidental and an optional digit — starting at
 * `start`, and report where the figure ends.
 *
 * An accidental with no digit alters the third above the bass, which is what a
 * lone `#` under a bass note means.
 */
function readFigure(text: string, start: number): { figure: Figure; index: number } {
  let index = start;
  let accidental: FigureAccidental = 'none';
  const pair = DOUBLE_ACCIDENTALS[text.slice(index, index + 2)];
  const single = SINGLE_ACCIDENTALS[text[index] ?? ''];
  if (pair !== undefined) {
    accidental = pair;
    index += 2;
  } else if (single !== undefined) {
    accidental = single;
    index += 1;
  }
  const digit = text[index] ?? '';
  if (digit >= '0' && digit <= '9') {
    const number = Number(digit);
    if (number < MIN_FIGURE_NUMBER || number > MAX_FIGURE_NUMBER) {
      throw invalidFigures(
        text,
        `names the interval ${number}, which is outside ${MIN_FIGURE_NUMBER}..${MAX_FIGURE_NUMBER}`,
      );
    }
    return { figure: { number, accidental }, index: index + 1 };
  }
  if (accidental === 'none') {
    // An empty slice means the string ended where a figure was expected, as in
    // a trailing `4-`; naming the position is more use than naming nothing.
    const found = text.slice(start, start + 1);
    throw invalidFigures(
      text,
      found === ''
        ? `ends where a figure was expected, at position ${start}`
        : `has an unexpected character ${JSON.stringify(found)}`,
    );
  }
  return { figure: { number: 3, accidental }, index };
}

/** Split a figure string into its static figures and its moving ones. */
function parseFigures(text: string): ParsedFigures {
  const figures: Figure[] = [];
  const motions: FigureMotion[] = [];
  let index = 0;
  while (index < text.length) {
    if (FIGURE_SEPARATORS.has(text[index] ?? '')) {
      index += 1;
      continue;
    }
    const first = readFigure(text, index);
    index = first.index;
    if (!MOTION_MARKS.has(text[index] ?? '')) {
      figures.push(first.figure);
      continue;
    }
    const second = readFigure(text, index + 1);
    index = second.index;
    if (MOTION_MARKS.has(text[index] ?? '')) {
      throw invalidFigures(text, 'chains more than one motion onto a single figure');
    }
    if (first.figure.number === second.figure.number) {
      throw invalidFigures(text, `moves the interval ${first.figure.number} onto itself`);
    }
    motions.push({ from: first.figure, to: second.figure });
  }
  return { figures, motions };
}

/** What a figure set sounds, and where the chord root sits above the bass. */
type FiguredSonority = { intervals: readonly number[]; rootInterval: number };

/** The root-position triad, which every unfigured bass note carries. */
const TRIAD: FiguredSonority = { intervals: [3, 5], rootInterval: 1 };

/** The first-inversion triad: the bass is the third of the chord. */
const TRIAD_FIRST: FiguredSonority = { intervals: [3, 6], rootInterval: 6 };

/** The second-inversion triad: the bass is the fifth of the chord. */
const TRIAD_SECOND: FiguredSonority = { intervals: [4, 6], rootInterval: 4 };

/** The root-position seventh chord. */
const SEVENTH: FiguredSonority = { intervals: [3, 5, 7], rootInterval: 1 };

/** The first-inversion seventh chord, written `6/5`. */
const SEVENTH_FIRST: FiguredSonority = { intervals: [3, 5, 6], rootInterval: 6 };

/** The second-inversion seventh chord, written `4/3`. */
const SEVENTH_SECOND: FiguredSonority = { intervals: [3, 4, 6], rootInterval: 4 };

/** The third-inversion seventh chord, written `4/2` or `2`. */
const SEVENTH_THIRD: FiguredSonority = { intervals: [2, 4, 6], rootInterval: 2 };

/**
 * Every figure set the grammar recognizes, keyed by the intervals actually
 * written in ascending order. Both the abbreviation a musician writes and the
 * full stack it stands for are listed, so `6` and `63` name one sonority and
 * `2`, `42` and `642` another.
 */
const FIGURE_SETS: ReadonlyMap<string, FiguredSonority> = new Map([
  ['', TRIAD],
  ['3', TRIAD],
  ['5', TRIAD],
  ['3,5', TRIAD],
  ['6', TRIAD_FIRST],
  ['3,6', TRIAD_FIRST],
  ['4,6', TRIAD_SECOND],
  ['7', SEVENTH],
  ['3,7', SEVENTH],
  ['5,7', SEVENTH],
  ['3,5,7', SEVENTH],
  ['5,6', SEVENTH_FIRST],
  ['3,5,6', SEVENTH_FIRST],
  ['3,4', SEVENTH_SECOND],
  ['3,4,6', SEVENTH_SECOND],
  ['2', SEVENTH_THIRD],
  ['2,4', SEVENTH_THIRD],
  ['2,4,6', SEVENTH_THIRD],
]);

/**
 * The digits a realized sonority is conventionally written with, keyed by its
 * full interval stack. The inverse of the abbreviations in {@link FIGURE_SETS},
 * and the reason {@link figuredBassOf} emits `6` rather than `63`.
 */
const FIGURE_ABBREVIATIONS: ReadonlyMap<string, readonly number[]> = new Map([
  [TRIAD.intervals.join(','), []],
  [TRIAD_FIRST.intervals.join(','), [6]],
  [TRIAD_SECOND.intervals.join(','), [6, 4]],
  [SEVENTH.intervals.join(','), [7]],
  [SEVENTH_FIRST.intervals.join(','), [6, 5]],
  [SEVENTH_SECOND.intervals.join(','), [4, 3]],
  [SEVENTH_THIRD.intervals.join(','), [4, 2]],
]);

/**
 * Index the chord vocabulary by interval template, for the triads and seventh
 * chords a figure can stack. Reading the templates back from the chord builder
 * keeps the two in step: a quality added to the vocabulary becomes reachable
 * from a figure without a second table to maintain.
 */
function tertianQualityIndex(): ReadonlyMap<string, ChordQuality> {
  const index = new Map<string, ChordQuality>();
  for (const quality of chordQualities()) {
    const { intervals } = makeChord(0, quality);
    const template = intervals.join(',');
    // Declaration order decides a tie, exactly as it does for chord detection.
    if (intervals.length >= 3 && intervals.length <= MAX_STACK_SIZE && !index.has(template)) {
      index.set(template, quality);
    }
  }
  return index;
}

const TERTIAN_QUALITIES = tertianQualityIndex();

/**
 * The alteration each diatonic letter carries in a key, indexed by letter.
 *
 * This one lookup is what makes an unfigured interval diatonic: the letter of
 * an interval above the bass comes from counting letters, and its accidental
 * comes from the key's own spelling of that letter, so a flat-side key hands
 * back its flats and a harmonic minor its raised leading tone.
 */
function keyLetterAlters(key: KeyScale): number[] {
  const size = scaleTonesInDegreeOrder(key).length;
  if (size !== 7) {
    throw new InvalidInputError(`figured bass requires a heptatonic key (received ${size} tones)`);
  }
  const alters: number[] = [];
  for (const note of spellScale(spelledKeyOf(key).tonic, key)) {
    alters[mod7(note.letter)] = note.alter;
  }
  return alters;
}

/** The note a figure names: its letter from the bass, its accidental from the key. */
function noteAbove(bass: Note, figure: Figure, alters: readonly number[]): Note {
  const letter = mod7(bass.letter + figure.number - 1);
  return { letter, alter: alteredBy(alters[letter] ?? 0, figure.accidental) };
}

/** A bass note reduced to the letter and accidental the figures are read from. */
function bareNote(note: Note): Note {
  return { letter: mod7(note.letter), alter: note.alter };
}

/**
 * Build the chord a resolved figure set names over a bass.
 *
 * The figure set fixes which tone is the root, so the stack is read from that
 * root upward in diatonic thirds and matched against the chord vocabulary. A
 * stack no quality names — the augmented sixths, above all — is reported as
 * having no solution rather than being rounded to a chord it is not.
 */
function realizeSonority(
  bass: Note,
  resolved: Figure[],
  text: string,
  alters: readonly number[],
): { chord: Chord; notes: Note[] } {
  const numbers = [...new Set(resolved.map((figure) => figure.number))].sort((a, b) => a - b);
  const sonority = FIGURE_SETS.get(numbers.join(','));
  if (sonority === undefined) {
    throw invalidFigures(text, 'names no chord over the bass');
  }
  const written = new Map(resolved.map((figure) => [figure.number, figure.accidental]));
  const notes = sonority.intervals.map((number) =>
    noteAbove(bass, { number, accidental: written.get(number) ?? 'none' }, alters),
  );
  const tones = [bass, ...notes];
  const root = tones[[1, ...sonority.intervals].indexOf(sonority.rootInterval)] ?? bass;
  const rootPc = noteToPitchClass(root);
  const stack: number[] = [];
  for (let step = 0; step < tones.length; step += 1) {
    // The chord tones sit two letters apart: root, third, fifth, seventh.
    const tone = tones.find((candidate) => mod7(candidate.letter - root.letter) === step * 2);
    if (tone === undefined) {
      throw new NoSolutionError(
        `figured bass ${JSON.stringify(text)} sounds ${noteNames(tones).join(' ')}, which does not stack in thirds`,
      );
    }
    stack.push(mod12(noteToPitchClass(tone) - rootPc));
  }
  const quality = TERTIAN_QUALITIES.get(stack.join(','));
  if (quality === undefined) {
    throw new NoSolutionError(
      `figured bass ${JSON.stringify(text)} sounds ${noteNames(tones).join(' ')}, which no chord quality names`,
    );
  }
  const chord = makeChord(rootPc, quality, noteToPitchClass(bass));
  chord.rootSpelling = { letter: root.letter, alter: root.alter };
  chord.bassSpelling = { letter: bass.letter, alter: bass.alter };
  return { chord, notes };
}

/**
 * A figure that moves over a held bass, such as the `4-3` suspension.
 *
 * @category Functional Harmony
 */
export type FiguredBassSuspension = {
  /** The interval above the bass that sounds first: the suspended note. */
  from: number;
  /** The interval it moves to, which is the one the chord contains. */
  to: number;
  /** The suspended note, spelled. */
  note: Note;
  /** The note it moves to, spelled. */
  resolution: Note;
};

/**
 * Everything a figured bass states: the chord, its spelled notes, and any
 * figure that moves.
 *
 * @category Functional Harmony
 */
export type FiguredBassRealization = {
  /**
   * The chord the figures name, carrying the given bass as its `bassPc` and
   * the letter spellings of its root and bass as enharmonic hints.
   */
  chord: Chord;
  /**
   * The spelled notes, bass first and then each figured interval in ascending
   * order. They carry no octave: figures fix the intervals above the bass, not
   * the register the upper voices take them in.
   */
  notes: Note[];
  /**
   * Every moving figure, in written order, or an empty array for a static one.
   * The chord above is the harmony these resolve into.
   */
  suspensions: FiguredBassSuspension[];
};

/**
 * Read a figured bass in full: the chord, its spelled notes, and its
 * suspensions.
 *
 * The figure grammar, in the forms this accepts:
 *
 * - Nothing at all, `5`, `3` or `53` — the root-position triad.
 * - `6` or `63` — the first-inversion triad; `64` — the second-inversion triad.
 * - `7` — the root-position seventh chord; `65`, `43`, and `42` (also written
 *   `2`) — its first, second, and third inversions. The full stacks `753`,
 *   `653`, `643` and `642` name the same four chords.
 * - Stacked figures may be written run together (`64`) or separated by a slash,
 *   a comma or a space (`6/4`), which is the same figure either way.
 * - An accidental in front of a figure alters that interval: `#6`, `b7`, `#43`.
 *   A slashed or crossed figure raises its interval, and is typed `+` — `+6` is
 *   `#6`. An accidental with no figure alters the third above the bass, so a
 *   lone `#` over the dominant of a minor key raises its third to the leading
 *   tone. `#` and `b` move the interval a semitone from what the key gives,
 *   `##` and `bb` a whole tone, and `n` names the natural note whatever the key
 *   gives. The Unicode accidentals are accepted alongside the typed ones.
 * - A figure that moves is written with a hyphen: `4-3`, `9-8`, `7-6`, and any
 *   other pair. Each side may carry its own accidental, as `4-#3` does in a
 *   minor key. Moving figures may stand beside static ones (`5 4-3`).
 *
 * Every interval no accidental touches is the one the key's scale gives, which
 * is why the key is required and why the same figure names different qualities
 * over different degrees.
 *
 * A moving figure resolves into the chord: `4-3` over a G in C major returns
 * the G major triad, and the suspended C is reported as a suspension rather
 * than as a chord tone. A suspension is a melodic event over a single harmony —
 * the sounding chord does not change when it resolves — so naming the
 * resolution is the reading that answers "which chord is this", and the record
 * of what was suspended is kept beside it rather than thrown away.
 *
 * @param bass The bass note, spelled: a note name, a MIDI number, note data, or
 *   a `Note`; its octave, if any, is not used.
 * @param figures The figures written under the bass; empty for an unfigured
 *   note.
 * @param key The prevailing key, which supplies every unaltered interval, as a
 *   key name, a key/scale, or a `Key`.
 * @returns The chord, its spelled notes, and any suspensions.
 * @throws If the figures are malformed or name no chord
 *   ({@link InvalidInputError}), if the key is not heptatonic
 *   ({@link InvalidInputError}), or if the figures sound a chord no
 *   {@link ChordQuality} names, such as an augmented sixth
 *   ({@link NoSolutionError}).
 * @example
 * ```ts
 * import { figuredBassRealization, majorKey, noteNames, parseNote } from '@libraz/libcantus';
 * const realized = figuredBassRealization(parseNote('G'), '4-3', majorKey(0));
 * noteNames(realized.notes); // ['G', 'B', 'D']
 * realized.suspensions[0]?.from; // 4 — the suspended C above the bass
 * ```
 * @category Functional Harmony
 */
export function figuredBassRealization(
  bass: NoteLike,
  figures: string,
  key: KeyLike,
): FiguredBassRealization {
  if (typeof figures !== 'string') {
    throw new InvalidInputError(`figured bass must be a string; received ${typeof figures}`);
  }
  const bassData = toNoteData(bass);
  const scale = toKeyScale(key);
  const alters = keyLetterAlters(scale);
  // Reading the pitch class validates the note's fields before its letter is
  // used for the interval arithmetic above it.
  noteToPitchClass(bassData);
  const bassNote = bareNote(bassData);
  const text = figures.trim();
  const { figures: written, motions } = parseFigures(text);
  const suspensions = motions.map((motion) => ({
    from: motion.from.number,
    to: motion.to.number,
    note: noteAbove(bassNote, motion.from, alters),
    resolution: noteAbove(bassNote, motion.to, alters),
  }));
  // A figure resolving onto the octave lands on the bass itself, which is
  // already sounding and so adds nothing to the stack: `9-8` resolves to a
  // plain root-position triad.
  const resolved = [
    ...written,
    ...motions.map((motion) => motion.to).filter((figure) => figure.number !== OCTAVE_FIGURE),
  ];
  const { chord, notes } = realizeSonority(bassNote, resolved, text, alters);
  return { chord, notes: [bassNote, ...notes], suspensions };
}

/**
 * Realize a figured bass: the chord a bass note and its figures name in a key.
 *
 * The chord carries the given bass as its `bassPc`, so an inversion reads as
 * one everywhere the library measures a bass against a root, and carries the
 * letter spellings of its root and bass so the realization can be respelled
 * without losing the accidentals the figures asked for.
 *
 * See {@link figuredBassRealization} for the figure grammar this accepts and
 * for the spelled notes and suspensions it drops. A moving figure such as
 * `4-3` returns the chord it resolves into.
 *
 * @param bass The bass note, spelled; its octave, if any, is not used.
 * @param figures The figures written under the bass; empty for an unfigured
 *   note.
 * @param key The prevailing key, which supplies every unaltered interval.
 * @param bass The bass note, spelled: a note name, a MIDI number, note data, or
 *   a `Note`.
 * @param figures The figures written under the bass.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns The chord the figures name.
 * @throws If the figures are malformed or name no chord
 *   ({@link InvalidInputError}), if the key is not heptatonic
 *   ({@link InvalidInputError}), or if the figures sound a chord no
 *   {@link ChordQuality} names ({@link NoSolutionError}).
 * @example
 * ```ts
 * import { majorKey, minorKey, parseNote, realizeFiguredBass } from '@libraz/libcantus';
 * realizeFiguredBass(parseNote('B'), '6', majorKey(0));
 * // G major with B in the bass: { rootPc: 7, quality: 'maj', bassPc: 11, ... }
 * realizeFiguredBass(parseNote('G'), '#', minorKey(0));
 * // G major in C minor: the raised third is a B natural
 * ```
 * @category Functional Harmony
 */
export function realizeFiguredBass(bass: NoteLike, figures: string, key: KeyLike): Chord {
  return figuredBassRealization(bass, figures, key).chord;
}

/**
 * Write a chord as the figures a bass would carry under it, in a key.
 *
 * The inverse of {@link realizeFiguredBass} for every chord the figure grammar
 * reaches: the conventional abbreviation for the inversion (`6`, `64`, `7`,
 * `65`, `43`, `42`, or nothing at all for a root-position triad), with an
 * accidental on any interval the key does not already give. An altered
 * interval the abbreviation would leave implied is written out, so the raised
 * third of a dominant in a minor key emits `#3` rather than the bare `#` a
 * score would print — the figures this returns read back as the same chord.
 *
 * What this returns is read back before it is returned, so the two directions
 * cannot disagree: a chord the digits would name only approximately — an
 * augmented sixth, whose tones do not stack in thirds over its bass — has no
 * figures rather than figures that fail to realize.
 *
 * @param chord The chord to figure, as a chord symbol, chord data, or a
 *   `Chord`; its `bassPc`, when present, is the bass the intervals are measured
 *   above.
 * @param key The prevailing key, which decides which intervals need no
 *   accidental, as a key name, a key/scale, or a `Key`.
 * @returns The figures, as {@link realizeFiguredBass} accepts them.
 * @throws If the key is not heptatonic ({@link InvalidInputError}), or if no
 *   figure names the chord — its bass is not one of its tones, its tones do not
 *   stack in diatonic thirds above that bass, or it is an added-tone or
 *   extended chord the notation has no abbreviation for
 *   ({@link NoSolutionError}).
 * @example
 * ```ts
 * import { figuredBassOf, majorKey, makeChord } from '@libraz/libcantus';
 * figuredBassOf(makeChord(7, 'maj', 11), majorKey(0)); // '6' — G major over B
 * figuredBassOf(makeChord(7, 'dom7', 2), majorKey(0)); // '43' — G7 over D
 * ```
 * @category Functional Harmony
 */
export function figuredBassOf(chord: ChordLike, key: KeyLike): string {
  const data = toChordData(chord);
  const scale = toKeyScale(key);
  const alters = keyLetterAlters(scale);
  const tones = spellChord(data, spelledKeyOf(scale).tonic, scale);
  const bassPc = mod12(data.bassPc ?? data.rootPc);
  const bass = tones.find((tone) => noteToPitchClass(tone) === bassPc);
  if (bass === undefined) {
    throw new NoSolutionError(
      "figured bass measures intervals above a chord tone, and this chord's bass is not one of its tones",
    );
  }
  const written = new Map<number, Note>();
  for (const tone of tones) {
    if (tone !== bass) {
      written.set(mod7(tone.letter - bass.letter) + 1, tone);
    }
  }
  const digits = FIGURE_ABBREVIATIONS.get([...written.keys()].sort((a, b) => a - b).join(','));
  if (digits === undefined) {
    throw new NoSolutionError(
      `no figured bass names ${noteNames(tones).join(' ')} over ${noteNames([bass])[0]}`,
    );
  }
  const accidentals = new Map<number, string>();
  for (const [number, tone] of written) {
    const alteration = tone.alter - (alters[mod7(tone.letter)] ?? 0);
    if (alteration === 0) {
      continue;
    }
    const glyph = ACCIDENTAL_GLYPHS[alteration];
    if (glyph === undefined) {
      throw new NoSolutionError(
        `no figure names an interval altered by ${alteration} semitones from the key`,
      );
    }
    accidentals.set(number, glyph);
  }
  // Figures are written from the top down, and an altered interval the
  // abbreviation leaves implied has to be named for its accidental to land on
  // anything: a raised third under a `6` is written `6#3`, not `#6`.
  const figures = [...new Set([...digits, ...accidentals.keys()])]
    .sort((a, b) => b - a)
    .map((number) => `${accidentals.get(number) ?? ''}${number}`)
    .join('');
  assertRealizesAs(bass, figures, scale, tones);
  return figures;
}

/** The pitch classes a set of spelled notes sounds, ascending. */
function pitchClassesOf(notes: readonly Note[]): number[] {
  return [...new Set(notes.map(noteToPitchClass))].sort((a, b) => a - b);
}

/**
 * Require the figures just written to read back as the chord they were written
 * from, and report the ones that do not as having no figured bass.
 *
 * The digits are chosen by which intervals are written above the bass, which is
 * a weaker test than the one a realization applies: a chord may occupy the
 * interval positions of an inversion without stacking in thirds over its bass,
 * and the augmented sixths do exactly that. Reading the figures back is what
 * keeps the two directions from disagreeing about which chords the notation
 * reaches, rather than a second table that would drift from the first.
 */
function assertRealizesAs(bass: Note, figures: string, key: KeyScale, tones: Note[]): void {
  const noFigures = (detail: string): NoSolutionError =>
    new NoSolutionError(
      `no figured bass names ${noteNames(tones).join(' ')} over ${noteNames([bass])[0]}: the figures ${JSON.stringify(figures)} ${detail}`,
    );
  let realized: FiguredBassRealization;
  try {
    realized = figuredBassRealization(bass, figures, key);
  } catch (error) {
    throw error instanceof NoSolutionError ? noFigures('read back as no chord at all') : error;
  }
  const written = pitchClassesOf(realized.notes);
  const expected = pitchClassesOf(tones);
  if (written.length !== expected.length || written.some((pc, index) => pc !== expected[index])) {
    throw noFigures(`sound ${noteNames(realized.notes).join(' ')} instead`);
  }
}
