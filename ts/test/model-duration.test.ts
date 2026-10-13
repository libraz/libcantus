import { describe, expect, it } from 'vitest';
import { Duration } from '../src/model/duration.js';

describe('Duration as a value', () => {
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
});
