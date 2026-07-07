import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import {
  diatonicPitchClasses,
  HARMONIC_MINOR_MASK,
  isScaleTone,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  majorKey,
  NATURAL_MINOR_MASK,
  nearestScaleTone,
  pitchToScaleDegree,
} from '../src/theory/scale/index.js';

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

describe('minor scale masks', () => {
  it('raises the seventh in the harmonic minor variant', () => {
    const aHarmonicMinor: KeyScale = { rootPc: 9, modeMask12: HARMONIC_MINOR_MASK };
    const aNaturalMinor: KeyScale = { rootPc: 9, modeMask12: NATURAL_MINOR_MASK };
    expect(isScaleTone(68, aHarmonicMinor)).toBe(true); // G#, the leading tone
    expect(isScaleTone(68, aNaturalMinor)).toBe(false);
    expect(isScaleTone(67, aHarmonicMinor)).toBe(false); // natural G is replaced
  });

  it('raises the sixth and seventh in the melodic minor variant', () => {
    const aMelodicMinor: KeyScale = { rootPc: 9, modeMask12: MELODIC_MINOR_MASK };
    expect(isScaleTone(66, aMelodicMinor)).toBe(true); // F#
    expect(isScaleTone(68, aMelodicMinor)).toBe(true); // G#
    expect(isScaleTone(65, aMelodicMinor)).toBe(false); // natural F is replaced
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
