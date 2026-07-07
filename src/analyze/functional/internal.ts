/**
 * Shared helpers for the functional-harmony modules.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { scaleTonesInDegreeOrder } from '../../theory/scale/index.js';

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Diatonic pitch class of a 1-based scale degree in a key. */
export function degreeRootPc(degreeNumber: number, key: KeyScale): number {
  const tones = scaleTonesInDegreeOrder(key);
  if (tones.length === 0) {
    return mod12(key.rootPc);
  }
  return tones[(degreeNumber - 1) % tones.length] ?? mod12(key.rootPc);
}

/** Whether a chord is the Neapolitan: a major triad on the flat second degree. */
export function isNeapolitan(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 1 && chord.quality === 'maj';
}
