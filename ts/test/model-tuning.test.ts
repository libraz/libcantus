import { describe, expect, it } from 'vitest';
import { Tuning } from '../src/model/tuning.js';

describe('Tuning plain data', () => {
  it('hands out its table as a fresh copy', () => {
    const tuning = Tuning.edo(19, 432);
    expect(tuning.data).not.toBe(tuning.data);
    expect(tuning.data).toEqual(tuning.data);
    expect(tuning.data).toEqual({ refStep: 69, refFreq: 432, divisions: 19 });
  });
});
