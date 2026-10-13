import { describe, expect, it } from 'vitest';
import { noteToMidi, parseNote } from '../src/core/pitch/index.js';
import {
  centsBetweenFreq,
  centsFromNearestStep,
  centsOfSteps,
  centsToRatio,
  edo,
  frequencyOf,
  justDeviationCents,
  nearestStep,
  ratioToCents,
  stepOf,
  stepsOfCents,
  TWELVE_TET,
} from '../src/core/tuning/index.js';
import { Note } from '../src/model/note.js';
import { Tuning } from '../src/model/tuning.js';

/**
 * The class is a binder for the tuning module's `tuning` argument, so every
 * method is checked against the function it delegates to on the same input:
 * the answers must be the same one, or the class would be a second reading of
 * the same theory.
 */

/** A tuning that is neither the default temperament nor the default reference. */
const ET19 = edo(19, 432, 69);

/** A stand-in exposing only the public getters, as a second copy of the class is. */
function publicOnly(tuning: Tuning): Tuning {
  return {
    refStep: tuning.refStep,
    refFreq: tuning.refFreq,
    divisions: tuning.divisions,
  } as unknown as Tuning;
}

describe('Tuning plain data', () => {
  it('hands out its table as a fresh copy', () => {
    const tuning = Tuning.edo(19, 432);
    expect(tuning.data).not.toBe(tuning.data);
    expect(tuning.data).toEqual(tuning.data);
    expect(tuning.data).toEqual({ refStep: 69, refFreq: 432, divisions: 19 });
  });

  it('round-trips through its plain data and through JSON', () => {
    const tuning = Tuning.of(ET19);
    expect(tuning.toJSON()).toEqual(tuning.data);
    expect(JSON.parse(JSON.stringify(tuning))).toEqual(tuning.data);
    expect(Tuning.fromData(tuning.data).data).toEqual(tuning.data);
    expect(Tuning.fromJSON(JSON.parse(JSON.stringify(tuning))).equals(tuning)).toBe(true);
  });

  it('keeps the table it was given out of its own state', () => {
    const table = { refStep: 69, refFreq: 440, divisions: 12 };
    const tuning = Tuning.of(table);
    table.divisions = 19;
    expect(tuning.divisions).toBe(12);
  });

  it('reads the reference and the divisions off the table', () => {
    const tuning = Tuning.of(ET19);
    expect([tuning.refStep, tuning.refFreq, tuning.divisions]).toEqual([69, 432, 19]);
    expect(Tuning.twelveTet().data).toEqual(TWELVE_TET);
    expect(Tuning.twelveTet().toString()).toBe('12-EDO (step 69 = 440 Hz)');
  });
});

describe('Tuning rejects a table it cannot hold', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %s in every field of the table',
    (poison) => {
      expect(() => Tuning.fromData({ ...TWELVE_TET, refStep: poison })).toThrow(RangeError);
      expect(() => Tuning.fromData({ ...TWELVE_TET, refFreq: poison })).toThrow(RangeError);
      expect(() => Tuning.fromData({ ...TWELVE_TET, divisions: poison })).toThrow(RangeError);
      expect(() => Tuning.edo(poison)).toThrow(RangeError);
    },
  );

  it('refuses a division count that is no count', () => {
    expect(() => Tuning.edo(0)).toThrow(RangeError);
    expect(() => Tuning.edo(12.5)).toThrow(RangeError);
    expect(() => Tuning.of({ refStep: 69, refFreq: 0, divisions: 12 })).toThrow(RangeError);
  });
});

describe('Tuning equality', () => {
  it('compares through the public surface alone', () => {
    const tuning = Tuning.of(ET19);
    expect(tuning.equals(publicOnly(tuning))).toBe(true);
    expect(tuning.equals(Tuning.edo(19, 432))).toBe(true);
    expect(tuning.equals(Tuning.edo(19))).toBe(false);
    expect(tuning.equals(Tuning.twelveTet())).toBe(false);
  });
});

describe('Tuning answers what the tuning functions answer', () => {
  it('reads a note as a name, a MIDI number, and a Note alike', () => {
    const tuning = Tuning.twelveTet();
    const byName = tuning.frequencyOf('A4');
    expect(byName).toBe(440);
    expect(tuning.frequencyOf(69)).toBe(byName);
    expect(tuning.frequencyOf(Note.parse('A4'))).toBe(byName);
    expect(tuning.frequencyOf({ letter: 5, alter: 0, octave: 4 })).toBe(byName);
  });

  it.each(['C4', 'A4', 'Eb3', 'F#6'])('gives %s the frequency the function gives it', (name) => {
    const step = noteToMidi(parseNote(name));
    for (const table of [TWELVE_TET, ET19, edo(31)]) {
      const tuning = Tuning.of(table);
      expect(tuning.frequencyOf(name)).toBe(frequencyOf(step, table));
      expect(tuning.frequencyOfStep(step)).toBe(frequencyOf(step, table));
    }
  });

  it('refuses a note that names no pitch', () => {
    expect(() => Tuning.twelveTet().frequencyOf('C')).toThrow(RangeError);
  });

  it.each([440, 442, 261.6255653005986, 27.5])(
    'reads %s Hz the way the functions read it',
    (freq) => {
      for (const table of [TWELVE_TET, ET19]) {
        const tuning = Tuning.of(table);
        expect(tuning.nearestStep(freq)).toBe(nearestStep(freq, table));
        expect(tuning.stepOf(freq)).toBe(stepOf(freq, table));
        expect(tuning.centsFromNearestStep(freq)).toBe(centsFromNearestStep(freq, table));
      }
    },
  );

  it.each([1, 7, -3, 0.5])('converts %s between steps and cents as the functions do', (value) => {
    for (const table of [TWELVE_TET, ET19]) {
      const tuning = Tuning.of(table);
      expect(tuning.centsOfSteps(value)).toBe(centsOfSteps(value, table));
      expect(tuning.stepsOfCents(value * 100)).toBe(stepsOfCents(value * 100, table));
    }
  });

  it('reads a value under another temperament when one is named', () => {
    const tuning = Tuning.twelveTet();
    expect(tuning.frequencyOfStep(70, ET19)).toBe(frequencyOf(70, ET19));
    expect(tuning.frequencyOf('A4', ET19)).toBe(432);
    expect(tuning.centsOfSteps(1, ET19)).toBe(centsOfSteps(1, ET19));
    expect(tuning.stepsOfCents(1200, ET19)).toBe(19);
    expect(tuning.nearestStep(432, ET19)).toBe(nearestStep(432, ET19));
    expect(tuning.stepOf(432, ET19)).toBe(stepOf(432, ET19));
    expect(tuning.centsFromNearestStep(442, ET19)).toBe(centsFromNearestStep(442, ET19));
    // The instance is untouched by reading one value elsewhere.
    expect(tuning.divisions).toBe(12);
  });

  it('is the exact inverse of itself, step for frequency', () => {
    const tuning = Tuning.edo(31);
    expect(tuning.stepOf(tuning.frequencyOfStep(80))).toBeCloseTo(80, 9);
    expect(tuning.nearestStep(tuning.frequencyOfStep(80))).toBe(80);
  });

  it('offers the ratio and just-intonation helpers the module exports', () => {
    expect(Tuning.ratioToCents(3, 2)).toBe(ratioToCents(3, 2));
    expect(Tuning.centsToRatio(14)).toBe(centsToRatio(14));
    expect(Tuning.centsBetweenFreq(440, 880)).toBe(centsBetweenFreq(440, 880));
    for (let semitoneClass = 0; semitoneClass <= 12; semitoneClass += 1) {
      expect(Tuning.justDeviationCents(semitoneClass)).toBe(justDeviationCents(semitoneClass));
    }
    expect(() => Tuning.justDeviationCents(13)).toThrow(RangeError);
  });
});
