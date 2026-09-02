import { describe, expect, it } from 'vitest';
import {
  diatonicPitchClasses,
  HARMONIC_MINOR_MASK,
  maskFromOffsets,
  minorKey,
  NAMED_SCALES,
  scaleByName,
} from '../src/theory/scale/index.js';

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

  it('rejects offsets that cannot name a chromatic pitch class', () => {
    expect(() => maskFromOffsets([Number.NaN])).toThrow(RangeError);
    expect(() => maskFromOffsets([1.5])).toThrow(RangeError);
  });
});

describe('named scales', () => {
  it('names each scale by the tones it holds', () => {
    // The mask itself, read as the offsets above the root: a table that only
    // says the name is known says nothing about what the name means, and every
    // one of these is a different set of tones.
    expect(NAMED_SCALES.dorian).toBe(maskFromOffsets([0, 2, 3, 5, 7, 9, 10]));
    expect(NAMED_SCALES.lydian).toBe(maskFromOffsets([0, 2, 4, 6, 7, 9, 11]));
    expect(NAMED_SCALES.blues).toBe(maskFromOffsets([0, 3, 5, 6, 7, 10]));
    expect(NAMED_SCALES.wholeTone).toBe(maskFromOffsets([0, 2, 4, 6, 8, 10]));
    expect(NAMED_SCALES.octatonicHalfWhole).toBe(maskFromOffsets([0, 1, 3, 4, 6, 7, 9, 10]));
  });

  it('builds a dorian scale via scaleByName', () => {
    const dDorian = scaleByName('dorian', 2);
    // The root the name was asked for, and the mask that name stands for: the
    // pitch classes alone are the relative major's and say nothing about which
    // of its modes was built.
    expect(dDorian.rootPc).toBe(2);
    expect(dDorian.modeMask12).toBe(NAMED_SCALES.dorian);
    expect(diatonicPitchClasses(dDorian)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('builds a natural-minor key', () => {
    const aMinor = minorKey(9);
    expect(aMinor.rootPc).toBe(9);
    expect(aMinor.modeMask12).toBe(maskFromOffsets([0, 2, 3, 5, 7, 8, 10]));
    expect(diatonicPitchClasses(aMinor)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('rejects unknown scale names', () => {
    expect(() => scaleByName('bogus', 0)).toThrow();
  });
});
