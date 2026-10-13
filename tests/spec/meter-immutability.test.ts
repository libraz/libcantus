import { meterAt, resolveMeters, type TimeSignature } from '@libraz/libcantus/core';
import { describe, expect, it } from 'vitest';

describe('the meter a caller is handed back', () => {
  it('leaves the default meter alone when the returned one is written to', () => {
    const held = resolveMeters({});
    const ts = held[0]?.ts as TimeSignature;
    ts.numerator = 99;
    ts.denominator = 4;
    expect(resolveMeters({})[0]?.ts).toEqual({ numerator: 4, denominator: 4 });
    // A meter the piece never declared cannot reach a piece analysed later.
    expect(meterAt(0, resolveMeters({}))).toEqual({ numerator: 4, denominator: 4 });
  });
});
