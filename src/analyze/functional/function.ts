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
import { assertFiniteNumber, assertInteger, assertOptions } from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { makeChord } from '../../theory/chord/index.js';
import { type KeyLike, scaleTonesInDegreeOrder, toKeyScale } from '../../theory/scale/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import { augmentedSixthKindOf } from './augmented-sixth.js';
import { type BorrowedSource, borrowedSourceOf } from './borrowed.js';
import {
  degreeRootPc,
  hasMajorThird,
  isDiatonicChord,
  isMinorScale,
  isNeapolitanChordOf,
  mod12,
  parallelScale,
} from './internal.js';
import { capitalize, type RejectedCandidate } from './rationale.js';
import { type ChordToRomanOptions, renderRoman, romanAlternatives } from './roman.js';
import { isAppliedDominant, pointsAtTonicizableDegree } from './tonicization.js';

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
 * Harmonic function of each root offset in a natural-minor context.
 *
 * The diatonic degrees take the function the textbooks give them; a chromatic
 * offset takes the function its role as a displaced neighbour of a diatonic
 * degree implies. The raised mediant is the case that shows the difference: it
 * carries neither a dominant sonority nor a dominant resolution, so as a
 * chromatic mediant it prolongs the tonic through the tones it shares with it.
 */
const MINOR_FUNCTION_BY_OFFSET: readonly HarmonicFunction[] = [
  'tonic', // 0  i
  'subdominant', // 1  bII (Neapolitan)
  'subdominant', // 2  iio
  'tonic', // 3  III
  'tonic', // 4  #III, the chromatic mediant
  'subdominant', // 5  iv
  'dominant', // 6  #iv / bv
  'dominant', // 7  V
  'tonic', // 8  VI
  'tonic', // 9  #VI
  'subdominant', // 10 VII
  'dominant', // 11 viio
];

/**
 * Whether a key's scale has a minor third and no major third (a minor key).
 *
 * @param key The key to test, as a key name, a key/scale, or a `Key`.
 * @returns True if the key's scale is a minor one.
 * @category Functional Harmony
 */
export function isMinorKey(key: KeyLike): boolean {
  return isMinorScale(toKeyScale(key));
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
 *   or a diminished-family chord — and is neither diatonic to the key nor
 *   borrowed from its parallel mode has dominant function when its root
 *   resolves onto a degree that can be made a local tonic. This is what makes an
 *   applied dominant (`A7` in C, which tonicizes ii) and its tritone substitute
 *   (`Db7`) read as dominant rather than inheriting the function of the degree
 *   they happen to sit on. A bare major triad carries no tritone, so it only
 *   tonicizes by falling a fifth onto a degree other than the tonic: the Picardy
 *   third of a minor key and its borrowed major IV sound their own degrees.
 * - The Neapolitan is subdominant.
 * - An augmented sixth is subdominant. All three are altered predominants that
 *   resolve outward onto the dominant, so they take subdominant function even
 *   though the German sixth sounds a dominant seventh and would otherwise read
 *   as the tritone substitute it shares its pitch classes with.
 * - A major triad on bVI or bVII of a major key is subdominant — the borrowed
 *   pop cadence chord, distinct from the bVII7 above, which has a seventh and
 *   is a dominant sonority.
 *
 * @param chord The chord, as a chord symbol, chord data, or a `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns The harmonic function.
 * @example
 * ```ts
 * import { functionOf, makeChord, majorKey } from '@libraz/libcantus';
 * functionOf(makeChord(9, 'dom7'), majorKey(0)); // 'dominant' — A7 tonicizes ii
 * functionOf('Bb', 'C major'); // 'subdominant' — borrowed bVII
 * ```
 * @category Functional Harmony
 */
export function functionOf(chord: ChordLike, key: KeyLike): HarmonicFunction {
  return functionWithReason(toChordData(chord), toKeyScale(key)).function;
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
  const functions = isMinorScale(key) ? MINOR_FUNCTION_BY_OFFSET : FUNCTION_BY_OFFSET;
  return functions[mod12(chord.rootPc - key.rootPc)] ?? 'tonic';
}

/** {@link functionOf}, keeping the rule that decided the answer. */
export function functionWithReason(
  chord: Chord,
  key: KeyScale,
): { function: HarmonicFunction; reason: FunctionReason } {
  const offset = mod12(chord.rootPc - key.rootPc);
  if (isNeapolitanChordOf(chord, key)) {
    return { function: 'subdominant', reason: 'neapolitan' };
  }
  if (augmentedSixthKindOf(chord, key) !== null) {
    return { function: 'subdominant', reason: 'augmentedSixth' };
  }
  if (isAppliedDominant(chord, key)) {
    return { function: 'dominant', reason: 'applied' };
  }
  // A chord the key already contains is its own degree, however flat that degree
  // lies: the major triad on the subtonic of mixolydian is the mode's own VII,
  // and describing it as borrowed would contradict the source the analysis
  // reports alongside it.
  if (
    !isMinorScale(key) &&
    !isDiatonicChord(chord, key) &&
    hasMajorThird(chord) &&
    (offset === 8 || offset === 10)
  ) {
    return { function: 'subdominant', reason: 'flatSideMajor' };
  }
  return { function: degreeFunction(chord, key), reason: 'degree' };
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
   * The readings that were considered and rejected, empty unless the
   * `alternatives` option of {@link AnalyzeChordOptions} asked for them.
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
    // Both halves are needed: a reading nothing could have been is not a
    // reading that was turned down. The subdominant of a major key sounds a
    // dominant and is diatonic, but points at no degree the key can tonicize,
    // so reporting it as a rejected applied dominant named a rival that never
    // existed and gave the wrong reason for its absence. What counts as
    // pointing is the predicate the accepting side applies, so inverting the
    // reason stated here is exactly what would make the analysis take it.
    if (pointsAtTonicizableDegree(chord, key) && isDiatonicChord(chord, key)) {
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
  if (augmentedSixthKindOf(chord, key) === 'german') {
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
 * @param chord The chord to test, as a chord symbol, chord data, or a `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns True if all chord pitch classes are scale tones.
 * @category Functional Harmony
 */
export function isDiatonic(chord: ChordLike, key: KeyLike): boolean {
  return isDiatonicChord(toChordData(chord), toKeyScale(key));
}

/**
 * The parallel key: same tonic, opposite mode.
 *
 * A key with a minor third (natural/harmonic/melodic minor, dorian, phrygian)
 * maps to the parallel major; any other key maps to the parallel natural minor.
 *
 * Internal to this layer, and not part of the public API. This is the
 * pitch-class form, taking and returning a `KeyScale`, which has nowhere to
 * put a spelling: the parallel of a key named as C is a key whose root is
 * pitch class 0, and whether that is written C or B# is lost. That is fine for
 * the callers here, which go straight on to compare pitch classes, and wrong
 * for a caller who wanted a key to show. Published alongside `parallelKeyOf`
 * it was a trap — the shorter name, the simpler signature, and the silent loss.
 *
 * `parallelKeyOf` is the public answer, and `Key.parallel()` the class one;
 * both keep the tonic spelling, and both sit beside `relativeKeyOf`,
 * `dominantKeyOf` and `subdominantKeyOf`, which take a tonic the same way.
 *
 * @param key The key to mirror, as a key name, a key/scale, or a `Key`.
 * @returns The parallel major or natural-minor key on the same tonic.
 * @see {@link parallelKeyOf} for the spelled form.
 */
export function parallelKey(key: KeyLike): KeyScale {
  return parallelScale(toKeyScale(key));
}

/**
 * Analyze a chord in a key: harmonic function, borrowing, and Roman numeral.
 *
 * The function is quality-aware (see the predicates behind it), the source
 * follows {@link borrowedSource}, and the numeral comes from
 * {@link chordToRoman}. `borrowed` is true whenever a source is identified,
 * which includes the Neapolitan: it belongs to neither parallel mode, and both
 * this and {@link isBorrowedChord} count it as a borrowing all the same.
 *
 * The `rationale` says which of those rules settled the function, so a reader
 * who disagrees can see what the reading rests on. `alternatives` is empty
 * unless asked for, and then names the readings that were turned down.
 *
 * @param chord The chord to analyze, as a chord symbol, chord data, or a
 *   `Chord`.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
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
  chord: ChordLike,
  key: KeyLike,
  opts: AnalyzeChordOptions = {},
): ChordAnalysis {
  const asked = assertOptions(opts, 'opts');
  const data = toChordData(chord);
  const scale = toKeyScale(key);
  const source = borrowedSourceOf(data, scale);
  const { function: fn, reason } = functionWithReason(data, scale);
  const roman = renderRoman(data, scale, asked).roman;
  return {
    function: fn,
    borrowed: source !== null,
    source,
    roman,
    rationale: describeChord(fn, reason, roman, source),
    alternatives:
      asked.alternatives === true
        ? [
            ...functionAlternatives(data, scale, reason, fn),
            ...romanAlternatives(data, scale, asked),
          ]
        : [],
  };
}

/**
 * The secondary dominant (V7) that tonicizes a scale degree.
 *
 * @param targetDegree 1-based scale degree to tonicize: 5 is the dominant, so
 *   `secondaryDominant(5, majorKey(0))` is the V of V.
 * @param key The prevailing key, as a key name, a key/scale, or a `Key`.
 * @returns A dominant-seventh chord a fifth above the target's root.
 * @throws If `targetDegree` is not an integer naming a degree in `key`.
 * @see {@link secondaryDominantOf} to tonicize a chord that has no degree in
 *   the key, or when no key is at hand.
 * @category Functional Harmony
 */
export function secondaryDominant(targetDegree: number, key: KeyLike): Chord {
  const scale = toKeyScale(key);
  // A degree outside the scale is a caller error, not a wrap-around: silently
  // tonicizing some other degree produces a chord that reads as intentional.
  const degreeCount = scaleTonesInDegreeOrder(scale).length;
  assertInteger(targetDegree, 'targetDegree', 1, degreeCount);
  const targetRoot = degreeRootPc(targetDegree, scale);
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
 * @param target The chord to tonicize, as a chord symbol, chord data, or a
 *   `Chord`.
 * @returns A dominant-seventh chord a perfect fifth above the target's root.
 * @throws If the target's root pitch class is not a finite number.
 * @example
 * ```ts
 * import { makeChord, secondaryDominantOf } from '@libraz/libcantus';
 * secondaryDominantOf(makeChord(8, 'maj')).rootPc; // 3 — Eb7 tonicizes the
 * // borrowed bVI of C major
 * ```
 * @category Functional Harmony
 */
export function secondaryDominantOf(target: ChordLike): Chord {
  const data = toChordData(target);
  assertFiniteNumber(data.rootPc, 'target chord rootPc');
  const dominant = makeChord(mod12(data.rootPc + 7), 'dom7');
  // Move an explicit spelling hint rather than deriving one: the dominant of a
  // flat-named target is spelled flat, whatever key it is later read in.
  if (data.rootSpelling !== undefined) {
    const moved = transposeNote(data.rootSpelling, 7);
    dominant.rootSpelling = { letter: moved.letter, alter: moved.alter };
  }
  return dominant;
}
