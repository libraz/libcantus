import type { Note } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';

/**
 * The vocabulary a key is described in.
 *
 * Kept in a module of its own, below the masks that define the scale forms, the
 * name reader that produces a key from text, and the coercion that accepts one
 * from a caller. All three name these types and none of them can be the others'
 * home without importing one back.
 */

/**
 * Which scale form a key stands in.
 *
 * `'modal'` is the honest answer for a key standing in none of the four, and it
 * is an answer rather than an absence.
 *
 * @category Scales
 */
export type KeyVariant = 'major' | 'natural' | 'harmonic' | 'melodic' | 'modal';

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
