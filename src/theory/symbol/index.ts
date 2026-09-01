/**
 * Lead-sheet chord symbol parsing and formatting.
 *
 * Bridges the informal `<root><quality>[/<bass>]` notation musicians write
 * (`Cmaj7`, `F#m7b5`, `Bb7`, `C/G`) and the library's structured {@link Chord}
 * type, so callers can accept/emit plain text at the edges of the API.
 *
 * The root and the slash bass are note names, so they are read and written in
 * whichever notation system the caller names — a German chart's `H7`, `As7` and
 * `Ges/B` included. Unlike a note name, a chord symbol is never attributed to a
 * system on its own: German `B` is a B flat and English `B` a B natural, and a
 * symbol carries no `dur`/`moll` word to break the tie, so the most common
 * symbol in the vocabulary would otherwise change chord with the source it came
 * from. With no system given a symbol is English.
 */

import {
  InvalidInputError,
  type ParseResult,
  parseFailure,
  unwrapParse,
} from '../../core/errors/index.js';
import {
  formatNote,
  midiToNote,
  type Note,
  type NoteNameOptions,
  type NoteNameSystem,
  noteToPitchClass,
  parseNote,
  pitchClassOf as pitchClass,
  spelledInterval,
  transposeByInterval,
  transposeNote,
  tryParseNote,
} from '../../core/pitch/index.js';
import { maxNoteNameLength } from '../../core/pitch/naming.js';
import {
  assertFiniteNumber,
  assertFiniteSemitones,
  describeRejected,
} from '../../core/validation/index.js';
import type {
  Alteration,
  AlteredDegree,
  Chord,
  ChordBase,
  ChordQuality,
  ChordSeventh,
  ChordSpec,
  PitchSpelling,
} from '../chord/index.js';
import { chordFromSpec, chordQualities, chordSpecOf } from '../chord/index.js';
import { chordSpecForQuality, exactChordSpecQuality } from '../chord/spec.js';

/**
 * Matches an English chord root: a letter A-G (case-insensitive, like
 * {@link parseNote}) with an optional single-direction accidental.
 */
const ROOT_RE = /^[A-Ga-g](?:#{1,2}|b{1,2}|x)?/;

/** Matches a bare English note usable as a slash-chord bass (no octave). */
const BASS_RE = /^[A-Ga-g](?:#{1,2}|b{1,2}|x)?$/;

/**
 * The system a symbol is read and written in when the caller names none.
 *
 * A German reading is something a caller asks for, never something inferred:
 * see this module's own documentation for why chord symbols do not detect.
 */
const DEFAULT_SYSTEM: NoteNameSystem = 'english';

/** A note every system can write, used only to validate a requested system. */
const SYSTEM_PROBE: Note = { letter: 0, alter: 0 };

/** Recognized quality suffixes, keyed by their exact lead-sheet spelling. */
const QUALITY_MAP: Record<string, ChordQuality> = {
  '': 'maj',
  maj: 'maj',
  m: 'min',
  min: 'min',
  '-': 'min',
  dim: 'dim',
  '°': 'dim',
  aug: 'aug',
  '+': 'aug',
  maj7: 'maj7',
  M7: 'maj7',
  Δ: 'maj7',
  Δ7: 'maj7',
  m7: 'min7',
  min7: 'min7',
  '-7': 'min7',
  '7': 'dom7',
  dim7: 'dim7',
  '°7': 'dim7',
  m7b5: 'm7b5',
  ø: 'm7b5',
  ø7: 'm7b5',
  min7b5: 'm7b5',
  mMaj7: 'minMaj7',
  mM7: 'minMaj7',
  minMaj7: 'minMaj7',
  mMaj9: 'minMaj9',
  mM9: 'minMaj9',
  minMaj9: 'minMaj9',
  mMaj11: 'minMaj11',
  mM11: 'minMaj11',
  minMaj11: 'minMaj11',
  mMaj13: 'minMaj13',
  mM13: 'minMaj13',
  minMaj13: 'minMaj13',
  aug7: 'aug7',
  '+7': 'aug7',
  '7#5': 'aug7',
  augMaj7: 'augMaj7',
  augM7: 'augMaj7',
  '+maj7': 'augMaj7',
  '+M7': 'augMaj7',
  majb5: 'majb5',
  'maj(b5)': 'majb5',
  '(b5)': 'majb5',
  '6': '6',
  m6: 'min6',
  min6: 'min6',
  '6/9': '6/9',
  '69': '6/9',
  sus2: 'sus2',
  sus: 'sus4',
  sus4: 'sus4',
  add9: 'add9',
  add11: 'add11',
  maj9: 'maj9',
  M9: 'maj9',
  m9: 'min9',
  min9: 'min9',
  '9': 'dom9',
  '7b9': '7b9',
  '7#9': '7#9',
  '7#11': '7#11',
  '7b13': '7b13',
  '11': '11',
  '13': '13',
  '5': '5',
  '7sus4': '7sus4',
  '7sus': '7sus4',
  '9sus4': '11',
  '9sus': '11',
  '7b5': '7b5',
  '7alt': '7alt',
  alt: '7alt',
  '13b9': '13b9',
  maj13: 'maj13',
  M13: 'maj13',
  'maj7#11': 'maj7#11',
  'M7#11': 'maj7#11',
  m11: 'min11',
  min11: 'min11',
  m13: 'min13',
  min13: 'min13',
  madd9: 'minAdd9',
  'min(add9)': 'minAdd9',
  'm(add9)': 'minAdd9',
  '6add9': '6/9',
  'm6/9': 'min6/9',
  m69: 'min6/9',
  'min6/9': 'min6/9',
  // ASCII stand-ins for the degree and half-diminished glyphs, which most
  // lead sheets and chord-chart text files use instead of the typographic ones.
  o: 'dim',
  o7: 'dim7',
  h: 'm7b5',
  h7: 'm7b5',
};

/** Canonical lead-sheet suffix emitted for each chord quality when formatting. */
const CANONICAL_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  dim7: 'dim7',
  m7b5: 'm7b5',
  minMaj7: 'mMaj7',
  minMaj9: 'mMaj9',
  minMaj11: 'mMaj11',
  minMaj13: 'mMaj13',
  aug7: 'aug7',
  augMaj7: 'augMaj7',
  majb5: 'maj(b5)',
  '6': '6',
  min6: 'm6',
  '6/9': '6/9',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'add9',
  add11: 'add11',
  maj9: 'maj9',
  min9: 'm9',
  dom9: '9',
  '7b9': '7b9',
  '7#9': '7#9',
  '7#11': '7#11',
  '7b13': '7b13',
  '11': '11',
  '13': '13',
  '5': '5',
  '7sus4': '7sus4',
  '7b5': '7b5',
  '7alt': '7alt',
  '13b9': '13b9',
  maj13: 'maj13',
  'maj7#11': 'maj7#11',
  min11: 'm11',
  min13: 'm13',
  minAdd9: 'madd9',
  'min6/9': 'm6/9',
};

/**
 * The quality a suffix names outright, or undefined when it names none.
 *
 * The own-property check is what stops `'constructor'` and `'toString'` from
 * resolving through `Object.prototype` and reaching the chord builder with a
 * quality it has no interval template for.
 */
function knownQuality(suffix: string): ChordQuality | undefined {
  return Object.hasOwn(QUALITY_MAP, suffix) ? QUALITY_MAP[suffix] : undefined;
}

/** How a base is written where a symbol opens with one. */
const BASE_TOKENS: readonly (readonly [string, ChordBase | 'major'])[] = [
  ['sus2', 'sus2'],
  ['sus4', 'sus4'],
  ['sus', 'sus4'],
  ['min', 'min'],
  ['dim', 'dim'],
  ['aug', 'aug'],
  ['maj', 'major'],
  ['Maj', 'major'],
  ['m', 'min'],
  ['-', 'min'],
  ['o', 'dim'],
  ['°', 'dim'],
  ['+', 'aug'],
  ['M', 'major'],
  ['Δ', 'major'],
  ['^', 'major'],
];

/**
 * The glyphs that name a base and the seventh over it in one character.
 *
 * The half-diminished glyph is a minor seventh over a diminished triad, not a
 * diminished seventh, so it is read as the pair it stands for: reading it as a
 * plain diminished base would let `Cø9` stack the diminished seventh the base
 * implies and print a chord the glyph does not name.
 */
const COMPOUND_TOKENS: readonly (readonly [string, { base: ChordBase; seventh: ChordSeventh }])[] =
  [
    ['ø', { base: 'dim', seventh: 'min7' }],
    ['h', { base: 'dim', seventh: 'min7' }],
  ];

/**
 * The markers that say a seventh is major.
 *
 * The glyphs say it on their own — `CΔ` is a major seventh — while the words do
 * not: `Cmaj` is the plain triad, and `CmMaj` only reads as a major seventh
 * because the base already took the letter before it.
 */
const MAJOR_MARKERS: readonly (readonly [string, 'word' | 'glyph'])[] = [
  ['maj', 'word'],
  ['Maj', 'word'],
  ['M', 'word'],
  ['Δ', 'glyph'],
  ['^', 'glyph'],
];

/** The extension numbers a symbol stacks a chord up to. */
const EXTENSION_NUMBERS = [13, 11, 9, 7, 6] as const;

/** The degree each `add` figure names, so `add2` and `add9` are one tone. */
const ADDED_DEGREES: Record<string, number> = {
  '2': 9,
  '4': 11,
  '6': 6,
  '9': 9,
  '11': 11,
  '13': 13,
};

/** The degrees a symbol can write an accidental against. */
const ALTERABLE: Record<string, AlteredDegree> = { '5': 5, '9': 9, '11': 11, '13': 13 };

/** The degrees a symbol can ask a chord to leave out. */
const OMITTABLE: Record<string, number> = { '1': 1, '3': 3, '5': 5 };

/** A chord read token by token, before it settles into a {@link ChordSpec}. */
type SpecDraft = {
  base: ChordBase;
  seventh?: ChordSeventh;
  /**
   * The alterations read so far, keyed by degree *and* accidental so that the
   * flat ninth and the raised ninth of an altered dominant are two tones rather
   * than two readings of one.
   */
  alterations: Map<string, Alteration>;
  additions: Set<number>;
  omissions: Set<number>;
  /**
   * The seventh the opening glyph names over its base, where it names one. An
   * extension number stacks up to this seventh instead of the one the base
   * implies, so the minor seventh of a half-diminished chord survives `ø9`.
   */
  seventhOverBase?: ChordSeventh;
  /** Degrees the extension number implied, which a written figure replaces. */
  implied: Set<AlteredDegree>;
  /** Whether a `maj`/`M`/`Δ` marker has already claimed the seventh. */
  major: boolean;
};

/** The identity of one alteration: which degree, and with which accidental. */
function alterationKey(degree: AlteredDegree, alter: -1 | 0 | 1): string {
  return `${degree}:${alter}`;
}

/**
 * Record an alteration the symbol writes out.
 *
 * A written figure states the degree outright, so it replaces the unaltered
 * tone the extension number implied — `C11b9` flattens the ninth of the stack
 * rather than sounding both — while two written figures against one degree both
 * stand, since that is what a chart asking for them means.
 */
function writeAlteration(draft: SpecDraft, degree: AlteredDegree, alter: -1 | 0 | 1): void {
  if (draft.implied.delete(degree)) {
    draft.alterations.delete(alterationKey(degree, 0));
  }
  draft.alterations.set(alterationKey(degree, alter), { degree, alter });
}

/** Record an unaltered degree the extension number stacks up to. */
function implyAlteration(draft: SpecDraft, degree: AlteredDegree): void {
  draft.implied.add(degree);
  draft.alterations.set(alterationKey(degree, 0), { degree, alter: 0 });
}

/** Whether the draft already carries an alteration of `degree`. */
function altersDegree(draft: SpecDraft, degree: AlteredDegree): boolean {
  for (const alteration of draft.alterations.values()) {
    if (alteration.degree === degree) {
      return true;
    }
  }
  return false;
}

/** The longest token in `table` that `text` carries at `at`. */
function matchToken<T>(
  text: string,
  at: number,
  table: readonly (readonly [string, T])[],
): { value: T; next: number } | undefined {
  let found: { value: T; next: number } | undefined;
  for (const [token, value] of table) {
    if (text.startsWith(token, at) && (found === undefined || at + token.length > found.next)) {
      found = { value, next: at + token.length };
    }
  }
  return found;
}

/** The number token at `at`, longest first so 11 and 13 are not read as 1. */
function matchNumber(text: string, at: number): { value: number; next: number } | undefined {
  for (const value of EXTENSION_NUMBERS) {
    const token = String(value);
    if (text.startsWith(token, at)) {
      return { value, next: at + token.length };
    }
  }
  return undefined;
}

/**
 * Stack the draft up to an extension number.
 *
 * A number names the top of a stack of thirds, not a single tone: `13` is a
 * seventh with a ninth and a thirteenth over it. The eleventh is left out of a
 * thirteenth chord, which is how a chart voices one.
 *
 * The seventh stacked under the number is the major seventh a marker asks for,
 * else the one the opening already named, else the one the base implies.
 *
 * The one place the eleventh's quarrel with the third is settled: over a
 * dominant seventh the eleventh sits a semitone above a major third, so the
 * third gives way to it, as a chart voices an eleventh chord. A minor third is
 * a whole tone below the eleventh and does not clash, and a major seventh puts
 * the chord in the family the dictionaries write out in full, so neither loses
 * its third. The rule is the number's alone, so it does not turn on whichever
 * further figures a symbol writes after it.
 */
function stackTo(draft: SpecDraft, top: number): void {
  if (top === 6) {
    draft.additions.add(6);
    return;
  }
  draft.seventh = draft.major
    ? 'maj7'
    : (draft.seventhOverBase ?? (draft.base === 'dim' ? 'dim7' : 'min7'));
  if (top >= 9) {
    implyAlteration(draft, 9);
  }
  if (top === 11) {
    implyAlteration(draft, 11);
    if (!draft.major && draft.base === 'maj') {
      draft.omissions.add(3);
    }
  }
  if (top === 13) {
    implyAlteration(draft, 13);
  }
}

/**
 * Apply one figure written after the chord's core, or report that it is none.
 *
 * The same grammar reads a figure written bare (`7b9`) and one written inside
 * brackets (`7(b9,#11)`), so the two spellings of a chart's tensions cannot
 * drift apart.
 */
function applyFigure(draft: SpecDraft, text: string, at: number): number | undefined {
  const base = matchToken(text, at, [
    ['sus2', 'sus2'],
    ['sus4', 'sus4'],
    ['sus', 'sus4'],
  ] as const);
  if (base !== undefined) {
    draft.base = base.value;
    return base.next;
  }
  if (text.startsWith('alt', at)) {
    // The altered dominant, whichever way it is reached: a raised fifth and a
    // raised ninth over a dominant seventh.
    draft.base = 'aug';
    draft.seventh = 'min7';
    writeAlteration(draft, 9, 1);
    return at + 3;
  }
  if (text.startsWith('add', at)) {
    const degree = matchNumberToken(text, at + 3, ADDED_DEGREES);
    if (degree === undefined) {
      return undefined;
    }
    draft.additions.add(degree.value);
    return degree.next;
  }
  const omitted = matchToken(text, at, [
    ['omit', 4],
    ['no', 2],
  ] as const);
  if (omitted !== undefined) {
    const degree = matchNumberToken(text, omitted.next, OMITTABLE);
    if (degree === undefined) {
      return undefined;
    }
    draft.omissions.add(degree.value);
    return degree.next;
  }
  const accidental = matchToken(text, at, [
    ['b', -1],
    ['#', 1],
  ] as const);
  const from = accidental?.next ?? at;
  const degree = matchNumberToken(text, from, ALTERABLE);
  if (degree === undefined) {
    return undefined;
  }
  // A symbol writes its fifth once. Read bare, a `5` would carry no accidental
  // of its own and so would state a perfect fifth over a chord whose fifth the
  // text has already altered — `dim`, `aug`, or a `b5`/`#5` figure before it —
  // silently returning a chord with a fifth the symbol does not spell. It is
  // the suffix that is wrong, not the fifth, so the whole symbol fails rather
  // than one reading of it being chosen.
  if (degree.value === 5 && (accidental === undefined || writesFifth(draft))) {
    return undefined;
  }
  writeAlteration(draft, degree.value, accidental?.value ?? 0);
  return degree.next;
}

/**
 * Whether the draft's fifth has already been written by the symbol.
 *
 * `dim` and `aug` name a fifth as part of the base and a `b5`/`#5` figure names
 * one outright, so a further fifth figure over either is a second, contradictory
 * spelling of the same tone rather than an addition to the chord.
 */
function writesFifth(draft: SpecDraft): boolean {
  return draft.base === 'dim' || draft.base === 'aug' || altersDegree(draft, 5);
}

/** The longest degree number in `table` that `text` carries at `at`. */
function matchNumberToken<T>(
  text: string,
  at: number,
  table: Record<string, T>,
): { value: T; next: number } | undefined {
  const entries = Object.entries(table).map(([token, value]) => [token, value] as const);
  return matchToken(text, at, entries);
}

/** One way a suffix's opening characters can be read. */
type Opening = {
  /** How many characters of the core the opening spends. */
  length: number;
  /** The base it names, where it names one. */
  base?: ChordBase;
  /** The seventh it names over that base, as the half-diminished glyph does. */
  seventh?: ChordSeventh;
  /** Whether it is a major-seventh marker rather than a base. */
  major?: boolean;
  /** Whether that marker is a glyph, which names the seventh on its own. */
  glyph?: boolean;
};

/**
 * The ways a suffix can open, in the order they are worth trying.
 *
 * Longest first, as elsewhere in this grammar, but the shorter readings are
 * kept rather than discarded: a character that opens a base can equally be the
 * first character of a figure, and only reading the rest of the suffix says
 * which it was. The `o` of `omit3` names a diminished triad in `Co9`, so the
 * base reading is tried first and the bare figure is what is left when it
 * leaves `mit3` unread.
 */
function openings(core: string): (Opening | undefined)[] {
  const found: Opening[] = [];
  for (const [token, value] of COMPOUND_TOKENS) {
    if (core.startsWith(token)) {
      found.push({ length: token.length, base: value.base, seventh: value.seventh });
    }
  }
  for (const [token, value] of BASE_TOKENS) {
    if (!core.startsWith(token)) {
      continue;
    }
    found.push(
      value === 'major'
        ? { length: token.length, major: true, glyph: token === 'Δ' || token === '^' }
        : { length: token.length, base: value },
    );
  }
  found.sort((a, b) => b.length - a.length);
  // Reading no base at all is the last resort, so a suffix that is figures from
  // its first character is still read as the figures it is.
  return [...found, undefined];
}

/**
 * Read a quality suffix as a chord, or undefined when it is not one.
 *
 * The suffix is read structurally — a base, a marker, an extension number, then
 * any number of figures written bare or in brackets — so a combination of
 * tensions no quality name covers is read as readily as one that has a name.
 * Returning undefined rather than throwing is what lets the caller keep trying
 * shorter roots when a system writes its accidental as an affix.
 *
 * Where the opening is ambiguous every reading of it is tried, so the suffix is
 * refused only when none of them accounts for all of its characters.
 */
function structuralSpec(text: string): ChordSpec | undefined {
  let core = '';
  const groups: string[] = [];
  let inside = false;
  let buffer = '';
  for (const char of text) {
    if (char === '(') {
      if (inside) {
        return undefined;
      }
      inside = true;
      buffer = '';
    } else if (char === ')') {
      if (!inside) {
        return undefined;
      }
      inside = false;
      groups.push(buffer);
    } else if (inside) {
      buffer += char;
    } else {
      core += char;
    }
  }
  if (inside) {
    return undefined;
  }
  for (const opening of openings(core)) {
    const spec = readCore(core, groups, opening);
    if (spec !== undefined) {
      return spec;
    }
  }
  return undefined;
}

/**
 * Read a suffix's core and bracketed groups under one reading of its opening,
 * or undefined when that reading leaves anything unread.
 *
 * @param core The suffix outside any brackets.
 * @param groups The contents of the bracketed groups, in order.
 * @param opening The reading of the opening characters, or undefined to read
 *   the core as figures from its first character.
 */
function readCore(
  core: string,
  groups: readonly string[],
  opening: Opening | undefined,
): ChordSpec | undefined {
  const draft: SpecDraft = {
    base: 'maj',
    alterations: new Map(),
    additions: new Set(),
    omissions: new Set(),
    implied: new Set(),
    major: false,
  };
  let at = 0;
  let markerGlyph = false;
  let markerAfterBase = false;
  if (opening !== undefined) {
    at = opening.length;
    if (opening.major === true) {
      draft.major = true;
      markerGlyph = opening.glyph === true;
    } else if (opening.base !== undefined) {
      draft.base = opening.base;
      if (opening.seventh !== undefined) {
        draft.seventh = opening.seventh;
        draft.seventhOverBase = opening.seventh;
      }
    }
  }
  if (!draft.major) {
    const marker = matchToken(core, at, MAJOR_MARKERS);
    if (marker !== undefined) {
      draft.major = true;
      markerGlyph = marker.value === 'glyph';
      markerAfterBase = opening !== undefined;
      at = marker.next;
    }
  }
  const number = matchNumber(core, at);
  if (number !== undefined) {
    at = number.next;
    stackTo(draft, number.value);
  } else if (draft.major && (markerGlyph || markerAfterBase)) {
    // A marker with no number after it names the seventh itself, but only where
    // it is not the whole suffix: `Cmaj` is the triad and `CΔ` the seventh.
    draft.seventh = 'maj7';
  }
  while (at < core.length) {
    // Between two figures a '/' separates them, as it already does inside
    // brackets: the added sixth and ninth of a `6/9` are written that way, and
    // so are the tensions a chart writes after one. A leading or trailing slash
    // separates nothing, so it is left to fail as the stray character it is.
    if (core[at] === '/' && at > 0 && at + 1 < core.length) {
      at += 1;
      continue;
    }
    const next = applyFigure(draft, core, at);
    if (next === undefined || next === at) {
      return undefined;
    }
    at = next;
  }
  for (const group of groups) {
    for (const figure of group.split(/[,/\s]+/)) {
      if (figure.length === 0) {
        continue;
      }
      const next = applyFigure(draft, figure, 0);
      if (next !== figure.length) {
        return undefined;
      }
    }
  }
  return {
    rootPc: 0,
    base: draft.base,
    ...(draft.seventh === undefined ? {} : { seventh: draft.seventh }),
    alterations: [...draft.alterations.values()],
    additions: [...draft.additions],
    omissions: [...draft.omissions],
  };
}

/**
 * The chord a quality suffix names, or undefined when it names none.
 *
 * A name in the alias table wins, so every spelling a chart already uses keeps
 * the exact reading it had; anything else is read structurally.
 */
function suffixSpec(suffix: string): ChordSpec | undefined {
  const quality = knownQuality(suffix);
  return quality === undefined ? structuralSpec(suffix) : chordSpecForQuality(quality, 0);
}

/**
 * Reject a notation system the naming layer has no table for.
 *
 * A root is found by trying to read one, and a name a system cannot read is
 * simply not a root, so without this an unknown `system` would be reported as
 * an invalid chord symbol rather than as the invalid option it is.
 */
function assertNamingSystem(system: NoteNameSystem): void {
  formatNote(SYSTEM_PROBE, { system });
}

/**
 * Read `text` as an octave-less note in `system`, or undefined when it is none.
 *
 * A chord root carries no register: `H7` is a dominant seventh, not the German
 * H in octave 7, so a name that swallowed the quality's digits is refused here
 * instead of being taken for a root.
 */
function bareNote(text: string, system: NoteNameSystem): Note | undefined {
  const read = tryParseNote(text, { system });
  if (!read.ok) {
    return undefined;
  }
  return read.value.octave === undefined ? read.value : undefined;
}

/** A chord root read off the front of a symbol, and the text left after it. */
type RootSplit = { root: Note; rest: string };

/**
 * Every way the front of `text` reads as a chord root, longest root first.
 *
 * An English root is a letter and an optional accidental, which the pattern
 * settles in one step. The other systems write the accidental as an affix that
 * can also open a quality suffix — German `As` is the A flat, but `Asus4` is an
 * A chord — so every prefix a name could fill is offered and the caller keeps
 * the longest one whose remainder it recognizes as a quality.
 *
 * How far those prefixes reach is a property of the system, not of the text: a
 * root is a bare note name, and no system writes one longer than a letter and
 * two accidentals. Offering every prefix of the text instead would make the
 * same symbol cost more to read in one system than in another, and would read a
 * long line of text as many candidate roots when it can hold at most one.
 */
function rootSplits(text: string, system: NoteNameSystem): RootSplit[] {
  if (system === 'english') {
    const match = text.match(ROOT_RE);
    const token = match?.[0];
    return token === undefined
      ? []
      : [{ root: parseNote(token, { system }), rest: text.slice(token.length) }];
  }
  assertNamingSystem(system);
  const splits: RootSplit[] = [];
  const longest = Math.min(text.length, maxNoteNameLength(system));
  for (let end = longest; end > 0; end -= 1) {
    const root = bareNote(text.slice(0, end), system);
    if (root !== undefined) {
      splits.push({ root, rest: text.slice(end) });
    }
  }
  return splits;
}

/** Read a slash-chord bass, which is a bare note in the symbol's own system. */
function bassNote(text: string, system: NoteNameSystem): Note | undefined {
  if (system === 'english') {
    return BASS_RE.test(text) ? parseNote(text, { system }) : undefined;
  }
  return bareNote(text, system);
}

/** Build a chord and record the parsed spellings as enharmonic hints. */
function makeSpelledChord(root: Note, spec: ChordSpec, bass?: Note): Chord {
  const rooted: ChordSpec = { ...spec, rootPc: noteToPitchClass(root) };
  if (bass !== undefined) {
    rooted.bassPc = noteToPitchClass(bass);
  }
  const chord = chordFromSpec(rooted);
  chord.rootSpelling = { letter: root.letter, alter: root.alter };
  if (bass !== undefined) {
    chord.bassSpelling = { letter: bass.letter, alter: bass.alter };
  }
  return chord;
}

/**
 * The chord a root and the text after it name, or undefined when that text
 * names no chord this module can read.
 */
function chordAfterRoot(root: Note, rest: string, system: NoteNameSystem): Chord | undefined {
  // Split at the last '/' so the '6/9' quality's own slash never masks a
  // trailing slash bass (e.g. 'C6/9/E').
  const slashIndex = rest.lastIndexOf('/');
  if (slashIndex !== -1) {
    const slashSpec = suffixSpec(rest.slice(0, slashIndex));
    const bass = slashSpec === undefined ? undefined : bassNote(rest.slice(slashIndex + 1), system);
    if (slashSpec !== undefined && bass !== undefined) {
      return makeSpelledChord(root, slashSpec, bass);
    }
  }
  const spec = suffixSpec(rest);
  return spec === undefined ? undefined : makeSpelledChord(root, spec);
}

/**
 * Parse a lead-sheet chord symbol into a {@link Chord}.
 *
 * Accepts `<root><quality>[/<bass>]`, e.g. `Cmaj7`, `F#m7b5`, `Bb7`, `C/G`,
 * `C6/9`, `C6/9/E`. Root and bass letters are case-insensitive, matching
 * {@link parseNote}. A `/` is ambiguous between a slash bass and the `6/9`
 * quality; the text splits at the last `/` whose right-hand side is a valid
 * bare note preceded by a recognized quality, so `6/9` (with or without a
 * further slash bass) parses as a quality.
 *
 * The root and bass are read in `system`, so a German chart's `H7`, `As7` and
 * `Ges/B` are read by asking for `'german'`. The system is never inferred: with
 * none given the symbol is English, where `B` is the B natural and `H` no note
 * at all. Case carries nothing in a chord symbol — unlike a German key name,
 * where the case of the tonic is the mode — so the quality suffix alone says
 * major or minor. Where a German root's flat suffix could equally open the
 * quality, the longest root that leaves a known quality behind wins: `Asus4` is
 * an A suspended chord and `Assus4` the A flat one.
 *
 * The quality suffix is read structurally when no name covers it, so a chart's
 * bracketed tensions parse as readily as the names do: `Cmaj7(#11)`,
 * `C7(b9,#11)`, `C7(13)`, `Csus4(add9)`, `C-Δ9`, `C6/9(#11)`. A `/` between two
 * figures separates them as it does inside brackets, which is what the sixth
 * and ninth of a `6/9` are. Such a chord carries the tones it names and reports
 * the nearest quality name (see {@link chordSpecQuality}); read
 * {@link chordSpecOf} for its structure.
 *
 * The parsed chord carries the root/bass spellings as enharmonic hints
 * (`rootSpelling`/`bassSpelling`) so {@link formatChordSymbol} can reproduce
 * flat spellings such as `Bbmaj7` instead of respelling them with sharps.
 *
 * @param text The chord symbol text.
 * @param opts `system` reads the root and bass in that notation system instead
 *   of English.
 * @returns The parsed chord.
 * @throws If the root or quality is not recognized in that system. Use
 *   {@link tryParseChordSymbol} where failure is ordinary, such as a chord
 *   field read on every keystroke.
 * @example
 * ```ts
 * import { parseChordSymbol, formatChordSymbol } from '@libraz/libcantus';
 * const c = parseChordSymbol('Bbmaj7');
 * formatChordSymbol(c); // 'Bbmaj7' — flat spelling is preserved on round-trip
 * parseChordSymbol('H7', { system: 'german' }).rootPc; // 11 — the B natural
 * parseChordSymbol('B', { system: 'german' }).rootPc; // 10 — the German B flat
 * ```
 * @category Chords
 */
export function parseChordSymbol(text: string, opts?: NoteNameOptions): Chord {
  return unwrapParse(tryParseChordSymbol(text, opts));
}

/**
 * Parse a lead-sheet chord symbol, reporting failure instead of throwing it.
 *
 * The same reading as {@link parseChordSymbol} — that function is this one with
 * its error thrown — for the callers where a symbol that does not parse yet is
 * the normal state of the input rather than a fault: a chord field says what is
 * wrong with what has been typed so far, and does not need a `try` around every
 * keystroke to do it.
 *
 * @param text The chord symbol text.
 * @param opts `system` reads the root and bass in that notation system instead
 *   of English.
 * @returns The chord, or the error explaining why the text is not one.
 * @example
 * ```ts
 * import { tryParseChordSymbol } from '@libraz/libcantus';
 * const result = tryParseChordSymbol('Cmaj7(#11)');
 * result.ok ? result.value.intervals : result.error.message;
 * ```
 * @category Chords
 */
export function tryParseChordSymbol(text: string, opts?: NoteNameOptions): ParseResult<Chord> {
  try {
    if (typeof text !== 'string') {
      throw new InvalidInputError(`chord symbol must be a string; received ${typeof text}`);
    }
    const system = opts?.system ?? DEFAULT_SYSTEM;
    const trimmed = text
      .trim()
      .replaceAll('♯', '#')
      .replaceAll('♭', 'b')
      .replaceAll('𝄪', 'x')
      .replaceAll('𝄫', 'bb')
      // Both delta glyphs in circulation stand for the same major seventh.
      .replaceAll('∆', 'Δ');
    const splits = rootSplits(trimmed, system);
    if (splits.length === 0) {
      throw new InvalidInputError(`Invalid chord symbol: ${describeRejected(text)}`);
    }
    for (const { root, rest } of splits) {
      const chord = chordAfterRoot(root, rest, system);
      if (chord !== undefined) {
        return { ok: true, value: chord };
      }
    }
    throw new InvalidInputError(`Unrecognized chord quality: ${describeRejected(text)}`);
  } catch (error) {
    return parseFailure(error);
  }
}

/**
 * Anything that names a chord: a chord symbol, plain chord data, or a value
 * that serializes to chord data such as the `Chord` class.
 *
 * @category Chords
 */
export type ChordLike =
  | string
  | Chord
  | {
      /** The chord data this value stands for. */
      toJSON(): Chord;
    };

/** Validate plain chord data and return it in the canonical shape. */
function normalizedChord(data: Chord): Chord {
  if (!Array.isArray(data.intervals)) {
    throw new InvalidInputError('chord.intervals must be an array of semitone offsets');
  }
  const copy: Chord = {
    rootPc: pitchClass(assertFiniteNumber(data.rootPc, 'chord.rootPc')),
    quality: data.quality,
    // Each offset is checked rather than copied blind: a chord holding a NaN
    // interval voices, spells and formats as a chord that looks real, and the
    // failure surfaces wherever the number is finally used.
    intervals: data.intervals.map((interval, index) =>
      assertFiniteNumber(interval, `chord.intervals[${index}]`),
    ),
  };
  if (data.bassPc !== undefined) {
    copy.bassPc = pitchClass(assertFiniteNumber(data.bassPc, 'chord.bassPc'));
  }
  // Spelling hints are carried through untouched. They are the caller's record
  // of how the chord is written, and deriving or discarding one here would
  // overrule a decision made where the key was known.
  if (data.rootSpelling !== undefined) {
    copy.rootSpelling = data.rootSpelling;
  }
  if (data.bassSpelling !== undefined) {
    copy.bassSpelling = data.bassSpelling;
  }
  if (data.toneSpellings !== undefined) {
    copy.toneSpellings = data.toneSpellings;
  }
  return copy;
}

/**
 * Resolve any chord-shaped value to plain {@link Chord} data.
 *
 * The counterpart of {@link toSpelledInterval} for chords: an entry point takes
 * whatever form the caller has — the symbol a chart holds, the data the chord
 * module returns, or a `Chord` instance — and gets one shape back. An instance
 * is accepted through its `toJSON` method rather than by its type, so the
 * layers below the model can read a class without importing it.
 *
 * @param value A chord symbol, plain chord data, or a value whose `toJSON`
 *   returns chord data.
 * @returns The validated chord data, with root and bass reduced to pitch
 *   classes and any spelling hint carried through.
 * @throws If the value names no chord, or an interval, root, or bass is not a
 *   finite number.
 * @example
 * ```ts
 * import { toChordData } from '@libraz/libcantus';
 * toChordData('Cmaj7').intervals; // [0, 4, 7, 11]
 * toChordData({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] }).rootPc; // 0
 * ```
 * @category Chords
 */
export function toChordData(value: ChordLike): Chord {
  if (typeof value === 'string') {
    return parseChordSymbol(value);
  }
  if (typeof value === 'object' && value !== null) {
    const data = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : value;
    return normalizedChord(data as Chord);
  }
  throw new InvalidInputError(
    `chord must be a chord symbol or chord data; received ${typeof value}`,
  );
}

/**
 * A root or bass written the way a chord symbol writes it.
 *
 * German note names are lowercase, but a German chord symbol capitalizes its
 * root — `Es`, `Fis`, `H7` — and leaves the quality suffix to say major or
 * minor. Since case means nothing here, reading ignores it and writing settles
 * on the capitalized form charts use. Every other system writes its name as the
 * naming layer does.
 */
function symbolName(note: Note, system: NoteNameSystem): string {
  const name = formatNote(note, { system });
  return system === 'german' ? `${name.slice(0, 1).toUpperCase()}${name.slice(1)}` : name;
}

/**
 * Name a pitch class, preferring a spelling hint when it is still valid.
 *
 * A hint is used only when no explicit sharp/flat preference was given and the
 * hint still resolves to `pc` (a stale hint left over after transposition is
 * ignored). Otherwise the pitch class is respelled from the requested table,
 * falling back to `inheritFlats` so an unhinted slash bass follows the side its
 * root was spelled on rather than flipping to sharps inside one symbol.
 */
function pitchClassName(
  pc: number,
  hint: PitchSpelling | undefined,
  system: NoteNameSystem,
  flats?: boolean,
  inheritFlats?: boolean,
): string {
  if (flats === undefined && hint !== undefined && noteToPitchClass(hint) === pc) {
    return symbolName(hint, system);
  }
  const note = midiToNote(60 + pc, (flats ?? inheritFlats) ? 'flat' : 'sharp');
  return symbolName({ letter: note.letter, alter: note.alter }, system);
}

/**
 * Whether a spelling is written on the side of the staff the caller asked for.
 *
 * A natural sits on both sides, so it never forces a respelling; with no
 * preference given every spelling qualifies.
 */
function onAccidentalSide(spelling: PitchSpelling, flats: boolean | undefined): boolean {
  return flats === undefined || spelling.alter === 0 || spelling.alter < 0 === flats;
}

/**
 * Move a spelling by the step that carries `from` to `to`.
 *
 * This is the one step a whole symbol moves by, whether it is being transposed
 * or respelled onto the other side of the staff: taking the bass and the tones
 * through it is what keeps them inside the chord the root names.
 */
function bySameStep(
  spelling: PitchSpelling,
  from: PitchSpelling,
  to: PitchSpelling,
): PitchSpelling {
  return bareSpelling(transposeByInterval(spelling, spelledInterval(from, to)));
}

/** A spelling hint, or undefined when it no longer names `pc`. */
function hintFor(hint: PitchSpelling | undefined, pc: number): PitchSpelling | undefined {
  return hint !== undefined && noteToPitchClass(hint) === pc ? hint : undefined;
}

/**
 * The spelling a symbol writes its root in.
 *
 * A hint is kept when it still names the root and already sits on the side the
 * caller asked for; otherwise the pitch class is named from that side's table.
 */
function rootSpellingFor(
  pc: number,
  hint: PitchSpelling | undefined,
  flats: boolean | undefined,
): PitchSpelling {
  return hint !== undefined && onAccidentalSide(hint, flats)
    ? hint
    : bareSpelling(midiToNote(60 + pc, flats ? 'flat' : 'sharp'));
}

/**
 * The named chords a symbol can write as its core, with the spec each stands
 * for.
 *
 * A core carries no tension of its own beyond the ones a chart writes into the
 * name itself — the unaltered ninth of an `m9`, the flattened fifth of a `7b5`
 * — so what is left over is written as figures rather than swallowed by a name
 * that does not say it.
 */
const CORE_CANDIDATES: readonly (readonly [ChordQuality, ChordSpec])[] = chordQualities()
  .map((quality) => [quality, chordSpecForQuality(quality, 0)] as const)
  .filter(([, spec]) => spec.alterations.every(({ degree, alter }) => degree === 5 || alter === 0));

/** Whether `part` is one of the alterations `spec` carries. */
function carriesAlteration(spec: ChordSpec, part: Alteration): boolean {
  return spec.alterations.some(
    ({ degree, alter }) => degree === part.degree && alter === part.alter,
  );
}

/**
 * The largest named chord a spec can be written as before its figures.
 *
 * Every part of the name must be a part of the chord: same base and seventh,
 * and no alteration, addition or omission the chord does not have. The largest
 * such name is the core, which is what makes a minor ninth with a raised
 * eleventh `Cm9(#11)` rather than `Cm7(9,#11)`.
 */
function coreQuality(spec: ChordSpec): ChordQuality | undefined {
  let core: ChordQuality | undefined;
  let named = -1;
  for (const [quality, candidate] of CORE_CANDIDATES) {
    const size = candidate.alterations.length + candidate.additions.length;
    if (
      size <= named ||
      candidate.base !== spec.base ||
      candidate.seventh !== spec.seventh ||
      !candidate.alterations.every((part) => carriesAlteration(spec, part)) ||
      !candidate.additions.every((degree) => spec.additions.includes(degree)) ||
      !candidate.omissions.every((degree) => spec.omissions.includes(degree))
    ) {
      continue;
    }
    core = quality;
    named = size;
  }
  return core;
}

/** How each base opens a suffix that no quality name covers. */
const BASE_SUFFIX: Record<ChordBase, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  power: '5',
};

/** How each seventh is written where it opens a suffix of its own. */
const SEVENTH_SUFFIX: Record<ChordSeventh, string> = { maj7: 'maj7', min7: '7', dim7: 'dim7' };

/**
 * The major seventh written after a base letter, which has taken the word's
 * place: `mMaj7` and `augMaj7` capitalize where a bare `maj7` cannot, since the
 * letter before it would otherwise read as the start of the word.
 */
const MAJOR_SEVENTH_AFTER_BASE = 'Maj7';

/**
 * A core no quality name covers, written from its parts.
 *
 * A suspension carries its seventh in front of it the way a chart writes
 * `7sus4`, and a major base writes the seventh alone, since `maj` says nothing
 * a bare root does not. Both of those put the seventh at the front of the
 * suffix, where it is the lowercase word a chart writes — `maj7sus4`, not a
 * capitalized form that reads as a base letter.
 */
function builtCoreSuffix(spec: ChordSpec): string {
  const base = BASE_SUFFIX[spec.base];
  if (spec.seventh === undefined) {
    return base;
  }
  const seventh = SEVENTH_SUFFIX[spec.seventh];
  if (spec.base === 'sus2' || spec.base === 'sus4') {
    return `${seventh}${base}`;
  }
  if (spec.base === 'maj') {
    return seventh;
  }
  return `${base}${spec.seventh === 'maj7' ? MAJOR_SEVENTH_AFTER_BASE : seventh}`;
}

/**
 * The figures a symbol writes after its core, in degree order.
 *
 * Whatever the core already names is left out of them, and so is an omitted
 * tone: a symbol names the harmony a player reads, and one that spelled out its
 * own omissions would not read as a chart's.
 */
function figureText(spec: ChordSpec, core: ChordSpec | undefined): string[] {
  const figures: { degree: number; text: string }[] = [];
  for (const alteration of spec.alterations) {
    if (core !== undefined && carriesAlteration(core, alteration)) {
      continue;
    }
    const { degree, alter } = alteration;
    figures.push({ degree, text: `${alter < 0 ? 'b' : alter > 0 ? '#' : ''}${degree}` });
  }
  for (const degree of spec.additions) {
    if (core?.additions.includes(degree) !== true) {
      figures.push({ degree, text: `add${degree}` });
    }
  }
  return figures.sort((a, b) => a.degree - b.degree).map(({ text }) => text);
}

/**
 * The suffix a chord's structure is written as.
 *
 * A spec a quality name covers is written under that name, so every symbol a
 * chart already uses is unchanged. Anything else is written as the largest name
 * that fits inside it followed by the figures it does not cover — the way a
 * lead sheet writes tensions — so a combination no name covers still writes
 * itself out, and reads back as the same tones bar the ones it omits, which
 * {@link figureText} leaves unwritten.
 */
function specSuffix(spec: ChordSpec): string {
  const named = exactChordSpecQuality(spec);
  if (named !== undefined) {
    return CANONICAL_SUFFIX[named];
  }
  const core = coreQuality(spec);
  const coreSpec = core === undefined ? undefined : chordSpecForQuality(core, 0);
  const text = core === undefined ? builtCoreSuffix(spec) : CANONICAL_SUFFIX[core];
  const figures = figureText(spec, coreSpec);
  return figures.length === 0 ? text : `${text}(${figures.join(',')})`;
}

/**
 * How a chord symbol is written: in which notation system, and on which side of
 * the enharmonic fence.
 *
 * @category Chords
 */
export type ChordSymbolOptions = NoteNameOptions & {
  /**
   * Which side of the staff the whole symbol is written on: `true` writes it in
   * flats, `false` in sharps. The root, the slash bass and the chord's tones are
   * spelled together, so a symbol never pairs a flat root with a sharp bass, and
   * a spelling hint already on the requested side is kept rather than renamed.
   * Where that side cannot spell the chord at all, the spelling a chart writes
   * wins over an unwritable one.
   */
  flats?: boolean;
};

/**
 * Format a {@link Chord} as a lead-sheet chord symbol.
 *
 * The inverse of {@link parseChordSymbol} in every notation system: each
 * quality maps to one canonical suffix spelling, the root and bass are written
 * in `system`, and a slash bass is appended only when it differs from the root.
 * Every symbol written here reads back through {@link parseChordSymbol} as the
 * same root, sounding bass and tones apart from the degrees the chord omits —
 * whatever combination of tensions it carries, and whether or not a quality
 * name covers it. Those omissions are the one difference the round trip has: a
 * chord that leaves a degree out is written without saying so, so reading the
 * symbol back puts the degree in.
 * When the chord carries `rootSpelling`/`bassSpelling` hints (as chords from
 * {@link parseChordSymbol} do) and no explicit `flats` preference is given, the
 * hints are reused so flat symbols round-trip unchanged.
 *
 * The suffix is written from the chord's own tones (see {@link chordSpecOf}),
 * not from its quality name, so a chord carrying alterations no name covers is
 * written out in full — `C7(b9,#11)` — rather than under the nearest name. A
 * tone the chord leaves out is not written: the symbol names the harmony, so a
 * fifth-less dominant is still `C7`.
 *
 * @param chord The chord to format, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param opts `system` writes the root and bass in that notation system instead
 *   of English; `flats` chooses the side of the staff the whole symbol is
 *   written on, as {@link ChordSymbolOptions} describes.
 * @returns The chord symbol text.
 * @example
 * ```ts
 * import { makeChord, formatChordSymbol, parseChordSymbol } from '@libraz/libcantus';
 * formatChordSymbol(makeChord(0, 'min7')); // 'Cm7'
 * formatChordSymbol(parseChordSymbol('Bb7'), { system: 'german' }); // 'B7'
 * formatChordSymbol(parseChordSymbol('B7'), { system: 'german' }); // 'H7'
 * ```
 * @category Chords
 */
export function formatChordSymbol(chord: ChordLike, opts?: ChordSymbolOptions): string {
  // A chord rebuilt from JSON or arrived at through arithmetic can carry a
  // non-finite root or a quality this module has no suffix for; formatting
  // those produces 'C' and 'Cundefined', which read as real symbols.
  const data = toChordData(chord);
  if (!Object.hasOwn(CANONICAL_SUFFIX, data.quality)) {
    throw new InvalidInputError(`Unknown chord quality: ${String(data.quality)}`);
  }
  const system = opts?.system ?? DEFAULT_SYSTEM;
  const flats = opts?.flats;
  const rootPc = pitchClass(data.rootPc);
  const rootHint = hintFor(data.rootSpelling, rootPc);
  const rootSpelling = rootSpellingFor(rootPc, rootHint, flats);
  const suffix = specSuffix(chordSpecOf(data));
  let symbol = `${symbolName(rootSpelling, system)}${suffix}`;
  if (data.bassPc !== undefined && pitchClass(data.bassPc) !== rootPc) {
    const bassPc = pitchClass(data.bassPc);
    const bassHint = hintFor(data.bassSpelling, bassPc);
    // Respelling the root respells the bass with it: the two are one symbol, so
    // a preference that moves the root to the flat side takes the bass there
    // too rather than leaving a sharp bass under a flat root.
    const bassName =
      rootHint !== undefined && bassHint !== undefined
        ? symbolName(bySameStep(bassHint, rootHint, rootSpelling), system)
        : pitchClassName(bassPc, bassHint, system, flats, rootSpelling.alter < 0);
    symbol += `/${bassName}`;
  }
  return symbol;
}

/**
 * The spellings a caller attaches to a chord, which transposition carries with
 * it: the root, the slash bass, and one per chord tone.
 */
export type ChordSpellings = {
  /** How the root is written. */
  rootSpelling?: PitchSpelling;
  /** How the slash bass is written. */
  bassSpelling?: PitchSpelling;
  /** How each chord tone is written. */
  toneSpellings?: PitchSpelling[];
};

/** Drop the octave from a transposed note, leaving the spelling alone. */
function bareSpelling(note: Note): PitchSpelling {
  return { letter: note.letter, alter: note.alter };
}

/**
 * Whether a spelling is one a chart writes for a root or a slash bass.
 *
 * The vocabulary is exactly what {@link pitchClassName} draws from with no hint
 * to follow: a natural or a single accidental, and never the accidental that
 * merely renames a natural letter — no C flat, F flat, B sharp or E sharp root,
 * and no double accidental at all.
 */
function isWrittenSpelling(spelling: PitchSpelling): boolean {
  const written = midiToNote(
    60 + noteToPitchClass(spelling),
    spelling.alter < 0 ? 'flat' : 'sharp',
  );
  return written.letter === spelling.letter && written.alter === spelling.alter;
}

/**
 * Move a chord's spellings by a semitone count, keeping them writable.
 *
 * Moving a spelling by letter is what keeps B flat and A sharp apart, but
 * carried far enough it lands on a root no chart writes: B flat up a semitone
 * spells C flat, D flat up one spells E double flat. Where that happens the
 * spelling falls back to the plain name of the pitch class, taken on the
 * accidental side already in force — an explicit preference first, then the
 * side the moved root reads on, then the root's own, then the bass's — so one
 * symbol never pairs a sharp root with a flat bass. The same fallback catches a
 * root whose own letters would leave the bass unwritable, so `Cmaj7/B` up a
 * tritone is `Gbmaj7/F` rather than an F# chord over a bass spelled E#. The
 * bass and the tones then
 * follow the root's own step rather than the semitone count, so respelling the
 * root respells the chord with it and the letter distances inside the chord
 * survive: `Bb7/D` up a semitone is `B7/D#`, the third of the chord it names,
 * and never `B7/Eb`, a note B7 does not contain.
 *
 * A transposition by whole octaves returns every letter to itself and is left
 * alone: a chart that writes C flat keeps it.
 *
 * @param spellings The chord's spellings.
 * @param semitones The signed semitone offset.
 * @param flats Writes the whole symbol on the flat or the sharp side: the root
 *   is chosen so that the bass carried with it lands there too.
 * @returns The moved spellings, carrying only the ones that were given.
 */
export function transposeChordSpellings(
  spellings: ChordSpellings,
  semitones: number,
  flats?: boolean,
): ChordSpellings {
  const byLetter = (spelling: PitchSpelling | undefined): PitchSpelling | undefined =>
    spelling === undefined ? undefined : bareSpelling(transposeNote(spelling, semitones));
  const movedRoot = byLetter(spellings.rootSpelling);
  const movedBass = byLetter(spellings.bassSpelling);
  const side = [movedRoot, spellings.rootSpelling, movedBass, spellings.bassSpelling].find(
    (spelling) => spelling !== undefined && spelling.alter !== 0,
  );
  const preferFlats = flats ?? (side !== undefined && side.alter < 0);
  const octaveOnly = pitchClass(semitones) === 0;
  const plainName = (spelling: PitchSpelling, asFlat: boolean): PitchSpelling =>
    bareSpelling(midiToNote(60 + noteToPitchClass(spelling), asFlat ? 'flat' : 'sharp'));
  const writable = (spelling: PitchSpelling): PitchSpelling =>
    octaveOnly || isWrittenSpelling(spelling) ? spelling : plainName(spelling, preferFlats);
  const root = spellings.rootSpelling;
  const bass = spellings.bassSpelling;
  // Whether a candidate root leaves a bass the chart can still write, on the
  // side the caller asked for. A bass that already reads as an odd name is no
  // test of the root, but one that reads plainly must stay that way, so a chord
  // whose sharp root would need E# under it is written on the flat side.
  const carriesBass = (candidate: PitchSpelling): boolean => {
    if (root === undefined || bass === undefined || octaveOnly || !isWrittenSpelling(bass)) {
      return true;
    }
    const carried = bySameStep(bass, root, candidate);
    return isWrittenSpelling(carried) && onAccidentalSide(carried, flats);
  };
  const moved: ChordSpellings = {};
  if (movedRoot !== undefined) {
    // The root is chosen for the symbol as a whole: the letter it moves to
    // first, then the plain name of its pitch class on the side in force, then
    // the other side. A caller who named a side is offered one more reading
    // before the symbol turns around — the letters' own spelling, odd as it may
    // be — because `Cb/Gb` is the flat side of that chord and `B/Gb` is not a
    // chord at all. Without a named side the written vocabulary wins.
    const asked = flats !== undefined && !octaveOnly && !isWrittenSpelling(movedRoot);
    const candidates = [
      ...(octaveOnly || isWrittenSpelling(movedRoot) ? [movedRoot] : []),
      plainName(movedRoot, preferFlats),
      ...(asked ? [movedRoot] : []),
      plainName(movedRoot, !preferFlats),
    ];
    moved.rootSpelling = candidates.find(carriesBass) ?? plainName(movedRoot, preferFlats);
  }
  // The one step the whole chord moves by: from the root as written to the root
  // as it comes out, fallback included. Everything below it takes this same step
  // instead of the semitone count, which is what keeps the bass and the tones
  // inside the chord the root names.
  const step =
    root !== undefined && moved.rootSpelling !== undefined
      ? spelledInterval(root, moved.rootSpelling)
      : undefined;
  const byStep = (spelling: PitchSpelling): PitchSpelling =>
    bareSpelling(
      step === undefined ? transposeNote(spelling, semitones) : transposeByInterval(spelling, step),
    );
  if (bass !== undefined) {
    moved.bassSpelling = writable(byStep(bass));
  }
  if (spellings.toneSpellings !== undefined) {
    moved.toneSpellings = spellings.toneSpellings.map(byStep);
  }
  return moved;
}

/**
 * Transpose a chord symbol by a number of semitones.
 *
 * The symbol is read in the same system it is written back in, so a German
 * chart stays German across the transposition.
 *
 * The root and the bass are respelled where moving them by letter would leave
 * a name no chart writes, so raising a flat chart a semitone gives `Bmaj7`
 * rather than `Cbmaj7`. Pass `flats` to write the whole symbol on one side of
 * the staff, root and bass together.
 *
 * @param text The chord symbol text.
 * @param semitones Signed semitone offset to apply to the root and bass.
 * @param opts Options for reading and writing the symbol; see
 *   {@link ChordSymbolOptions}.
 * @returns The transposed chord symbol text.
 * @throws If `text` does not parse as a chord symbol.
 * @example
 * ```ts
 * import { transposeChordSymbol } from '@libraz/libcantus';
 * transposeChordSymbol('C/G', 2); // 'D/A'
 * transposeChordSymbol('H7', 1, { system: 'german' }); // 'C7'
 * ```
 * @category Chords
 */
export function transposeChordSymbol(
  text: string,
  semitones: number,
  opts?: ChordSymbolOptions,
): string {
  assertFiniteSemitones(semitones);
  const chord = parseChordSymbol(text, opts);
  const transposed: Chord = { ...chord, rootPc: pitchClass(chord.rootPc + semitones) };
  if (chord.bassPc !== undefined) {
    transposed.bassPc = pitchClass(chord.bassPc + semitones);
  }
  const spellings = transposeChordSpellings(chord, semitones, opts?.flats);
  if (spellings.rootSpelling !== undefined) {
    transposed.rootSpelling = spellings.rootSpelling;
  }
  if (spellings.bassSpelling !== undefined) {
    transposed.bassSpelling = spellings.bassSpelling;
  }
  if (spellings.toneSpellings !== undefined) {
    transposed.toneSpellings = spellings.toneSpellings;
  }
  return formatChordSymbol(transposed, opts);
}
