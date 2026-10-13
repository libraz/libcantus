/**
 * Every playing technique a note can carry, in declaration order.
 *
 * These name intent, not a rendering: how `flam` becomes a grace stroke or
 * `slide` becomes pitch bend is the caller's decision, because it depends on the
 * sampler, key switches, and controller layout in use. Carrying the intent
 * instead of a baked note pair is what lets any phrase be flammed, ghosted, or
 * muted without the generator having to know how it will be voiced.
 *
 * @category Core
 */
export const ARTICULATIONS = Object.freeze([
  'accent',
  'ghost',
  'staccato',
  'legato',
  'slide',
  'hammer',
  'mute',
  'flam',
  'drag',
  'roll',
  'choke',
  'open',
] as const);

/**
 * How a note is played, independent of its pitch and length.
 *
 * @category Core
 */
export type Articulation = (typeof ARTICULATIONS)[number];
