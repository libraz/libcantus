/**
 * How well a key suits the melody it is being asked to harmonize.
 *
 * Two readings, and they answer different questions: whether the line lies
 * where it can be sung or played, and whether its notes belong to the key at
 * all. A transposition search weighs both, since moving a melody changes where
 * it sits as much as it changes what it is written in.
 */

import type { KeyScale } from '../../core/types.js';
import { OUT_OF_KEY_PER_BEAT } from './cost.js';
import type { MelodyNote } from './internal.js';
import { isKeyTone } from './internal.js';

/** Comfortable melodic range (MIDI) and the per-semitone cost of leaving it. */
const COMFORT_LOW = 55;
const COMFORT_HIGH = 79;
const TESSITURA_WEIGHT = 0.001;
/**
 * Register cost of a placed melody: a small penalty for notes pushed outside a
 * comfortable range. Kept far below emission/transition costs so it only breaks
 * ties between otherwise-equal octave placements.
 */
export function tessituraCost(melody: readonly MelodyNote[]): number {
  let cost = 0;
  for (const n of melody) {
    if (n.pitch < COMFORT_LOW) {
      cost += (COMFORT_LOW - n.pitch) * TESSITURA_WEIGHT;
    } else if (n.pitch > COMFORT_HIGH) {
      cost += (n.pitch - COMFORT_HIGH) * TESSITURA_WEIGHT;
    }
  }
  return cost;
}
/**
 * How badly a placed melody sits in the key it is about to be harmonized in.
 *
 * This is what makes a transposition search mean "move the melody into this
 * key": a shift is judged by the melody's own key membership, not by how many
 * chord tones a chord path can be talked into covering. The winning shift
 * therefore always agrees with the key the result reports.
 */
export function keyFitCost(melody: readonly MelodyNote[], key: KeyScale): number {
  let cost = 0;
  for (const n of melody) {
    if (!isKeyTone(n.pitch, key)) {
      cost += Math.max(0.25, n.durationBeat) * OUT_OF_KEY_PER_BEAT;
    }
  }
  return cost;
}
