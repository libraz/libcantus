import { describe, expect, it } from 'vitest';
import { beatsPerBar, metricWeight, type TimeSignature } from '../src/core/meter/index.js';
import {
  generateRhythm,
  onsetWeightCurve,
  type RhythmEvent,
  rhythmDensity,
} from '../src/generate/rhythm/index.js';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8 };

const EPS = 1e-9;

describe('onsetWeightCurve', () => {
  it('is monotonic non-decreasing in weight', () => {
    expect(onsetWeightCurve(0)).toBeLessThan(onsetWeightCurve(1));
    expect(onsetWeightCurve(1)).toBeLessThan(onsetWeightCurve(2));
    expect(onsetWeightCurve(2)).toBeLessThan(onsetWeightCurve(3));
  });

  it('makes the downbeat certain and stays within [0, 1]', () => {
    expect(onsetWeightCurve(3)).toBe(1);
    for (const w of [0, 1, 2, 3]) {
      expect(onsetWeightCurve(w)).toBeGreaterThanOrEqual(0);
      expect(onsetWeightCurve(w)).toBeLessThanOrEqual(1);
    }
  });
});

describe('generateRhythm determinism', () => {
  it('produces identical output for the same seed and options', () => {
    const a = generateRhythm(FOUR_FOUR, { seed: 42, bars: 2 });
    const b = generateRhythm(FOUR_FOUR, { seed: 42, bars: 2 });
    expect(a).toEqual(b);
  });

  it('is deeply equal on repeat across a range of option combinations', () => {
    const optionSets = [
      { seed: 0, bars: 1, subdivision: 2, density: 0.3 },
      { seed: 3, bars: 3, subdivision: 4, density: 0.7 },
      { seed: 99, bars: 2, subdivision: 3, density: 1 },
    ];
    for (const opts of optionSets) {
      expect(generateRhythm(SIX_EIGHT, opts)).toEqual(generateRhythm(SIX_EIGHT, opts));
      expect(generateRhythm(FOUR_FOUR, opts)).toEqual(generateRhythm(FOUR_FOUR, opts));
    }
  });

  it('generally differs across seeds', () => {
    const base = generateRhythm(FOUR_FOUR, { seed: 1, subdivision: 4 });
    let differing = 0;
    for (let seed = 2; seed <= 20; seed += 1) {
      const other = generateRhythm(FOUR_FOUR, { seed, subdivision: 4 });
      if (JSON.stringify(other) !== JSON.stringify(base)) {
        differing += 1;
      }
    }
    expect(differing).toBeGreaterThan(15);
  });
});

describe('generateRhythm downbeats', () => {
  it('forces every bar downbeat regardless of seed', () => {
    const bars = 3;
    const barBeats = beatsPerBar(FOUR_FOUR);
    const downbeats = Array.from({ length: bars }, (_, b) => b * barBeats);
    for (let seed = 0; seed < 20; seed += 1) {
      const events = generateRhythm(FOUR_FOUR, { seed, bars, subdivision: 4 });
      const positions = new Set(events.map((e) => e.position));
      for (const downbeat of downbeats) {
        expect(positions.has(downbeat)).toBe(true);
      }
    }
  });

  it('keeps every bar downbeat even at density 0', () => {
    const bars = 4;
    const barBeats = beatsPerBar(FOUR_FOUR);
    for (let seed = 0; seed < 10; seed += 1) {
      const events = generateRhythm(FOUR_FOUR, { seed, bars, subdivision: 4, density: 0 });
      // With no probabilistic onsets, exactly the bar downbeats remain.
      expect(events.map((e) => e.position)).toEqual([0, barBeats, 2 * barBeats, 3 * barBeats]);
    }
  });
});

describe('generateRhythm density clamping', () => {
  it('treats density 0 as no probabilistic onsets (downbeats only)', () => {
    const events = generateRhythm(FOUR_FOUR, { seed: 5, bars: 2, subdivision: 4, density: 0 });
    expect(events.map((e) => e.position)).toEqual([0, 4]);
  });

  it('clamps density above 1 to exactly 1', () => {
    const atOne = generateRhythm(FOUR_FOUR, { seed: 9, bars: 2, subdivision: 4, density: 1 });
    const overOne = generateRhythm(FOUR_FOUR, { seed: 9, bars: 2, subdivision: 4, density: 1.5 });
    expect(overOne).toEqual(atOne);
  });

  it('clamps negative density to 0', () => {
    const atZero = generateRhythm(FOUR_FOUR, { seed: 9, bars: 2, subdivision: 4, density: 0 });
    const belowZero = generateRhythm(FOUR_FOUR, {
      seed: 9,
      bars: 2,
      subdivision: 4,
      density: -0.5,
    });
    expect(belowZero).toEqual(atZero);
  });
});

describe('generateRhythm structure', () => {
  const meters: [string, TimeSignature][] = [
    ['4/4', FOUR_FOUR],
    ['6/8', SIX_EIGHT],
  ];

  for (const [name, ts] of meters) {
    describe(name, () => {
      it('always includes the downbeat at position 0', () => {
        for (let seed = 0; seed < 10; seed += 1) {
          const events = generateRhythm(ts, { seed, bars: 2 });
          expect(events[0]?.position).toBe(0);
        }
      });

      it('is sorted by position and non-overlapping', () => {
        const events = generateRhythm(ts, { seed: 7, bars: 2, subdivision: 4 });
        for (let i = 1; i < events.length; i += 1) {
          const prev = events[i - 1] as RhythmEvent;
          const curr = events[i] as RhythmEvent;
          expect(curr.position).toBeGreaterThan(prev.position);
          expect(prev.position + prev.duration).toBeLessThanOrEqual(curr.position + EPS);
        }
      });

      it('has durations summing to the full span', () => {
        const bars = 3;
        const events = generateRhythm(ts, { seed: 11, bars, subdivision: 4 });
        const total = events.reduce((sum, e) => sum + e.duration, 0);
        expect(total).toBeCloseTo(beatsPerBar(ts) * bars, 9);
      });

      it('has all onsets on grid and positive durations', () => {
        const subdivision = 4;
        const events = generateRhythm(ts, { seed: 3, bars: 2, subdivision });
        for (const e of events) {
          expect(e.duration).toBeGreaterThan(0);
          const steps = e.position * subdivision;
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(EPS);
        }
      });
    });
  }
});

describe('generateRhythm density', () => {
  it('higher density yields at least as many onsets on the same seed', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const low = generateRhythm(FOUR_FOUR, { seed, density: 0.2, subdivision: 4 });
      const high = generateRhythm(FOUR_FOUR, { seed, density: 0.9, subdivision: 4 });
      expect(high.length).toBeGreaterThanOrEqual(low.length);
    }
  });
});

describe('metric preference', () => {
  it('places onsets on strong beats more often than on weak ones', () => {
    // Aggregate onset counts by metric weight across many seeds and compare
    // the per-slot hit rate on strong vs. weak grid positions.
    const subdivision = 4;
    const bars = 2;
    const ts = FOUR_FOUR;
    const spanBeats = beatsPerBar(ts) * bars;
    const slotCount = Math.round(spanBeats * subdivision);

    let strongHits = 0;
    let strongSlots = 0;
    let weakHits = 0;
    let weakSlots = 0;
    const seeds = 200;

    for (let seed = 0; seed < seeds; seed += 1) {
      const events = generateRhythm(ts, { seed, bars, subdivision, density: 0.5 });
      const onsetSet = new Set(events.map((e) => Math.round(e.position * subdivision)));
      // Skip slot 0, which is always forced on.
      for (let i = 1; i < slotCount; i += 1) {
        const weight = metricWeight(i / subdivision, ts);
        const hit = onsetSet.has(i) ? 1 : 0;
        if (weight >= 2) {
          strongSlots += 1;
          strongHits += hit;
        } else if (weight === 0) {
          weakSlots += 1;
          weakHits += hit;
        }
      }
    }

    const strongRate = strongHits / strongSlots;
    const weakRate = weakHits / weakSlots;
    expect(strongRate).toBeGreaterThan(weakRate);
  });
});

describe('rhythmDensity', () => {
  it('reports the mean onset count per bar', () => {
    const events = generateRhythm(FOUR_FOUR, { seed: 5, bars: 2, subdivision: 4 });
    const perBar = rhythmDensity(events, FOUR_FOUR);
    expect(perBar).toBeCloseTo(events.length / 2, 9);
  });

  it('returns 0 for an empty pattern', () => {
    expect(rhythmDensity([], FOUR_FOUR)).toBe(0);
  });
});
