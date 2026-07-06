/**
 * Functional harmony: Roman-numeral parsing and formatting, harmonic function
 * (tonic / subdominant / dominant), and cadence detection.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { Chord, ChordQuality } from '../chord/index.js';
import { makeChord } from '../chord/index.js';
import { majorKey, scaleTonesInDegreeOrder } from '../scale/index.js';
import type { KeyScale } from '../types.js';

/** The three broad harmonic functions of tonal music. */
export type HarmonicFunction = 'tonic' | 'subdominant' | 'dominant';

/** A recognized cadence type, or null when a chord pair forms none. */
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

/** Parse a Roman numeral (no secondary '/') into a root pitch class and quality. */
function parseSimpleRoman(text: string, key: KeyScale): { rootPc: number; quality: ChordQuality } {
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

  const isDim = /o|°|dim/.test(suffix);
  const isAug = /\+|aug/.test(suffix);
  const isHalfDim = /ø/.test(suffix);
  const hasSeventh = /7/.test(suffix);
  const explicitMaj7 = /maj7|M7/.test(suffix);

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
    quality = base === 'min' ? 'minMaj7' : 'maj7';
  } else if (hasSeventh) {
    quality = seventhQuality(base, isHalfDim);
  } else if (base === 'dim') {
    quality = 'dim';
  } else if (base === 'aug') {
    quality = 'aug';
  } else {
    quality = base;
  }
  return { rootPc, quality };
}

/**
 * Build the chord denoted by a Roman numeral in a key.
 *
 * Supports accidentals (`bVII`, `#iv`), case-based triad quality, the `o`/`ø`/`+`
 * suffixes, sevenths (`V7`, `viio7`, `iiø7`, `Imaj7`), and applied/secondary
 * chords via a slash (`V7/V`, `viio/ii`). The target after the slash is read as
 * a scale degree whose root becomes a local major tonic for the applied chord.
 *
 * @param text The Roman numeral.
 * @param key The prevailing key.
 * @returns The chord.
 */
export function romanToChord(text: string, key: KeyScale): Chord {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    const applied = trimmed.slice(0, slash);
    const target = trimmed.slice(slash + 1);
    const targetRoot = parseSimpleRoman(target, key).rootPc;
    const localKey = majorKey(targetRoot);
    const { rootPc, quality } = parseSimpleRoman(applied, localKey);
    return makeChord(rootPc, quality);
  }
  const { rootPc, quality } = parseSimpleRoman(trimmed, key);
  return makeChord(rootPc, quality);
}

/** Case and suffix for rendering a chord quality as a Roman numeral. */
function romanStyle(quality: ChordQuality): { lower: boolean; suffix: string } {
  switch (quality) {
    case 'min':
      return { lower: true, suffix: '' };
    case 'dim':
      return { lower: true, suffix: 'o' };
    case 'aug':
      return { lower: false, suffix: '+' };
    case 'maj7':
      return { lower: false, suffix: 'maj7' };
    case 'dom7':
      return { lower: false, suffix: '7' };
    case 'min7':
      return { lower: true, suffix: '7' };
    case 'm7b5':
      return { lower: true, suffix: 'ø7' };
    case 'dim7':
      return { lower: true, suffix: 'o7' };
    case 'minMaj7':
      return { lower: true, suffix: 'maj7' };
    case 'maj':
      return { lower: false, suffix: '' };
    default:
      return { lower: false, suffix: quality };
  }
}

/**
 * Render a chord as a Roman numeral relative to a key.
 *
 * The root's offset from the tonic selects the numeral and any accidental; the
 * quality selects the case and suffix. Chromatic roots receive a flat/sharp
 * spelling from the standard major-key convention.
 *
 * @param chord The chord to name.
 * @param key The prevailing key.
 * @returns The Roman numeral string.
 */
export function chordToRoman(chord: Chord, key: KeyScale): string {
  const offset = mod12(chord.rootPc - key.rootPc);
  const [degreeNumber, accidental] = OFFSET_SPELLING[offset] ?? [1, ''];
  const { lower, suffix } = romanStyle(chord.quality);
  const numeral: string = ROMAN[degreeNumber - 1] ?? 'I';
  return `${accidental}${lower ? numeral.toLowerCase() : numeral}${suffix}`;
}

/**
 * The harmonic function of a chord in a key, from its root's offset above the
 * tonic. The mapping follows common-practice major-key function and is a useful
 * approximation in minor and for borrowed chords.
 *
 * @param chord The chord.
 * @param key The prevailing key.
 * @returns The harmonic function.
 */
export function functionOf(chord: Chord, key: KeyScale): HarmonicFunction {
  return FUNCTION_BY_OFFSET[mod12(chord.rootPc - key.rootPc)] ?? 'tonic';
}

/**
 * Classify the cadence formed by moving from one chord to the next.
 *
 * - authentic: V (dominant a fifth above the tonic) to I
 * - plagal: IV (a fourth above the tonic) to I
 * - deceptive: V to vi
 * - half: any chord to V
 *
 * @param from The penultimate chord.
 * @param to The final chord.
 * @param key The prevailing key.
 * @returns The cadence type, or null.
 */
export function detectCadence(from: Chord, to: Chord, key: KeyScale): Cadence {
  const tonic = mod12(key.rootPc);
  const fromOffset = mod12(from.rootPc - tonic);
  const toOffset = mod12(to.rootPc - tonic);
  if (fromOffset === 7 && toOffset === 0) {
    return 'authentic';
  }
  if (fromOffset === 5 && toOffset === 0) {
    return 'plagal';
  }
  if (fromOffset === 7 && toOffset === 9) {
    return 'deceptive';
  }
  if (toOffset === 7) {
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
 */
export function secondaryDominant(targetDegree: number, key: KeyScale): Chord {
  const targetRoot = degreeRootPc(targetDegree + 1, key);
  return makeChord(mod12(targetRoot + 7), 'dom7');
}
