import type { Articulation } from './articulation.js';
import type { StringedProfile } from './profile.js';

/** Techniques common to every fretted string instrument here. */
const STRINGED_ARTICULATIONS: readonly Articulation[] = Object.freeze([
  'accent',
  'ghost',
  'staccato',
  'legato',
  'slide',
  'hammer',
  'mute',
  'open',
] as const);

/**
 * Electric bass in standard tuning: E1 A1 D2 G2 over a 24-fret neck.
 *
 * @category Core
 */
export const BASS_4_STRING: StringedProfile = Object.freeze({
  kind: 'stringed',
  name: '4-string bass',
  tuning: Object.freeze([28, 33, 38, 43]),
  frets: 24,
  maxStretch: 4,
  articulations: STRINGED_ARTICULATIONS,
  polyphony: 4,
});

/**
 * Five-string bass with the low B: B0 E1 A1 D2 G2.
 *
 * @category Core
 */
export const BASS_5_STRING: StringedProfile = Object.freeze({
  kind: 'stringed',
  name: '5-string bass',
  tuning: Object.freeze([23, 28, 33, 38, 43]),
  frets: 24,
  maxStretch: 4,
  articulations: STRINGED_ARTICULATIONS,
  polyphony: 5,
});

/**
 * Six-string guitar in standard tuning: E2 A2 D3 G3 B3 E4.
 *
 * @category Core
 */
export const GUITAR_STANDARD: StringedProfile = Object.freeze({
  kind: 'stringed',
  name: 'guitar',
  tuning: Object.freeze([40, 45, 50, 55, 59, 64]),
  frets: 24,
  maxStretch: 5,
  articulations: STRINGED_ARTICULATIONS,
  polyphony: 6,
});

/**
 * Six-string guitar in drop D: the lowest string down a tone to D2, the rest
 * standard. Only the tuning differs, which is the whole point of deriving the
 * range from it.
 *
 * @category Core
 */
export const GUITAR_DROP_D: StringedProfile = Object.freeze({
  kind: 'stringed',
  name: 'guitar (drop D)',
  tuning: Object.freeze([38, 45, 50, 55, 59, 64]),
  frets: 24,
  maxStretch: 5,
  articulations: STRINGED_ARTICULATIONS,
  polyphony: 6,
});
