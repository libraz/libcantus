import { describe, expect, it } from 'vitest';
import {
  formatNote,
  HARMONIC_MINOR_MASK,
  keySignatureFifths,
  MELODIC_MINOR_MASK,
  scaleByName,
  spelledKeyOf,
} from '../src/index.js';
import * as theory from '../src/theory/index.js';
import * as scale from '../src/theory/scale/index.js';

/** The spelled tonic of a key, as it is written. */
function tonicOf(key: { rootPc: number; modeMask12: number }): string {
  return formatNote(spelledKeyOf(key).tonic);
}

describe('spelledKeyOf', () => {
  it('spells gis moll on G# and keeps the scale it was given', () => {
    // G# harmonic minor is written with G# minor's five sharps and its seventh
    // as an accidental; the mask must come back untouched, not flattened to
    // natural minor and not respelled as Ab.
    for (const mask of [HARMONIC_MINOR_MASK, MELODIC_MINOR_MASK]) {
      const key = { rootPc: 8, modeMask12: mask };
      const spelled = spelledKeyOf(key);
      expect(formatNote(spelled.tonic), `mask ${mask}`).toBe('G#');
      expect(spelled.scale).toBe(key);
      expect(spelled.scale.modeMask12).toBe(mask);
      expect(keySignatureFifths(spelled.tonic, key)).toBe(5);
    }
    expect(tonicOf(scaleByName('harmonicMinor', 8))).toBe('G#');
  });

  it('is reachable from the theory and scale barrels', () => {
    expect(formatNote(theory.spelledKeyOf(theory.majorKey(1)).tonic)).toBe('Db');
    expect(formatNote(scale.spelledKeyOf(scale.minorKey(8)).tonic)).toBe('G#');
  });
});
