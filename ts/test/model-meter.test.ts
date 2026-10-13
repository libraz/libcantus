import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  beatsPerBar,
  beatToBarPosition,
  formatBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  pulsesPerBar,
  type TimeSignature,
  tryParseTimeSignature,
  tuplet,
} from '../src/core/meter/index.js';
import { Meter } from '../src/model/meter.js';

/** The signatures the class is exercised over: simple, compound, and additive. */
const SIGNATURES = ['4/4', '3/4', '6/8', '9/8', '12/8', '5/8', '2+2+3/8'];

/** Positions inside a bar and past it, including the off-pulse subdivisions. */
const POSITIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4.5, 7.5, 11];

describe('Meter reads a signature the way the meter functions read it', () => {
  it.each(SIGNATURES)('%s answers as its plain time signature does', (text) => {
    const ts = parseTimeSignature(text);
    const meter = Meter.parse(text);
    expect(meter.numerator).toBe(ts.numerator);
    expect(meter.denominator).toBe(ts.denominator);
    expect(meter.grouping).toEqual(ts.grouping);
    expect(meter.isCompound).toBe(isCompound(ts));
    expect(meter.beatsPerBar).toBe(beatsPerBar(ts));
    expect(meter.pulsesPerBar).toBe(pulsesPerBar(ts));
    expect(meter.pulseBeats).toBe(pulseBeats(ts));
    expect(meter.format()).toBe(formatTimeSignature(ts));
    expect(meter.format({ grouping: true })).toBe(formatTimeSignature(ts, { grouping: true }));
    expect(meter.toString()).toBe(formatTimeSignature(ts));
    expect(meter.tuplet(1, 3)).toEqual(tuplet(1, 3));
  });

  it.each(SIGNATURES)('%s weighs and locates every position as the functions do', (text) => {
    const ts = parseTimeSignature(text);
    const meter = Meter.parse(text);
    for (const beat of POSITIONS) {
      const label = `${text} at ${beat}`;
      expect(meter.weightAt(beat), label).toBe(metricWeight(beat, ts));
      expect(meter.isStrongBeat(beat), label).toBe(isStrongBeat(beat, ts));
      expect(meter.barPositionAt(beat), label).toEqual(beatToBarPosition(beat, ts));
      expect(meter.formatPosition(beat), label).toBe(formatBarPosition(beat, ts));
      expect(meter.formatPosition(beat, 3), label).toBe(formatBarPosition(beat, ts, 3));
    }
  });

  it('knows the compound meters from the simple triples', () => {
    expect(Meter.parse('6/8').isCompound).toBe(true);
    expect(Meter.parse('3/4').isCompound).toBe(false);
    expect(Meter.of(9, 8, [2, 2, 2, 3]).isCompound).toBe(false);
    expect(Meter.parse('6/8').pulseBeats).toBe(1.5);
    expect(Meter.parse('6/8').formatPosition(7.5)).toBe('3.2');
  });

  it('accents the head of each group of an additive metre', () => {
    // Eighth-note pulses of 0.5 quarter each, grouped 2+2+3: the group heads
    // are pulses 0, 2 and 4, which sound at quarter-note beats 0, 1 and 2.
    const aksak = Meter.of(7, 8, [2, 2, 3]);
    expect(aksak.weightAt(0)).toBe(3);
    expect(aksak.weightAt(1)).toBe(2);
    expect(aksak.weightAt(2)).toBe(2);
    expect(aksak.weightAt(0.5)).toBe(1);
    expect(aksak.weightAt(2.5)).toBe(1);
    expect(aksak.weightAt(0.25)).toBe(0);
    expect(aksak.isStrongBeat(2)).toBe(true);
    expect(aksak.isStrongBeat(2.5)).toBe(false);
    expect(aksak.format({ grouping: true })).toBe('2+2+3/8');
  });
});

describe('Meter as a value', () => {
  it('round-trips through its plain data', () => {
    for (const text of SIGNATURES) {
      const meter = Meter.parse(text);
      expect(meter.data).toEqual(meter.toJSON());
      expect(Meter.fromData(meter.data).equals(meter), text).toBe(true);
      expect(Meter.fromJSON(JSON.parse(JSON.stringify(meter)) as TimeSignature).data).toEqual(
        meter.data,
      );
    }
  });

  it('hands out its plain data as a fresh copy', () => {
    const meter = Meter.of(7, 8, [2, 2, 3]);
    expect(meter.data).not.toBe(meter.data);
    expect(meter.data).toEqual(meter.data);
    const taken = meter.data;
    taken.numerator = 3;
    taken.grouping?.push(4);
    expect(meter.numerator).toBe(7);
    expect(meter.grouping).toEqual([2, 2, 3]);
    expect(meter.grouping).not.toBe(meter.grouping);
  });

  it('compares through the public surface, not through a private field', () => {
    const meter = Meter.of(7, 8, [2, 2, 3]);
    // The stand-in the model contracts use: only what a second copy of the
    // class would expose, so an `equals` reaching for `#ts` fails here.
    const standIn = {
      get data(): TimeSignature {
        return meter.data;
      },
    } as unknown as Meter;
    expect(meter.equals(standIn)).toBe(true);
    expect(Meter.of(7, 8, [2, 2, 3]).equals(Meter.parse('2+2+3/8'))).toBe(true);
    expect(Meter.parse('7/8').equals(Meter.of(7, 8, [2, 2, 3]))).toBe(false);
    expect(Meter.parse('6/8').equals(Meter.parse('3/4'))).toBe(false);
    expect(Meter.parse('4/4').equals(Meter.of(4, 4))).toBe(true);
  });

  it('refuses a number no bar can be measured with', () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => Meter.fromData({ numerator: poison, denominator: 4 }), `${poison}`).toThrow(
        InvalidInputError,
      );
      expect(() => Meter.fromData({ numerator: 4, denominator: poison }), `${poison}`).toThrow(
        RangeError,
      );
      expect(() => Meter.of(4, 4, [poison, 2]), `${poison}`).toThrow(RangeError);
    }
    expect(() => Meter.of(0, 4)).toThrow(InvalidInputError);
    expect(() => Meter.of(4, 4, [2, 3])).toThrow(InvalidInputError);
  });
});

describe('Meter text entry', () => {
  it('parses what the meter parser parses', () => {
    for (const text of SIGNATURES) {
      expect(Meter.parse(text).data).toEqual(parseTimeSignature(text));
    }
  });

  it('agrees with tryParse on a signature and on text that is not one', () => {
    const good = Meter.tryParse('6/8');
    expect(good.ok).toBe(true);
    expect(good.ok && good.value.data).toEqual(Meter.parse('6/8').data);

    const bad = Meter.tryParse('C major');
    expect(bad.ok).toBe(false);
    if (bad.ok) {
      return;
    }
    expect(bad.error.code).toBe('INVALID_INPUT');
    // The throwing form is the non-throwing one unwrapped, and both report
    // what the function they wrap reports.
    let thrown: unknown;
    try {
      Meter.parse('C major');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toBe(bad.error.message);
    const reference = tryParseTimeSignature('C major');
    expect(reference.ok ? '' : reference.error.message).toBe(bad.error.message);
  });
});
