/**
 * Generate a euclidean onset pattern (Bjorklund's algorithm), distributing
 * `pulses` as evenly as possible across `steps`, then rotating.
 *
 * @param pulses Number of onsets, clamped to [0, steps].
 * @param steps Total steps (>= 1).
 * @param rotation Steps to rotate onsets toward later positions.
 * @returns One boolean per step; true marks an onset.
 */
import {
  assertGenerationBudget,
  assertInteger,
  assertPositiveInt,
} from '../../core/validation/index.js';

export function euclideanRhythm(pulses: number, steps: number, rotation = 0): boolean[] {
  assertPositiveInt(steps, 'euclidean steps');
  assertInteger(pulses, 'euclidean pulses');
  assertInteger(rotation, 'euclidean rotation');
  assertGenerationBudget(steps, 'euclidean pattern steps');
  const p = Math.max(0, Math.min(pulses, steps));
  const base = bjorklund(p, steps);
  const shift = ((rotation % steps) + steps) % steps;
  if (shift === 0) {
    return base;
  }
  return base.map((_, i) => base[(i - shift + steps) % steps] ?? false);
}

/** True when the 16-step bitmask has an onset at `step`. */
export function hasHit(mask: number, step: number): boolean {
  return ((mask >> step) & 1) === 1;
}

/** Convert a euclidean boolean pattern to a 16-step bitmask (LSB = step 0). */
export function patternToMask(pattern: boolean[]): number {
  let mask = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i]) {
      mask |= 1 << i;
    }
  }
  return mask;
}

function bjorklund(pulses: number, steps: number): boolean[] {
  if (pulses === 0) {
    return Array.from({ length: steps }, () => false);
  }
  if (pulses >= steps) {
    return Array.from({ length: steps }, () => true);
  }
  let head: boolean[][] = Array.from({ length: pulses }, () => [true]);
  let remainder: boolean[][] = Array.from({ length: steps - pulses }, () => [false]);
  while (remainder.length > 1) {
    const count = Math.min(head.length, remainder.length);
    const next: boolean[][] = [];
    for (let i = 0; i < count; i += 1) {
      next.push([...(head[i] ?? []), ...(remainder[i] ?? [])]);
    }
    remainder = head.length > count ? head.slice(count) : remainder.slice(count);
    head = next;
  }
  return [...head.flat(), ...remainder.flat()];
}
