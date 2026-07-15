import { describe, expect, it } from 'vitest';
import { metricWeight, tuplet } from '../src/core/meter/index.js';
import { createRng } from '../src/core/random/index.js';
import { edo, frequencyOf, nearestStep, ratioToCents } from '../src/core/tuning/index.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertPositiveInt,
  assertRange,
} from '../src/core/validation/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { majorKey } from '../src/theory/scale/index.js';

describe('shared numeric input contracts', () => {
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects non-finite value %s', (value) => {
    expect(() => assertFiniteNumber(value, 'value')).toThrow(RangeError);
  });

  it('checks integer, range, and generation budget boundaries', () => {
    expect(assertPositiveInt(1, 'count')).toBe(1);
    expect(() => assertPositiveInt(1.5, 'count')).toThrow(RangeError);
    expect(assertRange(1, 0, 1, 'ratio')).toBe(1);
    expect(() => assertRange(-1, 0, 1, 'ratio')).toThrow(RangeError);
    expect(assertGenerationBudget(10, 'events', 10)).toBe(10);
    expect(() => assertGenerationBudget(11, 'events', 10)).toThrow(RangeError);
  });

  it('validates meter grouping before downbeat and off-pulse early returns', () => {
    const invalid = { numerator: 7, denominator: 8, grouping: [2, 2] };
    expect(() => metricWeight(0, invalid)).toThrow(RangeError);
    expect(() => metricWeight(0.25, invalid)).toThrow(RangeError);
    expect(() => tuplet(1, 1_000_001)).toThrow(RangeError);
  });

  it('rejects invalid tuning and random ranges consistently', () => {
    expect(() => edo(0)).toThrow(RangeError);
    expect(() => frequencyOf(Number.NaN)).toThrow(RangeError);
    expect(() => nearestStep(0)).toThrow(RangeError);
    expect(() => ratioToCents(3, 0)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createRng(1).range(4, 3)).toThrow(RangeError);
    expect(() => createRng(1).range(1.5, 3)).toThrow(RangeError);
    expect(() => createRng(1).float(2, 1)).toThrow(RangeError);
  });

  it.each([
    () => generateRhythm({ numerator: 4, denominator: 4 }, { bars: Number.POSITIVE_INFINITY }),
    () => generateRhythm({ numerator: 4, denominator: 4 }, { subdivision: 1_000_001 }),
    () => generateProgression({ key: majorKey(0), style: 'dance', bars: 1.5 }),
    () => generateMotif({ key: majorKey(0), bars: Number.NaN }),
    () =>
      generateDrums({
        bars: 1,
        bpm: 120,
        style: 'standard',
        section: 'verse',
        density: Number.NaN,
        fills: false,
      }),
    () =>
      harmonizeMelody({
        melody: [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
        key: majorKey(0),
        harmonicRhythm: Number.POSITIVE_INFINITY,
        reharmonize: 'diatonic',
        placement: { transposeSearch: false, octaveSearch: false },
      }),
  ])('rejects unsafe generator input before looping or allocating', (generate) => {
    expect(generate).toThrow(RangeError);
  });
});
