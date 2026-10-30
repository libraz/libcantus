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

describe('error messages', () => {
  it('carries a rejected value whole, past a NUL character', () => {
    expect(() => createRng('x\u0000y' as unknown as number)).toThrow(
      'seed must be finite; received x\u0000y',
    );
  });
});
