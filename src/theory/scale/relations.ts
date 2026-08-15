/**
 * How keys stand to one another: the relative, parallel, dominant and
 * subdominant keys, the enharmonic respelling of a key, and the relation that
 * holds between two given keys.
 *
 * Every relation but {@link parallelKeyOf} is computed in fifths space, on top
 * of {@link keySignatureFifths} and {@link keyFromFifths}. Stepping around the
 * circle of fifths and reading the tonic back off it is what keeps the spelling
 * right: the relative of Db major comes out as Bb minor, not A# minor.
 *
 * A relation always returns a plain major or minor key, because those are the
 * only keys these relations name. A key that is not a diatonic mode — harmonic
 * minor, a pentatonic, an octatonic — is read through the signature
 * {@link keySignatureFifths} assigns it, which is the signature of its parallel
 * major or minor. {@link parallelKeyOf} is the one exception: it travels no
 * fifths, so it keeps the tonic spelling it was given.
 */

import type { Note } from '../../core/pitch/index.js';
import { diatonicLetterOf, noteToPitchClass, pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertInteger } from '../../core/validation/index.js';
import { majorKey, minorKey } from './key.js';
import { CHROMATIC_MASK } from './masks.js';
import type { KeyMode } from './signature.js';
import { keyFromFifths, keySignatureFifths } from './signature.js';

/** How many fifths apart the two spellings of one sounding key sit. */
const ENHARMONIC_FIFTHS = 12;

/** Widest signature a key is actually written with. */
const MAX_CONVENTIONAL_FIFTHS = 7;

/** Whether a mode mask has a minor third and no major third — it leans flat. */
function isMinorMode(modeMask12: number): boolean {
  return ((modeMask12 >> 3) & 1) === 1 && ((modeMask12 >> 4) & 1) === 0;
}

/** Validate a key's mode mask, naming it the way the caller sees it. */
function assertModeMask(key: KeyScale, name = 'key'): number {
  return assertInteger(key.modeMask12, `${name}.modeMask12`, 1, CHROMATIC_MASK);
}

/**
 * Which of the two modes a key leans to.
 *
 * This is the same test the key-signature module applies, so a relation and a
 * signature never disagree about a key's mode.
 */
function modeOf(key: KeyScale): KeyMode {
  return isMinorMode(assertModeMask(key)) ? 'minor' : 'major';
}

/** The other of the two modes a signature is read in. */
function oppositeMode(mode: KeyMode): KeyMode {
  return mode === 'major' ? 'minor' : 'major';
}

/** Whether two keys sound alike: same root pitch class, same mode mask. */
function soundsLike(a: KeyScale, b: KeyScale): boolean {
  return pitchClassOf(a.rootPc) === pitchClassOf(b.rootPc) && a.modeMask12 === b.modeMask12;
}

/** Whether two tonics are written alike, octave aside. */
function spelledLike(a: Note, b: Note): boolean {
  return diatonicLetterOf(a.letter) === diatonicLetterOf(b.letter) && a.alter === b.alter;
}

/**
 * A key paired with the spelled tonic that anchors its letter names.
 *
 * The tonic carries no octave: a key is rooted on a pitch class, and its
 * spelling is what decides whether the key is written Db major or C# major.
 *
 * @example
 * ```ts
 * import type { SpelledKey } from '@libraz/libcantus';
 * import { majorKey, parseNote } from '@libraz/libcantus';
 * const dbMajor: SpelledKey = { tonic: parseNote('Db'), key: majorKey(1) };
 * ```
 * @category Scales
 */
export type SpelledKey = { tonic: Note; key: KeyScale };

/**
 * How one key stands to another, as reported by {@link keyRelationBetween} and
 * tagged onto every entry of {@link relatedKeysOf}.
 *
 * @example
 * ```ts
 * import type { KeyRelation } from '@libraz/libcantus';
 * const relation: KeyRelation = 'relative'; // C major -> A minor
 * ```
 * @category Scales
 */
export type KeyRelation =
  | 'same'
  | 'enharmonic'
  | 'relative'
  | 'parallel'
  | 'dominant'
  | 'subdominant'
  | 'relativeOfDominant'
  | 'relativeOfSubdominant';

/**
 * Spell a key's tonic the conventional way: the letter and accidental its key
 * signature would be written with, paired with the key exactly as given.
 *
 * The mask's third picks the mode — a minor third and no major third reads as
 * minor, anything else as major — and the tonic is then read off the circle of
 * fifths: among the signatures in [-7, 7] whose key has this root pitch class,
 * the one with the fewest accidentals names it. That is why pitch class 1 in
 * major comes out as Db, five flats, rather than as C#, seven sharps, and why
 * pitch class 6 in minor comes out as F#, three sharps. Where the two spellings
 * are equally far out — pitch class 6 in major is F# at +6 and Gb at -6 — the
 * flat side is taken.
 *
 * The key is returned unchanged, so a scale that is not a diatonic mode keeps
 * its own mask and only borrows the tonic spelling of its parallel major or
 * minor: G# harmonic minor is spelled G#, not Ab, and stays harmonic minor.
 *
 * Every 12-bit mask and every integer root is answered — a root outside [0, 11]
 * is reduced first, and a mask with no third at all counts as major.
 *
 * @param key The key/scale to spell.
 * @returns The conventional tonic spelling, paired with `key` verbatim.
 * @example
 * ```ts
 * import { formatNote, majorKey, scaleByName, spelledKeyOf } from '@libraz/libcantus';
 * formatNote(spelledKeyOf(majorKey(1)).tonic); // 'Db'
 * formatNote(spelledKeyOf(scaleByName('harmonicMinor', 8)).tonic); // 'G#'
 * ```
 * @category Scales
 */
export function spelledKeyOf(key: KeyScale): SpelledKey {
  // The mask is read through `isMinorMode` rather than through `modeOf`, which
  // rejects a malformed mask: spelling answers for whatever mask it is handed.
  const mode: KeyMode = isMinorMode(key.modeMask12) ? 'minor' : 'major';
  const rootPc = pitchClassOf(key.rootPc);
  // Every pitch class is named by a signature within ±7 in both modes, so the
  // starting tonic here only stands in until the scan makes its first match.
  let tonic: Note = keyFromFifths(0, mode).tonic;
  let closest = Number.POSITIVE_INFINITY;
  // Scanning from the flat end and keeping only a strictly closer candidate
  // settles the two ties on the flat side: pitch class 6 in major is Gb, and
  // pitch class 3 in minor is Eb.
  for (let fifths = -MAX_CONVENTIONAL_FIFTHS; fifths <= MAX_CONVENTIONAL_FIFTHS; fifths += 1) {
    const candidate = keyFromFifths(fifths, mode);
    if (candidate.key.rootPc === rootPc && Math.abs(fifths) < closest) {
      tonic = candidate.tonic;
      closest = Math.abs(fifths);
    }
  }
  return { tonic, key };
}

/**
 * The relative key: the same key signature read in the other mode.
 *
 * C major and A minor share a signature, and so are each other's relative; the
 * relation is its own inverse for a plain major or minor key. Because the new
 * tonic is read off the circle of fifths rather than transposed by semitones,
 * the relative of Db major is Bb minor and not its enharmonic A# minor.
 *
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale; its mask decides which mode the relative is in.
 * @returns The relative key and the tonic spelling it is written with.
 * @throws If the tonic or the mask is malformed, or if the key's signature
 *   falls outside [-12, 12] fifths.
 * @example
 * ```ts
 * import { formatNote, majorKey, parseNote, relativeKeyOf } from '@libraz/libcantus';
 * formatNote(relativeKeyOf(parseNote('C'), majorKey(0)).tonic); // 'A'
 * formatNote(relativeKeyOf(parseNote('Db'), majorKey(1)).tonic); // 'Bb'
 * ```
 * @category Scales
 */
export function relativeKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  return keyFromFifths(keySignatureFifths(tonic, key), oppositeMode(modeOf(key)));
}

/**
 * The parallel key: the other mode on the same tonic.
 *
 * The tonic keeps the spelling it was given — the parallel minor of C major is
 * C minor, never B# minor — which is why this is the one relation here that
 * does not travel the circle of fifths.
 *
 * @param tonic The spelled tonic of the key; its letter and alteration are kept.
 * @param key The key/scale; its mask decides which mode the parallel is in.
 * @returns The parallel key on the same tonic.
 * @throws If the tonic or the mask is malformed.
 * @example
 * ```ts
 * import { formatNote, majorKey, parallelKeyOf, parseNote } from '@libraz/libcantus';
 * const parallel = parallelKeyOf(parseNote('C'), majorKey(0));
 * formatNote(parallel.tonic); // 'C'
 * ```
 * @category Scales
 */
export function parallelKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  const mode = oppositeMode(modeOf(key));
  // The spelled tonic decides the root, so the returned key and its tonic agree
  // even when the caller's `rootPc` was left on the other mode's root.
  const rootPc = noteToPitchClass(tonic);
  return {
    tonic: { letter: diatonicLetterOf(tonic.letter), alter: tonic.alter },
    key: mode === 'minor' ? minorKey(rootPc) : majorKey(rootPc),
  };
}

/**
 * The dominant key: one sharp further round the circle of fifths, same mode.
 *
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale; its mask decides the mode of the result.
 * @returns The key a fifth above, in the same mode.
 * @throws If the tonic or the mask is malformed, or if the resulting signature
 *   falls outside [-12, 12] fifths — the dominant of a key already at +12.
 * @example
 * ```ts
 * import { dominantKeyOf, formatNote, majorKey, parseNote } from '@libraz/libcantus';
 * formatNote(dominantKeyOf(parseNote('C'), majorKey(0)).tonic); // 'G'
 * ```
 * @category Scales
 */
export function dominantKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  return keyFromFifths(keySignatureFifths(tonic, key) + 1, modeOf(key));
}

/**
 * The subdominant key: one flat further round the circle of fifths, same mode.
 *
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale; its mask decides the mode of the result.
 * @returns The key a fifth below, in the same mode.
 * @throws If the tonic or the mask is malformed, or if the resulting signature
 *   falls outside [-12, 12] fifths — the subdominant of a key already at -12.
 * @example
 * ```ts
 * import { formatNote, majorKey, parseNote, subdominantKeyOf } from '@libraz/libcantus';
 * formatNote(subdominantKeyOf(parseNote('C'), majorKey(0)).tonic); // 'F'
 * ```
 * @category Scales
 */
export function subdominantKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  return keyFromFifths(keySignatureFifths(tonic, key) - 1, modeOf(key));
}

/**
 * The same sounding key written the other way round the circle of fifths, or
 * null when it has no second spelling.
 *
 * Twelve fifths is one enharmonic turn of the circle, so a key's alternative
 * spelling sits at its signature ±12: Db major (-5) is also C# major (+7). Only
 * a candidate within ±7 is returned, because that is as far as keys are
 * actually written — past it the alternative needs double accidentals (D# major
 * would carry nine sharps) and no one spells the key that way. C major is
 * therefore alone, while Db major and F# major each answer with their twin.
 *
 * The two candidates lie 24 fifths apart, so at most one of them can qualify;
 * the answer is unambiguous, and applying the relation to it returns the
 * original key.
 *
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale; its mask decides the mode of the result.
 * @returns The other spelling of the key, or null when it is not written.
 * @throws If the tonic or the mask is malformed.
 * @example
 * ```ts
 * import { enharmonicKeyOf, formatNote, majorKey, parseNote } from '@libraz/libcantus';
 * const other = enharmonicKeyOf(parseNote('Db'), majorKey(1));
 * other === null ? 'none' : formatNote(other.tonic); // 'C#'
 * enharmonicKeyOf(parseNote('C'), majorKey(0)); // null
 * ```
 * @category Scales
 */
export function enharmonicKeyOf(tonic: Note, key: KeyScale): SpelledKey | null {
  const mode = modeOf(key);
  const fifths = keySignatureFifths(tonic, key);
  for (const candidate of [fifths - ENHARMONIC_FIFTHS, fifths + ENHARMONIC_FIFTHS]) {
    if (Math.abs(candidate) <= MAX_CONVENTIONAL_FIFTHS) {
      return keyFromFifths(candidate, mode);
    }
  }
  return null;
}

/** The relative of the dominant key: two moves along the circle, then across. */
function relativeOfDominantKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  const dominant = dominantKeyOf(tonic, key);
  return relativeKeyOf(dominant.tonic, dominant.key);
}

/** The relative of the subdominant key. */
function relativeOfSubdominantKeyOf(tonic: Note, key: KeyScale): SpelledKey {
  const subdominant = subdominantKeyOf(tonic, key);
  return relativeKeyOf(subdominant.tonic, subdominant.key);
}

/**
 * The closely related keys, in the order {@link relatedKeysOf} reports them and
 * {@link keyRelationBetween} tests them.
 */
const CLOSELY_RELATED: readonly {
  relation: KeyRelation;
  of: (tonic: Note, key: KeyScale) => SpelledKey;
}[] = [
  { relation: 'relative', of: relativeKeyOf },
  { relation: 'parallel', of: parallelKeyOf },
  { relation: 'dominant', of: dominantKeyOf },
  { relation: 'subdominant', of: subdominantKeyOf },
  { relation: 'relativeOfDominant', of: relativeOfDominantKeyOf },
  { relation: 'relativeOfSubdominant', of: relativeOfSubdominantKeyOf },
];

/**
 * The six closely related keys of a key, each tagged with its relation.
 *
 * These are the keys a piece modulates to without a change of signature worth
 * more than one accidental: the relative and parallel keys, the dominant and
 * subdominant, and the relatives of those two. For C major they are A minor,
 * C minor, G major, F major, E minor and D minor, in that order.
 *
 * @param tonic The spelled tonic of the key.
 * @param key The key/scale.
 * @returns The six related keys, in relation order, each with its tonic
 *   spelling and its `relation` tag.
 * @throws If the tonic or the mask is malformed, or if a neighbouring signature
 *   falls outside [-12, 12] fifths.
 * @example
 * ```ts
 * import { majorKey, parseNote, relatedKeysOf } from '@libraz/libcantus';
 * relatedKeysOf(parseNote('C'), majorKey(0)).map((related) => related.relation);
 * // ['relative', 'parallel', 'dominant', 'subdominant', 'relativeOfDominant', 'relativeOfSubdominant']
 * ```
 * @category Scales
 */
export function relatedKeysOf(
  tonic: Note,
  key: KeyScale,
): (SpelledKey & { relation: KeyRelation })[] {
  return CLOSELY_RELATED.map(({ relation, of }) => ({ ...of(tonic, key), relation }));
}

/**
 * How the second key stands to the first, or null when they are not related.
 *
 * The relations are tested in a fixed order — identity, enharmonic spelling,
 * then the six closely related keys in the order {@link relatedKeysOf} lists
 * them — and the first match is reported. Only the identity test looks at the
 * tonic spelling; every other test compares root pitch class and mode mask, so
 * C# minor and Db minor both read as the relative of E major.
 *
 * @param a The key the relation is measured from.
 * @param b The key the relation is measured to.
 * @returns The relation, or null when `b` is none of `a`'s related keys.
 * @throws If either key is malformed, or if a neighbouring signature of `a`
 *   falls outside [-12, 12] fifths.
 * @example
 * ```ts
 * import { keyRelationBetween, majorKey, minorKey, parseNote } from '@libraz/libcantus';
 * const cMajor = { tonic: parseNote('C'), key: majorKey(0) };
 * keyRelationBetween(cMajor, { tonic: parseNote('A'), key: minorKey(9) }); // 'relative'
 * keyRelationBetween(cMajor, { tonic: parseNote('Eb'), key: minorKey(3) }); // null
 * ```
 * @category Scales
 */
export function keyRelationBetween(a: SpelledKey, b: SpelledKey): KeyRelation | null {
  assertModeMask(a.key, 'a.key');
  assertModeMask(b.key, 'b.key');
  if (soundsLike(a.key, b.key)) {
    return spelledLike(a.tonic, b.tonic) ? 'same' : 'enharmonic';
  }
  for (const { relation, of } of CLOSELY_RELATED) {
    if (soundsLike(of(a.tonic, a.key).key, b.key)) {
      return relation;
    }
  }
  return null;
}
