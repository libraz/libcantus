/**
 * Harmonic function (tonic / subdominant / dominant), diatonicity, parallel-key
 * mirroring, and full chord analysis.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import { isScaleTone, MAJOR_MASK, NATURAL_MINOR_MASK } from '../../theory/scale/index.js';
import { type BorrowedSource, borrowedSource } from './borrowed.js';
import { degreeRootPc, isNeapolitan, mod12 } from './internal.js';
import { chordToRoman } from './roman.js';

/**
 * The three broad harmonic functions of tonal music.
 *
 * @category Functional Harmony
 */
export type HarmonicFunction = 'tonic' | 'subdominant' | 'dominant';

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
