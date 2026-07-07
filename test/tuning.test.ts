import { describe, expect, it } from 'vitest';
import {
  centsBetweenFreq,
  centsOfSteps,
  edo,
  frequencyOf,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  TWELVE_TET,
} from '../src/core/tuning/index.js';

describe('12-TET frequency conversion', () => {
  it('places A4 at 440 Hz and middle C near 261.63', () => {
    expect(frequencyOf(69)).toBeCloseTo(440, 6);
    expect(frequencyOf(60)).toBeCloseTo(261.6256, 3);
  });

  it('round-trips a frequency to the nearest step', () => {
    expect(nearestStep(440)).toBe(69);
    expect(nearestStep(frequencyOf(60))).toBe(60);
  });

  it('converts the MIDI range boundaries and beyond without clamping', () => {
    // Step 0 and 127 are the MIDI extremes; conversion is not clamped, so any
    // integer step maps to a positive frequency and round-trips exactly.
    expect(frequencyOf(0)).toBeGreaterThan(0);
    expect(frequencyOf(127)).toBeGreaterThan(frequencyOf(0));
    for (const step of [-24, 0, 60, 127, 200]) {
      expect(nearestStep(frequencyOf(step))).toBe(step);
    }
  });

  it('yields a positive frequency for negative and out-of-range steps', () => {
    expect(frequencyOf(-12)).toBeGreaterThan(0);
    expect(frequencyOf(-12)).toBeCloseTo(frequencyOf(0) / 2, 6);
    expect(frequencyOf(200)).toBeGreaterThan(frequencyOf(127));
  });

  it('measures an octave as 1200 cents', () => {
    expect(centsBetweenFreq(220, 440)).toBeCloseTo(1200, 6);
    expect(centsOfSteps(12, TWELVE_TET)).toBe(1200);
  });
});

describe('microtonal EDO', () => {
  it('divides the octave into 19 equal steps', () => {
    const edo19 = edo(19);
    expect(centsOfSteps(1, edo19)).toBeCloseTo(1200 / 19, 6);
    expect(centsOfSteps(19, edo19)).toBeCloseTo(1200, 6);
  });

  it('keeps the reference pitch fixed across tunings', () => {
    expect(frequencyOf(69, edo(31))).toBeCloseTo(440, 6);
  });
});

describe('just intonation', () => {
  it('gives the syntonic-tempered fifth and third deviations', () => {
    expect(ratioToCents(3, 2)).toBeCloseTo(701.955, 3);
    expect(justDeviationCents(7)).toBeCloseTo(1.955, 3); // just fifth is wider
    expect(justDeviationCents(4)).toBeCloseTo(-13.686, 3); // just major third is narrower
  });

  it('returns NaN for an unlisted class', () => {
    expect(justDeviationCents(13)).toBeNaN();
  });
});
