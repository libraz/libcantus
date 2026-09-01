import type { Note } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { type KeyLike, type KeyVariant, toKeyScale } from './coerce.js';
import { assertKeyVariant, variantOfMask } from './masks.js';
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

export type { KeyVariant };
export { assertKeyVariant, variantOfMask };

/**
 * The complete identity of a key: what it sounds, how it is written, and which
 * scale form it stands in.
 *
 * What {@link resolveKey} hands back, and the shape a key is passed on in. Every
 * field is present: a key that reaches here has been read, so there is nothing
 * left undecided about it, and a reader never has to ask whether a missing
 * field means `'modal'` or means nobody looked.
 *
 * @category Scales
 */
export type ResolvedKey = {
  /** The pitch classes the key is built from. */
  readonly scale: KeyScale;
  /** The spelled tonic every letter name derived from this key is anchored on. */
  readonly tonic: Note;
  /** The scale form the key stands in. */
  readonly variant: KeyVariant;
};

/** Whether a value carries the fields a resolved key is read through. */
function carriesIdentity(value: unknown): value is { tonic?: Note; variant?: KeyVariant } {
  return typeof value === 'object' && value !== null;
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
 *
 * @param value A key name, a plain key/scale, a resolved key, or a value whose
 *   `toJSON` returns one of those.
 * @returns The key, whole.
 * @throws If the value names no key, or its mask is out of range or excludes
 *   its own root.
 * @example
 * ```ts
 * import { resolveKey } from '@libraz/libcantus';
 * resolveKey('Ab minor').variant; // 'natural'
 * resolveKey('C major').tonic.letter; // 0
 * ```
 * @category Scales
 */
export function resolveKey(value: KeyLike): ResolvedKey {
  const scale = toKeyScale(value);
  const carried =
    carriesIdentity(value) && 'toJSON' in value && typeof value.toJSON === 'function'
      ? (value.toJSON() as unknown)
      : value;
  const tonic =
    carriesIdentity(carried) && carried.tonic !== undefined
      ? { letter: carried.tonic.letter, alter: carried.tonic.alter }
      : spelledKeyOf(scale).tonic;
  const variant =
    carriesIdentity(carried) && carried.variant !== undefined
      ? carried.variant
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
