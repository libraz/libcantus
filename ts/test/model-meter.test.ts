import { describe, expect, it } from 'vitest';
import { Meter } from '../src/model/meter.js';

describe('Meter as a value', () => {
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
});
