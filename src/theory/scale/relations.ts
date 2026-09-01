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
 * only keys these relations name; {@link enharmonicKeyOf} is the exception that
 * proves it, since a respelling is the same key rather than another one and so
 * keeps the mask it was handed. A key that is not a plain major or minor —
 * a church mode, harmonic minor, a pentatonic, an octatonic — is read through
 * the mode its third names, and the fifths are counted from where its tonic
 * stands on the circle rather than from the key's own signature: a mode's
 * signature carries its own offset (D dorian is two fifths flatter than D
 * major), which {@link keyFromFifths} does not know how to give back.
 * {@link parallelKeyOf} travels no fifths at all, so it keeps the tonic
 * spelling it was given.
 */

import type { Note, NoteLike } from '../../core/pitch/index.js';
import {
  diatonicLetterOf,
  noteToPitchClass,
  pitchClassOf,
  toNoteData,
} from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertInteger } from '../../core/validation/index.js';
import { spellScale } from '../spelling/index.js';
import { type KeyLike, toKeyScale } from './coerce.js';
import type { ResolvedKey } from './identity.js';
import { majorKey, minorKey } from './key.js';
import { CHROMATIC_MASK, isMinorMask, variantOfMask } from './masks.js';
import type { KeyMode } from './signature.js';
import { isSignatureKey, keyFromFifths, keySignatureFifths } from './signature.js';

/** How many fifths apart the two spellings of one sounding key sit. */
const ENHARMONIC_FIFTHS = 12;

/** Widest signature a key is actually written with. */
const MAX_CONVENTIONAL_FIFTHS = 7;

/** An alteration of two sharps or two flats: the spelling a tonic should avoid. */
const DOUBLE_ACCIDENTAL = 2;

/** How many fifths a minor key's tonic stands above its signature: A minor is +3. */
const MINOR_TONIC_FIFTHS = 3;

/**
 * The flattest and sharpest points on the circle a tonic is ever written at.
 *
 * A key is written with at most seven accidentals, which puts its tonic between
 * Cb — the tonic of the seven-flat major key — and A#, the tonic of the
 * seven-sharp minor one. Every pitch class is named once or twice inside that
 * span, and those names are the only ones a key is spelled on: F# and Gb are
 * both there, E# and Fb are not.
 */
const FLATTEST_TONIC_FIFTHS = -MAX_CONVENTIONAL_FIFTHS;
const SHARPEST_TONIC_FIFTHS = MAX_CONVENTIONAL_FIFTHS + MINOR_TONIC_FIFTHS;

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
  return isMinorMask(assertModeMask(key)) ? 'minor' : 'major';
}

/** The other of the two modes a signature is read in. */
function oppositeMode(mode: KeyMode): KeyMode {
  return mode === 'major' ? 'minor' : 'major';
}

/**
 * Whether two keys name the same key: same root pitch class, same mode.
 *
 * Both keys are read the way every relation here reads them — through the mode
 * their third names — rather than by comparing masks. A relation answers with a
 * plain major or minor key, so a key that arrives as A harmonic minor has to be
 * met on the same terms as the A minor it is a form of; matching masks would
 * make the relation hold in one direction and not in the other.
 */
function soundsLike(a: KeyScale, b: KeyScale): boolean {
  return (
    pitchClassOf(a.rootPc) === pitchClassOf(b.rootPc) &&
    isMinorMask(a.modeMask12) === isMinorMask(b.modeMask12)
  );
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
 * import type { ResolvedKey } from '@libraz/libcantus';
 * import { majorKey, parseNote } from '@libraz/libcantus';
 * const dbMajor = spelledKeyOf(majorKey(1));
 * ```
 * @category Scales
 */

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
 * What a candidate tonic costs the scale it is asked to spell: the double
 * accidentals it forces, the accidentals it needs altogether, and how far round
 * the circle of fifths the key it names is written.
 */
type TonicCost = { doubles: number; accidentals: number; fifths: number };

/** How the scale reads when spelled from `tonic`. */
function tonicCost(tonic: Note, key: KeyScale): TonicCost {
  let doubles = 0;
  let accidentals = 0;
  for (const note of spellScale(tonic, key)) {
    const alter = Math.abs(note.alter);
    accidentals += alter;
    if (alter >= DOUBLE_ACCIDENTAL) {
      doubles += 1;
    }
  }
  return { doubles, accidentals, fifths: Math.abs(keySignatureFifths(tonic, key)) };
}

/**
 * Whether the first tonic spells the key better than the second; ties keep the
 * first, which is the flatter one because the scan runs from the flat end.
 *
 * A key that is written with a signature is spelled on the tonic that signature
 * is written on — pitch class 8 in minor is G# with five sharps, not Ab with
 * seven, and the F## its harmonic form writes is an accidental over that
 * signature rather than a reason to respell the key. A scale that only borrows
 * a signature has nothing to go on but how it reads, so there the double
 * accidentals it forces come first and the borrowed signature only breaks ties.
 */
function spellsBetter(a: TonicCost, b: TonicCost, signatureKey: boolean): boolean {
  const order: (keyof TonicCost)[] = signatureKey
    ? ['fifths', 'doubles', 'accidentals']
    : ['doubles', 'accidentals', 'fifths'];
  for (const term of order) {
    if (a[term] !== b[term]) {
      return a[term] < b[term];
    }
  }
  return false;
}

/**
 * Spell a key's tonic the conventional way: the letter and accidental the key
 * is written with, paired with the key exactly as given.
 *
 * The candidates are the tonics keys are actually written on — everything from
 * Cb to A#, which names each pitch class once or twice (C, but Db and C#) — and
 * which of them names the key depends on whether the key has a signature of its
 * own. A major or minor key, a church mode, and the harmonic and melodic minor
 * are spelled on the tonic their signature is written on: pitch class 1 in
 * major is Db, five flats, rather than C#, seven sharps; pitch class 8 in minor
 * is G#, five sharps, rather than Ab, seven flats; and G# harmonic minor writes
 * its raised seventh F## as an accidental over that signature rather than
 * respelling the key. Where two signatures are equally long — pitch class 6 in
 * major is F# at +6 and Gb at -6 — the flat side is taken.
 *
 * Every other scale only borrows the signature of its parallel major or minor,
 * so nothing follows from it and the scale is spelled on the tonic it reads
 * best from: the fewest double accidentals first, then the fewest accidentals
 * altogether, and only then the shorter signature. That is why pitch class 1
 * altered is C# — C# D E F G A B — rather than Db, which would have to write
 * four double flats to say the same thing, and why pitch class 8 minor
 * pentatonic is G# B C# D# F# rather than Ab B Db Eb Gb, which reads its third
 * as an augmented second.
 *
 * The mask's third picks the mode the signature is measured in — a minor third
 * and no major third reads as minor, anything else as major — and the key is
 * returned unchanged, so a scale keeps its own mask and only borrows a tonic
 * spelling. A caller that has a tonic spelling of its own always keeps it: this
 * only answers for a key that arrives as a bare pitch class.
 *
 * Every 12-bit mask and every integer root is answered — a root outside [0, 11]
 * is reduced first, and a mask with no third at all counts as major.
 *
 * The key is paired with the answer exactly as it was handed in, root and mask
 * untouched, so this takes a plain key/scale rather than the wider forms the
 * relations below accept: a coerced key could not be given back verbatim.
 *
 * @param key The key/scale to spell.
 * @returns The conventional tonic spelling, paired with `key` verbatim.
 * @example
 * ```ts
 * import { formatNote, majorKey, scaleByName, spelledKeyOf } from '@libraz/libcantus';
 * formatNote(spelledKeyOf(majorKey(1)).tonic); // 'Db'
 * formatNote(spelledKeyOf(scaleByName('harmonicMinor', 8)).tonic); // 'G#'
 * formatNote(spelledKeyOf(scaleByName('altered', 1)).tonic); // 'C#'
 * ```
 * @category Scales
 */
export function spelledKeyOf(key: KeyScale): ResolvedKey {
  const scale = key;
  const rootPc = pitchClassOf(scale.rootPc);
  const signatureKey = isSignatureKey(scale);
  // Every pitch class is named somewhere in the span, so the starting tonic here
  // only stands in until the scan makes its first match.
  let tonic: Note = keyFromFifths(0).tonic;
  let best: TonicCost | undefined;
  // Scanning from the flat end and keeping only a strictly better candidate
  // settles an even tie on the flat side: pitch class 6 in major is Gb, and
  // pitch class 3 in minor is Eb.
  for (let fifths = FLATTEST_TONIC_FIFTHS; fifths <= SHARPEST_TONIC_FIFTHS; fifths += 1) {
    const candidate = keyFromFifths(fifths).tonic;
    if (noteToPitchClass(candidate) !== rootPc) {
      continue;
    }
    const cost = tonicCost(candidate, scale);
    if (best === undefined || spellsBetter(cost, best, signatureKey)) {
      tonic = candidate;
      best = cost;
    }
  }
  return { tonic, scale: key, variant: variantOfMask(key.modeMask12) };
}

/**
 * The relative key: for a plain major or minor key, the same key signature read
 * in the other mode.
 *
 * C major and A minor share a signature, and so are each other's relative; the
 * relation is its own inverse for a plain major or minor key. Because the new
 * tonic is read off the circle of fifths rather than transposed by semitones,
 * the relative of Db major is Bb minor and not its enharmonic A# minor.
 *
 * A key that is not a plain major or minor is read through the mode its third
 * names and stepped from where its tonic stands on the circle, the origin every
 * relation here shares: the relative of D dorian is F major, the relative of the
 * D minor its third names. The shared-signature reading does not carry over to
 * those — D dorian is written with no accidentals and F major with one — and the
 * modes have no relative of their own for it to be measured against.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`; its mask
 *   decides which mode the relative is in.
 * @returns The relative key and the tonic spelling it is written with.
 * @throws If the tonic or the mask is malformed, or if the resulting signature
 *   falls outside [-12, 12] fifths.
 * @example
 * ```ts
 * import { formatNote, majorKey, parseNote, relativeKeyOf } from '@libraz/libcantus';
 * formatNote(relativeKeyOf(parseNote('C'), majorKey(0)).tonic); // 'A'
 * formatNote(relativeKeyOf('Db', majorKey(1)).tonic); // 'Bb'
 * ```
 * @category Scales
 */
export function relativeKeyOf(tonic: NoteLike, key: KeyLike): ResolvedKey {
  const mode = modeOf(toKeyScale(key));
  // Counted from where the tonic itself stands on the circle, as every other
  // relation here counts: a mode's own signature carries an offset that
  // `keyFromFifths` cannot give back, so stepping from it would answer C major
  // for D dorian — the key one of its own neighbours already names — instead of
  // the F major a fifth flatter.
  return keyFromFifths(tonicFifths(toNoteData(tonic), mode), oppositeMode(mode));
}

/**
 * The parallel key: the other mode on the same tonic.
 *
 * The tonic keeps the spelling it was given — the parallel minor of C major is
 * C minor, never B# minor — which is why this is the one relation here that
 * does not travel the circle of fifths.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`; its letter and alteration are kept.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`; its mask
 *   decides which mode the parallel is in.
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
export function parallelKeyOf(tonic: NoteLike, key: KeyLike): ResolvedKey {
  const note = toNoteData(tonic);
  const mode = oppositeMode(modeOf(toKeyScale(key)));
  // The spelled tonic decides the root, so the returned key and its tonic agree
  // even when the caller's `rootPc` was left on the other mode's root.
  const rootPc = noteToPitchClass(note);
  const scale = mode === 'minor' ? minorKey(rootPc) : majorKey(rootPc);
  return {
    tonic: { letter: diatonicLetterOf(note.letter), alter: note.alter },
    scale,
    variant: variantOfMask(scale.modeMask12),
  };
}

/** Where a spelled tonic itself stands on the circle of fifths: C at 0, F# at +6. */
function tonicPosition(tonic: Note): number {
  return keySignatureFifths(tonic, majorKey(noteToPitchClass(tonic)));
}

/**
 * The signature the tonic's own plain major or minor key is written with.
 *
 * This, and not the key's signature, is what a relation that travels the circle
 * steps from. The two agree for a plain major or minor key and part company
 * everywhere else: G mixolydian has the signature of C major, so stepping from
 * that signature and reading the tonic back with {@link keyFromFifths} — which
 * knows only the major and minor offsets — would answer G major, a unison
 * above, instead of D, a fifth above.
 */
function tonicFifths(tonic: Note, mode: KeyMode): number {
  return tonicPosition(tonic) - (mode === 'minor' ? MINOR_TONIC_FIFTHS : 0);
}

/**
 * Whether a key is actually written on this tonic — the same question
 * {@link spelledKeyOf} asks, and answered the same way.
 *
 * A key with a signature of its own is written wherever that signature is: up
 * to seven sharps or flats, which is what makes Ab minor and G# minor two
 * spellings of one key and D# major none at all. A scale that only borrows a
 * signature is written wherever it reads without a double accidental.
 */
function isWrittenTonic(tonic: Note, key: KeyScale): boolean {
  const position = tonicPosition(tonic);
  if (position < FLATTEST_TONIC_FIFTHS || position > SHARPEST_TONIC_FIFTHS) {
    return false;
  }
  return isSignatureKey(key)
    ? Math.abs(keySignatureFifths(tonic, key)) <= MAX_CONVENTIONAL_FIFTHS
    : tonicCost(tonic, key).doubles === 0;
}

/**
 * The dominant key: the key a fifth above, in the mode this key's third names.
 *
 * The fifth is measured from the tonic, so a key that is not a plain major or
 * minor answers with the same move: the dominant of G mixolydian is D major and
 * the dominant of D dorian is A minor.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`; its mask
 *   decides the mode of the result.
 * @returns The key a fifth above, in the mode this key's third names.
 * @throws If the tonic or the mask is malformed, or if the resulting signature
 *   falls outside [-12, 12] fifths — the dominant of a key already at +12.
 * @example
 * ```ts
 * import { dominantKeyOf, formatNote, majorKey, parseNote } from '@libraz/libcantus';
 * formatNote(dominantKeyOf(parseNote('C'), majorKey(0)).tonic); // 'G'
 * ```
 * @category Scales
 */
export function dominantKeyOf(tonic: NoteLike, key: KeyLike): ResolvedKey {
  const mode = modeOf(toKeyScale(key));
  return keyFromFifths(tonicFifths(toNoteData(tonic), mode) + 1, mode);
}

/**
 * The subdominant key: the key a fifth below, in the mode this key's third
 * names, and the exact inverse of {@link dominantKeyOf} on the tonic spelling.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`; its mask
 *   decides the mode of the result.
 * @returns The key a fifth below, in the mode this key's third names.
 * @throws If the tonic or the mask is malformed, or if the resulting signature
 *   falls outside [-12, 12] fifths — the subdominant of a key already at -12.
 * @example
 * ```ts
 * import { formatNote, majorKey, parseNote, subdominantKeyOf } from '@libraz/libcantus';
 * formatNote(subdominantKeyOf(parseNote('C'), majorKey(0)).tonic); // 'F'
 * ```
 * @category Scales
 */
export function subdominantKeyOf(tonic: NoteLike, key: KeyLike): ResolvedKey {
  const mode = modeOf(toKeyScale(key));
  return keyFromFifths(tonicFifths(toNoteData(tonic), mode) - 1, mode);
}

/**
 * The same sounding key written the other way round the circle of fifths, or
 * null when it has no second spelling.
 *
 * Twelve fifths is one enharmonic turn of the circle, so a tonic's alternative
 * spelling sits at its own position ±12: Db (-5) is also C# (+7). It is offered
 * only when the key is actually written there, by the same test
 * {@link spelledKeyOf} spells with. That is why C major is alone while Db major
 * and F# major each answer with their twin: Eb major's twin would be D# major
 * and its nine sharps, and pitch class 3 altered is written D# but never Eb,
 * which would need two double flats to say the same thing.
 *
 * The answer is therefore always a spelling the key is written on, which makes
 * the relation its own inverse for such a key. A key spelled some other way —
 * a tonic a transposition drove out to Ebb, say — still names its written twin,
 * so this is also the way back from a spelling no one writes.
 *
 * The relation respells rather than moves, so the mask is kept: the other
 * spelling of C# lydian is Db lydian, and its root pitch class is the one it
 * was handed.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`; its mask
 *   decides the mode the tonic is read in, and is carried into the result.
 * @returns The other spelling of the key, or null when it is not written.
 * @throws If the tonic or the mask is malformed.
 * @example
 * ```ts
 * import { enharmonicKeyOf, formatNote, majorKey, parseNote } from '@libraz/libcantus';
 * const other = enharmonicKeyOf(parseNote('Db'), majorKey(1));
 * other === null ? 'none' : formatNote(other.tonic); // 'C#'
 * enharmonicKeyOf('C', majorKey(0)); // null
 * ```
 * @category Scales
 */
export function enharmonicKeyOf(tonic: NoteLike, key: KeyLike): ResolvedKey | null {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  assertModeMask(scale);
  for (const position of [
    tonicPosition(note) - ENHARMONIC_FIFTHS,
    tonicPosition(note) + ENHARMONIC_FIFTHS,
  ]) {
    if (position < FLATTEST_TONIC_FIFTHS || position > SHARPEST_TONIC_FIFTHS) {
      continue;
    }
    const spelled = keyFromFifths(position).tonic;
    if (!isWrittenTonic(spelled, scale)) {
      continue;
    }
    return {
      tonic: spelled,
      // The mask is the caller's; only the root is re-read, so a tonic that did
      // not spell the mask's own root still comes back consistent.
      scale: { rootPc: noteToPitchClass(spelled), modeMask12: scale.modeMask12 },
      variant: variantOfMask(scale.modeMask12),
    };
  }
  return null;
}

/** The relative of the dominant key: two moves along the circle, then across. */
function relativeOfDominantKeyOf(tonic: Note, key: KeyScale): ResolvedKey {
  const dominant = dominantKeyOf(tonic, key);
  return relativeKeyOf(dominant.tonic, dominant.scale);
}

/** The relative of the subdominant key. */
function relativeOfSubdominantKeyOf(tonic: Note, key: KeyScale): ResolvedKey {
  const subdominant = subdominantKeyOf(tonic, key);
  return relativeKeyOf(subdominant.tonic, subdominant.scale);
}

/**
 * The closely related keys, in the order {@link relatedKeysOf} reports them and
 * {@link keyRelationBetween} tests them.
 */
const CLOSELY_RELATED: readonly {
  relation: KeyRelation;
  of: (tonic: Note, key: KeyScale) => ResolvedKey;
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
 * These are the keys the German and Japanese teaching tradition counts as a
 * key's near relations: the relative and parallel keys, the dominant and the
 * subdominant, and the relatives of those two. For C major they are A minor,
 * C minor, G major, F major, E minor and D minor, in that order. For a plain
 * major or minor key five of them are written within one accidental of the key's
 * own signature — the relative shares it exactly and the other four stand one
 * away; the parallel key does not — C minor is three flats away from C major —
 * and belongs to the set for the tonic it shares rather than for the signature
 * it carries.
 *
 * A key that is not a plain major or minor is read through the mode its third
 * names, so its relations are walked from where its tonic stands on the circle
 * rather than from its own signature, and the accidental counts above do not
 * describe them: the relative of D dorian is F major, one flat against dorian's
 * none.
 *
 * @param tonic The spelled tonic of the key, as a note name, note data, or a
 *   `Note`.
 * @param key The key/scale, as a key name, a key/scale, or a `Key`.
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
  tonic: NoteLike,
  key: KeyLike,
): (ResolvedKey & { relation: KeyRelation })[] {
  const note = toNoteData(tonic);
  const scale = toKeyScale(key);
  return CLOSELY_RELATED.map(({ relation, of }) => ({ ...of(note, scale), relation }));
}

/**
 * How the second key stands to the first, or null when they are not related.
 *
 * The relations are tested in a fixed order — identity, enharmonic spelling,
 * then the six closely related keys in the order {@link relatedKeysOf} lists
 * them — and the first match is reported. Only the identity test looks at the
 * tonic spelling; every other test compares root pitch class and mode, so
 * C# minor and Db minor both read as the relative of E major.
 *
 * Both keys are read through the mode their third names, exactly as
 * {@link relatedKeysOf} reads the key it is given, so A harmonic minor stands
 * to C major as A minor does whichever of the two is asked about. That is what
 * makes the answer symmetric: if one key's related keys name the other, the
 * relation between them is reported from either side.
 *
 * @param a The key the relation is measured from.
 * @param b The key the relation is measured to.
 * @returns The relation, or null when `b` is none of `a`'s related keys.
 * @throws If either key is malformed, or if a neighbouring signature of `a`
 *   falls outside [-12, 12] fifths.
 * @example
 * ```ts
 * import { keyRelationBetween, majorKey, minorKey, parseNote } from '@libraz/libcantus';
 * const cMajor = spelledKeyOf(majorKey(0));
 * keyRelationBetween(cMajor, spelledKeyOf(minorKey(9))); // 'relative'
 * keyRelationBetween(cMajor, spelledKeyOf(minorKey(3))); // null
 * ```
 * @category Scales
 */
export function keyRelationBetween(a: ResolvedKey, b: ResolvedKey): KeyRelation | null {
  assertModeMask(a.scale, 'a.scale');
  assertModeMask(b.scale, 'b.scale');
  if (soundsLike(a.scale, b.scale)) {
    return spelledLike(a.tonic, b.tonic) ? 'same' : 'enharmonic';
  }
  for (const { relation, of } of CLOSELY_RELATED) {
    if (soundsLike(of(a.tonic, a.scale).scale, b.scale)) {
      return relation;
    }
  }
  return null;
}
