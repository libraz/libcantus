import { describe, expect, it } from 'vitest';
import {
  type DrumGenOptions,
  type GrooveStyle,
  generateDrums,
  type Section,
} from '../src/drums/index.js';
import { quantizeSwing } from '../src/drums/swing.js';

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;
const TAMBOURINE = 54;
const HANDCLAP = 39;

const isTom = (pitch: number) => pitch === 45 || pitch === 47 || pitch === 50;
const isOffGrid16 = (beat: number) => {
  const frac = beat - Math.floor(beat);
  return Math.abs(frac - 0.25) < 1e-6 || Math.abs(frac - 0.75) < 1e-6;
};

const base: DrumGenOptions = {
  bars: 1,
  bpm: 120,
  style: 'standard',
  section: 'verse',
  density: 0.5,
  seed: 1,
};

describe('generateDrums basic groove', () => {
  it('places a standard 1-and-3 kick and a backbeat snare', () => {
    const hits = generateDrums(base);
    const kicks = hits.filter((h) => h.pitch === KICK);
    // Standard pop groove: kick on beats 1 and 3 (0-based 0 and 2). The verse
    // section adds no kick syncopation, so exactly two downbeat kicks land.
    expect(kicks.map((h) => h.startBeat).sort((a, b) => a - b)).toEqual([0, 2]);

    const snares = hits.filter((h) => h.pitch === SNARE);
    expect(snares.map((h) => h.startBeat).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('adds hits monotonically with density', () => {
    const sparse = generateDrums({ ...base, density: 0.3 });
    const dense = generateDrums({ ...base, density: 0.8 });
    expect(dense.length).toBeGreaterThanOrEqual(sparse.length);
  });

  it('suppresses 16th-note hats at high BPM', () => {
    const countHats = (opts: DrumGenOptions) =>
      generateDrums(opts).filter((h) => h.pitch === CLOSED_HAT).length;
    const slow = countHats({ ...base, density: 0.8, bpm: 110 });
    const fast = countHats({ ...base, density: 0.8, bpm: 180 });
    expect(fast).toBeLessThanOrEqual(slow);
  });

  it('replaces only the last bar when fills are enabled', () => {
    const opts: DrumGenOptions = { ...base, bars: 4, seed: 0 };
    const noFill = generateDrums(opts);
    const withFill = generateDrums({ ...opts, fills: true });

    const beforeLast = (hits: typeof noFill) => hits.filter((h) => h.startBeat < 12);
    expect(beforeLast(withFill)).toEqual(beforeLast(noFill));

    const lastBar = (hits: typeof noFill) => hits.filter((h) => h.startBeat >= 12);
    expect(lastBar(withFill)).not.toEqual(lastBar(noFill));
  });
});

describe('generateDrums richness', () => {
  it('emits ghost snares and open hi-hats in a dense chorus', () => {
    const render = (seed: number) =>
      generateDrums({
        bars: 2,
        bpm: 120,
        style: 'standard',
        section: 'chorus',
        density: 0.7,
        seed,
      });
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    const hasGhost = seeds.some((s) =>
      render(s).some((h) => h.pitch === SNARE && isOffGrid16(h.startBeat)),
    );
    const hasOpenHat = seeds.some((s) => render(s).some((h) => h.pitch === OPEN_HAT));
    expect(hasGhost).toBe(true);
    expect(hasOpenHat).toBe(true);
  });

  it('allows 16th-grid hats at moderate BPM but not at high BPM', () => {
    const opts: DrumGenOptions = {
      bars: 1,
      bpm: 120,
      style: 'standard',
      section: 'chorus',
      density: 0.6,
      seed: 7,
    };
    const isHat = (p: number) => p === CLOSED_HAT || p === OPEN_HAT;
    const slow = generateDrums(opts).filter((h) => isHat(h.pitch) && isOffGrid16(h.startBeat));
    const fast = generateDrums({ ...opts, bpm: 180 }).filter(
      (h) => isHat(h.pitch) && isOffGrid16(h.startBeat),
    );
    expect(slow.length).toBeGreaterThan(0);
    expect(fast.length).toBe(0);
  });

  it('delays off-beat hi-hats under a swing feel', () => {
    const common: DrumGenOptions = {
      bars: 1,
      bpm: 120,
      style: 'standard',
      section: 'verse',
      density: 0.5,
      seed: 3,
    };
    const offBeat = (feel: 'straight' | 'swing') =>
      generateDrums({ ...common, feel }).find(
        (h) => h.pitch === CLOSED_HAT && h.startBeat > 0.4 && h.startBeat < 0.9,
      )?.startBeat ?? 0;
    expect(offBeat('swing')).toBeGreaterThan(offBeat('straight'));
  });

  it('adds auxiliary percussion only in energetic sections', () => {
    const chorus = generateDrums({
      bars: 1,
      bpm: 128,
      style: 'funk',
      section: 'chorus',
      density: 0.8,
      seed: 5,
    });
    const intro = generateDrums({
      bars: 1,
      bpm: 128,
      style: 'funk',
      section: 'intro',
      density: 0.2,
      seed: 5,
    });
    const auxCount = (hits: typeof chorus) =>
      hits.filter((h) => h.pitch === TAMBOURINE || h.pitch === HANDCLAP).length;
    expect(auxCount(chorus)).toBeGreaterThan(0);
    expect(auxCount(intro)).toBe(0);
  });

  it('produces a recognizable fill in the last bar', () => {
    const opts = (seed: number, fills: boolean): DrumGenOptions => ({
      bars: 4,
      bpm: 120,
      style: 'standard',
      section: 'verse',
      density: 0.5,
      seed,
      fills,
    });
    const seeds = [0, 1, 2, 3, 4, 5];
    // Every fill changes the last bar, regardless of archetype.
    for (const s of seeds) {
      const noFill = generateDrums(opts(s, false)).filter((h) => h.startBeat >= 12);
      const withFill = generateDrums(opts(s, true)).filter((h) => h.startBeat >= 12);
      expect(withFill).not.toEqual(noFill);
    }
    // Some fill archetypes (e.g. snare rolls) use neither toms nor crash, so
    // only require that at least one seed introduces a tom/crash voice.
    const introducesTomOrCrash = seeds.some((s) =>
      generateDrums(opts(s, true))
        .filter((h) => h.startBeat >= 12)
        .some((h) => isTom(h.pitch) || h.pitch === 49),
    );
    expect(introducesTomOrCrash).toBe(true);
  });

  it('is deterministic for identical options and seed', () => {
    const opts: DrumGenOptions = {
      bars: 4,
      bpm: 124,
      style: 'funk',
      section: 'chorus',
      density: 0.75,
      seed: 99,
      fills: true,
    };
    expect(generateDrums(opts)).toEqual(generateDrums(opts));
  });

  it('is deterministic across the full style/section/feel/role matrix', () => {
    const styles: GrooveStyle[] = [
      'standard',
      'funk',
      'shuffle',
      'bossa',
      'trap',
      'halftime',
      'breakbeat',
      'house',
      'synthpop',
    ];
    const sections: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
    for (const style of styles) {
      for (const section of sections) {
        const opts: DrumGenOptions = {
          bars: 3,
          bpm: 132,
          style,
          section,
          density: 0.7,
          seed: 123,
          fills: true,
          nextSection: 'chorus',
        };
        // Two independent runs of the same options must be byte-for-byte equal.
        expect(generateDrums(opts)).toEqual(generateDrums(opts));
      }
    }
  });
});

describe('generateDrums phrase-end fills', () => {
  it('never emits a silent last-bar fill at low energy', () => {
    // At intro/outro energy the fill spans only beat 3; no seed may leave the
    // phrase end silent (#21). intro/outro carry no auxiliary percussion, so a
    // hit in the beat-3 window can only come from the fill itself.
    const sections: Section[] = ['intro', 'outro'];
    const styles: GrooveStyle[] = ['standard', 'halftime', 'breakbeat', 'house', 'synthpop'];
    const bars = 2;
    const lastBarStart = (bars - 1) * 4;
    for (const section of sections) {
      for (const style of styles) {
        for (let seed = 0; seed < 40; seed += 1) {
          const hits = generateDrums({
            bars,
            bpm: 120,
            style,
            section,
            density: 0.5,
            seed,
            fills: true,
          });
          const fillWindow = hits.filter((h) => h.startBeat >= lastBarStart + 3);
          expect(fillWindow.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('quantizeSwing sixteenth grid', () => {
  it('delays the "e" off-beat 16th under full swing', () => {
    expect(quantizeSwing(0.25, 1, 'sixteenth')).toBeGreaterThan(0.25);
  });

  it('delays the "a" off-beat 16th under full swing', () => {
    expect(quantizeSwing(0.75, 1, 'sixteenth')).toBeGreaterThan(0.75);
  });

  it('places the shuffle "a" 16th near 0.8125 without over-swinging', () => {
    // The default shuffle feel clamps effective swing to 0.75. The "a" 16th
    // (0.75 beat) must land near 0.8125, not the previously doubly-swung
    // 0.9375 that crowded the next downbeat (#23).
    const swing = 0.75;
    expect(quantizeSwing(0.75, swing, 'sixteenth')).toBeCloseTo(0.8125, 10);
    // It is symmetric with the "e" 16th and never crosses the next downbeat.
    expect(quantizeSwing(0.25, swing, 'sixteenth')).toBeCloseTo(0.3125, 10);
    expect(quantizeSwing(0.75, 1, 'sixteenth')).toBeLessThan(1);
  });
});
