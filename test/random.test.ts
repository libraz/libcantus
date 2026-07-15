import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/random/index.js';

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
