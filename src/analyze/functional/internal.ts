/**
 * Shared helpers for the functional-harmony modules.
 *
 * Roots are pitch classes measured against the key tonic, so borrowed and
 * chromatic chords are handled by their semitone offset rather than requiring a
 * spelled key signature.
 */

import { pitchClassOf as mod12 } from '../../core/pitch/index.js';

export { pitchClassOf as mod12 } from '../../core/pitch/index.js';

import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { MAJOR_MASK, scaleTonesInDegreeOrder } from '../../theory/scale/index.js';

/** Diatonic pitch class of a 1-based scale degree in a key. */
export function degreeRootPc(degreeNumber: number, key: KeyScale): number {
  const tones = scaleTonesInDegreeOrder(key);
  if (tones.length === 0) {
    return mod12(key.rootPc);
  }
  return tones[(degreeNumber - 1) % tones.length] ?? mod12(key.rootPc);
}

/**
 * The 1-based scale degrees that already sit a semitone below their parallel
 * major counterpart — the third, sixth and seventh of a natural minor key, the
 * third and seventh of dorian, and so on.
 *
 * Roman-numeral spelling and parsing both need this: a flat sign on such a
 * degree is the degree itself rather than a further lowering, and a chromatic
 * root a semitone above one of them is that degree raised (`#III` in a minor
 * key), not a flattened version of the degree above it.
 *
 * Only heptatonic keys have a degree-for-degree correspondence with a major
 * scale, so anything else reports no lowered degrees.
 */
export function loweredDegrees(key: KeyScale): Set<number> {
  const tones = scaleTonesInDegreeOrder(key);
  const out = new Set<number>();
  if (tones.length !== 7) {
    return out;
  }
  const major = scaleTonesInDegreeOrder({ rootPc: mod12(key.rootPc), modeMask12: MAJOR_MASK });
  for (let index = 0; index < 7; index += 1) {
    const tone = tones[index];
    const majorTone = major[index];
    if (tone !== undefined && majorTone !== undefined && mod12(majorTone - tone) === 1) {
      out.add(index + 1);
    }
  }
  return out;
}

/** Whether a chord is the Neapolitan: a major triad on the flat second degree. */
export function isNeapolitan(chord: Chord, key: KeyScale): boolean {
  return mod12(chord.rootPc - key.rootPc) === 1 && chord.quality === 'maj';
}
