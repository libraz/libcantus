import { createRng } from '@libraz/libcantus/core';
import { describe, expect, it } from 'vitest';

describe('shared deterministic random generator', () => {
  it('preserves the Mulberry32 golden stream', () => {
    const rng = createRng(42);
    expect(Array.from({ length: 5 }, () => rng.next())).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('keeps simultaneous seeded streams isolated and deterministic', async () => {
    const streams = await Promise.all(
      Array.from({ length: 32 }, async () => {
        const rng = createRng(42);
        await Promise.resolve();
        return Array.from({ length: 5 }, () => rng.next());
      }),
    );
    expect(new Set(streams.map((stream) => JSON.stringify(stream))).size).toBe(1);
  });
});

describe('Rng.float stays below its upper bound', () => {
  it('never returns hi where rounding would reach it', () => {
    for (const [lo, hi] of [
      [0.7, 0.7000000000000001],
      [1e16, 1e16 + 2],
      [-0.7000000000000001, -0.7],
      [-Number.MIN_VALUE, 0],
    ] as const) {
      const rng = createRng(1);
      for (let i = 0; i < 2000; i += 1) {
        const value = rng.float(lo, hi);
        expect(value, `[${lo}, ${hi})`).toBeGreaterThanOrEqual(lo);
        expect(value, `[${lo}, ${hi})`).toBeLessThan(hi);
      }
    }
  });

  it('draws once per call and keeps ordinary values unchanged', () => {
    const floats = createRng(7);
    const units = createRng(7);
    for (let i = 0; i < 50; i += 1) {
      const unit = units.next();
      expect(floats.float(2, 6)).toBe(2 + unit * 4);
    }
    expect(createRng(3).float(5, 5)).toBe(5);
  });
});

describe('error messages', () => {
  it('carries a rejected value whole, past a NUL character', () => {
    expect(() => createRng('x\u0000y' as unknown as number)).toThrow(
      'seed must be finite; received x\u0000y',
    );
  });
});
