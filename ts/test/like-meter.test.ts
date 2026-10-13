import { describe, expect, it } from 'vitest';
import type { MeterLike, MeterMap } from '../src/index.js';
import {
  Arrangement,
  barIndexAt,
  barPositionToBeat,
  barPositionToPulse,
  barStartBeat,
  beatsPerBarAt,
  beatToBarPosition,
  Composer,
  formatBarPosition,
  InvalidInputError,
  isStrongBeat,
  Meter,
  meterAt,
  metricWeight,
  parseTimeSignature,
  Score,
  tryParseTimeSignature,
} from '../src/index.js';

/**
 * Every entry point that takes a meter takes it in whichever form the caller
 * holds: the text a meter field carries, the plain time signature, the map of a
 * piece that changes meter, or a `Meter`. The text is read in one place, so
 * these functions accept exactly the signatures the parser accepts.
 */

const FOUR_FOUR = { numerator: 4, denominator: 4 };
const SIX_EIGHT = { numerator: 6, denominator: 8 };

/** Every reading a meter-aware entry point makes of a beat, for one meter. */
function readings(meter: MeterLike): unknown[] {
  return [
    meterAt(5, meter),
    barStartBeat(5, meter),
    barIndexAt(5, meter),
    beatsPerBarAt(5, meter),
    beatToBarPosition(5, meter),
    barPositionToPulse({ bar: 1, beat: 1.5 }, meter),
    barPositionToBeat({ bar: 2, beat: 1 }, meter),
    formatBarPosition(5, meter),
    metricWeight(5, meter),
    isStrongBeat(5, meter),
  ];
}

describe('a meter given as text', () => {
  it('answers as the same signature given as data', () => {
    expect(readings('4/4')).toEqual(readings(FOUR_FOUR));
    expect(readings('3/4')).toEqual(readings({ numerator: 3, denominator: 4 }));
  });

  it('reads an additive signature as its grouping, as the parser does', () => {
    expect(readings('2+2+3/8')).toEqual(readings(parseTimeSignature('2+2+3/8')));
    // The grouping is what makes the fifth quaver a secondary strong pulse.
    expect(metricWeight(2, '2+2+3/8')).toBe(2);
    expect(metricWeight(2, { numerator: 7, denominator: 8 })).toBe(1);
  });

  it('reads a compound signature as the compound meter it is', () => {
    expect(readings('6/8')).toEqual(readings(SIX_EIGHT));
    // Three quarter-note beats to the bar, felt as two dotted-quarter pulses.
    expect(beatsPerBarAt(0, '6/8')).toBe(3);
    expect(barPositionToPulse({ bar: 0, beat: 1.5 }, '6/8')).toBe(2);
    expect(barPositionToPulse({ bar: 0, beat: 1.5 }, SIX_EIGHT)).toBe(2);
    expect(formatBarPosition(7.5, '6/8')).toBe('3.2');
    expect(metricWeight(1.5, '6/8')).toBe(2);
    expect(metricWeight(1, '6/8')).toBe(0);
    expect(isStrongBeat(1.5, '6/8')).toBe(true);
  });

  it('never names a meter map, which has no text form', () => {
    const map: MeterMap = [
      { startBeat: 0, ts: FOUR_FOUR },
      { startBeat: 8, ts: { numerator: 3, denominator: 4 } },
    ];
    expect(meterAt(9, map)).toEqual({ numerator: 3, denominator: 4 });
    expect(barIndexAt(11, map)).toBe(3);
    expect(readings(map)).toEqual(readings(map));
  });

  it('reads a class instance through its serialized form', () => {
    expect(readings(Meter.parse('6/8'))).toEqual(readings(SIX_EIGHT));
    expect(readings(Meter.of(7, 8, [2, 2, 3]))).toEqual(readings(parseTimeSignature('2+2+3/8')));
  });

  it('rejects text that names no signature', () => {
    expect(() => meterAt(0, '7/')).toThrow(InvalidInputError);
    expect(() => meterAt(0, 'x/4')).toThrow(InvalidInputError);
    expect(() => metricWeight(0, '7/')).toThrow(InvalidInputError);
    expect(() => formatBarPosition(0, 'x/4')).toThrow(InvalidInputError);
    expect(() => barPositionToBeat({ bar: 0, beat: 0 }, '4/')).toThrow(InvalidInputError);
  });

  it('rejects a value that names no meter at all', () => {
    expect(() => meterAt(0, 4 as unknown as MeterLike)).toThrow(InvalidInputError);
    expect(() => meterAt(0, null as unknown as MeterLike)).toThrow(InvalidInputError);
    expect(() => meterAt(0, [] as MeterMap)).toThrow(InvalidInputError);
  });

  it('adds no shorthand of its own: what the parser rejects, it rejects', () => {
    const texts = [
      '4/4',
      '6/8',
      '2+2+3/8',
      ' 3 / 4 ',
      'C',
      '4',
      '4/',
      '/4',
      '4/4/4',
      '4-4',
      '0/4',
      '4/0',
      '-3/4',
      '3/4.5',
      '',
    ];
    for (const text of texts) {
      const parsed = tryParseTimeSignature(text);
      if (parsed.ok) {
        expect(meterAt(0, text), text).toEqual(parsed.value);
      } else {
        expect(() => meterAt(0, text), text).toThrow(InvalidInputError);
      }
    }
  });
});

describe('the model classes that take a meter', () => {
  it('builds a score on a signature named as text', () => {
    const notes = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    expect(Score.of(notes, { meters: '6/8' }).meters).toEqual(
      Score.of(notes, { meters: SIX_EIGHT }).meters,
    );
    expect(Score.of(notes, { meters: '6/8' }).meterAt(0)).toEqual(SIX_EIGHT);
    expect(Score.of(notes).withMeters('3/4').meterAt(0)).toEqual({
      numerator: 3,
      denominator: 4,
    });
    expect(Score.of(notes).withMeters(Meter.parse('6/8')).meterAt(0)).toEqual(SIX_EIGHT);
    expect(() => Score.of(notes, { meters: 'x/4' })).toThrow(InvalidInputError);
  });

  it('holds a composer on a signature named as text', () => {
    expect(Composer.of({ meters: '6/8' }).data.meters).toEqual([{ startBeat: 0, ts: SIX_EIGHT }]);
    expect(Composer.of({ meters: '6/8' }).data).toEqual(Composer.of({ meters: SIX_EIGHT }).data);
    expect(Composer.of({ meters: '3/4' }).with({ bpm: 90 }).data.meters).toEqual([
      { startBeat: 0, ts: { numerator: 3, denominator: 4 } },
    ]);
    expect(() => Composer.of({ meters: '7/' })).toThrow(InvalidInputError);
  });

  it('reads an arrangement on a signature named as text', () => {
    const tracks = [{ name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] }];
    expect(Arrangement.of(tracks, { meters: '6/8' }).data.settings?.meters).toEqual([
      { startBeat: 0, ts: SIX_EIGHT },
    ]);
    expect(() => Arrangement.of(tracks, { meters: 'x/4' })).toThrow(InvalidInputError);
  });
});
