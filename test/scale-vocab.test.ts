import { describe, expect, it } from 'vitest';
import {
  diatonicPitchClasses,
  HARMONIC_MINOR_MASK,
  maskFromOffsets,
  minorKey,
  NAMED_SCALES,
  scaleByName,
} from '../src/scale/index.js';

describe('maskFromOffsets', () => {
  it('builds the harmonic-minor mask', () => {
    expect(maskFromOffsets([0, 2, 3, 5, 7, 8, 11])).toBe(HARMONIC_MINOR_MASK);
  });

  it('always sets bit 0 even when the offsets omit the root', () => {
    // The KeyScale invariant requires the root to be a scale tone, so the
    // root bit is forced on regardless of the supplied offsets.
    expect(maskFromOffsets([2, 4, 7]) & 1).toBe(1);
    expect(maskFromOffsets([]) & 1).toBe(1);
  });
});

describe('named scales', () => {
  it('exposes the expected scale set', () => {
    for (const name of ['dorian', 'lydian', 'blues', 'wholeTone', 'octatonicHalfWhole']) {
      expect(NAMED_SCALES[name]).toBeGreaterThan(0);
    }
  });

  it('builds a dorian scale via scaleByName', () => {
    const dDorian = scaleByName('dorian', 2);
    expect(diatonicPitchClasses(dDorian)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('builds a natural-minor key', () => {
    const aMinor = minorKey(9);
    expect(diatonicPitchClasses(aMinor)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('rejects unknown scale names', () => {
    expect(() => scaleByName('bogus', 0)).toThrow();
  });
});
