/**
 * Tonicization: which degrees a key can make a local tonic, which chords point
 * at one, and which seventh qualities the minor-key leading-tone numeral
 * convention covers.
 *
 * The function layer, the numeral layer and the part-writing checker all have
 * to answer "can this degree be tonicized?", and they answered it differently
 * for long enough that a diminished seventh could read as an applied dominant
 * in the same analysis object whose numeral refused to name a target for it.
 * The degrees themselves are derived one layer down, in `theory/tendency`,
 * which needs nothing but the key and which the checker can reach; what is
 * written here is what only this layer knows — the sonorities that point at a
 * degree, and the semitone fall a tritone substitute makes, which is the one
 * reading allowed to reach the tonic.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import type { TonicizableDegree } from '../../theory/tendency/index.js';
import {
  appliedDominantTarget,
  LEADING_TONE_QUALITIES,
  tonicizableDegrees,
} from '../../theory/tendency/index.js';
import { borrowedSourceOf } from './borrowed.js';
import { hasDominantSonority, isDiatonicChord, mod12, soundsDominantSeventh } from './internal.js';

/**
 * Which degrees of a key can be made a local tonic, and the type naming one.
 *
 * The derivation belongs to the theory layer, since it needs nothing but the
 * key: the part-writing checker asks it too, and cannot import this layer. It
 * is re-exported here because that is where the numeral and function layers
 * reach it, and where the package surface has always exposed it from.
 */
export type { TonicizableDegree };
/**
 * Diminished-family qualities.
 *
 * All three tonicize from a semitone below, and all three are what the bare
 * `viio` family of numerals means in a key whose seventh degree is lowered: the
 * fully diminished seventh and the half-diminished one stand on the same raised
 * leading tone and differ only in the colour of the sixth degree above it.
 */
export { LEADING_TONE_QUALITIES, tonicizableDegrees };

/** Whether a pitch class is a degree of `key` that can be made a local tonic. */
function isTonicizableRoot(rootPc: number, key: KeyScale): boolean {
  return tonicizableDegrees(key).some((degree) => degree.rootPc === mod12(rootPc));
}

/**
 * The scale degree a chromatic chord tonicizes as a numeral names it, or null
 * when it tonicizes nothing.
 *
 * A dominant sonority points a fifth below itself and a diminished one a
 * semitone above itself; which degrees may be pointed at is
 * {@link appliedDominantTarget}, so the tonic is not among them — a chord
 * pointing there is the key's own dominant, and `V/I` is a numeral no harmony
 * text writes.
 */
export function appliedTarget(chord: Chord, key: KeyScale): TonicizableDegree | null {
  const dominant = hasDominantSonority(chord);
  const leadingTone = LEADING_TONE_QUALITIES.has(chord.quality);
  if (!dominant && !leadingTone) {
    return null;
  }
  return appliedDominantTarget(chord.rootPc + (dominant ? 5 : 1), key);
}

/**
 * Whether a chord is an applied dominant: a chromatic chord whose sonority and
 * resolution give it dominant function whatever degree it stands on.
 *
 * Three things have to hold. The chord must be chromatic to the key, since a
 * diatonic chord keeps the function of its degree. It must not be modal
 * interchange: the Picardy tonic and the major IV of a minor key are borrowed
 * from the parallel major and sound their own degrees, and reading either as an
 * applied dominant would give the tonic chord dominant function. And it must
 * point at a degree that can be a local tonic.
 *
 * What counts as pointing is {@link appliedTarget}, the same predicate the
 * numeral layer names its target with, so a chord read as applied here always
 * has a numeral to be applied to. The tonic is not among those targets: a chord
 * pointing at it is the key's own dominant, which is why the raised `V7` of a
 * minor key and the altered dominants and leading-tone sevenths of a major one
 * take the function of their degree rather than tonicizing anything.
 *
 * The tritone substitute is the one reading that reaches the tonic. It is a
 * dominant seventh falling a semitone rather than a fifth, and nothing else
 * resolves that way, so it is asked for separately instead of loosening the
 * targets every other sonority is held to.
 */
export function isAppliedDominant(chord: Chord, key: KeyScale): boolean {
  if (isDiatonicChord(chord, key)) {
    return false;
  }
  const source = borrowedSourceOf(chord, key);
  if (source === 'parallelMajor' || source === 'parallelMinor') {
    return false;
  }
  if (appliedTarget(chord, key) !== null) {
    return true;
  }
  return soundsDominantSeventh(chord) && isTonicizableRoot(mod12(chord.rootPc - 1), key);
}
