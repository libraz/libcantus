import { describe, expect, it } from 'vitest';
import type { MeterMap, TimeSignature } from '../src/core/meter/index.js';
import { meterAt, resolveMeters, toMeterData } from '../src/core/meter/index.js';

const AKSAK: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };

describe('the meter a caller is handed back', () => {
  it('is a new signature on every call, never the shared default', () => {
    const first = resolveMeters({});
    const second = resolveMeters({});
    expect(first[0]?.ts).toEqual({ numerator: 4, denominator: 4 });
    expect(first[0]?.ts).not.toBe(second[0]?.ts);
    expect(first).not.toBe(second);
  });

  it('leaves the default meter alone when the returned one is written to', () => {
    const held = resolveMeters({});
    const ts = held[0]?.ts as TimeSignature;
    ts.numerator = 99;
    ts.denominator = 4;
    expect(resolveMeters({})[0]?.ts).toEqual({ numerator: 4, denominator: 4 });
    // A meter the piece never declared cannot reach a piece analysed later.
    expect(meterAt(0, resolveMeters({}))).toEqual({ numerator: 4, denominator: 4 });
  });

  it('does not alias the signature the caller passed in', () => {
    const given: TimeSignature = { ...AKSAK, grouping: [...(AKSAK.grouping ?? [])] };
    const resolved = resolveMeters({ ts: given });
    const ts = resolved[0]?.ts as TimeSignature;
    expect(ts).not.toBe(given);
    expect(ts.grouping).not.toBe(given.grouping);
    ts.grouping?.push(4);
    expect(given.grouping).toEqual([2, 2, 3]);
  });

  it('does not alias the map the caller passed in', () => {
    const given: MeterMap = [
      { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
      { startBeat: 8, ts: { ...AKSAK, grouping: [...(AKSAK.grouping ?? [])] } },
    ];
    const resolved = resolveMeters({ meters: given });
    expect(resolved).toEqual(given);
    expect(resolved).not.toBe(given);
    expect(resolved[1]).not.toBe(given[1]);
    expect(resolved[1]?.ts).not.toBe(given[1]?.ts);
    expect(resolved[1]?.ts.grouping).not.toBe(given[1]?.ts.grouping);
    const entry = resolved[1] as MeterMap[number];
    entry.startBeat = 4;
    entry.ts.numerator = 5;
    expect(given[1]?.startBeat).toBe(8);
    expect(given[1]?.ts.numerator).toBe(7);
  });
});

describe('the meter data an entry point resolves', () => {
  it('hands out a fresh signature on every call', () => {
    const given: TimeSignature = { ...AKSAK, grouping: [...(AKSAK.grouping ?? [])] };
    const first = toMeterData(given) as TimeSignature;
    const second = toMeterData(given) as TimeSignature;
    expect(first).toEqual(given);
    expect(first).not.toBe(given);
    expect(first).not.toBe(second);
    expect(first.grouping).not.toBe(second.grouping);
    first.numerator = 13;
    expect((toMeterData(given) as TimeSignature).numerator).toBe(7);
  });

  it('hands out a fresh map on every call', () => {
    const given: MeterMap = [{ startBeat: 0, ts: { numerator: 3, denominator: 4 } }];
    const first = toMeterData(given) as MeterMap;
    const second = toMeterData(given) as MeterMap;
    expect(first).toEqual(given);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]?.ts).not.toBe(second[0]?.ts);
  });

  it('hands out a fresh signature from a name and from a wrapper', () => {
    const fromText = toMeterData('6/8') as TimeSignature;
    expect(toMeterData('6/8')).not.toBe(fromText);
    const wrapper = { toJSON: (): TimeSignature => ({ numerator: 5, denominator: 4 }) };
    const fromWrapper = toMeterData(wrapper) as TimeSignature;
    expect(fromWrapper).toEqual({ numerator: 5, denominator: 4 });
    expect(fromWrapper).not.toBe(toMeterData(wrapper));
  });

  it('does not hand out the signature a map entry holds', () => {
    const meters = resolveMeters({ meters: [{ startBeat: 0, ts: { ...AKSAK } }] });
    const read = meterAt(0, meters);
    expect(read).toEqual(AKSAK);
    expect(read).not.toBe(meters[0]?.ts);
    read.numerator = 11;
    expect(meterAt(0, meters).numerator).toBe(7);
  });
});
