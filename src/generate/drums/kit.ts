import type { Articulation, Limb, PercussionProfile } from '../../core/instrument/index.js';
import { LIMBS } from '../../core/instrument/index.js';
import { DRUM_NOTES, type DrumVoice } from './hit.js';

/** Which limbs reach each voice, in the order a player would take them. */
const REACH_BY_VOICE: Readonly<Record<DrumVoice, readonly Limb[]>> = {
  kick: ['rightFoot'],
  pedalHiHat: ['leftFoot'],
  // The left hand rests on the snare and the right on the timekeeping voices;
  // either can cross over, which is what the second entry allows.
  snare: ['leftHand', 'rightHand'],
  sideStick: ['leftHand', 'rightHand'],
  handClap: ['leftHand', 'rightHand'],
  tambourine: ['leftHand', 'rightHand'],
  closedHiHat: ['rightHand', 'leftHand'],
  openHiHat: ['rightHand', 'leftHand'],
  ride: ['rightHand', 'leftHand'],
  crash: ['rightHand', 'leftHand'],
  highTom: ['rightHand', 'leftHand'],
  midTom: ['rightHand', 'leftHand'],
  lowTom: ['rightHand', 'leftHand'],
  shaker: ['rightHand', 'leftHand'],
};

/** The reach table keyed the way a hit is: by General MIDI note number. */
function reachByNote(): Record<number, readonly Limb[]> {
  const reach: Record<number, readonly Limb[]> = {};
  for (const [voice, limbs] of Object.entries(REACH_BY_VOICE) as [DrumVoice, readonly Limb[]][]) {
    reach[DRUM_NOTES[voice]] = limbs;
  }
  return reach;
}

/** Ornaments a kit produces; the string techniques are not among them. */
const KIT_ARTICULATIONS: readonly Articulation[] = Object.freeze([
  'accent',
  'ghost',
  'staccato',
  'mute',
  'flam',
  'drag',
  'roll',
  'choke',
  'open',
] as const);

/**
 * A drum kit played with four limbs, covering every voice
 * {@link generateDrums} emits.
 *
 * A kit is bounded by limbs rather than by range: two voices wanting the same
 * hand at the same instant is what makes a pattern unplayable, and a voice no
 * limb reaches is not on the kit at all.
 *
 * @example
 * ```ts
 * import { DRUM_KIT, generateDrums, playability } from '@libraz/libcantus';
 * const hits = generateDrums({ bars: 1, bpm: 120, style: 'funk', section: 'chorus', density: 0.8 });
 * const report = playability(hits, DRUM_KIT, 120);
 * ```
 * @category Composition
 */
export const DRUM_KIT: PercussionProfile = Object.freeze({
  kind: 'percussion',
  name: 'drum kit',
  limbs: LIMBS,
  reach: Object.freeze(reachByNote()),
  articulations: KIT_ARTICULATIONS,
  polyphony: 4,
});
