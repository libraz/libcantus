import {
  formatNote,
  type Note,
  type NoteNameSystem,
  noteToPitchClass,
  parseNote,
  tryParseNote,
} from '../../core/pitch/index.js';
import { maxNoteNameLength } from '../../core/pitch/naming.js';
import type {
  Alteration,
  AlteredDegree,
  Chord,
  ChordBase,
  ChordQuality,
  ChordSeventh,
  ChordSpec,
} from '../chord/index.js';
import { chordFromSpec } from '../chord/index.js';
import { chordSpecForQuality } from '../chord/spec.js';

/**
 * What a chord symbol is allowed to say, and how it is read.
 *
 * The reading side of the unit, kept apart from the writing side because the
 * two are not mirror images: a symbol is read far more loosely than it is
 * written. `-7`, `m7` and `min7` all read as a minor seventh; exactly one of
 * them is written, and that choice lives in `suffix.ts`.
 */

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
export const DEFAULT_SYSTEM: NoteNameSystem = 'english';

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
export function rootSplits(text: string, system: NoteNameSystem): RootSplit[] {
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
export function chordAfterRoot(
  root: Note,
  rest: string,
  system: NoteNameSystem,
): Chord | undefined {
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
