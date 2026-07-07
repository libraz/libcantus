/**
 * Lead-sheet chord symbol parsing and formatting.
 *
 * Bridges the informal `<root><quality>[/<bass>]` notation musicians write
 * (`Cmaj7`, `F#m7b5`, `Bb7`, `C/G`) and the library's structured {@link Chord}
 * type, so callers can accept/emit plain text at the edges of the API.
 */
import { type Chord, type ChordQuality, makeChord, type PitchSpelling } from '../chord/index.js';
import { formatNote, midiToNote, type Note, noteToPitchClass, parseNote } from '../pitch/index.js';

/**
 * Matches a chord root: a letter A-G (case-insensitive, like {@link parseNote})
 * with an optional single-direction accidental.
 */
const ROOT_RE = /^[A-Ga-g](?:#{1,2}|b{1,2})?/;

/** Matches a bare note usable as a slash-chord bass (no octave). */
const BASS_RE = /^[A-Ga-g](?:#{1,2}|b{1,2})?$/;

/** Recognized quality suffixes, keyed by their exact lead-sheet spelling. */
const QUALITY_MAP: Record<string, ChordQuality> = {
  '': 'maj',
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
};

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
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
 * Parse a lead-sheet chord symbol into a {@link Chord}.
 *
 * Accepts `<root><quality>[/<bass>]`, e.g. `Cmaj7`, `F#m7b5`, `Bb7`, `C/G`,
 * `C6/9`, `C6/9/E`. Root and bass letters are case-insensitive, matching
 * {@link parseNote}. A `/` is ambiguous between a slash bass and the `6/9`
 * quality; the text splits at the last `/` whose right-hand side is a valid
 * bare note preceded by a recognized quality, so `6/9` (with or without a
 * further slash bass) parses as a quality.
 *
 * The parsed chord carries the root/bass spellings as enharmonic hints
 * (`rootSpelling`/`bassSpelling`) so {@link formatChordSymbol} can reproduce
 * flat spellings such as `Bbmaj7` instead of respelling them with sharps.
 *
 * @param text The chord symbol text.
 * @returns The parsed chord.
 * @throws If the root or quality is not recognized.
 * @example
 * ```ts
 * import { parseChordSymbol, formatChordSymbol } from '@libraz/libcantus';
 * const c = parseChordSymbol('Bbmaj7');
 * formatChordSymbol(c); // 'Bbmaj7' — flat spelling is preserved on round-trip
 * ```
 * @category Chords
 */
export function parseChordSymbol(text: string): Chord {
  const trimmed = text.trim();
  const rootMatch = ROOT_RE.exec(trimmed);
  if (!rootMatch) {
    throw new Error(`Invalid chord symbol: ${text}`);
  }
  const rootToken = rootMatch[0];
  const rootNote = parseNote(rootToken);
  const rest = trimmed.slice(rootToken.length);

  // Split at the last '/' so the '6/9' quality's own slash never masks a
  // trailing slash bass (e.g. 'C6/9/E').
  const slashIndex = rest.lastIndexOf('/');
  if (slashIndex !== -1) {
    const before = rest.slice(0, slashIndex);
    const after = rest.slice(slashIndex + 1);
    const beforeQuality = QUALITY_MAP[before];
    if (beforeQuality !== undefined && BASS_RE.test(after)) {
      return makeSpelledChord(rootNote, beforeQuality, parseNote(after));
    }
  }

  const quality = QUALITY_MAP[rest];
  if (quality === undefined) {
    throw new Error(`Unrecognized chord quality: ${text}`);
  }
  return makeSpelledChord(rootNote, quality);
}

/**
 * Name a pitch class, preferring a spelling hint when it is still valid.
 *
 * A hint is used only when no explicit sharp/flat preference was given and the
 * hint still resolves to `pc` (a stale hint left over after transposition is
 * ignored). Otherwise the pitch class is respelled from the requested table.
 */
function pitchClassName(pc: number, hint: PitchSpelling | undefined, flats?: boolean): string {
  if (flats === undefined && hint !== undefined && noteToPitchClass(hint) === pc) {
    return formatNote(hint);
  }
  const note = midiToNote(60 + pc, flats ? 'flat' : 'sharp');
  return formatNote({ letter: note.letter, alter: note.alter });
}

/**
 * Format a {@link Chord} as a lead-sheet chord symbol.
 *
 * The inverse of {@link parseChordSymbol}: each quality maps to one canonical
 * suffix spelling, and a slash bass is appended only when it differs from the
 * root. When the chord carries `rootSpelling`/`bassSpelling` hints (as chords
 * from {@link parseChordSymbol} do) and no explicit `flats` preference is
 * given, the hints are reused so flat symbols round-trip unchanged.
 *
 * @param chord The chord to format.
 * @param opts Formatting options.
 * @param opts.flats Prefer flat spellings over sharps for altered roots/basses;
 *   passing either `true` or `false` overrides any spelling hints.
 * @returns The chord symbol text.
 * @example
 * ```ts
 * import { makeChord, formatChordSymbol } from '@libraz/libcantus';
 * formatChordSymbol(makeChord(0, 'min7')); // 'Cm7'
 * ```
 * @category Chords
 */
export function formatChordSymbol(chord: Chord, opts?: { flats?: boolean }): string {
  const rootPc = pitchClass(chord.rootPc);
  const rootName = pitchClassName(rootPc, chord.rootSpelling, opts?.flats);
  const suffix = CANONICAL_SUFFIX[chord.quality];
  let symbol = `${rootName}${suffix}`;
  if (chord.bassPc !== undefined && pitchClass(chord.bassPc) !== rootPc) {
    symbol += `/${pitchClassName(pitchClass(chord.bassPc), chord.bassSpelling, opts?.flats)}`;
  }
  return symbol;
}

/**
 * Transpose a chord symbol by a number of semitones.
 *
 * @param text The chord symbol text.
 * @param semitones Signed semitone offset to apply to the root and bass.
 * @param opts Formatting options for the result; see {@link formatChordSymbol}.
 * @returns The transposed chord symbol text.
 * @throws If `text` does not parse as a chord symbol.
 * @example
 * ```ts
 * import { transposeChordSymbol } from '@libraz/libcantus';
 * transposeChordSymbol('C/G', 2); // 'D/A'
 * ```
 * @category Chords
 */
export function transposeChordSymbol(
  text: string,
  semitones: number,
  opts?: { flats?: boolean },
): string {
  const chord = parseChordSymbol(text);
  const transposed: Chord = { ...chord, rootPc: pitchClass(chord.rootPc + semitones) };
  if (chord.bassPc !== undefined) {
    transposed.bassPc = pitchClass(chord.bassPc + semitones);
  }
  return formatChordSymbol(transposed, opts);
}
