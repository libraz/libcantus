import { describe, expect, it } from 'vitest';
import {
  diatonicPitchClasses,
  isScaleTone,
  MAJOR_MASK,
  majorKey,
  nearestScaleTone,
  pitchToScaleDegree,
} from '../src/scale/index.js';
import type { KeyScale } from '../src/types.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('diatonicPitchClasses', () => {
  it('yields the C major scale', () => {
    expect(diatonicPitchClasses(cMajor)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('is sorted ascending for a non-zero root', () => {
    const gMajor = majorKey(7);
    expect(diatonicPitchClasses(gMajor)).toEqual([0, 2, 4, 6, 7, 9, 11]);
  });
});

describe('isScaleTone', () => {
  it('accepts diatonic pitches and rejects chromatic ones', () => {
    expect(isScaleTone(60, cMajor)).toBe(true);
    expect(isScaleTone(61, cMajor)).toBe(false);
  });
});

describe('nearestScaleTone', () => {
  it('snaps a chromatic pitch to the lower neighbour on a tie', () => {
    expect(nearestScaleTone(61, cMajor)).toBe(60);
  });

  it('returns an in-scale pitch unchanged', () => {
    expect(nearestScaleTone(64, cMajor)).toBe(64);
  });
});

describe('pitchToScaleDegree', () => {
  it('reports 0-based degrees for scale tones', () => {
    expect(pitchToScaleDegree(60, cMajor)).toBe(0);
    expect(pitchToScaleDegree(64, cMajor)).toBe(2);
  });

  it('returns -1 for non-scale tones', () => {
    expect(pitchToScaleDegree(61, cMajor)).toBe(-1);
  });
});
