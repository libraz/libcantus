/**
 * Roman-numeral parsing and formatting.
 *
 * The {@link ROMAN_STYLE} table is the single source of truth for both
 * directions, so {@link chordToRoman} and {@link romanToChord} stay mutual
 * inverses by construction.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import { isScaleTone, majorKey, scaleTonesInDegreeOrder } from '../../theory/scale/index.js';
import {
  degreeRootPc,
  isAppliedDominantSonority,
  loweredDegrees,
  mod12,
  romanReference,
} from './internal.js';

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
  minMaj9: { lower: true, suffix: 'maj9' },
  minMaj11: { lower: true, suffix: 'maj11' },
  minMaj13: { lower: true, suffix: 'maj13' },
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
  '7sus4': { lower: false, suffix: '7sus4' },
  '7b5': { lower: false, suffix: '7b5' },
  '7alt': { lower: false, suffix: '7alt' },
  '13b9': { lower: false, suffix: '13b9' },
  maj13: { lower: false, suffix: 'maj13' },
  'maj7#11': { lower: false, suffix: 'maj7#11' },
  min11: { lower: true, suffix: '11' },
  min13: { lower: true, suffix: '13' },
  minAdd9: { lower: true, suffix: 'add9' },
  'min6/9': { lower: true, suffix: '69' },
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
    throw new InvalidInputError(`Invalid Roman numeral: ${text}`);
  }
  const glyphText = match[2] ?? '';
  if (glyphText !== glyphText.toUpperCase() && glyphText !== glyphText.toLowerCase()) {
    throw new InvalidInputError(`Roman numeral must use one case: ${text}`);
  }
  const accidental = match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0;
  const glyph = glyphText.toUpperCase();
  const degreeNumber = ROMAN_TO_DEGREE[glyph];
  if (degreeNumber === undefined) {
    throw new InvalidInputError(`Invalid Roman numeral: ${text}`);
  }
  const isUpper = glyphText[0] === glyphText[0]?.toUpperCase();
  const suffix = match[3] ?? '';
  // Degrees are read in the key's heptatonic frame, so a numeral means the same
  // root in both directions even when the key itself is not heptatonic.
  const frame = romanReference(key);
  // A flat on a degree the mode already lowers is that degree, not a further
  // lowering: `bVII` in A minor is G, the pop reading, rather than F#.
  const redundantFlat = accidental === -1 && loweredDegrees(frame).has(degreeNumber);
  const diatonicRootPc = mod12(
    degreeRootPc(degreeNumber, frame) + (redundantFlat ? 0 : accidental),
  );

  // In a minor key, an unaltered diminished seventh-degree numeral conventionally
  // denotes the harmonic-minor leading tone: `viio` in A minor is G#, not G.
  // An explicit accidental remains literal, so callers can still write `#viio`
  // (or `bviio`) when that distinction is meaningful to them.
  const rootForQuality = (quality: ChordQuality): number =>
    accidental === 0 &&
    degreeNumber === 7 &&
    loweredDegrees(frame).has(7) &&
    (quality === 'dim' || quality === 'dim7')
      ? mod12(diatonicRootPc + 1)
      : diatonicRootPc;

  // Canonical quality suffixes (exact match, case-sensitive on the numeral)
  // come first so every chordToRoman rendering re-parses to the same quality:
  // `V9` -> dom9 but `ii9` -> min9 and `Imaj9` -> maj9, and added-tone suffixes
  // whose digits would otherwise be misread as figured bass (`Iadd6`, `I69`,
  // `Isus2`, `Iadd11`) resolve to their qualities in root position.
  const canonical = SUFFIX_QUALITY.get(`${isUpper ? 'u' : 'l'}:${suffix}`);
  if (canonical !== undefined) {
    return { rootPc: rootForQuality(canonical), quality: canonical, inversion: 0 };
  }

  // Non-canonical spellings are limited to a complete quality marker followed
  // by an optional major-seventh marker and a recognized figured bass. Never
  // search substrings: `Vfoo` must not become diminished merely because it
  // contains an "o", and unknown trailing text must be rejected in full.
  const parsedSuffix = /^(o|°|dim|ø|\+|aug)?(maj7|M7)?(65|64|43|42|7|6|2)?$/.exec(suffix);
  if (!parsedSuffix) {
    throw new InvalidInputError(`Unsupported suffix "${suffix}" in Roman numeral: ${text}`);
  }
  const qualityMarker = parsedSuffix[1] ?? '';
  const isDim = qualityMarker === 'o' || qualityMarker === '°' || qualityMarker === 'dim';
  const isAug = qualityMarker === '+' || qualityMarker === 'aug';
  const isHalfDim = qualityMarker === 'ø';
  const explicitMaj7 = parsedSuffix[2] !== undefined;
  const figures = parsedSuffix[3] ?? '';

  // Reject figure strings that are neither a known figured-bass inversion nor a
  // canonical quality suffix rather than silently degrading to a root triad.
  if (figures !== '' && !INVERSION_FIGURES.has(figures)) {
    throw new InvalidInputError(
      `Unsupported figured-bass or extension "${figures}" in Roman numeral: ${text}`,
    );
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
  return { rootPc: rootForQuality(quality), quality, inversion };
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
  // Accept the conventional slashes in figured bass (`V6/4`, `V6/5`) while
  // retaining `/` as the separator for applied dominants (`V7/V`).
  const trimmed = text.trim().replace(/(\d)\/(?=\d)/g, '$1');
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
  const tones = scaleTonesInDegreeOrder(romanReference(key));
  const diatonic = tones.indexOf(mod12(rootPc));
  if (diatonic >= 0) {
    return { degreeNumber: diatonic + 1, accidental: '' };
  }
  // A chromatic root a semitone above a degree the mode already lowers is that
  // degree raised: C# in A minor is `#III`, not `bIV`.
  const lowered = loweredDegrees(romanReference(key));
  for (let i = 0; i < tones.length; i += 1) {
    if (lowered.has(i + 1) && mod12((tones[i] ?? 0) + 1) === mod12(rootPc)) {
      return { degreeNumber: i + 1, accidental: '#' };
    }
  }
  // Otherwise prefer a flat of the diatonic degree a semitone above it,
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
 * The numeral glyph for a degree number, cased for the chord quality.
 *
 * Only the seven glyphs exist, so a degree outside 1..7 is a contract violation
 * rather than something to paper over with a default numeral.
 */
function numeralFor(degreeNumber: number, lower: boolean): string {
  const glyph = ROMAN[degreeNumber - 1];
  if (glyph === undefined) {
    throw new InvalidInputError(`no Roman numeral for scale degree ${degreeNumber}`);
  }
  return lower ? glyph.toLowerCase() : glyph;
}

/** Whether every pitch class of a chord belongs to the key's scale. */
function isDiatonicChord(chord: Chord, key: KeyScale): boolean {
  return chordPitchClasses(chord).every((pc) => isScaleTone(pc, key));
}

/** Diminished-family qualities, which tonicize from a semitone below. */
const LEADING_TONE_QUALITIES: ReadonlySet<ChordQuality> = new Set(['dim', 'dim7', 'm7b5']);

/** The third and fifth above a scale degree, measured within its own scale. */
function degreeTriad(tones: readonly number[], index: number): { third: number; fifth: number } {
  const root = tones[index] ?? 0;
  return {
    third: mod12((tones[(index + 2) % tones.length] ?? 0) - root),
    fifth: mod12((tones[(index + 4) % tones.length] ?? 0) - root),
  };
}

/**
 * The scale degree a chromatic chord tonicizes, or null when it tonicizes
 * nothing. A dominant sonority points a fifth below itself, a diminished one a
 * semitone above itself; the tonic is never a target (that chord is the key's own
 * dominant) and neither is a degree carrying a diminished triad, which has no
 * fifth to be tonicized.
 */
function appliedTarget(
  chord: Chord,
  key: KeyScale,
): { degreeNumber: number; rootPc: number; lower: boolean } | null {
  const dominant = isAppliedDominantSonority(chord);
  const leadingTone = LEADING_TONE_QUALITIES.has(chord.quality);
  if (!dominant && !leadingTone) {
    return null;
  }
  const tones = scaleTonesInDegreeOrder(romanReference(key));
  for (let index = 1; index < tones.length; index += 1) {
    const targetRoot = tones[index];
    if (targetRoot === undefined) {
      continue;
    }
    const triad = degreeTriad(tones, index);
    const expectedRoot = mod12(targetRoot + (dominant ? 7 : -1));
    if (expectedRoot === mod12(chord.rootPc)) {
      return { degreeNumber: index + 1, rootPc: targetRoot, lower: triad.third === 3 };
    }
  }
  return null;
}

/**
 * Options for {@link chordToRoman}.
 *
 * @category Functional Harmony
 */
export type ChordToRomanOptions = {
  /**
   * Render a tonicizing chord as an applied numeral (`V7/V`, `viio7/ii`)
   * instead of naming its root against the home key (`II7`, `#ivo7`).
   *
   * Off by default: naming the root is always a correct spelling, whereas
   * whether a chromatic dominant is genuinely applied is a reading only the
   * caller can make. Turning it on makes {@link chordToRoman} the exact inverse
   * of {@link romanToChord} for the chords {@link secondaryDominant} builds.
   */
  applied?: boolean;
};

/**
 * Render a chord as a Roman numeral relative to a key.
 *
 * Diatonic roots take their scale-degree numeral directly, so numerals are
 * correct in both major and minor keys (and any custom scale). The quality
 * selects the case and suffix; chromatic roots receive a flat/sharp spelling by
 * convention. A key that is not heptatonic has no numeral of its own for every
 * degree, so its roots are named against its parallel major.
 *
 * When the chord carries a `bassPc` on a chord tone, a figured-bass inversion
 * (`6`, `64`, `65`, `43`, `42`) is emitted for plain triads and true seventh
 * chords; added-tone and extended qualities have no lossless figure and render
 * in root position instead (the bass is dropped, pitch classes are preserved).
 *
 * A `bassPc` that is *not* a chord tone — a pedal or passing bass such as
 * `C/D` — is likewise dropped, and the numeral names the upper chord alone.
 * Roman-numeral notation spends its slash on applied chords (`V7/V`), so there
 * is no unambiguous way to write such a bass; a caller that must keep it should
 * read `chord.bassPc` alongside the numeral.
 *
 * @param chord The chord to name.
 * @param key The prevailing key.
 * @param opts `applied` renders tonicizing chords as `V7/V`-style numerals.
 * @returns The Roman numeral string.
 * @example
 * ```ts
 * import { chordToRoman, makeChord, majorKey } from '@libraz/libcantus';
 * chordToRoman(makeChord(7, 'dom7'), majorKey(0)); // => 'V7' (G7 in C major)
 * chordToRoman(makeChord(2, 'dom7'), majorKey(0), { applied: true }); // => 'V7/V'
 * ```
 * @category Functional Harmony
 */
export function chordToRoman(chord: Chord, key: KeyScale, opts: ChordToRomanOptions = {}): string {
  if (opts.applied === true && !isDiatonicChord(chord, key)) {
    const target = appliedTarget(chord, key);
    if (target !== null) {
      const local = chordToRoman(chord, majorKey(target.rootPc));
      return `${local}/${numeralFor(target.degreeNumber, target.lower)}`;
    }
  }
  const { degreeNumber, accidental: spelledAccidental } = romanSpelling(chord.rootPc, key);
  const { lower, suffix } = romanStyle(chord.quality);
  const cased = numeralFor(degreeNumber, lower);
  // Render the conventional unaltered `viio`/`viio7` for the raised leading
  // tone in a minor key. Keeping the parser and formatter aligned makes the
  // common harmonic-minor progression a true round trip.
  const accidental =
    spelledAccidental === '#' &&
    degreeNumber === 7 &&
    loweredDegrees(romanReference(key)).has(7) &&
    (chord.quality === 'dim' || chord.quality === 'dim7')
      ? ''
      : spelledAccidental;

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
