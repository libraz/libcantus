/**
 * Functional harmony: Roman-numeral parsing and formatting, harmonic function
 * (tonic / subdominant / dominant), and cadence detection.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { Chord, ChordQuality } from '../chord/index.js';
import { chordPitchClasses, makeChord } from '../chord/index.js';
import {
  HARMONIC_MINOR_MASK,
  isScaleTone,
  MAJOR_MASK,
  majorKey,
  NATURAL_MINOR_MASK,
  scaleTonesInDegreeOrder,
} from '../scale/index.js';
import type { KeyScale } from '../types.js';

/**
 * The three broad harmonic functions of tonal music.
 *
 * @category Functional Harmony
 */
export type HarmonicFunction = 'tonic' | 'subdominant' | 'dominant';

/**
 * A recognized cadence type, or null when a chord pair forms none.
 *
 * @category Functional Harmony
 */
export type Cadence = 'authentic' | 'plagal' | 'half' | 'deceptive' | null;

/** Roman numeral glyphs indexed by degree number - 1. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** Roman glyph -> degree number (1..7). */
const ROMAN_TO_DEGREE: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
};

/** Major-key Roman spelling for each semitone offset above the tonic. */
const OFFSET_SPELLING: readonly [number, string][] = [
  [1, ''],
  [2, 'b'],
  [2, ''],
  [3, 'b'],
  [3, ''],
  [4, ''],
  [4, '#'],
  [5, ''],
  [6, 'b'],
  [6, ''],
  [7, 'b'],
  [7, ''],
];

/** Harmonic function of each semitone offset above the tonic (major context). */
const FUNCTION_BY_OFFSET: readonly HarmonicFunction[] = [
  'tonic', // 0  I
  'subdominant', // 1  bII (Neapolitan)
  'subdominant', // 2  ii
  'tonic', // 3  bIII
  'tonic', // 4  iii
  'subdominant', // 5  IV
  'dominant', // 6  #IV / bV
  'dominant', // 7  V
  'subdominant', // 8  bVI
  'tonic', // 9  vi
  'subdominant', // 10 bVII
  'dominant', // 11 vii
];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/**
 * Whether a key's scale has a minor third and no major third (a minor key).
 *
 * @category Functional Harmony
 */
export function isMinorKey(key: KeyScale): boolean {
  const hasMinorThird = (key.modeMask12 >> 3) & 1;
  const hasMajorThird = (key.modeMask12 >> 4) & 1;
  return Boolean(hasMinorThird) && !hasMajorThird;
}

/** Diatonic pitch class of a 1-based scale degree in a key. */
function degreeRootPc(degreeNumber: number, key: KeyScale): number {
  const tones = scaleTonesInDegreeOrder(key);
  if (tones.length === 0) {
    return mod12(key.rootPc);
  }
  return tones[(degreeNumber - 1) % tones.length] ?? mod12(key.rootPc);
}

/** Choose a seventh-chord quality from a triad label and the numeral case. */
function seventhQuality(base: 'maj' | 'min' | 'dim' | 'aug', halfDim: boolean): ChordQuality {
  if (halfDim) {
    return 'm7b5';
  }
  if (base === 'dim') {
    return 'dim7';
  }
  if (base === 'aug') {
    return 'aug7';
  }
  return base === 'maj' ? 'dom7' : 'min7';
}

/** Figure strings that denote a recognized figured-bass inversion. */
const INVERSION_FIGURES = new Set(['6', '64', '65', '43', '42', '2', '7']);

/**
 * Canonical Roman-numeral rendering (numeral case and quality suffix) for every
 * supported chord quality. The table is the single source of truth for both
 * directions: {@link chordToRoman} renders from it and {@link romanToChord}
 * recognizes its exact case-sensitive suffixes, so the two stay mutual
 * inverses by construction. Suffixes are chosen to never collide with
 * figured-bass inversion digits (`6`, `64`, `65`, `43`, `42`, `2`) — the added
 * sixth is `add6`, the six-nine chord is `69` — and each (case, suffix) pair is
 * unique.
 */
const ROMAN_STYLE: Record<ChordQuality, { lower: boolean; suffix: string }> = {
  maj: { lower: false, suffix: '' },
  min: { lower: true, suffix: '' },
  dim: { lower: true, suffix: 'o' },
  aug: { lower: false, suffix: '+' },
  maj7: { lower: false, suffix: 'maj7' },
  min7: { lower: true, suffix: '7' },
  dom7: { lower: false, suffix: '7' },
  dim7: { lower: true, suffix: 'o7' },
  m7b5: { lower: true, suffix: 'ø7' },
  minMaj7: { lower: true, suffix: 'maj7' },
  aug7: { lower: false, suffix: '+7' },
  augMaj7: { lower: false, suffix: '+maj7' },
  majb5: { lower: false, suffix: 'b5' },
  '6': { lower: false, suffix: 'add6' },
  min6: { lower: true, suffix: 'add6' },
  '6/9': { lower: false, suffix: '69' },
  sus2: { lower: false, suffix: 'sus2' },
  sus4: { lower: false, suffix: 'sus4' },
  add9: { lower: false, suffix: 'add9' },
  add11: { lower: false, suffix: 'add11' },
  maj9: { lower: false, suffix: 'maj9' },
  min9: { lower: true, suffix: '9' },
  dom9: { lower: false, suffix: '9' },
  '7b9': { lower: false, suffix: '7b9' },
  '7#9': { lower: false, suffix: '7#9' },
  '7#11': { lower: false, suffix: '7#11' },
  '7b13': { lower: false, suffix: '7b13' },
  '11': { lower: false, suffix: '11' },
  '13': { lower: false, suffix: '13' },
  '5': { lower: false, suffix: '5' },
};

/** Reverse lookup of {@link ROMAN_STYLE}: `(case, exact suffix) -> quality`. */
const SUFFIX_QUALITY: ReadonlyMap<string, ChordQuality> = new Map(
  (Object.entries(ROMAN_STYLE) as [ChordQuality, { lower: boolean; suffix: string }][]).map(
    ([quality, style]) => [`${style.lower ? 'l' : 'u'}:${style.suffix}`, quality],
  ),
);

/** Read figured-bass digits into a chord inversion and whether a seventh is implied. */
function parseInversion(figures: string): { inversion: number; seventh: boolean } {
  if (figures === '65') {
    return { inversion: 1, seventh: true };
  }
  if (figures === '43') {
    return { inversion: 2, seventh: true };
  }
  if (figures === '42' || figures === '2') {
    return { inversion: 3, seventh: true };
  }
  if (figures === '7') {
    return { inversion: 0, seventh: true };
  }
  if (figures === '64') {
    return { inversion: 2, seventh: false };
  }
  if (figures === '6') {
    return { inversion: 1, seventh: false };
  }
  return { inversion: 0, seventh: false };
}

/** Parse a Roman numeral (no secondary '/') into a root, quality, and inversion. */
function parseSimpleRoman(
  text: string,
  key: KeyScale,
): { rootPc: number; quality: ChordQuality; inversion: number } {
  const match = /^([b#]?)([iIvV]+)(.*)$/.exec(text.trim());
  if (!match) {
    throw new Error(`Invalid Roman numeral: ${text}`);
  }
  const accidental = match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0;
  const glyph = (match[2] ?? '').toUpperCase();
  const degreeNumber = ROMAN_TO_DEGREE[glyph];
  if (degreeNumber === undefined) {
    throw new Error(`Invalid Roman numeral: ${text}`);
  }
  const isUpper = (match[2] ?? '')[0] === (match[2] ?? '')[0]?.toUpperCase();
  const suffix = match[3] ?? '';
  const rootPc = mod12(degreeRootPc(degreeNumber, key) + accidental);

  // Canonical quality suffixes (exact match, case-sensitive on the numeral)
  // come first so every chordToRoman rendering re-parses to the same quality:
  // `V9` -> dom9 but `ii9` -> min9 and `Imaj9` -> maj9, and added-tone suffixes
  // whose digits would otherwise be misread as figured bass (`Iadd6`, `I69`,
  // `Isus2`, `Iadd11`) resolve to their qualities in root position.
  const canonical = SUFFIX_QUALITY.get(`${isUpper ? 'u' : 'l'}:${suffix}`);
  if (canonical !== undefined) {
    return { rootPc, quality: canonical, inversion: 0 };
  }

  const isDim = /o|°|dim/.test(suffix);
  const isAug = /\+|aug/.test(suffix);
  const isHalfDim = /ø/.test(suffix);
  const explicitMaj7 = /maj7|M7/.test(suffix);
  const figures = suffix.replace(/maj7|M7/g, '').replace(/[^0-9]/g, '');

  // Reject figure strings that are neither a known figured-bass inversion nor a
  // canonical quality suffix rather than silently degrading to a root triad.
  if (figures !== '' && !INVERSION_FIGURES.has(figures)) {
    throw new Error(`Unsupported figured-bass or extension "${figures}" in Roman numeral: ${text}`);
  }

  const { inversion, seventh } = parseInversion(figures);
  // The ø glyph is the half-diminished seventh by definition (there is no
  // half-diminished triad), so it always implies a seventh.
  const hasSeventh = explicitMaj7 || seventh || isHalfDim;

  let base: 'maj' | 'min' | 'dim' | 'aug';
  if (isDim || isHalfDim) {
    base = 'dim';
  } else if (isAug) {
    base = 'aug';
  } else {
    base = isUpper ? 'maj' : 'min';
  }

  let quality: ChordQuality;
  if (explicitMaj7) {
    quality = base === 'min' ? 'minMaj7' : base === 'aug' ? 'augMaj7' : 'maj7';
  } else if (hasSeventh) {
    quality = seventhQuality(base, isHalfDim);
  } else if (base === 'dim') {
    quality = 'dim';
  } else if (base === 'aug') {
    quality = 'aug';
  } else {
    quality = base;
  }
  return { rootPc, quality, inversion };
}

/** Build a chord from a parsed Roman numeral, attaching a bass for inversions. */
function chordFromParsed(parsed: {
  rootPc: number;
  quality: ChordQuality;
  inversion: number;
}): Chord {
  const chord = makeChord(parsed.rootPc, parsed.quality);
  if (parsed.inversion > 0 && parsed.inversion < chord.intervals.length) {
    chord.bassPc = mod12(parsed.rootPc + (chord.intervals[parsed.inversion] ?? 0));
  }
  return chord;
}

/**
 * Build the chord denoted by a Roman numeral in a key.
 *
 * Supports accidentals (`bVII`, `#iv`), case-based triad quality, the `o`/`ø`/`+`
 * suffixes, sevenths (`V7`, `viio7`, `Imaj7`), figured-bass inversions
 * (`V6`, `V64`, `V65`, `V43`, `V42`), and applied/secondary chords via a slash
 * (`V7/V`, `viio/ii`). The target after the slash is read as a scale degree
 * whose root becomes a local major tonic for the applied chord. Inverted chords
 * carry a `bassPc`.
 *
 * The `ø` glyph always denotes the half-diminished seventh (`iiø` == `iiø7` ==
 * `m7b5`), since no half-diminished triad exists. Extension and added-tone
 * suffixes are the canonical case-sensitive forms emitted by
 * {@link chordToRoman} and honor the numeral case: `V9` -> `dom9`, `ii9` ->
 * `min9`, `Imaj9` -> `maj9`, `V11` -> `11`, `V13` -> `13`, `Iadd6`/`iadd6` ->
 * `6`/`min6`, `I69` -> `6/9`, `Isus2`/`Isus4`, `Iadd9`/`Iadd11`, `Ib5` ->
 * `majb5`, `I5` -> `5`, and the altered dominants `V7b9`/`V7#9`/`V7#11`/`V7b13`.
 * A figure string that is neither a recognized inversion nor a supported
 * quality suffix throws rather than silently degrading to a triad.
 *
 * @param text The Roman numeral.
 * @param key The prevailing key.
 * @returns The chord.
 * @example
 * ```ts
 * import { romanToChord, majorKey } from '@libraz/libcantus';
 * romanToChord('V7', majorKey(0)); // G7 in C major: { rootPc: 7, quality: 'dom7', ... }
 * ```
 * @category Functional Harmony
 */
export function romanToChord(text: string, key: KeyScale): Chord {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    const applied = trimmed.slice(0, slash);
    const target = trimmed.slice(slash + 1);
    const targetRoot = parseSimpleRoman(target, key).rootPc;
    const localKey = majorKey(targetRoot);
    return chordFromParsed(parseSimpleRoman(applied, localKey));
  }
  return chordFromParsed(parseSimpleRoman(trimmed, key));
}

/** Case and suffix for rendering a chord quality as a Roman numeral. */
function romanStyle(quality: ChordQuality): { lower: boolean; suffix: string } {
  return ROMAN_STYLE[quality];
}

/** Choose the degree number and accidental to spell a root as a Roman numeral. */
function romanSpelling(
  rootPc: number,
  key: KeyScale,
): { degreeNumber: number; accidental: string } {
  const tones = scaleTonesInDegreeOrder(key);
  const diatonic = tones.indexOf(mod12(rootPc));
  if (diatonic >= 0) {
    return { degreeNumber: diatonic + 1, accidental: '' };
  }
  // Chromatic root: prefer a flat of the diatonic degree a semitone above it,
  // then a sharp of the degree a semitone below. Degree 1 (the tonic) and
  // degree 5 (the dominant) are skipped in the flat pass, so a raised leading
  // tone spells as `#vii` rather than a flat tonic `bI`, and the tritone above
  // the tonic spells as `#iv` rather than a flat fifth `bV` (matching the
  // conventional `OFFSET_SPELLING` for offset 6).
  for (let i = 0; i < tones.length; i += 1) {
    const degreeNumber = i + 1;
    if (degreeNumber === 1 || degreeNumber === 5) {
      continue;
    }
    if (mod12((tones[i] ?? 0) - 1) === mod12(rootPc)) {
      return { degreeNumber, accidental: 'b' };
    }
  }
  for (let i = 0; i < tones.length; i += 1) {
    if (mod12((tones[i] ?? 0) + 1) === mod12(rootPc)) {
      return { degreeNumber: i + 1, accidental: '#' };
    }
  }
  const [degreeNumber, accidental] = OFFSET_SPELLING[mod12(rootPc - key.rootPc)] ?? [1, ''];
  return { degreeNumber, accidental };
}

/** Quality marker (without the seventh digit) used when a figure carries the 7. */
function baseMarker(quality: ChordQuality): string {
  if (quality === 'dim' || quality === 'dim7') {
    return 'o';
  }
  if (quality === 'm7b5') {
    return 'ø';
  }
  if (quality === 'aug' || quality === 'aug7') {
    return '+';
  }
  if (quality === 'augMaj7') {
    return '+maj7';
  }
  if (quality === 'maj7' || quality === 'minMaj7') {
    return 'maj7';
  }
  return '';
}

const TRIAD_FIGURES: Record<number, string> = { 1: '6', 2: '64' };
const SEVENTH_FIGURES: Record<number, string> = { 1: '65', 2: '43', 3: '42' };

/** Qualities whose inversions render as lossless triad figures (6, 64). */
const TRIAD_FIGURE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['maj', 'min', 'dim', 'aug']);

/**
 * Qualities carrying a chordal seventh, whose inversions render as seventh
 * figures (65, 43, 42). Membership is decided by the quality itself — a 7th
 * above the root (10 or 11 semitones, or the diminished 7th of `dim7`) — never
 * by interval count, which would turn added-tone chords into false sevenths.
 */
const SEVENTH_FIGURE_QUALITIES: ReadonlySet<ChordQuality> = new Set([
  'maj7',
  'min7',
  'dom7',
  'dim7',
  'm7b5',
  'minMaj7',
  'aug7',
  'augMaj7',
]);

/**
 * Render a chord as a Roman numeral relative to a key.
 *
 * Diatonic roots take their scale-degree numeral directly, so numerals are
 * correct in both major and minor keys (and any custom scale). The quality
 * selects the case and suffix; chromatic roots receive a flat/sharp spelling by
 * convention. When the chord carries a `bassPc` on a chord tone, a figured-bass
 * inversion (`6`, `64`, `65`, `43`, `42`) is emitted for plain triads and true
 * seventh chords; added-tone and extended qualities have no lossless figure and
 * render in root position instead (the bass is dropped, pitch classes are
 * preserved).
 *
 * @param chord The chord to name.
 * @param key The prevailing key.
 * @returns The Roman numeral string.
 * @example
 * ```ts
 * import { chordToRoman, makeChord, majorKey } from '@libraz/libcantus';
 * chordToRoman(makeChord(7, 'dom7'), majorKey(0)); // => 'V7' (G7 in C major)
 * ```
 * @category Functional Harmony
 */
export function chordToRoman(chord: Chord, key: KeyScale): string {
  const { degreeNumber, accidental } = romanSpelling(chord.rootPc, key);
  const { lower, suffix } = romanStyle(chord.quality);
  const numeral: string = ROMAN[degreeNumber - 1] ?? 'I';
  const cased = lower ? numeral.toLowerCase() : numeral;

  let inversion = 0;
  if (chord.bassPc !== undefined) {
    const idx = chord.intervals.findIndex((iv) => mod12(chord.rootPc + iv) === chord.bassPc);
    if (idx > 0) {
      inversion = idx;
    }
  }
  if (inversion > 0) {
    const figure = SEVENTH_FIGURE_QUALITIES.has(chord.quality)
      ? SEVENTH_FIGURES[inversion]
      : TRIAD_FIGURE_QUALITIES.has(chord.quality)
        ? TRIAD_FIGURES[inversion]
        : undefined;
    if (figure !== undefined) {
      return `${accidental}${cased}${baseMarker(chord.quality)}${figure}`;
    }
    // No lossless figured-bass symbol exists — the quality is an added-tone or
    // extended chord, or the bass falls on a tension beyond the seventh — so
    // fall back to root-position rendering with the quality suffix rather than
    // emitting a figure that would re-parse as a different chord.
  }
  return `${accidental}${cased}${suffix}`;
}

/**
 * The harmonic function of a chord in a key, from its root's offset above the
 * tonic. The mapping follows common-practice major-key function and is a useful
 * approximation in minor and for borrowed chords.
 *
 * @param chord The chord.
 * @param key The prevailing key.
 * @returns The harmonic function.
 * @category Functional Harmony
 */
export function functionOf(chord: Chord, key: KeyScale): HarmonicFunction {
  return FUNCTION_BY_OFFSET[mod12(chord.rootPc - key.rootPc)] ?? 'tonic';
}

/**
 * The origin of a recognized non-diatonic chord, or null when none applies.
 *
 * @category Functional Harmony
 */
export type BorrowedSource = 'parallel-minor' | 'parallel-major' | 'neapolitan' | null;

/**
 * The result of {@link analyzeChord}: function, borrowing, and Roman numeral.
 *
 * @category Functional Harmony
 */
export type ChordAnalysis = {
  function: HarmonicFunction;
  borrowed: boolean;
  source: BorrowedSource;
  roman: string;
};

/**
 * Whether every pitch class of a chord belongs to the key's scale.
 *
 * The test is strict against the key's own mode mask: in a natural-minor key
 * the harmonic-minor dominant (major V) is *not* diatonic, since the raised
 * leading tone lies outside the mask. Borrowing predicates treat that case as
 * an in-key alteration separately (see {@link isBorrowedChord}).
 *
 * @param chord The chord to test.
 * @param key The prevailing key.
 * @returns True if all chord pitch classes are scale tones.
 * @category Functional Harmony
 */
export function isDiatonic(chord: Chord, key: KeyScale): boolean {
  return chordPitchClasses(chord).every((pc) => isScaleTone(pc, key));
}

/**
 * The parallel key: same tonic, opposite mode.
 *
 * A key with a minor third (natural/harmonic/melodic minor, dorian, phrygian)
 * maps to the parallel major; any other key maps to the parallel natural minor.
 *
 * @param key The key to mirror.
 * @returns The parallel major or natural-minor key on the same tonic.
 * @category Functional Harmony
 */
export function parallelKey(key: KeyScale): KeyScale {
  return {
    rootPc: mod12(key.rootPc),
    modeMask12: isMinorKey(key) ? MAJOR_MASK : NATURAL_MINOR_MASK,
  };
}

/**
 * In a minor key, whether a non-diatonic chord is explained by the harmonic
 * minor scale on the same tonic (major V, V7, the raised-leading-tone viio).
 * Such chords are in-key chromatic alterations, not modal interchange.
 */
function isHarmonicMinorAlteration(chord: Chord, key: KeyScale): boolean {
  return (
    isMinorKey(key) &&
    isDiatonic(chord, { rootPc: mod12(key.rootPc), modeMask12: HARMONIC_MINOR_MASK })
  );
}

/** Whether a chord is the Neapolitan: a major triad on the flat second degree. */
function isNeapolitan(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 1 && chord.quality === 'maj';
}

/**
 * Whether a chord is borrowed from the parallel mode (modal interchange).
 *
 * True when the chord is not diatonic to `key` but is diatonic to its
 * {@link parallelKey} — e.g. iv, bVI, or bVII in a major key, or the Picardy
 * tonic and major IV in a minor key. Two non-diatonic families are excluded:
 * chords diatonic to neither mode (they are chromatic, not borrowed), and, in
 * a minor key, chords explained by the harmonic minor scale (the major
 * dominant and raised-leading-tone chords), which are in-key alterations
 * rather than interchange even though they happen to fit the parallel major.
 *
 * @param chord The chord to test.
 * @param key The prevailing key.
 * @returns True if the chord is borrowed from the parallel mode.
 * @category Functional Harmony
 */
export function isBorrowedChord(chord: Chord, key: KeyScale): boolean {
  if (isDiatonic(chord, key)) {
    return false;
  }
  if (isHarmonicMinorAlteration(chord, key)) {
    return false;
  }
  return isDiatonic(chord, parallelKey(key));
}

/**
 * Identify where a non-diatonic chord comes from.
 *
 * The Neapolitan (major triad on b2) is recognized first, since it sits
 * outside both parallel modes; parallel-mode borrowing follows the
 * {@link isBorrowedChord} rules. Diatonic chords, harmonic-minor alterations,
 * and unrecognized chromatic chords all yield null.
 *
 * @param chord The chord to classify.
 * @param key The prevailing key.
 * @returns The borrowing source, or null.
 * @category Functional Harmony
 */
export function borrowedSource(chord: Chord, key: KeyScale): BorrowedSource {
  if (isDiatonic(chord, key)) {
    return null;
  }
  if (isNeapolitan(chord, key)) {
    return 'neapolitan';
  }
  if (isBorrowedChord(chord, key)) {
    return isMinorKey(key) ? 'parallel-major' : 'parallel-minor';
  }
  return null;
}

/** Diminished-family qualities: diminished triad, dim7, half-diminished. */
function isDiminishedQuality(quality: ChordQuality): boolean {
  return quality === 'dim' || quality === 'dim7' || quality === 'm7b5';
}

/** Whether the chord's interval template carries a major third above the root. */
function hasMajorThird(chord: Chord): boolean {
  return chord.intervals.some((interval) => mod12(interval) === 4);
}

/**
 * Quality-aware harmonic function, refining the offset table where chord
 * quality disambiguates: diminished chords on the leading tone or the raised
 * subdominant resolve by semitone and act as dominants; the Neapolitan and the
 * major-third chords on bVI/bVII borrowed from the parallel minor act as
 * subdominant (predominant) harmony. All other chords keep {@link functionOf}.
 */
function qualityAwareFunction(chord: Chord, key: KeyScale): HarmonicFunction {
  const offset = mod12(chord.rootPc - key.rootPc);
  if (isDiminishedQuality(chord.quality) && (offset === 11 || offset === 6)) {
    return 'dominant';
  }
  if (isNeapolitan(chord, key)) {
    return 'subdominant';
  }
  if (!isMinorKey(key) && hasMajorThird(chord) && (offset === 8 || offset === 10)) {
    return 'subdominant';
  }
  return functionOf(chord, key);
}

/**
 * Analyze a chord in a key: harmonic function, borrowing, and Roman numeral.
 *
 * The function is quality-aware (see the predicates behind it), the source
 * follows {@link borrowedSource}, and the numeral comes from
 * {@link chordToRoman}. `borrowed` is true whenever a source is identified —
 * including the Neapolitan, which the stricter parallel-mode predicate
 * {@link isBorrowedChord} does not count.
 *
 * @param chord The chord to analyze.
 * @param key The prevailing key.
 * @returns The chord analysis.
 * @example
 * ```ts
 * import { analyzeChord, makeChord, majorKey } from '@libraz/libcantus';
 * analyzeChord(makeChord(7, 'dom7'), majorKey(0));
 * // { function: 'dominant', borrowed: false, source: null, roman: 'V7' }
 * ```
 * @category Functional Harmony
 */
export function analyzeChord(chord: Chord, key: KeyScale): ChordAnalysis {
  const source = borrowedSource(chord, key);
  return {
    function: qualityAwareFunction(chord, key),
    borrowed: source !== null,
    source,
    roman: chordToRoman(chord, key),
  };
}

/**
 * Classify the cadence formed by moving from one chord to the next.
 *
 * - authentic: V (dominant a fifth above the tonic) to I
 * - plagal: IV (a fourth above the tonic) to I
 * - deceptive: V to the submediant (diatonic vi or borrowed bVI in major, VI in
 *   minor)
 * - half: any chord other than the dominant itself to V
 *
 * A static V-to-V repeat with no root motion is not a cadence and yields null.
 *
 * @param from The penultimate chord.
 * @param to The final chord.
 * @param key The prevailing key.
 * @returns The cadence type, or null.
 * @example
 * ```ts
 * import { detectCadence, makeChord, majorKey } from '@libraz/libcantus';
 * detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0)); // => 'authentic'
 * ```
 * @category Functional Harmony
 */
export function detectCadence(from: Chord, to: Chord, key: KeyScale): Cadence {
  const tonic = mod12(key.rootPc);
  const fromOffset = mod12(from.rootPc - tonic);
  const toOffset = mod12(to.rootPc - tonic);
  // Deceptive targets: the diatonic submediant (vi at offset 9 in major, VI at
  // offset 8 in minor) plus, in a major key, the borrowed flat-submediant bVI
  // at offset 8.
  const deceptiveTargets = isMinorKey(key) ? [8] : [8, 9];
  if (fromOffset === 7 && toOffset === 0) {
    return 'authentic';
  }
  if (fromOffset === 5 && toOffset === 0) {
    return 'plagal';
  }
  if (fromOffset === 7 && deceptiveTargets.includes(toOffset)) {
    return 'deceptive';
  }
  // A move to the dominant is a half cadence, but a no-root-motion V-to-V repeat
  // is not a cadence at all.
  if (toOffset === 7 && fromOffset !== 7) {
    return 'half';
  }
  return null;
}

/**
 * The secondary dominant (V7) that tonicizes a scale degree.
 *
 * @param targetDegree 0-based scale degree to tonicize.
 * @param key The prevailing key.
 * @returns A dominant-seventh chord a fifth above the target's root.
 * @category Functional Harmony
 */
export function secondaryDominant(targetDegree: number, key: KeyScale): Chord {
  const targetRoot = degreeRootPc(targetDegree + 1, key);
  return makeChord(mod12(targetRoot + 7), 'dom7');
}
