import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/random/index.js';
import { deriveSeed, type SeedPath } from '../src/core/random/seed.js';
import {
  ALGORITHM_VERSION,
  MIN_ALGORITHM_VERSION,
  resolveAlgorithmVersion,
} from '../src/core/random/version.js';

/** Number of differing bits between two 32-bit seeds. */
function bitDistance(a: number, b: number): number {
  let word = (a ^ b) >>> 0;
  let count = 0;
  while (word !== 0) {
    count += word & 1;
    word >>>= 1;
  }
  return count;
}

describe('hierarchical seed derivation', () => {
  it('derives the same seed for the same path, every time', () => {
    const first = deriveSeed(42, 'drums', 'chorus', 3);
    for (let i = 0; i < 8; i += 1) {
      expect(deriveSeed(42, 'drums', 'chorus', 3)).toBe(first);
    }
  });

  it('derives a seed createRng accepts', () => {
    const paths: SeedPath[] = [[], ['drums'], ['bass', 'verse', 0], ['x', -1.5], ['', 0]];
    for (const path of paths) {
      const seed = deriveSeed(42, ...path);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
      expect(() => createRng(seed)).not.toThrow();
    }
  });

  it('sends near-identical names to unrelated seeds', () => {
    const drums = deriveSeed(42, 'drums');
    const drum = deriveSeed(42, 'drum');
    const padded = deriveSeed(42, 'drums ');
    expect(new Set([drums, drum, padded]).size).toBe(3);
    // A one-character difference must avalanche, not shift a few low bits.
    expect(bitDistance(drums, drum)).toBeGreaterThanOrEqual(8);
    expect(bitDistance(drums, padded)).toBeGreaterThanOrEqual(8);
    expect(bitDistance(drum, padded)).toBeGreaterThanOrEqual(8);
  });

  it('sends adjacent variation numbers to unrelated seeds', () => {
    const first = deriveSeed(42, 'drums', 'chorus', 1);
    const second = deriveSeed(42, 'drums', 'chorus', 2);
    expect(first).not.toBe(second);
    expect(bitDistance(first, second)).toBeGreaterThanOrEqual(8);
  });

  it('separates roots that differ by one', () => {
    expect(bitDistance(deriveSeed(41, 'drums'), deriveSeed(42, 'drums'))).toBeGreaterThanOrEqual(8);
  });

  it('keeps a number segment apart from its decimal spelling', () => {
    expect(deriveSeed(42, 'drums', 3)).not.toBe(deriveSeed(42, 'drums', '3'));
  });

  it('keeps segment boundaries unambiguous', () => {
    // Without a length prefix these two paths would hash the same bytes.
    expect(deriveSeed(42, 'ab', 'c')).not.toBe(deriveSeed(42, 'a', 'bc'));
    expect(deriveSeed(42, 'a')).not.toBe(deriveSeed(42, 'a', ''));
  });

  it('treats negative zero as zero', () => {
    // The two compare equal, so a caller reading the path sees one address.
    expect(deriveSeed(42, 'bar', -0)).toBe(deriveSeed(42, 'bar', 0));
  });

  it('distributes sibling paths without collisions', () => {
    const count = 20000;
    const seeds = new Set<number>();
    const buckets = new Array<number>(16).fill(0);
    for (let index = 0; index < count; index += 1) {
      const seed = deriveSeed(42, 'bar', index);
      seeds.add(seed);
      buckets[seed >>> 28] = (buckets[seed >>> 28] ?? 0) + 1;
    }
    expect(seeds.size).toBe(count);
    const expected = count / 16;
    for (const bucket of buckets) {
      expect(bucket).toBeGreaterThan(expected * 0.85);
      expect(bucket).toBeLessThan(expected * 1.15);
    }
  });

  it('preserves the derivation golden values', () => {
    // Pinned so a change to the mixing function cannot pass unnoticed: every
    // seed saved by a caller depends on these.
    expect(deriveSeed(42)).toBe(1827562367);
    expect(deriveSeed(42, 'drums')).toBe(1945151523);
    expect(deriveSeed(42, 'drums', 'chorus', 3)).toBe(1211545333);
    expect(deriveSeed(0, 'a')).toBe(2784846123);
    expect(deriveSeed(0xffffffff, 'a')).toBe(2693774173);
    expect(createRng(deriveSeed(42, 'drums')).next()).toBe(0.18077733018435538);
  });

  it('rejects a root outside the seed range', () => {
    expect(() => deriveSeed(-1, 'drums')).toThrow();
    expect(() => deriveSeed(0x100000000, 'drums')).toThrow();
    expect(() => deriveSeed(1.5, 'drums')).toThrow();
    expect(() => deriveSeed(Number.NaN, 'drums')).toThrow();
  });

  it('rejects a segment that addresses nothing', () => {
    expect(() => deriveSeed(42, Number.NaN)).toThrow();
    expect(() => deriveSeed(42, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => deriveSeed(42, true as unknown as string)).toThrow();
    expect(() => deriveSeed(42, undefined as unknown as string)).toThrow();
    expect(() => deriveSeed(42, null as unknown as string)).toThrow();
  });
});

describe('algorithm version', () => {
  it('declares a version this build produces', () => {
    expect(Number.isInteger(ALGORITHM_VERSION)).toBe(true);
    expect(MIN_ALGORITHM_VERSION).toBeGreaterThanOrEqual(1);
    expect(ALGORITHM_VERSION).toBeGreaterThanOrEqual(MIN_ALGORITHM_VERSION);
  });

  it('runs an unpinned request at the current version', () => {
    expect(resolveAlgorithmVersion()).toBe(ALGORITHM_VERSION);
    expect(resolveAlgorithmVersion(undefined)).toBe(ALGORITHM_VERSION);
  });

  it('returns a supported pin unchanged', () => {
    for (let version = MIN_ALGORITHM_VERSION; version <= ALGORITHM_VERSION; version += 1) {
      expect(resolveAlgorithmVersion(version)).toBe(version);
    }
  });

  it('rejects a version this build does not produce', () => {
    // A project saved by a newer build must fail rather than come back as a
    // different piece under the same name.
    expect(() => resolveAlgorithmVersion(ALGORITHM_VERSION + 1)).toThrow(/algorithm version/);
    expect(() => resolveAlgorithmVersion(MIN_ALGORITHM_VERSION - 1)).toThrow(/algorithm version/);
    expect(() => resolveAlgorithmVersion(1.5)).toThrow();
    expect(() => resolveAlgorithmVersion(Number.NaN)).toThrow();
  });
});
