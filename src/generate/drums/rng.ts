/**
 * The drum engine's PRNG, re-exported from the shared {@link ../random} module.
 * `DrumRng` is retained as the drum-facing name of the shared {@link Rng} type.
 */

export type { Rng as DrumRng } from '../../core/random/index.js';
export { createRng } from '../../core/random/index.js';
