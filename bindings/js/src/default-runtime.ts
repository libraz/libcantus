/**
 * The runtime the generated exports call through, bound to the backend the
 * `#backend` import resolves to.
 */
import { backend } from '#backend';
import { TYPES } from './generated/meta.js';
import { Runtime } from './runtime.js';

/** The facade's runtime. */
export const runtime = new Runtime(backend, TYPES);
