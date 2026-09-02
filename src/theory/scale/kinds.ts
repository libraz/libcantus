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
/**
 * A key/scale with the spelling it is conventionally written in beside it.
 *
 * What the key builders hand back. It is a {@link KeyScale} — every reader that
 * wants only the pitch classes takes it unchanged — and it carries the tonic
 * those pitch classes are conventionally written on, so it also satisfies the
 * entry points whose answer depends on how the key is written.
 *
 * Carrying the spelling here is what lets those entry points refuse a bare
 * `KeyScale` without refusing the library's own builders. A bare scale reaching
 * one of them has had a spelling and lost it, which is the defect; a built key
 * never lost one.
 *
 * @category Scales
 */
export type SpelledKeyScale = KeyScale & {
  /** The tonic the key is conventionally written on. */
  tonic: Note;
  /** The scale form the mask stands in. */
  variant: KeyVariant;
};

/**
 * A key read into the three things every reader of one needs: the pitch
 * classes it is built from, the spelled tonic its letter names are anchored on,
 * and the scale form it stands in.
 *
 * What a key-shaped argument becomes once it has been read, whatever form the
 * caller held it in — a name, a scale, a `Key`. Carrying the tonic beside the
 * scale is what keeps an A flat minor an A flat minor rather than the G sharp
 * minor its pitch classes alone would be spelled back as.
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
