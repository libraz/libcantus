import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { assertDraw, DRAW_METHODS } from '../src/generate/context/draw.js';
import { resolveContext } from '../src/generate/context/index.js';

describe('the samplers a generator is handed', () => {
  it('names every sampler a draw carries', () => {
    // The check that a caller's sampler set is one reads a list of method
    // names, and a list is only as good as its agreement with the type it
    // stands for. Comparing it against a real draw is what keeps a sampler
    // added to `Draw` from being the one nobody checks for.
    const draw = resolveContext({ seed: 1 }).part('x');
    expect([...DRAW_METHODS].sort()).toEqual(Object.keys(draw).sort());
  });

  it('refuses a sampler set that is missing one', () => {
    const draw = resolveContext({ seed: 1 }).part('x');
    for (const method of DRAW_METHODS) {
      const broken = { ...draw, [method]: undefined } as unknown as typeof draw;
      expect(() => assertDraw(broken)).toThrow(InvalidInputError);
    }
    expect(() => assertDraw(null as unknown as typeof draw)).toThrow(InvalidInputError);
    expect(assertDraw(draw)).toBe(draw);
  });
});
