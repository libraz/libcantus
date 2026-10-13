import type { Articulation, Limb, PercussionProfile } from '../../core/instrument/index.js';
import { LIMBS } from '../../core/instrument/index.js';
import { deepFreeze } from '../vocabulary/freeze.js';
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

/**
 * Voices a drum track lays over the kit on a take of their own.
 *
 * The groove commits both hands wherever it puts a hi-hat under a snare, so a
 * tambourine, a hand-clap or a shaker riding over it is a second pass rather
 * than a stroke the player has a hand free for — which is how these parts reach
 * a record, and why keeping them means overdubbing rather than thinning the
 * groove that carries them.
 */
const OVERDUB_VOICES: readonly DrumVoice[] = Object.freeze([
  'handClap',
  'tambourine',
  'shaker',
] as const);

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
 * The auxiliary percussion — hand-claps, tambourine, shaker — is dubbed over
 * the kit on a pass of its own, so it sounds through a backbeat whose snare and
 * hi-hat already take both hands, and the four limbs stay the bound on the
 * groove itself.
 *
 * @example
 * ```ts
 * import { DRUM_KIT, generateDrums, playability } from '@libraz/libcantus';
 * const hits = generateDrums({
 *   bars: 1,
 *   style: 'funk',
 *   section: 'chorus',
 *   ctx: { bpm: 120, complexity: { rhythmic: 0.8 } },
 * });
 * const report = playability(hits, DRUM_KIT, 120);
 * ```
 * @category Composition
 */
export const DRUM_KIT: PercussionProfile = Object.freeze({
  kind: 'percussion',
  name: 'drum kit',
  limbs: LIMBS,
  reach: deepFreeze(reachByNote()),
  overdub: deepFreeze(OVERDUB_VOICES.map((voice) => DRUM_NOTES[voice])),
  articulations: KIT_ARTICULATIONS,
  // One stroke per limb, and one more per voice dubbed over them.
  polyphony: LIMBS.length + OVERDUB_VOICES.length,
});
