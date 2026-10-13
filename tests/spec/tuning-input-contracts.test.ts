import {
  centsFromNearestStep,
  centsOfSteps,
  centsToRatio,
  edo,
  frequencyOf,
  InvalidInputError,
  isLibcantusError,
  JUST_RATIOS,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  stepOf,
  stepsOfCents,
  type TuningTable,
  TWELVE_TET,
} from '@libraz/libcantus/core';
import { Tuning } from '@libraz/libcantus/model';
import { describe, expect, it } from 'vitest';

/** A table written out field by field, so a missing field is a real hole. */
const BAROQUE: TuningTable = { refStep: 69, refFreq: 415, divisions: 12 };

/** The same table with one field dropped, as storage or a host would hand it over. */
function without(field: keyof TuningTable): TuningTable {
  const partial: Record<string, number> = {
    refStep: BAROQUE.refStep,
    refFreq: BAROQUE.refFreq,
    divisions: BAROQUE.divisions,
  };
  delete partial[field];
  return partial as unknown as TuningTable;
}

describe('a tuning table cannot be completed by the library', () => {
  // The tables below are written out rather than spread from TWELVE_TET: a
  // spread supplies every field, which is exactly the hole under test.
  it.each(['refFreq', 'refStep', 'divisions'] as const)(
    'refuses a table that lost %s instead of filling it in',
    (field) => {
      for (const build of [
        (table: TuningTable) => Tuning.of(table),
        (table: TuningTable) => Tuning.fromData(table),
        (table: TuningTable) => Tuning.fromJSON(table),
      ]) {
        expect(() => build(without(field))).toThrow(InvalidInputError);
        expect(() => build(without(field))).toThrow(field);
      }
    },
  );

  it('keeps a Baroque reference frequency across a serialization round trip', () => {
    const restored = Tuning.fromJSON(JSON.parse(JSON.stringify(Tuning.of(BAROQUE))) as TuningTable);
    expect(restored.data).toEqual(BAROQUE);
    expect(restored.frequencyOf('A4')).toBeCloseTo(415, 10);
  });

  it('still gives edo its documented positional defaults', () => {
    expect(Tuning.edo(19).data).toEqual({ refStep: 69, refFreq: 440, divisions: 19 });
    expect(edo(19)).toEqual({ refStep: 69, refFreq: 440, divisions: 19 });
  });
});

describe('a tuning argument is checked for its shape first', () => {
  const NOT_A_TABLE = null as unknown as TuningTable;

  it('rejects null where a tuning belongs, in every function that takes one', () => {
    for (const call of [
      () => frequencyOf(60, NOT_A_TABLE),
      () => nearestStep(440, NOT_A_TABLE),
      () => stepOf(440, NOT_A_TABLE),
      () => centsFromNearestStep(440, NOT_A_TABLE),
      () => stepsOfCents(700, NOT_A_TABLE),
      () => centsOfSteps(7, NOT_A_TABLE),
    ]) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isLibcantusError(thrown)).toBe(true);
      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
  });

  it('rejects null where a tuning belongs, in every method that takes one', () => {
    const tuning = Tuning.edo(12, 442);
    for (const call of [
      () => tuning.frequencyOf('A4', NOT_A_TABLE),
      () => tuning.frequencyOfStep(69, NOT_A_TABLE),
      () => tuning.nearestStep(442, NOT_A_TABLE),
      () => tuning.stepOf(442, NOT_A_TABLE),
      () => tuning.centsFromNearestStep(442, NOT_A_TABLE),
      () => tuning.centsOfSteps(1, NOT_A_TABLE),
      () => tuning.stepsOfCents(700, NOT_A_TABLE),
    ]) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isLibcantusError(thrown)).toBe(true);
      expect(thrown).toBeInstanceOf(InvalidInputError);
    }
  });

  it('reads an omitted tuning as twelve-tone equal temperament', () => {
    expect(frequencyOf(69, undefined)).toBeCloseTo(440, 10);
    expect(frequencyOf(69)).toBe(frequencyOf(69, TWELVE_TET));
    expect(stepOf(440, undefined)).toBeCloseTo(69, 10);
  });
});

describe('a reference step is only required to be finite', () => {
  it('accepts a negative and a fractional reference step', () => {
    expect(edo(19, 440, -5).refStep).toBe(-5);
    expect(edo(19, 440, 69.5).refStep).toBe(69.5);
    expect(Tuning.edo(19, 440, -5).refStep).toBe(-5);
    expect(Tuning.edo(19, 440, 69.5).refStep).toBe(69.5);
    // The reference pitch itself is what the reference step names, whatever
    // number it is: a tuner or a pitch-bend calibration lands between steps.
    expect(Tuning.edo(19, 440, 69.5).frequencyOfStep(69.5)).toBeCloseTo(440, 10);
  });
});

describe('the just ratio table is indexed by the classes it lists', () => {
  it('keeps the table and the deviations it feeds', () => {
    expect(Object.keys(JUST_RATIOS)).toHaveLength(13);
    expect([
      JUST_RATIOS[0],
      JUST_RATIOS[1],
      JUST_RATIOS[2],
      JUST_RATIOS[3],
      JUST_RATIOS[4],
      JUST_RATIOS[5],
      JUST_RATIOS[6],
      JUST_RATIOS[7],
      JUST_RATIOS[8],
      JUST_RATIOS[9],
      JUST_RATIOS[10],
      JUST_RATIOS[11],
      JUST_RATIOS[12],
    ]).toEqual([
      [1, 1],
      [16, 15],
      [9, 8],
      [6, 5],
      [5, 4],
      [4, 3],
      [45, 32],
      [3, 2],
      [8, 5],
      [5, 3],
      [9, 5],
      [15, 8],
      [2, 1],
    ]);
    expect(ratioToCents(3, 2)).toBeCloseTo(701.9550008653874, 10);
    expect([0, 4, 7, 12].map((semitoneClass) => justDeviationCents(semitoneClass))).toEqual([
      0,
      ratioToCents(5, 4) - 400,
      ratioToCents(3, 2) - 700,
      0,
    ]);
  });
});

describe('a cents offset that spans no ratio is refused', () => {
  it('rejects an offset whose ratio overflows or underflows', () => {
    for (const cents of [1e9, -1e9]) {
      expect(() => centsToRatio(cents)).toThrow(InvalidInputError);
      expect(() => Tuning.centsToRatio(cents)).toThrow(InvalidInputError);
    }
  });

  it('still spans the offsets a pitch bend uses', () => {
    expect(centsToRatio(0)).toBe(1);
    expect(centsToRatio(1200)).toBeCloseTo(2, 10);
    expect(centsToRatio(-1200)).toBeCloseTo(0.5, 10);
    for (const cents of [-4800, -14, 14, 4800]) {
      const ratio = centsToRatio(cents);
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThanOrEqual(Number.MIN_VALUE);
    }
  });
});
