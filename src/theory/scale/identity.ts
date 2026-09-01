import { InvalidInputError } from '../../core/errors/index.js';
import type { Note } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertOneOf } from '../../core/validation/index.js';
import { type KeyLike, type KeyVariant, toKeyScale } from './coerce.js';
import {
  HARMONIC_MINOR_MASK,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  NATURAL_MINOR_MASK,
} from './masks.js';
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

/** The mask each named form stands for, and the only place that pairing is written. */
const VARIANT_MASKS: Readonly<Record<Exclude<KeyVariant, 'modal'>, number>> = {
  major: MAJOR_MASK,
  natural: NATURAL_MINOR_MASK,
  harmonic: HARMONIC_MINOR_MASK,
  melodic: MELODIC_MINOR_MASK,
};

/**
 * The form a mask stands in, when it stands in one.
 *
 * A bare scale still names its form — a major mask is a major key whoever built
 * it — so the form is read from the mask rather than defaulted away. Only a
 * mask matching none of the four is modal.
 */
export function variantOfMask(modeMask12: number): KeyVariant {
  for (const [variant, mask] of Object.entries(VARIANT_MASKS)) {
    if (mask === modeMask12) {
      return variant as KeyVariant;
    }
  }
  return 'modal';
}

/** Every value a key's variant may hold, in a fixed order. */
const KEY_VARIANTS: readonly KeyVariant[] = [
  ...(Object.keys(VARIANT_MASKS) as Exclude<KeyVariant, 'modal'>[]),
  'modal',
];

/**
 * Refuse a scale form the key's own mask does not hold.
 *
 * A key whose variant says `'harmonic'` over a major mask prints as a harmonic
 * minor while comparing equal to plain C major, so a project file that carried
 * the two apart is refused where the mismatch is still an argument. Kept beside
 * the type it validates: the pairing of form and mask is written once, and
 * every construction path reads that one.
 *
 * @param variant The form claimed for the key.
 * @param modeMask12 The mask the key actually holds.
 * @throws If the form is not one a key may stand in, or the mask does not hold it.
 * @category Scales
 */
export function assertKeyVariant(variant: KeyVariant, modeMask12: number): void {
  assertOneOf(variant, KEY_VARIANTS, 'variant');
  const named = VARIANT_MASKS[variant as Exclude<KeyVariant, 'modal'>];
  const matches =
    named === undefined ? !Object.values(VARIANT_MASKS).includes(modeMask12) : named === modeMask12;
  if (!matches) {
    throw new InvalidInputError(
      `variant ${variant} does not match the scale mask ${modeMask12}; ` +
        'pass the scale that variant names, or omit the variant',
    );
  }
}

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
