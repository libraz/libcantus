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
import { capitalize, type RejectedCandidate } from './rationale.js';
import { type ChordToRomanOptions, chordToRoman, romanAlternatives } from './roman.js';

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
  return functionWithReason(chord, key).function;
}

/**
 * Which of the rules in {@link functionOf} settled the function.
 *
 * `'degree'` is the baseline mapping from the root's offset above the tonic;
 * the other four are the sonority-aware rules that override it, and naming
 * which one fired is what lets the analysis say why it disagreed with the
 * degree the chord stands on.
 */
type FunctionReason = 'neapolitan' | 'augmentedSixth' | 'applied' | 'flatSideMajor' | 'degree';

/** The function the root's offset above the tonic maps to, before any override. */
function degreeFunction(chord: Chord, key: KeyScale): HarmonicFunction {
  const functions = isMinorKey(key) ? MINOR_FUNCTION_BY_OFFSET : FUNCTION_BY_OFFSET;
  return functions[mod12(chord.rootPc - key.rootPc)] ?? 'tonic';
}

/** {@link functionOf}, keeping the rule that decided the answer. */
function functionWithReason(
  chord: Chord,
  key: KeyScale,
): { function: HarmonicFunction; reason: FunctionReason } {
  const offset = mod12(chord.rootPc - key.rootPc);
  if (isNeapolitan(chord, key)) {
    return { function: 'subdominant', reason: 'neapolitan' };
  }
  if (augmentedSixthKind(chord, key) !== null) {
    return { function: 'subdominant', reason: 'augmentedSixth' };
  }
  if (isAppliedDominant(chord, key)) {
    return { function: 'dominant', reason: 'applied' };
  }
  if (!isMinorKey(key) && hasMajorThird(chord) && (offset === 8 || offset === 10)) {
    return { function: 'subdominant', reason: 'flatSideMajor' };
  }
  return { function: degreeFunction(chord, key), reason: 'degree' };
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
  /**
   * Why the chord reads this way: the rule that settled its function, and where
   * it was borrowed from when it was borrowed. Always present, in the phrasing
   * {@link analyzeVoice} uses for a note.
   */
  rationale: string;
  /**
   * The readings that were considered and rejected, empty unless
   * {@link AnalyzeChordOptions.alternatives} asked for them.
   */
  alternatives: RejectedCandidate[];
};

/**
 * Options for {@link analyzeChord}: {@link ChordToRomanOptions} plus the switch
 * for the rival readings.
 *
 * @category Functional Harmony
 */
export type AnalyzeChordOptions = ChordToRomanOptions & {
  /**
   * Report the readings this analysis turned down: the function the chord's
   * degree alone would have carried, the tonicizing reading a dominant sonority
   * could have had, and the numerals the other rendering options would emit.
   *
   * Off by default. The rationale is built from facts the analysis already
   * established, but a rival costs work nothing else needs — a second and third
   * numeral rendering among them — and most callers read the conclusion only.
   *
   * @defaultValue false
   */
  alternatives?: boolean;
};

/** What a rule overriding the degree table found, phrased for a rationale. */
const FUNCTION_REASON_PHRASE: Record<Exclude<FunctionReason, 'degree'>, string> = {
  neapolitan: 'the Neapolitan, an altered predominant on the lowered second degree',
  augmentedSixth: 'an augmented sixth, an altered predominant resolving outward onto the dominant',
  applied: 'an applied dominant sonority resolving onto a diatonic degree',
  flatSideMajor: 'a major triad on the flat side, the borrowed cadence chord',
};

/** Where a borrowed chord came from, phrased for a rationale. */
const BORROWED_SOURCE_PHRASE: Record<Exclude<BorrowedSource, null>, string> = {
  parallelMinor: 'borrowed from the parallel minor',
  parallelMajor: 'borrowed from the parallel major',
  neapolitan: 'belonging to neither parallel mode',
};

/** Build the rationale for a chord's function and borrowing. */
function describeChord(
  fn: HarmonicFunction,
  reason: FunctionReason,
  roman: string,
  source: BorrowedSource,
): string {
  const head =
    reason === 'degree'
      ? `${capitalize(fn)}: ${roman} takes the ${fn} function of its degree in the key`
      : `${capitalize(fn)}: ${roman} is ${FUNCTION_REASON_PHRASE[reason]}`;
  // The Neapolitan rule already says where the chord comes from; repeating the
  // source would make the rationale name it twice.
  return source === null || reason === 'neapolitan'
    ? head
    : `${head}, ${BORROWED_SOURCE_PHRASE[source]}`;
}

/** The readings of the chord's function that were considered and rejected. */
function functionAlternatives(
  chord: Chord,
  key: KeyScale,
  reason: FunctionReason,
  accepted: HarmonicFunction,
): RejectedCandidate[] {
  const out: RejectedCandidate[] = [];
  if (reason === 'degree') {
    // The sonority could tonicize, and only its being in the key stopped it.
    if (isAppliedDominantSonority(chord) && isDiatonic(chord, key)) {
      out.push({
        label: 'applied dominant',
        reason:
          'The chord is diatonic to the key, so it keeps the function of its degree rather than tonicizing another',
      });
    }
  } else {
    const byDegree = degreeFunction(chord, key);
    if (byDegree !== accepted) {
      out.push({
        label: `${byDegree} by scale degree`,
        reason: `The degree the root stands on reads as ${byDegree}, but the chord is ${FUNCTION_REASON_PHRASE[reason]}`,
      });
    }
  }
  if (augmentedSixthKind(chord, key) === 'german') {
    out.push({
      label: 'tritone substitute',
      reason:
        'The German sixth sounds a dominant seventh, but the lowered submediant under it fixes the reading as an augmented sixth',
    });
  }
  return out;
}

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
 * The `rationale` says which of those rules settled the function, so a reader
 * who disagrees can see what the reading rests on. `alternatives` is empty
 * unless asked for, and then names the readings that were turned down.
 *
 * @param chord The chord to analyze.
 * @param key The prevailing key.
 * @param opts Options used when rendering the Roman numeral, plus
 *   `alternatives` to collect the rejected readings.
 * @returns The chord analysis.
 * @example
 * ```ts
 * import { analyzeChord, makeChord, majorKey } from '@libraz/libcantus';
 * analyzeChord(makeChord(7, 'dom7'), majorKey(0));
 * // { function: 'dominant', borrowed: false, source: null, roman: 'V7', ... }
 * analyzeChord(makeChord(9, 'dom7'), majorKey(0), { alternatives: true }).alternatives;
 * // [{ label: 'tonic by scale degree', reason: '...' }, ...]
 * ```
 * @category Functional Harmony
 */
export function analyzeChord(
  chord: Chord,
  key: KeyScale,
  opts: AnalyzeChordOptions = {},
): ChordAnalysis {
  const source = borrowedSource(chord, key);
  const { function: fn, reason } = functionWithReason(chord, key);
  const roman = chordToRoman(chord, key, opts);
  return {
    function: fn,
    borrowed: source !== null,
    source,
    roman,
    rationale: describeChord(fn, reason, roman, source),
    alternatives:
      opts.alternatives === true
        ? [...functionAlternatives(chord, key, reason, fn), ...romanAlternatives(chord, key, opts)]
        : [],
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
