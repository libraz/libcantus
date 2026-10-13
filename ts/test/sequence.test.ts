import { describe, expect, it } from 'vitest';
import { distanceToSimilarity, gradedEditDistance } from '../src/analyze/sequence.js';

/** 0 for equal values, 1 otherwise. */
const flatCost = (x: number, y: number): number => (x === y ? 0 : 1);

/** Capped absolute difference, scaled so a gap of 10 saturates at 1. */
const gradedCost = (x: number, y: number): number => Math.min(1, Math.abs(x - y) / 10);

describe('gradedEditDistance', () => {
  it('is 0 for identical sequences, whatever the gap', () => {
    expect(gradedEditDistance([1, 2, 3], [1, 2, 3], flatCost)).toBe(0);
    expect(gradedEditDistance([1, 2, 3], [1, 2, 3], flatCost, 0.4)).toBe(0);
  });

  it('is 0 for two empty sequences', () => {
    expect(gradedEditDistance([], [], flatCost)).toBe(0);
  });

  it('charges one gap per element against an empty sequence', () => {
    expect(gradedEditDistance([], [1, 2, 3], flatCost, 1)).toBe(3);
    expect(gradedEditDistance([], [1, 2, 3], flatCost, 2)).toBe(6);
  });

  it('defaults the gap to 1, matching the cost the old hardcoded step used', () => {
    const a = [1, 1, 1];
    const b = [1, 1];
    expect(gradedEditDistance(a, b, flatCost)).toBe(gradedEditDistance(a, b, flatCost, 1));
    expect(gradedEditDistance(a, b, flatCost)).toBe(1);
  });

  it('charges a deletion at the gap cost when it is cheaper than the trailing match', () => {
    // a has one extra element; every element that lines up costs 0, so the
    // distance is exactly one gap however small that gap is.
    expect(gradedEditDistance([1, 1, 1], [1, 1], flatCost, 0.4)).toBeCloseTo(0.4, 9);
  });

  it('trades a costly substitution for two gaps once the gap is cheap enough', () => {
    // Hand-derived for a = [0, 50], b = [0, 100] under gradedCost: the optimal
    // alignment is either one substitution of cost 1 (0 vs 0, then 50 vs 100)
    // or two insert/delete gaps, so the distance is min(1, 2 * gap).
    const a = [0, 50];
    const b = [0, 100];
    expect(gradedEditDistance(a, b, gradedCost, 1)).toBeCloseTo(1, 9);
    expect(gradedEditDistance(a, b, gradedCost, 0.3)).toBeCloseTo(0.6, 9);
    expect(gradedEditDistance(a, b, gradedCost, 0.6)).toBeCloseTo(1, 9);
  });
});

describe('distanceToSimilarity', () => {
  it('is 1 when both sequences are empty', () => {
    expect(distanceToSimilarity(0, 0, 0)).toBe(1);
  });

  it('is 1 for a zero distance between non-empty sequences', () => {
    expect(distanceToSimilarity(0, 5, 5)).toBe(1);
  });

  it('normalises by the longer sequence', () => {
    expect(distanceToSimilarity(2, 5, 5)).toBeCloseTo(0.6, 9);
    expect(distanceToSimilarity(2, 5, 3)).toBeCloseTo(0.6, 9);
  });

  it('clamps to [0, 1]', () => {
    expect(distanceToSimilarity(10, 5, 5)).toBe(0);
  });
});
