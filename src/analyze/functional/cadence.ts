/**
 * Cadence detection between two successive chords.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { isMinorKey } from './function.js';
import { mod12 } from './internal.js';

/** Whether a chord can carry dominant function through its major third. */
function hasDominantThird(chord: Chord): boolean {
  return chord.intervals.some((interval) => mod12(interval) === 4);
}

/** Whether a leading-tone chord is a diminished-family resolution chord. */
function isLeadingToneDiminished(chord: Chord): boolean {
  return chord.quality === 'dim' || chord.quality === 'dim7' || chord.quality === 'm7b5';
}

/**
 * A recognized cadence type, or null when a chord pair forms none.
 *
 * @category Functional Harmony
 */
export type Cadence = 'authentic' | 'plagal' | 'half' | 'deceptive' | null;

/**
 * Classify the cadence formed by moving from one chord to the next.
 *
 * - authentic: V (dominant a fifth above the tonic) to I
 * - plagal: IV (a fourth above the tonic) to I
 * - deceptive: V to the submediant (diatonic vi or borrowed bVI in major, VI in
 *   minor)
 * - half: any chord other than the dominant itself to V
 *
 * A static V-to-V repeat with no root motion is not a cadence and yields null.
 *
 * @param from The penultimate chord.
 * @param to The final chord.
 * @param key The prevailing key.
 * @returns The cadence type, or null.
 * @example
 * ```ts
 * import { detectCadence, makeChord, majorKey } from '@libraz/libcantus';
 * detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), majorKey(0)); // => 'authentic'
 * ```
 * @category Functional Harmony
 */
export function detectCadence(from: Chord, to: Chord, key: KeyScale): Cadence {
  const tonic = mod12(key.rootPc);
  const fromOffset = mod12(from.rootPc - tonic);
  const toOffset = mod12(to.rootPc - tonic);
  // Deceptive targets: the diatonic submediant (vi at offset 9 in major, VI at
  // offset 8 in minor) plus, in a major key, the borrowed flat-submediant bVI
  // at offset 8.
  const deceptiveTargets = isMinorKey(key) ? [8] : [8, 9];
  const dominant = fromOffset === 7 && hasDominantThird(from);
  const leadingTone = fromOffset === 11 && isLeadingToneDiminished(from);
  if ((dominant || leadingTone) && toOffset === 0) {
    return 'authentic';
  }
  if (fromOffset === 5 && toOffset === 0) {
    return 'plagal';
  }
  if (dominant && deceptiveTargets.includes(toOffset)) {
    return 'deceptive';
  }
  // A move to the dominant is a half cadence, but a no-root-motion V-to-V repeat
  // is not a cadence at all.
  if (toOffset === 7 && hasDominantThird(to) && fromOffset !== 7) {
    return 'half';
  }
  return null;
}
