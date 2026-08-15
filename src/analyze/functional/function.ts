/**
 * Harmonic function (tonic / subdominant / dominant), diatonicity, parallel-key
 * mirroring, and full chord analysis.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import { transposeNote } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertFiniteNumber, assertInteger } from '../../core/validation/index.js';
import type { Chord, ChordQuality } from '../../theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../../theory/chord/index.js';
import {
  isScaleTone,
  MAJOR_MASK,
  NATURAL_MINOR_MASK,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { augmentedSixthKind } from './augmented-sixth.js';
import { type BorrowedSource, borrowedSource } from './borrowed.js';
import { degreeRootPc, isAppliedDominantSonority, isNeapolitan, mod12 } from './internal.js';
import { type ChordToRomanOptions, chordToRoman } from './roman.js';

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

/** Harmonic function of each root offset in a natural-minor context. */
const MINOR_FUNCTION_BY_OFFSET: readonly HarmonicFunction[] = [
  'tonic',
  'subdominant',
  'subdominant',
  'tonic',
  'dominant',
  'subdominant',
  'dominant',
  'dominant',
  'tonic',
  'tonic',
  'subdominant',
  'dominant',
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
 * The harmonic function of a chord in a key.
 *
 * The root's offset above the tonic gives the baseline mapping, which follows
 * common-practice major-key function and is a useful approximation in minor and
 * for borrowed chords. Chord quality then refines it where the sonority settles
 * an ambiguity the root offset cannot:
 *
 * - A chord that *sounds* like a dominant — a major third with a minor seventh,
 *   or a diminished-family chord — and is not diatonic to the key has dominant
 *   function when its root resolves down a fifth or by a semitone onto a
 *   diatonic degree. This is what makes an applied dominant (`A7` in C, which
 *   tonicizes ii) and its tritone substitute (`Db7`) read as dominant rather
 *   than inheriting the function of the degree they happen to sit on.
 * - The Neapolitan is subdominant.
 * - An augmented sixth is subdominant. All three are altered predominants that
 *   resolve outward onto the dominant, so they take subdominant function even
 *   though the German sixth sounds a dominant seventh and would otherwise read
 *   as the tritone substitute it shares its pitch classes with.
 * - A major triad on bVI or bVII of a major key is subdominant — the borrowed
 *   pop cadence chord, distinct from the bVII7 above, which has a seventh and
 *   is a dominant sonority.
 *
 * @param chord The chord.
 * @param key The prevailing key.
 * @returns The harmonic function.
 * @example
 * ```ts
 * import { functionOf, makeChord, majorKey } from '@libraz/libcantus';
 * functionOf(makeChord(9, 'dom7'), majorKey(0)); // 'dominant' — A7 tonicizes ii
 * functionOf(makeChord(10, 'maj'), majorKey(0)); // 'subdominant' — borrowed bVII
 * ```
 * @category Functional Harmony
 */
export function functionOf(chord: Chord, key: KeyScale): HarmonicFunction {
  const offset = mod12(chord.rootPc - key.rootPc);
  if (isNeapolitan(chord, key)) {
    return 'subdominant';
  }
  if (augmentedSixthKind(chord, key) !== null) {
    return 'subdominant';
  }
  if (isAppliedDominant(chord, key)) {
    return 'dominant';
  }
  if (!isMinorKey(key) && hasMajorThird(chord) && (offset === 8 || offset === 10)) {
    return 'subdominant';
  }
  const functions = isMinorKey(key) ? MINOR_FUNCTION_BY_OFFSET : FUNCTION_BY_OFFSET;
  return functions[offset] ?? 'tonic';
}

/**
 * Whether the chord is a dominant sonority pointing at a diatonic degree.
 *
 * A chord already diatonic to the key keeps the offset table's reading; what is
 * classified here is the chromatic chord whose sonority and resolution give it
 * dominant function regardless of the degree it sits on.
 *
 * The resolution required depends on the sonority. A dominant seventh (major
 * third plus minor seventh) must fall a perfect fifth — the applied dominants —
 * or a semitone, which is the same motion its tritone substitute makes. A
 * diminished-family chord must rise a semitone, the leading-tone resolution;
 * requiring that is what keeps a borrowed `iiø7`, which falls a fifth like any
 * other supertonic chord, reading as a predominant rather than a dominant.
 */
function isAppliedDominant(chord: Chord, key: KeyScale): boolean {
  if (isDiatonic(chord, key)) {
    return false;
  }
  const root = mod12(chord.rootPc);
  const resolvesTo = (step: number) => isScaleTone(mod12(root + step), key);
  if (isAppliedDominantSonority(chord)) {
    return chord.quality === 'maj' ? resolvesTo(5) : resolvesTo(5) || resolvesTo(11);
  }
  return isDiminishedQuality(chord.quality) && resolvesTo(1);
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
 * @param opts Options used when rendering the Roman numeral.
 * @returns The chord analysis.
 * @example
 * ```ts
 * import { analyzeChord, makeChord, majorKey } from '@libraz/libcantus';
 * analyzeChord(makeChord(7, 'dom7'), majorKey(0));
 * // { function: 'dominant', borrowed: false, source: null, roman: 'V7' }
 * ```
 * @category Functional Harmony
 */
export function analyzeChord(
  chord: Chord,
  key: KeyScale,
  opts: ChordToRomanOptions = {},
): ChordAnalysis {
  const source = borrowedSource(chord, key);
  return {
    function: functionOf(chord, key),
    borrowed: source !== null,
    source,
    roman: chordToRoman(chord, key, opts),
  };
}

/**
 * The secondary dominant (V7) that tonicizes a scale degree.
 *
 * @param targetDegree 1-based scale degree to tonicize: 5 is the dominant, so
 *   `secondaryDominant(5, majorKey(0))` is the V of V.
 * @param key The prevailing key.
 * @returns A dominant-seventh chord a fifth above the target's root.
 * @throws If `targetDegree` is not an integer naming a degree in `key`.
 * @see {@link secondaryDominantOf} to tonicize a chord that has no degree in
 *   the key, or when no key is at hand.
 * @category Functional Harmony
 */
export function secondaryDominant(targetDegree: number, key: KeyScale): Chord {
  // A degree outside the scale is a caller error, not a wrap-around: silently
  // tonicizing some other degree produces a chord that reads as intentional.
  const degreeCount = scaleTonesInDegreeOrder(key).length;
  assertInteger(targetDegree, 'targetDegree', 1, degreeCount);
  const targetRoot = degreeRootPc(targetDegree, key);
  return makeChord(mod12(targetRoot + 7), 'dom7');
}

/**
 * The secondary dominant (V7) that tonicizes a chord.
 *
 * {@link secondaryDominant} names its target by scale degree, so it only
 * reaches the degrees a key actually has. This takes the target chord itself
 * and needs no key at all, which is what lets a borrowed or chromatic target —
 * bVI of a major key, a Neapolitan, any chord a modulation left behind — have
 * its dominant built without first inventing a degree for it.
 *
 * A `rootSpelling` hint on the target moves with the root, so a flat-named
 * target yields a flat-named dominant (Eb gives Bb7, not A#7).
 *
 * @param target The chord to tonicize.
 * @returns A dominant-seventh chord a perfect fifth above the target's root.
 * @throws If the target's root pitch class is not a finite number.
 * @example
 * ```ts
 * import { makeChord, secondaryDominantOf } from '@libraz/libcantus';
 * secondaryDominantOf(makeChord(8, 'maj'));
 * // { rootPc: 3, quality: 'dom7' } — Eb7 tonicizes the borrowed bVI of C major
 * ```
 * @category Functional Harmony
 */
export function secondaryDominantOf(target: Chord): Chord {
  assertFiniteNumber(target.rootPc, 'target chord rootPc');
  const dominant = makeChord(mod12(target.rootPc + 7), 'dom7');
  // Move an explicit spelling hint rather than deriving one: the dominant of a
  // flat-named target is spelled flat, whatever key it is later read in.
  if (target.rootSpelling !== undefined) {
    const moved = transposeNote(target.rootSpelling, 7);
    dominant.rootSpelling = { letter: moved.letter, alter: moved.alter };
  }
  return dominant;
}
