import { describe, expect, it } from 'vitest';
import { GUITAR_STANDARD } from '../src/core/instrument/index.js';
import { ALGORITHM_VERSION, createPositionalRng } from '../src/core/random/index.js';
import type { GenerationContext } from '../src/generate/context/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import type { ComposerOptions } from '../src/model/composer.js';
import { Composer } from '../src/model/composer.js';
import { Timeline } from '../src/model/timeline.js';
import { majorKey } from '../src/theory/scale/index.js';

/**
 * The settings holder: the contracts every model class holds, and — the point
 * of the class — that every part it writes is exactly what calling the
 * generator with the key, the meter and the context written out by hand
 * returns.
 */

const TS = { numerator: 4, denominator: 4 } as const;

/** The settings under test, with every field of the class filled. */
const OPTIONS: ComposerOptions = {
  key: 'C major',
  meters: TS,
  bpm: 96,
  seed: 7,
  complexity: { rhythmic: 0.6, harmonic: 0.4, ornament: 0.3, difficulty: 3 },
  instruments: { bass: GUITAR_STANDARD },
};

/**
 * The same settings as the generators read them, for the comparisons. The
 * algorithm version is written out because a composer concretises the one it
 * resolved when its settings were named, rather than leaving the parts to be
 * redrawn under whatever version the next build defaults to.
 */
const CTX: GenerationContext = {
  seed: 7,
  bpm: 96,
  algorithmVersion: ALGORITHM_VERSION,
  complexity: { rhythmic: 0.6, harmonic: 0.4, ornament: 0.3, difficulty: 3 },
  instruments: { bass: GUITAR_STANDARD },
};

const KEY = majorKey(0);

const composer = () => Composer.of(OPTIONS);

describe('plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const held = composer();
    expect(held.data).not.toBe(held.data);
    expect(held.data).toEqual(held.data);
  });

  it('exposes the context the generators are handed', () => {
    expect(composer().context).toEqual(CTX);
    expect(composer().context).not.toBe(composer().context);
    // A composer naming nothing still hands the generators the seed and the
    // version its parts are drawn under, which is what makes them repeatable.
    expect(Composer.of({}).context).toEqual({ seed: 0, algorithmVersion: ALGORITHM_VERSION });
  });
});

describe('immutability', () => {
  it('returns a new composer and leaves the original writing what it wrote', () => {
    const held = composer();
    const before = held.progression({ style: 'dance', bars: 4 });
    for (const variation of [held.withSeed(8), held.withKey('A minor'), held.with({ bpm: 120 })]) {
      expect(variation).not.toBe(held);
      expect(variation.equals(held)).toBe(false);
    }
    expect(held.data).toEqual(composer().data);
    expect(held.progression({ style: 'dance', bars: 4 }).equals(before)).toBe(true);
  });
});

describe('the reproduction recipe', () => {
  it('draws from a source it was handed, keeping it out of the plain data', () => {
    const rng = createPositionalRng(11);
    const written = Composer.of({ key: KEY, rng }).progression({ style: 'dance', bars: 4 });
    const byHand = generateProgression({ style: 'dance', bars: 4, key: KEY, ts: TS, ctx: { rng } });
    expect(written.equals(Timeline.fromChords(byHand, 16, KEY))).toBe(true);
    expect(Composer.of({ key: KEY, rng }).context.rng).toBe(rng);
    // A live source is not settings: it is held by reference and left out of
    // the data a caller may serialize.
    expect(Composer.of({ key: KEY, rng }).data.rng).toBeUndefined();
    expect(Composer.of({ key: KEY, rng }).withSeed(3).context.rng).toBe(rng);
  });
});
