import { InvalidInputError } from '../../core/errors/index.js';
import type { Note } from '../../core/pitch/index.js';
import { formatNote, noteToPitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { type KeyLike, toKeyScale } from './coerce.js';
import type { KeyVariant, ResolvedKey } from './kinds.js';
import { assertKeyVariant, variantOfMask } from './masks.js';
import { resolveKeyName } from './name.js';
import { spelledKeyOf } from './relations.js';

/**
 * A key's whole identity, and the one resolver that produces it.
 *
 * A key is three facts, and the library used to keep them in three layers: the
 * pitch classes in the core, the spelled tonic in the theory, the scale form in
 * the analysis. Only the topmost layer could hold all three, so a key handed
 * down from there arrived as pitch classes and came back spelled from whichever
 * side of the circle read best — an Ab minor went down and a G# minor came up.
 *
 * The three are one value here, low enough that every layer that reads a key
 * can carry it whole. Reducing a key to its pitch classes is still a thing a
 * caller may need, but it is now something written down at the place it
 * happens, rather than what happens by default on the way past.
 */

export type { KeyVariant, ResolvedKey };
export { assertKeyVariant, variantOfMask };

/** Whether a value carries the fields a resolved key is read through. */
function carriesIdentity(value: unknown): value is { tonic?: Note; variant?: KeyVariant } {
  return typeof value === 'object' && value !== null;
}

/**
 * A carried tonic, refused when it spells a pitch class the scale is not rooted
 * on.
 *
 * A key whose tonic and scale disagree is two answers to what the key is, and
 * nothing downstream can tell which was meant: the chord builders read the
 * pitch classes and the spellers read the letters, so an augmented sixth comes
 * back naming one chord by its pitches and another by its letters. The words
 * are `Key.of`'s, because a resolver that accepted what the class refuses would
 * make the two APIs answer the same input differently.
 */
function carriedTonic(tonic: Note, scale: KeyScale): Note {
  if (noteToPitchClass(tonic) !== scale.rootPc) {
    throw new InvalidInputError(
      `tonic ${formatNote(tonic)} does not match the scale root pitch class ${scale.rootPc}; ` +
        'pass a tonic that spells the scale root, or omit it to have one chosen',
    );
  }
  return { letter: tonic.letter, alter: tonic.alter };
}

/** A carried scale form, refused when the mask it arrived with does not hold it. */
function carriedVariant(variant: KeyVariant, scale: KeyScale): KeyVariant {
  assertKeyVariant(variant, scale.modeMask12);
  return variant;
}

/**
 * Resolve any key-shaped value to the whole key it names.
 *
 * The counterpart of {@link toKeyScale}, and the one to prefer: both read the
 * same shapes, but this one keeps what it read. A caller that genuinely wants
 * only the pitch classes asks for them with {@link scaleOf}, which says so at
 * the place it happens.
 *
 * What the value does not carry is derived rather than dropped: a bare scale is
 * spelled by {@link spelledKeyOf}, the same reading the rest of the library
 * uses, and its form is read from its mask. A key that carries a spelled tonic
 * keeps that one — the caller's spelling outranks any the library would pick.
 * A name carries one too, and it is kept: `'Ab minor'` resolves to an A flat
 * minor rather than being reduced to pitch classes and spelled back as the G#
 * minor those read best as.
 *
 * What it carries is checked rather than trusted. Accepting a wide range of
 * shapes is not the same as accepting whatever those shapes hold, and a key
 * whose tonic or form contradicts its own scale is refused here in the words
 * `Key.of` refuses it — the two APIs answer the same input alike, and the
 * refusal reaches every entry point built on this one.
 *
 * @param value A key name, a plain key/scale, a resolved key, or a value whose
 *   `toJSON` returns one of those.
 * @returns The key, whole.
 * @throws If the value names no key, its mask is out of range or excludes its
 *   own root, its tonic spells a pitch class its scale is not rooted on, or its
 *   form is not one that mask holds.
 * @example
 * ```ts
 * import { formatNote, resolveKey } from '@libraz/libcantus';
 * formatNote(resolveKey('Ab minor').tonic); // 'Ab'
 * resolveKey('C major').tonic.letter; // 0
 * ```
 * @category Scales
 */
export function resolveKey(value: KeyLike): ResolvedKey {
  if (typeof value === 'string') {
    return resolveKeyName(value);
  }
  const scale = toKeyScale(value);
  const carried =
    carriesIdentity(value) && 'toJSON' in value && typeof value.toJSON === 'function'
      ? (value.toJSON() as unknown)
      : value;
  const tonic =
    carriesIdentity(carried) && carried.tonic !== undefined
      ? carriedTonic(carried.tonic, scale)
      : spelledKeyOf(scale).tonic;
  const variant =
    carriesIdentity(carried) && carried.variant !== undefined
      ? carriedVariant(carried.variant, scale)
      : variantOfMask(scale.modeMask12);
  return { scale, tonic, variant };
}

/**
 * The pitch classes of a key, with its spelling and form deliberately dropped.
 *
 * Named so that dropping them is something a reader can see. A layer that
 * reduces a key silently is where an Ab minor becomes a G# minor, and the only
 * way to keep finding those is to make the reduction say its own name.
 *
 * @param key The key to read.
 * @returns Its pitch classes alone.
 * @category Scales
 */
export function scaleOf(key: ResolvedKey): KeyScale {
  return key.scale;
}
