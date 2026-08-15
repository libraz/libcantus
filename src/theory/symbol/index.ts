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
  transposeNote,
  tryParseNote,
} from '../../core/pitch/index.js';
import { assertFiniteNumber, assertFiniteSemitones } from '../../core/validation/index.js';
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
  alterations: Map<AlteredDegree, -1 | 0 | 1>;
  additions: Set<number>;
  omissions: Set<number>;
  /** Whether a `maj`/`M`/`Δ` marker has already claimed the seventh. */
  major: boolean;
};

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
 */
function stackTo(draft: SpecDraft, top: number): void {
  if (top === 6) {
    draft.additions.add(6);
    return;
  }
  draft.seventh = draft.major ? 'maj7' : draft.base === 'dim' ? 'dim7' : 'min7';
  if (top >= 9) {
    draft.alterations.set(9, 0);
  }
  if (top === 11) {
    draft.alterations.set(11, 0);
  }
  if (top === 13) {
    draft.alterations.set(13, 0);
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
    draft.alterations.set(9, 1);
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
  draft.alterations.set(degree.value, accidental?.value ?? 0);
  return degree.next;
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

/**
 * Read a quality suffix as a chord, or undefined when it is not one.
 *
 * The suffix is read structurally — a base, a marker, an extension number, then
 * any number of figures written bare or in brackets — so a combination of
 * tensions no quality name covers is read as readily as one that has a name.
 * Returning undefined rather than throwing is what lets the caller keep trying
 * shorter roots when a system writes its accidental as an affix.
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
  const draft: SpecDraft = {
    base: 'maj',
    alterations: new Map(),
    additions: new Set(),
    omissions: new Set(),
    major: false,
  };
  let at = 0;
  const opening = matchToken(core, at, BASE_TOKENS);
  let markerGlyph = false;
  let markerAfterBase = false;
  if (opening !== undefined) {
    at = opening.next;
    if (opening.value === 'major') {
      draft.major = true;
      markerGlyph = core.startsWith('Δ') || core.startsWith('^');
    } else {
      draft.base = opening.value;
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
    alterations: [...draft.alterations].map(([degree, alter]) => ({ degree, alter })),
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
 * A chord — so every prefix is offered and the caller keeps the longest one
 * whose remainder it recognizes as a quality.
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
  for (let end = text.length; end > 0; end -= 1) {
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
 * `C7(b9,#11)`, `C7(13)`, `Csus4(add9)`, `C-Δ9`. Such a chord carries the tones
 * it names and reports the nearest quality name (see {@link chordSpecQuality});
 * read {@link chordSpecOf} for its structure.
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
      throw new InvalidInputError(`Invalid chord symbol: ${text}`);
    }
    for (const { root, rest } of splits) {
      const chord = chordAfterRoot(root, rest, system);
      if (chord !== undefined) {
        return { ok: true, value: chord };
      }
    }
    throw new InvalidInputError(`Unrecognized chord quality: ${text}`);
  } catch (error) {
    return parseFailure(error);
  }
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

/** How each seventh is written after a base that is not itself major. */
const SEVENTH_SUFFIX: Record<ChordSeventh, string> = { maj7: 'Maj7', min7: '7', dim7: 'dim7' };

/**
 * A core no quality name covers, written from its parts.
 *
 * A suspension carries its seventh in front of it the way a chart writes
 * `7sus4`, and a major base writes the seventh alone, since `maj` says nothing
 * a bare root does not.
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
    return seventh === 'Maj7' ? 'maj7' : seventh;
  }
  return `${base}${seventh}`;
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
 * itself out, and reads back.
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
   * Prefer flat spellings over sharps for an altered root or bass; passing
   * either `true` or `false` overrides any spelling hint the chord carries.
   */
  flats?: boolean;
};

/**
 * Format a {@link Chord} as a lead-sheet chord symbol.
 *
 * The inverse of {@link parseChordSymbol} in every notation system: each
 * quality maps to one canonical suffix spelling, the root and bass are written
 * in `system`, and a slash bass is appended only when it differs from the root.
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
 * @param chord The chord to format.
 * @param opts `system` writes the root and bass in that notation system instead
 *   of English; `flats` overrides the spelling hints, as
 *   {@link ChordSymbolOptions} describes.
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
export function formatChordSymbol(chord: Chord, opts?: ChordSymbolOptions): string {
  // A chord rebuilt from JSON or arrived at through arithmetic can carry a
  // non-finite root or a quality this module has no suffix for; formatting
  // those produces 'C' and 'Cundefined', which read as real symbols.
  assertFiniteNumber(chord.rootPc, 'chord rootPc');
  if (chord.bassPc !== undefined) {
    assertFiniteNumber(chord.bassPc, 'chord bassPc');
  }
  if (!Object.hasOwn(CANONICAL_SUFFIX, chord.quality)) {
    throw new InvalidInputError(`Unknown chord quality: ${String(chord.quality)}`);
  }
  const system = opts?.system ?? DEFAULT_SYSTEM;
  const rootPc = pitchClass(chord.rootPc);
  const rootHint = chord.rootSpelling;
  const rootName = pitchClassName(rootPc, rootHint, system, opts?.flats);
  const suffix = specSuffix(chordSpecOf(chord));
  let symbol = `${rootName}${suffix}`;
  if (chord.bassPc !== undefined && pitchClass(chord.bassPc) !== rootPc) {
    const inheritFlats =
      rootHint !== undefined && noteToPitchClass(rootHint) === rootPc
        ? rootHint.alter < 0
        : undefined;
    const bassPc = pitchClass(chord.bassPc);
    symbol += `/${pitchClassName(bassPc, chord.bassSpelling, system, opts?.flats, inheritFlats)}`;
  }
  return symbol;
}

/**
 * Transpose a chord symbol by a number of semitones.
 *
 * The symbol is read in the same system it is written back in, so a German
 * chart stays German across the transposition.
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
  if (chord.rootSpelling !== undefined) {
    const hint = transposeNote(chord.rootSpelling, semitones);
    transposed.rootSpelling = { letter: hint.letter, alter: hint.alter };
  }
  if (chord.bassPc !== undefined) {
    transposed.bassPc = pitchClass(chord.bassPc + semitones);
  }
  if (chord.bassSpelling !== undefined) {
    const hint = transposeNote(chord.bassSpelling, semitones);
    transposed.bassSpelling = { letter: hint.letter, alter: hint.alter };
  }
  return formatChordSymbol(transposed, opts);
}
