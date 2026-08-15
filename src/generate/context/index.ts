/**
 * The generation context: one seed, one set of dials, one tempo, shared by
 * every generator.
 *
 * Before it, each generator carried its own idea of "how involved should this
 * be" — a 0..1 density here, a style name there, a boolean somewhere else — and
 * only the drums knew the tempo. A context names those things once, so a piece
 * can be asked for at a given complexity in one place, and every part derives
 * its own randomness from the same project seed.
 */

import type { InstrumentProfile } from '../../core/instrument/index.js';
import {
  createPositionalRng,
  deriveSeed,
  type PositionalRng,
  resolveAlgorithmVersion,
} from '../../core/random/index.js';
import { assertInteger, assertRange } from '../../core/validation/index.js';
import { assertVocabulary, type Vocabulary } from '../vocabulary/types.js';
import { assertDifficulty } from './difficulty.js';
import { type Draw, drawsFrom } from './draw.js';

export {
  assertDifficulty,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  sustainsShift,
  sustainsStrokes,
} from './difficulty.js';
export type { Draw } from './draw.js';
export { drawsFrom } from './draw.js';

/**
 * How involved the generated music should be, on axes that do not imply one
 * another.
 *
 * The first three ask for more of something and are continuous: moving one of
 * them adds material without disturbing what is already sounding.
 * {@link Complexity.difficulty} is not one of those — it is a ceiling, and it
 * only ever takes candidates away.
 *
 * @category Composition
 */
export type Complexity = {
  /** Subdivision and syncopation, in [0, 1]. */
  rhythmic?: number;
  /** Tension, substitution and passing chords, in [0, 1]. */
  harmonic?: number;
  /** Ghosts, flams and decoration, in [0, 1]. */
  ornament?: number;
  /**
   * The hardest the result may be to play, from 1 (a beginner's part) to 5 (at
   * the limit of the instrument). It is a ceiling rather than a strength:
   * "involved but easy" and "plain but hard" are both real requests, so this
   * filters what the other three proposed instead of scaling it. It governs the
   * timing layer alone — whether the note exists on the instrument, and whether
   * the shape can be held, follow from {@link GenerationContext.instruments} and
   * apply whatever the ceiling says.
   */
  difficulty?: number;
};

/**
 * Everything a generator needs that is not about the notes themselves.
 *
 * @category Composition
 */
export type GenerationContext = {
  /** The project seed every part derives its own randomness from. */
  seed: number;
  /** The dials; see {@link Complexity}. */
  complexity?: Complexity;
  /**
   * Draw from this source instead of one derived from `seed`. Each part still
   * addresses its own namespace, so parts do not collide.
   */
  rng?: PositionalRng;
  /**
   * The instruments the parts are written for, keyed by part name — `'bass'`,
   * `'drums'`. Naming one is itself the request that the part be playable on
   * it, so its range and physical limits always apply.
   */
  instruments?: Record<string, InstrumentProfile>;
  /**
   * Tempo in quarter-note beats per minute. Without it no generator can judge
   * whether a passage is reachable in the time available, so a ceiling on
   * difficulty has nothing to measure against.
   */
  bpm?: number;
  /**
   * The algorithm version to generate under; defaults to the version this build
   * produces. See {@link resolveAlgorithmVersion} for what the number promises.
   */
  algorithmVersion?: number;
  /**
   * Figures this piece may draw on, over and above the library's own.
   *
   * Genres are endless, which is the reason the vocabulary is data at all: a
   * caller brings the dictionary for the music it is writing instead of waiting
   * for the library to grow one. Entries for every part travel in one list —
   * each generator recognises its own material by shape — and an entry carrying
   * the id of a built-in replaces it rather than being offered alongside.
   */
  vocabulary?: readonly Vocabulary<unknown>[];
};

/**
 * A context, or just the seed for one.
 *
 * A bare number is sugar for `{ seed }`: the common case is a caller who wants
 * reproducible output and nothing else.
 *
 * @category Composition
 */
export type GenerationContextInput = GenerationContext | number;

/**
 * A context with everything resolved: dials validated, tempo and ceiling
 * settled, and a positional source ready for each part.
 */
export type ResolvedContext = {
  seed: number;
  /** Requested rhythmic density, or undefined when the caller named none. */
  rhythmic: number | undefined;
  /** Requested harmonic richness, or undefined when the caller named none. */
  harmonic: number | undefined;
  /** Requested ornament density, or undefined when the caller named none. */
  ornament: number | undefined;
  /** The difficulty ceiling, or undefined for no ceiling. */
  difficulty: number | undefined;
  /** Tempo in BPM, or undefined when the caller named none. */
  bpm: number | undefined;
  /** The resolved algorithm version. */
  algorithmVersion: number;
  /** The profile written for a part, if one was named for it. */
  instrument: (part: string) => InstrumentProfile | undefined;
  /** The figures the caller brought, validated; empty when it brought none. */
  vocabulary: readonly Vocabulary<unknown>[];
  /** The position-addressed samplers for a part. */
  part: (name: string) => Draw;
};

/** The seed a generator uses when the caller names none. */
const DEFAULT_SEED = 0;

/** Path segment separating one algorithm version's draws from another's. */
const VERSION_SEGMENT = 'v';

/**
 * Resolve a context (or a bare seed) into the form the generators use.
 *
 * The algorithm version takes part in every derivation, so two versions never
 * share a draw: pinning one is what makes a saved project reopen as the piece
 * it was, and a version this build does not produce is rejected rather than
 * quietly rendered as another.
 *
 * @param input The context, the seed alone, or nothing.
 * @returns The resolved context.
 * @throws If the seed is not a 32-bit integer, a dial is out of range, the
 *   tempo is not positive, or the algorithm version is unknown.
 * @example
 * ```ts
 * import { resolveContext } from '@libraz/libcantus';
 * const ctx = resolveContext({ seed: 42, complexity: { rhythmic: 0.8 }, bpm: 96 });
 * ctx.part('drums').prob(0.5, 'ghost', 1, 2); // the same answer however often it is asked
 * ```
 */
export function resolveContext(input?: GenerationContextInput): ResolvedContext {
  const ctx: GenerationContext =
    typeof input === 'number' ? { seed: input } : (input ?? { seed: DEFAULT_SEED });
  const seed = assertInteger(ctx.seed ?? DEFAULT_SEED, 'seed', 0, 0xffffffff);
  const complexity = ctx.complexity ?? {};
  const rhythmic =
    complexity.rhythmic === undefined
      ? undefined
      : assertRange(complexity.rhythmic, 0, 1, 'complexity rhythmic');
  const harmonic =
    complexity.harmonic === undefined
      ? undefined
      : assertRange(complexity.harmonic, 0, 1, 'complexity harmonic');
  const ornament =
    complexity.ornament === undefined
      ? undefined
      : assertRange(complexity.ornament, 0, 1, 'complexity ornament');
  const difficulty =
    complexity.difficulty === undefined ? undefined : assertDifficulty(complexity.difficulty);
  const bpm =
    ctx.bpm === undefined ? undefined : assertRange(ctx.bpm, Number.MIN_VALUE, 1000, 'bpm');
  const algorithmVersion = resolveAlgorithmVersion(ctx.algorithmVersion);
  const supplied = ctx.rng;
  const instruments = ctx.instruments;
  // Validated on the way in: an entry naming a difficulty of 40 would otherwise
  // clear every ceiling and be chosen for a beginner's part.
  const vocabulary = (ctx.vocabulary ?? []).map((entry, index) =>
    assertVocabulary(entry, `vocabulary[${index}]`),
  );

  return {
    seed,
    rhythmic,
    harmonic,
    ornament,
    difficulty,
    bpm,
    algorithmVersion,
    instrument: (part) => instruments?.[part],
    vocabulary,
    part: (name) =>
      supplied
        ? drawsFrom(supplied, name, VERSION_SEGMENT, algorithmVersion)
        : drawsFrom(createPositionalRng(deriveSeed(seed, name, VERSION_SEGMENT, algorithmVersion))),
  };
}

/**
 * Merge a generator's own options into a context.
 *
 * Every generator kept a `seed` of its own, the drums a `bpm`, and the drums
 * and the rhythm generator a `density`; those stay, as the short way to say the
 * same thing. Where both are given the context wins, since it is the one thing
 * that speaks for the whole piece.
 *
 * @param input The context or bare seed, if any.
 * @param sugar The generator's own options.
 * @returns The resolved context, with the sugar filled in where the context was
 *   silent.
 */
export function resolveContextWith(
  input: GenerationContextInput | undefined,
  sugar: { seed?: number; bpm?: number; rhythmic?: number; ornament?: number },
): ResolvedContext {
  const base = resolveContext(
    input ?? (sugar.seed === undefined ? undefined : { seed: sugar.seed }),
  );
  const bpm =
    base.bpm ??
    (sugar.bpm === undefined ? undefined : assertRange(sugar.bpm, Number.MIN_VALUE, 1000, 'bpm'));
  const rhythmic =
    base.rhythmic ??
    (sugar.rhythmic === undefined
      ? undefined
      : assertRange(sugar.rhythmic, 0, 1, 'complexity rhythmic'));
  const ornament =
    base.ornament ??
    (sugar.ornament === undefined
      ? undefined
      : assertRange(sugar.ornament, 0, 1, 'complexity ornament'));
  return { ...base, bpm, rhythmic, ornament };
}
