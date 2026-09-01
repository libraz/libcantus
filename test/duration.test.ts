import { describe, expect, it } from 'vitest';
import {
  beatsToDuration,
  beatsToTiedDurations,
  type DurationData,
  durationToBeats,
  NOTE_VALUES,
  type NoteValue,
  type Tuplet,
} from '../src/core/duration/index.js';
import { InvalidInputError, NoSolutionError } from '../src/core/errors/index.js';

const TRIPLET: Tuplet = { actual: 3, normal: 2 };
const QUINTUPLET: Tuplet = { actual: 5, normal: 4 };
const SEPTUPLET: Tuplet = { actual: 7, normal: 4 };

describe('duration to beats', () => {
  it('measures the base values in quarter-note beats', () => {
    expect(NOTE_VALUES.map((base) => durationToBeats(base))).toEqual([
      4, 2, 1, 0.5, 0.25, 0.125, 0.0625,
    ]);
  });

  it('applies dots as base * (2 - 2^-dots)', () => {
    expect(durationToBeats({ base: 'quarter', dots: 1 })).toBe(1.5);
    expect(durationToBeats({ base: 'quarter', dots: 2 })).toBe(1.75);
    expect(durationToBeats({ base: 'half', dots: 1 })).toBe(3);
    expect(durationToBeats({ base: 'half', dots: 2 })).toBe(3.5);
    expect(durationToBeats({ base: 'eighth', dots: 2 })).toBe(0.875);
    expect(durationToBeats({ base: 'quarter', dots: 0 })).toBe(durationToBeats('quarter'));
  });

  it('applies a tuplet ratio', () => {
    expect(durationToBeats({ base: 'eighth', tuplet: TRIPLET })).toBeCloseTo(1 / 3, 12);
    expect(durationToBeats({ base: 'quarter', tuplet: TRIPLET })).toBeCloseTo(2 / 3, 12);
    expect(durationToBeats({ base: 'sixteenth', tuplet: QUINTUPLET })).toBe(0.2);
    expect(durationToBeats({ base: 'sixteenth', tuplet: SEPTUPLET })).toBeCloseTo(1 / 7, 12);
    // Duplets: two in the time of three, as written in a compound meter.
    expect(durationToBeats({ base: 'eighth', tuplet: { actual: 2, normal: 3 } })).toBe(0.75);
  });

  it('counts in another beat unit when asked', () => {
    expect(durationToBeats('eighth', { beatUnit: 'eighth' })).toBe(1);
    expect(durationToBeats('whole', { beatUnit: 'half' })).toBe(2);
    // The felt beat of 6/8 is a dotted quarter.
    expect(durationToBeats('quarter', { beatUnit: { base: 'quarter', dots: 1 } })).toBeCloseTo(
      2 / 3,
      12,
    );
  });

  it('rejects a malformed duration', () => {
    expect(() => durationToBeats('crotchet' as NoteValue)).toThrow(InvalidInputError);
    expect(() => durationToBeats({ base: 'quarter', dots: -1 })).toThrow(InvalidInputError);
    expect(() => durationToBeats({ base: 'quarter', dots: 1.5 })).toThrow(InvalidInputError);
    expect(() => durationToBeats({ base: 'quarter', dots: 5 })).toThrow(InvalidInputError);
    expect(() => durationToBeats({ base: 'quarter', tuplet: { actual: 0, normal: 2 } })).toThrow(
      InvalidInputError,
    );
    expect(() => durationToBeats({ base: 'quarter', tuplet: { actual: 3, normal: 2.5 } })).toThrow(
      InvalidInputError,
    );
    expect(() => durationToBeats(null as unknown as DurationData)).toThrow(InvalidInputError);
    expect(() => durationToBeats(4 as unknown as DurationData)).toThrow(InvalidInputError);
    expect(() => durationToBeats('quarter', { beatUnit: 'minim' as NoteValue })).toThrow(
      InvalidInputError,
    );
  });
});

describe('beats to duration', () => {
  it('spells the plain values', () => {
    expect(beatsToDuration(4)).toEqual({ base: 'whole', dots: 0 });
    expect(beatsToDuration(1)).toEqual({ base: 'quarter', dots: 0 });
    expect(beatsToDuration(0.0625)).toEqual({ base: 'sixtyFourth', dots: 0 });
  });

  it('prefers a dotted value to a tie', () => {
    expect(beatsToDuration(1.5)).toEqual({ base: 'quarter', dots: 1 });
    expect(beatsToDuration(3)).toEqual({ base: 'half', dots: 1 });
    expect(beatsToDuration(6)).toEqual({ base: 'whole', dots: 1 });
    expect(beatsToDuration(0.75)).toEqual({ base: 'eighth', dots: 1 });
  });

  it('spells double dots', () => {
    expect(beatsToDuration(1.75)).toEqual({ base: 'quarter', dots: 2 });
    expect(beatsToDuration(3.5)).toEqual({ base: 'half', dots: 2 });
    expect(beatsToDuration(7)).toEqual({ base: 'whole', dots: 2 });
    expect(beatsToDuration(0.4375)).toEqual({ base: 'sixteenth', dots: 2 });
  });

  it('spells a third of a beat as an eighth triplet, not a twenty-fourth', () => {
    expect(beatsToDuration(1 / 3)).toEqual({ base: 'eighth', dots: 0, tuplet: TRIPLET });
    expect(beatsToDuration(2 / 3)).toEqual({ base: 'quarter', dots: 0, tuplet: TRIPLET });
    expect(beatsToDuration(1 / 6)).toEqual({ base: 'sixteenth', dots: 0, tuplet: TRIPLET });
  });

  it('spells quintuplets and septuplets in the time of four', () => {
    expect(beatsToDuration(0.2)).toEqual({ base: 'sixteenth', dots: 0, tuplet: QUINTUPLET });
    expect(beatsToDuration(0.8)).toEqual({ base: 'quarter', dots: 0, tuplet: QUINTUPLET });
    expect(beatsToDuration(1 / 7)).toEqual({ base: 'sixteenth', dots: 0, tuplet: SEPTUPLET });
    expect(beatsToDuration(4 / 7)).toEqual({ base: 'quarter', dots: 0, tuplet: SEPTUPLET });
  });

  it('reads a rounded decimal within 1e-6 beats', () => {
    expect(beatsToDuration(0.3333333)).toEqual({ base: 'eighth', dots: 0, tuplet: TRIPLET });
    expect(beatsToDuration(1 / 3 + 9e-7)).toEqual({ base: 'eighth', dots: 0, tuplet: TRIPLET });
    expect(beatsToDuration(1 / 3 - 9e-7)).toEqual({ base: 'eighth', dots: 0, tuplet: TRIPLET });
    expect(() => beatsToDuration(1 / 3 + 2e-6)).toThrow(NoSolutionError);
    expect(() => beatsToDuration(0.333)).toThrow(NoSolutionError);
  });

  it('prefers the plain reading where a tuplet spelling coincides with one', () => {
    // A dotted triplet of a value is that value, and a double-dotted septuplet too.
    expect(durationToBeats({ base: 'quarter', dots: 1, tuplet: TRIPLET })).toBe(1);
    expect(beatsToDuration(1)).toEqual({ base: 'quarter', dots: 0 });
    expect(durationToBeats({ base: 'quarter', dots: 2, tuplet: SEPTUPLET })).toBe(1);
  });

  it('spells in another beat unit when asked', () => {
    expect(beatsToDuration(1, { beatUnit: { base: 'quarter', dots: 1 } })).toEqual({
      base: 'quarter',
      dots: 1,
    });
    expect(beatsToDuration(1, { beatUnit: 'eighth' })).toEqual({ base: 'eighth', dots: 0 });
    expect(beatsToDuration(1 / 3, { beatUnit: 'half' })).toEqual({
      base: 'quarter',
      dots: 0,
      tuplet: TRIPLET,
    });
  });

  it('round-trips every spelling it can produce', () => {
    const tuplets: (Tuplet | undefined)[] = [undefined, TRIPLET, QUINTUPLET, SEPTUPLET];
    for (const base of NOTE_VALUES) {
      for (const dots of [0, 1, 2]) {
        for (const tuplet of tuplets) {
          // A dotted triplet and a double-dotted septuplet are plain values
          // under another name; they are spelled plainly on the way back.
          if ((tuplet === TRIPLET && dots === 1) || (tuplet === SEPTUPLET && dots === 2)) {
            continue;
          }
          const spelled = tuplet === undefined ? { base, dots } : { base, dots, tuplet };
          expect(beatsToDuration(durationToBeats(spelled))).toEqual(spelled);
        }
      }
    }
  });

  it('rejects a non-positive or non-finite length', () => {
    expect(() => beatsToDuration(0)).toThrow(InvalidInputError);
    expect(() => beatsToDuration(-1)).toThrow(InvalidInputError);
    expect(() => beatsToDuration(Number.NaN)).toThrow(InvalidInputError);
    expect(() => beatsToTiedDurations(0)).toThrow(InvalidInputError);
  });

  it('refuses to spell a length no single note value covers', () => {
    expect(() => beatsToDuration(5)).toThrow(NoSolutionError);
    expect(() => beatsToDuration(8)).toThrow(NoSolutionError);
    expect(() => beatsToDuration(2.5)).toThrow(NoSolutionError);
  });

  it('matches within a tolerance counted in quarter notes, not in beats', () => {
    // The comparison is made in quarter notes whatever `beatUnit` names, so a
    // longer beat unit narrows the tolerance in proportion: under a whole-note
    // beat the documented 1e-6 quarter notes is 2.5e-7 of a beat.
    const inWholeNotes = { beatUnit: 'whole' as NoteValue };
    expect(beatsToDuration(1 + 2e-7, inWholeNotes)).toEqual({ base: 'whole', dots: 0 });
    expect(() => beatsToDuration(1 + 3e-7, inWholeNotes)).toThrow(NoSolutionError);
    // The same distance in beats is well inside the tolerance when the beat is
    // itself a quarter note.
    expect(beatsToDuration(1 + 3e-7)).toEqual({ base: 'quarter', dots: 0 });
  });
});

describe('tied durations', () => {
  it('returns a single value when there is one', () => {
    expect(beatsToTiedDurations(1.5)).toEqual([{ base: 'quarter', dots: 1 }]);
    expect(beatsToTiedDurations(1 / 3)).toEqual([{ base: 'eighth', dots: 0, tuplet: TRIPLET }]);
  });

  it('decomposes what no single value spells', () => {
    expect(beatsToTiedDurations(5)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'quarter', dots: 0 },
    ]);
    expect(beatsToTiedDurations(8)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
    ]);
    expect(beatsToTiedDurations(2.5)).toEqual([
      { base: 'half', dots: 0 },
      { base: 'eighth', dots: 0 },
    ]);
  });

  it('sums back to the requested length', () => {
    for (const beats of [5, 8, 2.5, 4.25, 9.9375, 17]) {
      const total = beatsToTiedDurations(beats).reduce(
        (sum, duration) => sum + durationToBeats(duration),
        0,
      );
      expect(total).toBeCloseTo(beats, 9);
    }
  });

  it('writes a value followed by its own half as a dot', () => {
    expect(beatsToTiedDurations(1.9375)).toEqual([
      { base: 'quarter', dots: 2 },
      { base: 'thirtySecond', dots: 1 },
    ]);
  });

  it('has no chain for a length off the notatable grid', () => {
    expect(() => beatsToTiedDurations(1.1)).toThrow(NoSolutionError);
  });

  it('writes no dot that would put the chain out of longest-first order', () => {
    // A dot lengthens a value that is already written, so 10 beats used to come
    // back as a whole note tied to a longer dotted whole — the right total in
    // the wrong order, which an engraver splitting at barlines reads as a
    // different rhythm.
    expect(beatsToTiedDurations(10)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'half', dots: 0 },
    ]);
    expect(beatsToTiedDurations(11.5)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'half', dots: 2 },
    ]);
    expect(beatsToTiedDurations(14)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'half', dots: 0 },
    ]);
    expect(beatsToTiedDurations(18)).toEqual([
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'whole', dots: 0 },
      { base: 'half', dots: 0 },
    ]);
  });

  it('never rises in length along a chain, whatever the requested total', () => {
    for (const beats of [5, 8, 10, 11.5, 14, 18, 2.5, 4.25, 6.5, 9.9375, 17, 1.9375]) {
      const chain = beatsToTiedDurations(beats);
      expect(chain.length).toBeGreaterThan(0);
      const lengths = chain.map((duration) => durationToBeats(duration));
      expect(lengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(beats, 9);
      for (let index = 1; index < lengths.length; index += 1) {
        const previous = lengths[index - 1] ?? Number.NEGATIVE_INFINITY;
        const current = lengths[index] ?? Number.POSITIVE_INFINITY;
        expect(current).toBeLessThanOrEqual(previous);
      }
    }
  });
});
