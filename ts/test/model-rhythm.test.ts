import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { Rhythm } from '../src/model/rhythm.js';

/**
 * `Rhythm` is a skin over the rhythm generator and the transforms that deform
 * a figure, so most of what is checked here is equivalence: the class answer
 * must be the answer the underlying functions give for the same onsets, the
 * same meter and the same context. The rest is the contract every model class
 * holds — plain data out, plain data back in, nothing shared with the caller,
 * and no transformation that mutates.
 */

const FOUR_FOUR = parseTimeSignature('4/4');

/** A two-bar pattern, dense enough for thinning and syncopation to bite. */
function pattern(): Rhythm {
  return Rhythm.generate(FOUR_FOUR, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.8 } } });
}

describe('Rhythm plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const rhythm = pattern();
    expect(rhythm.data).not.toBe(rhythm.data);
    expect(rhythm.data).toEqual(rhythm.data);
    expect(rhythm.data.events[0]).not.toBe(rhythm.data.events[0]);
    expect(rhythm.events).not.toBe(rhythm.events);
    expect(rhythm.ts).not.toBe(rhythm.ts);
  });
});
