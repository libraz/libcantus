import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  beatsToSeconds,
  beatsToTicks,
  durationToSeconds,
  secondsToBeats,
  type TempoMap,
  ticksToBeats,
} from '../src/core/tempo/index.js';
import { Tempo, type TempoData } from '../src/model/tempo.js';

/** The markings the class is exercised over, slow to fast. */
const MARKINGS = [40, 60, 90, 120, 208];

/** The one-event map a constant tempo is, as the tempo functions read it. */
const mapOf = (bpm: number): TempoMap => [{ startBeat: 0, bpm }];

/** Positions inside a piece, before its downbeat, and on it. */
const BEATS = [-2, 0, 1, 1.5, 4, 16, 127.25];

describe('Tempo converts the way the tempo functions convert', () => {
  it.each(MARKINGS)('%d bpm answers as its one-event tempo map does', (bpm) => {
    const map = mapOf(bpm);
    const tempo = Tempo.of(bpm);
    expect(tempo.bpm).toBe(bpm);
    for (const beat of BEATS) {
      const label = `${bpm} bpm at ${beat}`;
      expect(tempo.secondsAt(beat), label).toBe(beatsToSeconds(beat, map));
      expect(tempo.beatAtSeconds(beat), label).toBe(secondsToBeats(beat, map));
      expect(tempo.ticksAt(beat, 480), label).toBe(beatsToTicks(beat, 480));
      expect(tempo.beatAtTicks(Math.round(beat * 96), 96), label).toBe(
        ticksToBeats(Math.round(beat * 96), 96),
      );
    }
    for (const length of [0, 1, 2.5, 32]) {
      expect(tempo.secondsOf(length), `${bpm} bpm for ${length}`).toBe(
        durationToSeconds(0, length, map),
      );
    }
  });

  it('measures a span and the position that ends it alike', () => {
    const tempo = Tempo.of(120);
    expect(tempo.secondsAt(16)).toBe(8);
    expect(tempo.beatAtSeconds(8)).toBe(16);
    // A pickup sounds before the downbeat, so its elapsed time is negative.
    expect(tempo.secondsAt(-2)).toBe(-1);
    expect(tempo.beatAtSeconds(-1)).toBe(-2);
    expect(tempo.secondsOf(4)).toBe(tempo.secondsAt(4));
    expect(tempo.ticksAt(1.5, 480)).toBe(720);
    expect(tempo.beatAtTicks(720, 480)).toBe(1.5);
    expect(tempo.toString()).toBe('120 bpm');
  });

  it('refuses a length no span can last and a tick that is not one', () => {
    const tempo = Tempo.of(120);
    expect(() => tempo.secondsOf(-1)).toThrow(InvalidInputError);
    expect(() => tempo.secondsAt(Number.NaN)).toThrow(InvalidInputError);
    expect(() => tempo.beatAtTicks(1.5, 480)).toThrow(InvalidInputError);
    expect(() => tempo.ticksAt(1, 0)).toThrow(InvalidInputError);
  });
});

describe('Tempo as a value', () => {
  it('round-trips through its plain data', () => {
    for (const bpm of MARKINGS) {
      const tempo = Tempo.of(bpm);
      expect(tempo.data).toEqual({ bpm });
      expect(tempo.data).toEqual(tempo.toJSON());
      expect(Tempo.fromData(tempo.data).equals(tempo), `${bpm}`).toBe(true);
      expect(Tempo.fromJSON(JSON.parse(JSON.stringify(tempo)) as TempoData).data).toEqual(
        tempo.data,
      );
    }
  });

  it('hands out its plain data as a fresh copy', () => {
    const tempo = Tempo.of(96);
    expect(tempo.data).not.toBe(tempo.data);
    expect(tempo.data).toEqual(tempo.data);
    const taken = tempo.data;
    taken.bpm = 60;
    expect(tempo.bpm).toBe(96);
  });

  it('compares through the public surface, not through a private field', () => {
    const tempo = Tempo.of(96);
    // The stand-in the model contracts use: only what a second copy of the
    // class would expose, so an `equals` reaching for `#bpm` fails here.
    const standIn = {
      get bpm(): number {
        return tempo.bpm;
      },
      get data(): TempoData {
        return tempo.data;
      },
    } as unknown as Tempo;
    expect(tempo.equals(standIn)).toBe(true);
    expect(Tempo.of(96).equals(Tempo.of(96))).toBe(true);
    expect(Tempo.of(96).equals(Tempo.of(96.5))).toBe(false);
  });

  it('refuses a marking no pulse can be counted at', () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => Tempo.fromData({ bpm: poison }), `${poison}`).toThrow(InvalidInputError);
      expect(() => Tempo.fromJSON({ bpm: poison }), `${poison}`).toThrow(RangeError);
      expect(() => Tempo.of(poison), `${poison}`).toThrow(RangeError);
    }
    expect(() => Tempo.of(0)).toThrow(InvalidInputError);
    expect(() => Tempo.of(-120)).toThrow(InvalidInputError);
  });
});
