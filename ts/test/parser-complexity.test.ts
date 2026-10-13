import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { BASS_4_STRING, foldIntoRange } from '../src/core/instrument/index.js';
import { bandFloor, foldIntoBand, placePc } from '../src/generate/bass/internal.js';

/**
 * The cost of one call, in milliseconds, as the best of several runs.
 *
 * The best rather than the mean: a scheduling interruption can only make a run
 * slower, so the fastest of them is the one least contaminated by the machine.
 */
function cost(run: () => void): number {
  run();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * A ceiling no linear parser approaches and no quadratic one meets.
 *
 * It backs up the growth ratio, which two sub-millisecond readings satisfy
 * whatever they are. A linear reading of the longest input here is under half a
 * millisecond and the quadratic readings it replaced were hundreds to tens of
 * thousands, so a ceiling of fifty leaves two orders of magnitude of headroom
 * for a loaded machine and still cannot be met by a quadratic path.
 */
const CEILING_MS = 50;

describe('an instrument profile the library accepts cannot be walked forever', () => {
  it('folds a pitch far outside the instrument without walking to it', () => {
    // Before the octave counts were computed, each of these stepped by twelve
    // from the pitch to the instrument, which is where the process hung. The
    // published entry no longer reaches the walk at all with a pitch this far
    // out — it is outside the MIDI compass, and is refused as such — so the
    // guarantee is stated where the pitch is still nameable, and the internal
    // band helpers, which take a band rather than an instrument, carry the rest.
    expect(() => foldIntoRange(-1e9, BASS_4_STRING)).toThrow(InvalidInputError);
    expect(() => foldIntoRange(1e9, BASS_4_STRING)).toThrow(InvalidInputError);
    expect(cost(() => void foldIntoRange(0, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoRange(127, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void bandFloor(1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void bandFloor(-1e9, BASS_4_STRING))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoBand(1e9, 36))).toBeLessThan(CEILING_MS);
    expect(cost(() => void foldIntoBand(-1e9, 36))).toBeLessThan(CEILING_MS);
    expect(cost(() => void placePc(0, 1e9, 36))).toBeLessThan(CEILING_MS);
  });

  it('folds and places exactly where it always did', () => {
    expect(foldIntoRange(27, BASS_4_STRING)).toBe(39);
    expect(foldIntoRange(40, BASS_4_STRING)).toBe(40);
    expect(foldIntoRange(100, BASS_4_STRING)).toBe(64);
    expect(bandFloor(36, BASS_4_STRING)).toBe(36);
    expect(bandFloor(12, BASS_4_STRING)).toBe(36);
    expect(bandFloor(96, BASS_4_STRING)).toBe(48);
    expect(bandFloor(36, undefined)).toBe(36);
    expect(foldIntoBand(20, 36)).toBe(44);
    expect(foldIntoBand(60, 36)).toBe(48);
    expect(foldIntoBand(40, 36)).toBe(40);
    expect(placePc(0, 61, 36)).toBe(48);
  });
});
