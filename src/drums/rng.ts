/**
 * The drum engine's PRNG, re-exported from the shared {@link ../random} module.
 * `DrumRng` is retained as the drum-facing name of the shared {@link Rng} type.
 */

export type { Rng as DrumRng } from '../random/index.js';
export { createRng } from '../random/index.js';
