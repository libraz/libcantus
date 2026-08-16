import { describe, expect, it } from 'vitest';
import { choosePhrasePath, PHRASE_CUT_COST } from '../src/analyze/form/phrase.js';

/**
 * How well a length matches what a phrase is expected to run.
 *
 * Mirrors the search's own length term so a reading can be scored here exactly
 * as the search scores it — same operations in the same order, so two readings
 * that tie in the search tie here too, down to the last bit.
 */
function lengthFit(length: number, expected: number): number {
  if (!(expected > 0)) {
    return 0;
  }
  return Math.max(-1, 1 - Math.abs(length - expected) / expected);
}

/** Every reading the search may return, with the value it is worth. */
function everyReading(
  beats: readonly number[],
  strengths: readonly number[],
  minPhraseBeats: number,
  expected: number,
): { path: number[]; value: number }[] {
  const readings: { path: number[]; value: number }[] = [];
  const last = beats.length - 1;
  const walk = (at: number, value: number, path: number[]): void => {
    if (at === last) {
      readings.push({ path: [...path], value });
      return;
    }
    for (let j = at + 1; j <= last; j += 1) {
      const length = (beats[j] ?? 0) - (beats[at] ?? 0);
      if (length < minPhraseBeats - 1e-9) {
        continue;
      }
      walk(j, value + (strengths[j] ?? 0) + lengthFit(length, expected) - PHRASE_CUT_COST, [
        ...path,
        j,
      ]);
    }
  };
  walk(0, 0, []);
  return readings;
}

describe('the phrase search settles a tie on the reading with fewer boundaries', () => {
  // The tie the rule is about happens where a boundary carrying no evidence of
  // its own is paid for exactly by the length term: two four-beat phrases fit
  // the expected six-beat phrase as well as one eight-beat phrase does, so the
  // reading that cuts and the reading that does not are worth the same. Written
  // out, both come to -0.1333333333333333 — the same double, not merely a close
  // one, which is what makes this the tie-break rather than the comparison.
  const EXPECTED = 6;
  const BEATS = [0, 4, 8];
  const BREAK_EVEN = PHRASE_CUT_COST - lengthFit(4, EXPECTED);
  const END_STRENGTH = 0.5;

  it('scores the two readings identically, to the bit', () => {
    const readings = everyReading(BEATS, [0, BREAK_EVEN, END_STRENGTH], 1, EXPECTED);
    expect(readings.map((reading) => reading.path)).toEqual([[1, 2], [2]]);
    expect(readings[0]?.value).toBe(readings[1]?.value);
  });

  it('returns the reading without the boundary', () => {
    expect(choosePhrasePath(BEATS, [0, BREAK_EVEN, END_STRENGTH], 1, EXPECTED)).toEqual([2]);
  });

  it('takes the boundary as soon as the evidence prefers it', () => {
    // The rule suppresses nothing: a hair more evidence and the search cuts.
    const strengths = [0, BREAK_EVEN + 0.01, END_STRENGTH];
    expect(choosePhrasePath(BEATS, strengths, 1, EXPECTED)).toEqual([1, 2]);
  });
});

describe('the phrase search returns the best reading, and the plainest of the best', () => {
  // Stated over readings rather than over the loop: whatever order predecessors
  // are visited in, the answer has to be a highest-scoring reading, and among
  // those, one with as few boundaries as any. A search that invented a boundary
  // the evidence is indifferent to would fail this without any appeal to how it
  // is written.
  const STRENGTH_POOL = [0, 0.25, 0.5, PHRASE_CUT_COST - 1 / 3, 0.75, 1];
  const EXPECTED_POOL = [4, 6, 8];

  it('holds over a battery of readings, ties included', () => {
    let seed = 424242;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let tieCases = 0;
    for (let trial = 0; trial < 1500; trial += 1) {
      const stopCount = 3 + Math.floor(next() * 4);
      const beats = [0];
      for (let n = 1; n < stopCount; n += 1) {
        beats.push((beats[n - 1] ?? 0) + Math.round(next() * 3 + 1) * 2);
      }
      const strengths = beats.map(
        () => STRENGTH_POOL[Math.floor(next() * STRENGTH_POOL.length)] ?? 0,
      );
      strengths[0] = 0;
      const expected = EXPECTED_POOL[Math.floor(next() * EXPECTED_POOL.length)] ?? 4;
      const readings = everyReading(beats, strengths, 1, expected);
      const best = Math.max(...readings.map((reading) => reading.value));
      const bestReadings = readings.filter((reading) => reading.value === best);
      if (bestReadings.length > 1) {
        tieCases += 1;
      }
      const fewest = Math.min(...bestReadings.map((reading) => reading.path.length));
      const chosen = choosePhrasePath(beats, strengths, 1, expected);
      const chosenValue = readings.find((reading) => reading.path.join() === chosen.join())?.value;
      const at = `beats=${beats.join()} strengths=${strengths.join()} expected=${expected}`;
      expect(chosenValue, at).toBe(best);
      expect(chosen.length, at).toBe(fewest);
    }
    // The property is only worth stating if the battery reaches the ties.
    expect(tieCases).toBeGreaterThan(20);
  });
});
