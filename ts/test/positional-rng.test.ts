import { describe, expect, it } from 'vitest';
import {
  createPositionalRng,
  includeAt,
  type PositionalRng,
} from '../src/core/random/positional.js';
import { deriveSeed, type SeedPath } from '../src/core/random/seed.js';

/** Every sixteenth-note position of a thirty-two bar span. */
const GRID: SeedPath[] = Array.from({ length: 32 }, (_bar, bar) =>
  Array.from({ length: 16 }, (_step, step) => [bar, step] as SeedPath),
).flat();

/** The positions a complexity dial selects, keyed for set comparison. */
function selected(rng: PositionalRng, complexity: number): Set<string> {
  const chosen = new Set<string>();
  for (const path of GRID) {
    if (includeAt(rng, complexity, ...path)) {
      chosen.add(path.join(':'));
    }
  }
  return chosen;
}

describe('position-addressed randomness', () => {
  it('returns the same value however often a position is asked for', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    const first = rng.at(4, 2.5, 'ghost');
    for (let i = 0; i < 8; i += 1) {
      expect(rng.at(4, 2.5, 'ghost')).toBe(first);
    }
    // Interleaving other positions must not advance anything.
    rng.at(0, 0);
    rng.at(31, 15, 'snare');
    expect(rng.at(4, 2.5, 'ghost')).toBe(first);
  });

  it('holds no cursor: any visiting order gives the same values', () => {
    const rng = createPositionalRng(7);
    const forward = GRID.map((path) => rng.at(...path));
    const backward = [...GRID].reverse().map((path) => rng.at(...path));
    expect(backward.reverse()).toEqual(forward);
    // A scattered order, and a second instance of the same seed, agree too.
    const other = createPositionalRng(7);
    const scattered = new Map<string, number>();
    for (let i = 0; i < GRID.length; i += 1) {
      const path = GRID[(i * 173) % GRID.length] ?? [];
      scattered.set(path.join(':'), other.at(...path));
    }
    for (let i = 0; i < GRID.length; i += 1) {
      expect(scattered.get((GRID[i] ?? []).join(':'))).toBe(forward[i]);
    }
  });

  it('draws in [0, 1) and spreads over the unit interval', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    const count = 20000;
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let bar = 0; bar < 1000; bar += 1) {
      for (let step = 0; step < 20; step += 1) {
        const draw = rng.at(bar, step);
        expect(draw).toBeGreaterThanOrEqual(0);
        expect(draw).toBeLessThan(1);
        buckets[Math.floor(draw * 10)] = (buckets[Math.floor(draw * 10)] ?? 0) + 1;
        sum += draw;
      }
    }
    expect(sum / count).toBeCloseTo(0.5, 2);
    const expected = count / 10;
    for (const bucket of buckets) {
      expect(bucket).toBeGreaterThan(expected * 0.85);
      expect(bucket).toBeLessThan(expected * 1.15);
    }
  });

  it('gives unrelated streams to different seeds', () => {
    const a = createPositionalRng(1);
    const b = createPositionalRng(2);
    const shared = GRID.filter((path) => a.at(...path) === b.at(...path));
    expect(shared).toEqual([]);
  });

  it('keeps positional draws independent of derived seeds', () => {
    // Otherwise a generator that seeds a sub-part and draws at the same
    // position would be using one number twice.
    const seed = deriveSeed(42, 'drums');
    const rng = createPositionalRng(seed);
    for (const path of GRID.slice(0, 32)) {
      expect(rng.at(...path)).not.toBe(deriveSeed(seed, ...path) / 4294967296);
    }
  });

  it('rejects a seed outside the seed range', () => {
    expect(() => createPositionalRng(-1)).toThrow();
    expect(() => createPositionalRng(1.5)).toThrow();
    expect(() => createPositionalRng(0x100000000)).toThrow();
  });

  it('preserves the positional golden values', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    expect(rng.at(0, 0, 'kick')).toBe(0.9651263654232025);
    expect(rng.at(3, 2.5, 'ghost')).toBe(0.5042517399415374);
    const plain = createPositionalRng(7);
    expect(plain.at()).toBe(0.9939962499774992);
    expect(plain.at('a')).toBe(0.5571061174850911);
    expect(plain.at(0)).toBe(0.08448557695373893);
  });
});

describe('threshold sampling', () => {
  it('selects nothing at 0 and everything at 1', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    expect(selected(rng, 0).size).toBe(0);
    expect(selected(rng, 1).size).toBe(GRID.length);
  });

  it('compares the position draw against the dial', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    for (const path of GRID.slice(0, 64)) {
      expect(includeAt(rng, 0.37, ...path)).toBe(rng.at(...path) < 0.37);
    }
  });

  it('only ever adds events as the dial rises', () => {
    // The property a slider depends on: for c1 < c2 the events at c1 are a
    // subset of the events at c2, so nothing already sounding moves.
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    const grid = Array.from({ length: 21 }, (_step, step) => step / 20);
    const sets = grid.map((complexity) => selected(rng, complexity));
    for (let lower = 0; lower < sets.length; lower += 1) {
      for (let upper = lower + 1; upper < sets.length; upper += 1) {
        const smaller = sets[lower] ?? new Set<string>();
        const larger = sets[upper] ?? new Set<string>();
        for (const event of smaller) {
          expect(larger.has(event)).toBe(true);
        }
        expect(larger.size).toBeGreaterThanOrEqual(smaller.size);
      }
    }
    // The dial has to actually do something across its range.
    expect((sets[20] ?? new Set()).size).toBeGreaterThan((sets[0] ?? new Set()).size);
  });

  it('grows smoothly rather than in steps', () => {
    const rng = createPositionalRng(deriveSeed(42, 'drums'));
    const counts = Array.from({ length: 11 }, (_step, step) => selected(rng, step / 10).size);
    for (let i = 0; i < counts.length; i += 1) {
      // Selection is a fair coin per position, so the count tracks the dial
      // instead of jumping between a handful of quantised levels.
      expect(Math.abs((counts[i] ?? 0) - (GRID.length * i) / 10)).toBeLessThan(GRID.length / 10);
    }
  });

  it('accepts a caller-supplied positional source', () => {
    const fixed: PositionalRng = { at: (...path) => (path.length % 2 === 0 ? 0.25 : 0.75) };
    expect(includeAt(fixed, 0.5, 'a', 'b')).toBe(true);
    expect(includeAt(fixed, 0.5, 'a')).toBe(false);
  });

  it('rejects a dial outside [0, 1]', () => {
    const rng = createPositionalRng(7);
    expect(() => includeAt(rng, -0.1, 0)).toThrow();
    expect(() => includeAt(rng, 1.1, 0)).toThrow();
    expect(() => includeAt(rng, Number.NaN, 0)).toThrow();
  });

  it('rejects a source whose draw would break monotonicity', () => {
    for (const draw of [1, -0.1, Number.NaN]) {
      const broken: PositionalRng = { at: () => draw };
      expect(() => includeAt(broken, 0.5, 0)).toThrow(/positional draw/);
    }
  });
});
