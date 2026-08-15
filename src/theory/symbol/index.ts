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

import { InvalidInputError } from '../../core/errors/index.js';
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
} from '../../core/pitch/index.js';
import { assertFiniteNumber, assertFiniteSemitones } from '../../core/validation/index.js';
import { type Chord, type ChordQuality, makeChord, type PitchSpelling } from '../chord/index.js';

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
 * The quality a suffix names, or undefined when it names none.
 *
 * The own-property check is what stops `'constructor'` and `'toString'` from
 * resolving through `Object.prototype` and reaching the chord builder with a
 * quality it has no interval template for.
 */
function knownQuality(suffix: string): ChordQuality | undefined {
  return Object.hasOwn(QUALITY_MAP, suffix) ? QUALITY_MAP[suffix] : undefined;
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
  let note: Note;
  try {
    note = parseNote(text, { system });
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return undefined;
    }
    throw error;
  }
  return note.octave === undefined ? note : undefined;
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
function makeSpelledChord(root: Note, quality: ChordQuality, bass?: Note): Chord {
  const chord = makeChord(
    noteToPitchClass(root),
    quality,
    bass === undefined ? undefined : noteToPitchClass(bass),
  );
  chord.rootSpelling = { letter: root.letter, alter: root.alter };
  if (bass !== undefined) {
    chord.bassSpelling = { letter: bass.letter, alter: bass.alter };
  }
  return chord;
}

/**
 * The chord a root and the text after it name, or undefined when that text
 * names no quality this module knows.
 */
function chordAfterRoot(root: Note, rest: string, system: NoteNameSystem): Chord | undefined {
  // Split at the last '/' so the '6/9' quality's own slash never masks a
  // trailing slash bass (e.g. 'C6/9/E').
  const slashIndex = rest.lastIndexOf('/');
  if (slashIndex !== -1) {
    const slashQuality = knownQuality(rest.slice(0, slashIndex));
    const bass =
      slashQuality === undefined ? undefined : bassNote(rest.slice(slashIndex + 1), system);
    if (slashQuality !== undefined && bass !== undefined) {
      return makeSpelledChord(root, slashQuality, bass);
    }
  }
  const quality = knownQuality(rest);
  return quality === undefined ? undefined : makeSpelledChord(root, quality);
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
 * The parsed chord carries the root/bass spellings as enharmonic hints
 * (`rootSpelling`/`bassSpelling`) so {@link formatChordSymbol} can reproduce
 * flat spellings such as `Bbmaj7` instead of respelling them with sharps.
 *
 * @param text The chord symbol text.
 * @param opts `system` reads the root and bass in that notation system instead
 *   of English.
 * @returns The parsed chord.
 * @throws If the root or quality is not recognized in that system.
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
  const system = opts?.system ?? DEFAULT_SYSTEM;
  const trimmed = text
    .trim()
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .replaceAll('𝄪', 'x')
    .replaceAll('𝄫', 'bb');
  const splits = rootSplits(trimmed, system);
  if (splits.length === 0) {
    throw new InvalidInputError(`Invalid chord symbol: ${text}`);
  }
  for (const { root, rest } of splits) {
    const chord = chordAfterRoot(root, rest, system);
    if (chord !== undefined) {
      return chord;
    }
  }
  throw new InvalidInputError(`Unrecognized chord quality: ${text}`);
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
  const suffix = CANONICAL_SUFFIX[chord.quality];
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
