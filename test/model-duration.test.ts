import { describe, expect, it } from 'vitest';
import {
  beatsToDuration,
  beatsToTiedDurations,
  durationToBeats,
  NOTE_VALUES,
  type NoteValue,
  type SpelledDuration,
} from '../src/core/duration/index.js';
import { InvalidInputError, NoSolutionError } from '../src/core/errors/index.js';
import { Duration } from '../src/model/duration.js';

/** Lengths a single note value spells: plain, dotted, and tupleted. */
const SPELLABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25, 1 / 3, 2 / 3, 0.2];

/** Lengths that need a tie chain, and the ones that do not. */
const CHAINED = [5, 7, 1.9375, 3, 0.5];

/** Written values covering the dots and the tuplet families. */
const WRITTEN: SpelledDuration[] = [
  { base: 'whole', dots: 0 },
  { base: 'quarter', dots: 1 },
  { base: 'quarter', dots: 2 },
  { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } },
  { base: 'sixteenth', dots: 1, tuplet: { actual: 5, normal: 4 } },
];

describe('Duration spells and measures the way the duration functions do', () => {
  it.each(SPELLABLE)('%d beats is spelled as the duration function spells it', (beats) => {
    const spelled = beatsToDuration(beats);
    const duration = Duration.ofBeats(beats);
    expect(duration.data).toEqual(spelled);
    expect(duration.spelled).toEqual(spelled);
    expect(duration.base).toBe(spelled.base);
    expect(duration.dots).toBe(spelled.dots);
    expect(duration.tuplet).toEqual(spelled.tuplet);
    expect(duration.beats()).toBe(durationToBeats(spelled));
  });

  it.each(WRITTEN)('$base with $dots dots lasts what the duration function says', (written) => {
    const duration = Duration.fromData(written);
    expect(duration.beats()).toBe(durationToBeats(written));
    for (const beatUnit of ['half', 'eighth'] as NoteValue[]) {
      expect(duration.beats({ beatUnit })).toBe(durationToBeats(written, { beatUnit }));
    }
    const dottedQuarter = { base: 'quarter' as NoteValue, dots: 1 };
    expect(duration.beats({ beatUnit: dottedQuarter })).toBe(
      durationToBeats(written, { beatUnit: dottedQuarter }),
    );
  });

  it.each(CHAINED)('%d beats ties as the duration function ties it', (beats) => {
    const chain = beatsToTiedDurations(beats);
    expect(Duration.tieChain(beats).map((value) => value.data)).toEqual(chain);
    expect(Duration.tieChain(beats).reduce((sum, value) => sum + value.beats(), 0)).toBeCloseTo(
      beats,
      9,
    );
  });

  it('counts in the beat unit the caller names, as the functions do', () => {
    const compound = { beatUnit: { base: 'quarter' as NoteValue, dots: 1 } };
    expect(Duration.ofBeats(1, compound).data).toEqual(beatsToDuration(1, compound));
    expect(Duration.ofBeats(1, compound).beats(compound)).toBe(1);
    expect(Duration.tieChain(1.5, compound).map((value) => value.data)).toEqual(
      beatsToTiedDurations(1.5, compound),
    );
  });

  it('builds the same value from parts as from a length', () => {
    expect(Duration.of('quarter', 1).equals(Duration.ofBeats(1.5))).toBe(true);
    expect(Duration.of('eighth', 0, { actual: 3, normal: 2 }).beats()).toBe(
      durationToBeats({ base: 'eighth', tuplet: { actual: 3, normal: 2 } }),
    );
    expect(Duration.of('quarter').beats()).toBe(1);
    for (const base of NOTE_VALUES) {
      expect(Duration.of(base).beats(), base).toBe(durationToBeats(base));
      expect(Duration.fromData(base).data, base).toEqual({ base, dots: 0 });
    }
  });

  it('reads as the value a score shows', () => {
    expect(Duration.of('quarter').toString()).toBe('quarter');
    expect(Duration.of('quarter', 1).toString()).toBe('quarter.');
    expect(Duration.of('eighth', 0, { actual: 3, normal: 2 }).toString()).toBe('eighth 3:2');
    expect(Duration.tieChain(5).map((value) => value.toString())).toEqual(['whole', 'quarter']);
  });

  it('reports a length no single value spells the way the function does', () => {
    expect(() => Duration.ofBeats(5)).toThrow(NoSolutionError);
    expect(() => beatsToDuration(5)).toThrow(NoSolutionError);
    expect(Duration.tieChain(5).length).toBe(2);
  });
});

describe('Duration as a value', () => {
  it('round-trips through its plain data', () => {
    for (const written of WRITTEN) {
      const duration = Duration.fromData(written);
      expect(duration.data).toEqual(duration.toJSON());
      expect(duration.data).toEqual(written);
      expect(Duration.fromData(duration.data).equals(duration), duration.toString()).toBe(true);
      expect(
        Duration.fromJSON(JSON.parse(JSON.stringify(duration)) as SpelledDuration).data,
      ).toEqual(duration.data);
    }
  });

  it('hands out its plain data as a fresh copy', () => {
    const duration = Duration.of('eighth', 1, { actual: 3, normal: 2 });
    expect(duration.data).not.toBe(duration.data);
    expect(duration.data).toEqual(duration.data);
    const taken = duration.data;
    taken.dots = 0;
    if (taken.tuplet !== undefined) {
      taken.tuplet.actual = 7;
    }
    expect(duration.dots).toBe(1);
    expect(duration.tuplet).toEqual({ actual: 3, normal: 2 });
    expect(duration.tuplet).not.toBe(duration.tuplet);
  });

  it('compares through the public surface, not through a private field', () => {
    const duration = Duration.of('eighth', 0, { actual: 3, normal: 2 });
    // The stand-in the model contracts use: only what a second copy of the
    // class would expose, so an `equals` reaching for `#base` fails here.
    const standIn = {
      get data(): SpelledDuration {
        return duration.data;
      },
    } as unknown as Duration;
    expect(duration.equals(standIn)).toBe(true);
    expect(duration.equals(Duration.of('eighth'))).toBe(false);
    // Same length, different notation: a dotted quarter and a quarter written
    // in the time of a triplet half both last 1.5 beats.
    const tripletHalf = Duration.of('half', 0, { actual: 4, normal: 3 });
    expect(tripletHalf.beats()).toBe(Duration.of('quarter', 1).beats());
    expect(tripletHalf.equals(Duration.of('quarter', 1))).toBe(false);
  });

  it('refuses a number no note value can carry', () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => Duration.fromData({ base: 'quarter', dots: poison }), `${poison}`).toThrow(
        InvalidInputError,
      );
      expect(
        () =>
          Duration.fromJSON({ base: 'quarter', dots: 0, tuplet: { actual: poison, normal: 2 } }),
        `${poison}`,
      ).toThrow(RangeError);
      expect(() => Duration.of('quarter', 0, { actual: 3, normal: poison }), `${poison}`).toThrow(
        RangeError,
      );
      expect(() => Duration.ofBeats(poison), `${poison}`).toThrow(InvalidInputError);
      expect(() => Duration.tieChain(poison), `${poison}`).toThrow(InvalidInputError);
    }
    expect(() => Duration.of('breve' as NoteValue)).toThrow(InvalidInputError);
    expect(() => Duration.ofBeats(0)).toThrow(InvalidInputError);
  });
});
