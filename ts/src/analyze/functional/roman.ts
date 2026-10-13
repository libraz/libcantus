/**
 * Roman-numeral parsing and formatting.
 *
 * The {@link ROMAN_STYLE} table is the single source of truth for both
 * directions, so {@link chordToRoman} and {@link romanToChord} stay mutual
 * inverses by construction. The chromatic chords no numeral can spell — the
 * augmented sixths, and the Neapolitan under its figured name — are matched as
 * whole symbols beside that table.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertOptions } from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordToneSpellings, makeChord } from '../../theory/chord/index.js';
import {
  type KeyLike,
  majorKey,
  type ResolvedKey,
  resolveKey,
  type SpelledKeyLike,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { spellPitchClass } from '../../theory/spelling/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import { augmentedSixthFromSymbol, augmentedSixthSymbol } from './augmented-sixth.js';
import {
  degreeRootPc,
  isDiatonicChord,
  isNeapolitanChordOf,
  loweredDegrees,
  mod12,
  romanReference,
} from './internal.js';
import type { RejectedCandidate } from './rationale.js';
import {
  appliedTarget,
  LEADING_TONE_QUALITIES,
  type TonicizableDegree,
  tonicizableDegrees,
} from './tonicization.js';

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

  // In a minor key, an unaltered diminished-family seventh-degree numeral
  // conventionally denotes the harmonic-minor leading tone: `viio`, `viio7` and
  // `viiø7` in A minor all stand on G#, not G. An explicit accidental remains
  // literal, so callers can still write `#viio` (or `bviio`) when that
  // distinction is meaningful to them.
  const rootForQuality = (quality: ChordQuality): number =>
    accidental === 0 &&
    degreeNumber === 7 &&
    loweredDegrees(frame).has(7) &&
    LEADING_TONE_QUALITIES.has(quality)
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

/** The conventional figured name for the Neapolitan in first inversion. */
const NEAPOLITAN_SIXTH = 'N6';

/**
 * The chord a whole-token chromatic symbol names, or null when the text is an
 * ordinary numeral.
 *
 * `It6`, `Fr6`, `Ger6` (also written `Ger65`) and `N6` are names rather than
 * numerals: the degree-plus-figure grammar has no way to spell an augmented
 * sixth, and `N6` is a name for a chord that grammar already spells as `bII6`.
 * Both build the same chords their numeral counterparts would, so the two
 * notations stay interchangeable.
 *
 * The key is taken whole rather than as a scale, because an augmented sixth is
 * spelled from the tonic the key is written on: the German sixth of Ab minor is
 * Fb Ab Cb D, and reducing the key here would build the E G# B C## the same
 * pitch classes read as once they have been respelled in G# minor.
 */
function chromaticSymbolChord(text: string, key: ResolvedKey): Chord | null {
  if (text === NEAPOLITAN_SIXTH) {
    // Exactly the chord `bII6` builds: the major triad on b2, third in the bass.
    const rootPc = mod12(key.scale.rootPc + 1);
    return makeChord(rootPc, 'maj', mod12(rootPc + 4));
  }
  return augmentedSixthFromSymbol(text, key);
}

/**
 * The local major key an applied numeral is read in.
 *
 * The degree being tonicized is spelled the way the prevailing key writes that
 * pitch class, so the local key is written on a letter the caller's key would
 * use: `Ger6/V` in Ab minor is built on Eb, not on the D# the bare pitch class
 * would otherwise be named.
 */
function tonicizedKey(targetRoot: number, key: ResolvedKey): ResolvedKey {
  return resolveKey({
    scale: majorKey(targetRoot),
    tonic: spellPitchClass(targetRoot, key.tonic, key.scale),
  });
}

/**
 * The degree an augmented sixth is applied to, or null when the chord is the
 * augmented sixth of no degree at all.
 *
 * The reading is made by building the local key {@link tonicizedKey} builds for
 * the parse direction and asking whether the chord is an augmented sixth there,
 * so the two directions stay each other's inverse by sharing one derivation:
 * whatever `Ger6/V` builds in a key is exactly what is recognized here.
 *
 * The tonic is skipped, for the reason it is no target for an applied dominant
 * either — the augmented sixth of the home key is that key's own chord, which
 * the unconditional reading has already named, and `Ger6/I` is a numeral no
 * harmony text writes.
 *
 * Only a chord carrying its own tone spellings is read this way, which is the
 * one place this reading is stricter than the home-key one. A chord that brings
 * no letters is spelled by stacking thirds, and that stack writes the French
 * sixth correctly by accident, since the French sixth is the one kind that is a
 * genuine stack of thirds over its own root. Over the single lowered submediant
 * of the prevailing key that inference is safe, but there are six candidate
 * degrees here, and half of all `7b5` chords with the fifth in the bass stand on
 * the lowered submediant of one of them — reading those as French sixths would
 * take an altered dominant nobody spelled and call it an exotic chord. A caller
 * holding pitch classes alone makes the reading it means with
 * {@link augmentedSixthFromPitchClasses}, whose chord carries the letters.
 */
function augmentedSixthTarget(chord: Chord, key: ResolvedKey): TonicizableDegree | null {
  if (chordToneSpellings(chord) === undefined) {
    return null;
  }
  for (const degree of tonicizableDegrees(key.scale)) {
    if (degree.degreeNumber === 1) {
      continue;
    }
    if (augmentedSixthSymbol(chord, tonicizedKey(degree.rootPc, key)) !== null) {
      return degree;
    }
  }
  return null;
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
 * Four chromatic chords are named rather than numbered, and are accepted as
 * whole symbols: the augmented sixths `It6`, `Fr6` and `Ger6` (also written
 * `Ger65`), all three on the lowered submediant in the bass, and `N6` for the
 * first-inversion Neapolitan, which builds exactly the chord `bII6` does.
 * Each may be applied to a degree like any other numeral, so `Ger6/V` is the
 * German sixth of the dominant.
 *
 * @param text The Roman numeral.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns The chord.
 * @example
 * ```ts
 * import { romanToChord, majorKey } from '@libraz/libcantus';
 * romanToChord('V7', majorKey(0)); // G7 in C major: { rootPc: 7, quality: 'dom7', ... }
 * romanToChord('Ger6', majorKey(0)); // Ab C Eb F#, bass Ab
 * ```
 * @category Functional Harmony
 */
export function romanToChord(text: string, key: SpelledKeyLike): Chord {
  // The key is kept whole: the chromatic chords named as whole symbols are
  // spelled from its tonic, and a key reduced here would spell them from
  // whichever side of the circle its pitch classes read best as.
  const resolved = resolveKey(key);
  const scale = resolved.scale;
  // Accept the conventional slashes in figured bass (`V6/4`, `V6/5`) while
  // retaining `/` as the separator for applied dominants (`V7/V`).
  const trimmed = text.trim().replace(/(\d)\/(?=\d)/g, '$1');
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    const applied = trimmed.slice(0, slash);
    const target = trimmed.slice(slash + 1);
    const targetRoot = parseSimpleRoman(target, scale).rootPc;
    const localKey = tonicizedKey(targetRoot, resolved);
    return (
      chromaticSymbolChord(applied, localKey) ??
      chordFromParsed(parseSimpleRoman(applied, localKey.scale))
    );
  }
  return (
    chromaticSymbolChord(trimmed, resolved) ?? chordFromParsed(parseSimpleRoman(trimmed, scale))
  );
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

/**
 * The accidental a seventh-degree numeral is written with, which is the one
 * place the spelling is not the literal one.
 *
 * A bare `viio`/`viio7`/`viiø7` conventionally names the raised leading tone in
 * a key whose seventh degree is lowered, so the raised root drops its sharp —
 * and the lowered root, which that numeral therefore no longer names, has to
 * take a flat. Both halves are needed: this is the exact inverse of the reading
 * `parseSimpleRoman` applies, and without the second one the two roots collapse
 * onto a single numeral. The convention covers the whole diminished family, so
 * the half-diminished seventh on the leading tone is not left pointing at a
 * different root than the fully diminished one beside it.
 */
function seventhDegreeAccidental(
  accidental: string,
  degreeNumber: number,
  quality: ChordQuality,
  key: KeyScale,
): string {
  if (
    degreeNumber !== 7 ||
    !LEADING_TONE_QUALITIES.has(quality) ||
    !loweredDegrees(romanReference(key)).has(7)
  ) {
    return accidental;
  }
  if (accidental === '#') {
    return '';
  }
  return accidental === '' ? 'b' : accidental;
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
   * caller can make. Turning it on names the chords {@link secondaryDominant}
   * builds as the applied numerals they are, except in three cases, where the
   * numeral names the root against the home key as it does with this off:
   *
   * - The target degree carries no perfect fifth: nothing tonicizes a
   *   diminished triad, so a chord over the seventh degree of a major key stays
   *   `#IV7` rather than becoming a numeral no harmony text writes.
   * - The target is the tonic, which its own dominant points at: `V7` is the
   *   key's dominant and `V/I` is a numeral no harmony text writes either.
   * - The chord is diatonic to the key, which keeps the function of its degree
   *   rather than tonicizing another. `G7` is `VII7` in A minor and `I7` in C
   *   mixolydian, not `V7/III` and `V7/IV`.
   */
  applied?: boolean;
  /**
   * Render a first-inversion Neapolitan under its figured name `N6` instead of
   * the numeral `bII6`.
   *
   * Off by default, for the opposite reason to `applied`: both spellings name
   * the same chord and `bII6` is already correct, so which one to write is a
   * house-style choice rather than an analysis. `romanToChord` accepts either
   * whatever this is set to. The augmented sixths need no such switch — no
   * numeral spells them at all, so they always render as `It6`, `Fr6`
   * and `Ger6`.
   */
  neapolitan?: boolean;
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
 * A chord sounding one of the augmented sixths over an explicit bass on the
 * lowered submediant renders as `It6`, `Fr6` or `Ger6`, since no numeral names
 * those chords; see {@link augmentedSixthKind} for exactly when that applies.
 * That reading is made against the key as written, because what separates an
 * augmented sixth from the seventh chord it sounds like is its letters: the
 * German sixth of Ab minor is named from the Fb Ab Cb D it is written with, not
 * from the letters those pitch classes take once the key has been respelled as
 * a G# minor.
 *
 * @param chord The chord to name, as a chord symbol, chord data, or a `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @param opts `applied` renders tonicizing chords as `V7/V`-style numerals;
 *   `neapolitan` renders a first-inversion Neapolitan as `N6`.
 * @returns The Roman numeral string.
 * @example
 * ```ts
 * import { chordToRoman, makeChord, majorKey } from '@libraz/libcantus';
 * chordToRoman(makeChord(7, 'dom7'), majorKey(0)); // => 'V7' (G7 in C major)
 * chordToRoman(makeChord(2, 'dom7'), majorKey(0), { applied: true }); // => 'V7/V'
 * ```
 * @see {@link explainRoman} for the same numeral with the reasoning behind it.
 * @category Functional Harmony
 */
export function chordToRoman(
  chord: ChordLike,
  key: KeyLike,
  opts: ChordToRomanOptions = {},
): string {
  return renderRoman(toChordData(chord), key, assertOptions(opts, 'opts')).roman;
}

/**
 * Where a chord's bass ended up in the numeral.
 *
 * `'figured'` is an inversion a figure spells losslessly; the last two are the
 * cases where a bass exists and the numeral cannot carry it, which is what a
 * reader wondering where the slash chord went needs told.
 */
type RomanBass = 'root' | 'figured' | 'unfigurable' | 'foreign';

/**
 * How a numeral was arrived at, as the facts themselves rather than as prose.
 *
 * {@link chordToRoman} is called once per chord by arrangement analysis, so the
 * rendering path carries data and leaves the phrasing to {@link explainRoman};
 * deriving both from one pass is what keeps the explanation from drifting away
 * from the numeral it explains.
 */
type RomanDerivation =
  | { kind: 'augmentedSixth' }
  | { kind: 'applied'; target: string }
  | { kind: 'neapolitan' }
  | {
      kind: 'degree';
      degreeNumber: number;
      /** The accidental the numeral is printed with. */
      accidental: string;
      /**
       * The accidental the root literally stands at above the degree, which is
       * the printed one everywhere except the seventh degree of a key that
       * lowers it. Keeping both is what lets the explanation state where the
       * root actually is instead of reading the display convention back as a
       * fact about the key.
       */
      literalAccidental: string;
      quality: ChordQuality;
      bass: RomanBass;
      figure?: string;
    };

/** Render a chord as a numeral, keeping the facts that decided it. */
export function renderRoman(
  chord: Chord,
  keyLike: KeyLike,
  opts: ChordToRomanOptions,
): { roman: string; derivation: RomanDerivation } {
  // The key is resolved once here and kept whole for the reading that needs its
  // letters. Naming an augmented sixth is that reading: the chord is one only
  // while its tones spell the sixth above the bass, which is a question about
  // the key as written — the German sixth of Ab minor is Fb Ab Cb D, and a key
  // reduced here would measure those letters against a G# minor and answer that
  // the chord is an ordinary VI7.
  const resolved = resolveKey(keyLike);
  const key = resolved.scale;
  // The augmented sixths come first and unconditionally: their pitch classes
  // also spell a dominant seventh or an altered supertonic seventh, but only
  // this reading survives the bass they are standing on.
  const augmented = augmentedSixthSymbol(chord, resolved);
  if (augmented !== null) {
    return { roman: augmented, derivation: { kind: 'augmentedSixth' } };
  }
  if (opts.applied === true) {
    // The augmented sixth of a degree is asked for first, and is not held to the
    // chromatic test the ordinary applied reading is. It has to be asked
    // separately because nothing about where a dominant resolves finds it: the
    // German sixth of the dominant stands a tritone from its target rather than
    // a fifth above it, so the sonority test would hand back a different degree
    // for the same chord. Ordering it first pulls no ordinary chord into the
    // exotic reading, because a chord is an augmented sixth only while its own
    // letters spell that sixth over its bass — the same pitch classes written
    // with a minor seventh on top stay the bIII7 they are.
    const target =
      augmentedSixthTarget(chord, resolved) ??
      (isDiatonicChord(chord, key) ? null : appliedTarget(chord, key));
    if (target !== null) {
      const local = renderRoman(chord, tonicizedKey(target.rootPc, resolved), {}).roman;
      const numeral = numeralFor(target.degreeNumber, target.lower);
      return {
        roman: `${local}/${numeral}`,
        derivation: { kind: 'applied', target: numeral },
      };
    }
  }
  const { degreeNumber, accidental: spelledAccidental } = romanSpelling(chord.rootPc, key);
  const { lower, suffix } = romanStyle(chord.quality);
  const cased = numeralFor(degreeNumber, lower);
  // Render the conventional unaltered `viio`/`viio7` for the raised leading
  // tone in a minor key, and `bviio`/`bviio7` for the subtonic below it.
  // Keeping the parser and formatter aligned makes the common harmonic-minor
  // progression a true round trip.
  const accidental = seventhDegreeAccidental(spelledAccidental, degreeNumber, chord.quality, key);

  let inversion = 0;
  let bass: RomanBass = 'root';
  if (chord.bassPc !== undefined) {
    const idx = chord.intervals.findIndex((iv) => mod12(chord.rootPc + iv) === chord.bassPc);
    if (idx > 0) {
      inversion = idx;
    } else if (idx < 0) {
      bass = 'foreign';
    }
  }
  if (opts.neapolitan === true && inversion === 1 && isNeapolitanChordOf(chord, key)) {
    return { roman: NEAPOLITAN_SIXTH, derivation: { kind: 'neapolitan' } };
  }
  if (inversion > 0) {
    const figure = SEVENTH_FIGURE_QUALITIES.has(chord.quality)
      ? SEVENTH_FIGURES[inversion]
      : TRIAD_FIGURE_QUALITIES.has(chord.quality)
        ? TRIAD_FIGURES[inversion]
        : undefined;
    if (figure !== undefined) {
      return {
        roman: `${accidental}${cased}${baseMarker(chord.quality)}${figure}`,
        derivation: {
          kind: 'degree',
          degreeNumber,
          accidental,
          literalAccidental: spelledAccidental,
          quality: chord.quality,
          bass: 'figured',
          figure,
        },
      };
    }
    // No lossless figured-bass symbol exists — the quality is an added-tone or
    // extended chord, or the bass falls on a tension beyond the seventh — so
    // fall back to root-position rendering with the quality suffix rather than
    // emitting a figure that would re-parse as a different chord.
    bass = 'unfigurable';
  }
  return {
    roman: `${accidental}${cased}${suffix}`,
    derivation: {
      kind: 'degree',
      degreeNumber,
      accidental,
      literalAccidental: spelledAccidental,
      quality: chord.quality,
      bass,
    },
  };
}

/** Ordinal names of the seven scale degrees, indexed by degree number - 1. */
const DEGREE_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'] as const;

/**
 * The phrase naming where a numeral's root came from.
 *
 * The claim is made about the root itself, so it reads the accidental the root
 * literally stands at and not the one the numeral is printed with. The two part
 * company on the seventh degree of a key that lowers it, where the bare numeral
 * is reserved for the raised leading tone; saying the root is chromatic because
 * the numeral wears a flat would state the opposite of where the root is, and
 * would make the same root chromatic or diatonic according to the chord's
 * quality.
 */
function describeDegree(degreeNumber: number, accidental: string, literal: string): string {
  const name = DEGREE_NAMES[degreeNumber - 1] ?? `${degreeNumber}th`;
  if (accidental !== literal) {
    return literal === ''
      ? `the root is the ${name} degree of the key, written with a flat because the bare numeral is reserved by convention for the raised leading tone above it`
      : `the root is the raised leading tone, a semitone above the ${name} degree of the key, which the bare numeral denotes by convention`;
  }
  if (literal === '') {
    return `the root is the ${name} degree of the key`;
  }
  const direction = literal === 'b' ? 'lowered' : 'raised';
  return `the root is chromatic, spelled as the ${name} degree ${direction} a semitone`;
}

/** The phrase naming what became of the chord's bass. */
function describeBass(bass: RomanBass, figure: string | undefined): string {
  switch (bass) {
    case 'root':
      return 'and the chord stands on its own root';
    case 'figured':
      return figure === undefined
        ? 'and the bass is an inversion'
        : `and the bass is an inversion, figured ${figure}`;
    case 'unfigurable':
      return 'and the bass names no lossless figure for this quality, so the numeral is written in root position';
    case 'foreign':
      return 'and the bass is not a chord tone, so the numeral names the upper chord alone';
  }
}

/**
 * The note a tonic six-four carries, which the numeral alone cannot give.
 *
 * `I64` is the right spelling for the chord, and the harmony it names is a
 * question the chords around it answer: standing on the dominant's bass and
 * resolving onto it, the same notes are a double appoggiatura over the dominant
 * rather than a tonic of their own.
 */
const SIX_FOUR_NOTE =
  '; on the dominant bass this chord is heard as a double appoggiatura over the dominant rather than as a tonic of its own, which only the chords around it settle';

/** Build the rationale for a rendered numeral. */
function describeRoman(roman: string, derivation: RomanDerivation): string {
  switch (derivation.kind) {
    case 'augmentedSixth':
      return `${roman}: an augmented sixth, which no numeral spells, standing on the lowered submediant`;
    case 'applied':
      return `${roman}: an applied chord, named in the local key its target degree ${derivation.target} makes a tonic`;
    case 'neapolitan':
      return `${roman}: the first-inversion Neapolitan under its figured name, the chord bII6 also spells`;
    case 'degree': {
      const text = `${roman}: ${describeDegree(derivation.degreeNumber, derivation.accidental, derivation.literalAccidental)}, the case and suffix come from the ${derivation.quality} quality, ${describeBass(derivation.bass, derivation.figure)}`;
      const tonicSixFour =
        derivation.degreeNumber === 1 && derivation.accidental === '' && derivation.figure === '64';
      return tonicSixFour ? `${text}${SIX_FOUR_NOTE}` : text;
    }
  }
}

/**
 * The numerals the options turned down for this chord.
 *
 * Both switches of {@link ChordToRomanOptions} name a spelling the caller could
 * have had instead, so the rival is exactly what the other setting renders —
 * derived by rendering it rather than by describing it, so the two can never
 * disagree. A setting that changes nothing for this chord produces no rival.
 */
export function romanAlternatives(
  chord: Chord,
  key: KeyLike,
  opts: ChordToRomanOptions,
): RejectedCandidate[] {
  const emitted = renderRoman(chord, key, opts).roman;
  const out: RejectedCandidate[] = [];
  const flippedApplied = renderRoman(chord, key, {
    ...opts,
    applied: opts.applied !== true,
  }).roman;
  if (flippedApplied !== emitted) {
    out.push({
      label: flippedApplied,
      reason:
        opts.applied === true
          ? 'Naming the root against the home key is always a correct spelling; `applied` asked for the tonicizing reading instead'
          : 'Whether a chromatic dominant is genuinely applied is a reading only the caller can make, so the root is named against the home key unless `applied` asks otherwise',
    });
  }
  const flippedNeapolitan = renderRoman(chord, key, {
    ...opts,
    neapolitan: opts.neapolitan !== true,
  }).roman;
  if (flippedNeapolitan !== emitted) {
    out.push({
      label: flippedNeapolitan,
      reason:
        'Both spellings name the same chord, so which one to write is a house-style choice `neapolitan` settles',
    });
  }
  return out;
}

/**
 * A numeral with the reasoning behind it.
 *
 * @category Functional Harmony
 */
export type RomanExplanation = {
  /** The numeral, exactly as {@link chordToRoman} renders it. */
  roman: string;
  /** How the numeral was arrived at: the degree, the quality, and the bass. */
  rationale: string;
  /**
   * The spellings the options turned down, empty unless the `alternatives`
   * option of {@link ExplainRomanOptions} asked for them.
   */
  alternatives: RejectedCandidate[];
};

/**
 * Options for {@link explainRoman}: {@link ChordToRomanOptions} plus the switch
 * for the rival spellings.
 *
 * @category Functional Harmony
 */
export type ExplainRomanOptions = ChordToRomanOptions & {
  /**
   * Report the numerals the other option settings would have rendered, and why
   * this one was rendered instead.
   *
   * Off by default: each rival costs a further rendering pass, and a caller
   * that only wants the numeral explained should not pay for the ones it did
   * not get.
   *
   * @defaultValue false
   */
  alternatives?: boolean;
};

/**
 * Render a chord as a Roman numeral and say how the numeral was arrived at.
 *
 * The numeral is exactly what {@link chordToRoman} returns for the same
 * arguments — this is that function with its reasoning attached, for teaching
 * material and for any interface whose users argue with the analysis. The
 * rationale names the degree the root was spelled as, the quality that set the
 * numeral's case and suffix, and what became of the bass, including the two
 * cases where a bass exists and no numeral can carry it.
 *
 * @param chord The chord to name, as a chord symbol, chord data, or a `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @param opts The rendering options of {@link chordToRoman}, plus
 *   `alternatives` to collect the spellings they turned down.
 * @returns The numeral, its rationale, and the rejected spellings.
 * @example
 * ```ts
 * import { explainRoman, makeChord, majorKey } from '@libraz/libcantus';
 * explainRoman(makeChord(7, 'dom7'), majorKey(0)).rationale;
 * // 'V7: the root is the fifth degree of the key, the case and suffix come from the dom7 quality, and the chord stands on its own root'
 * const applied = explainRoman(makeChord(2, 'dom7'), majorKey(0), { alternatives: true });
 * applied.alternatives?.map((rejected) => rejected.label); // ['V7/V']
 * ```
 * @category Functional Harmony
 */
export function explainRoman(
  chord: ChordLike,
  key: KeyLike,
  opts: ExplainRomanOptions = {},
): RomanExplanation {
  const asked = assertOptions(opts, 'opts');
  const data = toChordData(chord);
  const { roman, derivation } = renderRoman(data, key, asked);
  return {
    roman,
    rationale: describeRoman(roman, derivation),
    alternatives: asked.alternatives === true ? romanAlternatives(data, key, asked) : [],
  };
}
