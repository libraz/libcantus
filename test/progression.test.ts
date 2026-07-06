import { describe, expect, it } from 'vitest';
import {
  generateProgression,
  progressions,
  progressionsByStyle,
} from '../src/progression/index.js';
import { MAJOR_MASK } from '../src/scale/index.js';
import type { KeyScale } from '../src/types.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('progressions', () => {
  it('includes the named presets with the expected degrees', () => {
    const byId = new Map(progressions().map((p) => [p.id, p]));
    expect(byId.get('royalRoad')?.degrees).toEqual([3, 4, 2, 5]);
    expect(byId.get('cityPop')?.degrees).toEqual([0, 5, 1, 4]);
    expect(byId.get('fourChordPop')?.degrees).toEqual([0, 4, 5, 3]);
  });

  it('exposes all 22 presets', () => {
    expect(progressions()).toHaveLength(22);
  });
});

describe('progressionsByStyle', () => {
  it('filters presets by style membership', () => {
    const rock = progressionsByStyle('rock');
    expect(rock.every((p) => p.styles.includes('rock'))).toBe(true);
    expect(rock.map((p) => p.id)).toContain('rock1');
    expect(rock.map((p) => p.id)).not.toContain('cityPop');
  });
});

describe('generateProgression', () => {
  it('lays out fourChordPop over four bars', () => {
    const chords = generateProgression({
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol',
      bars: 4,
      ext: 'auto',
    });
    expect(chords.map((c) => c.rootPc)).toEqual([0, 7, 9, 5]);
    expect(chords.map((c) => c.quality)).toEqual(['maj', 'maj', 'min', 'maj']);
    expect(chords.map((c) => c.startBeat)).toEqual([0, 4, 8, 12]);
  });

  it('lays out royalRoad with diatonic qualities', () => {
    const chords = generateProgression({
      presetId: 'royalRoad',
      key: cMajor,
      style: 'idol',
      bars: 4,
    });
    expect(chords.map((c) => c.rootPc)).toEqual([5, 7, 4, 9]);
    expect(chords.map((c) => c.quality)).toEqual(['maj', 'maj', 'min', 'min']);
  });

  it('cycles the preset degrees when bars exceed the preset length', () => {
    const chords = generateProgression({
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol',
      bars: 8,
    });
    expect(chords).toHaveLength(8);
    expect(chords.map((c) => c.rootPc)).toEqual([0, 7, 9, 5, 0, 7, 9, 5]);
    expect(chords.map((c) => c.startBeat)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it('forces a single quality when ext is not auto', () => {
    const chords = generateProgression({
      presetId: 'royalRoad',
      key: cMajor,
      style: 'idol',
      bars: 4,
      ext: 'maj7',
    });
    expect(chords.every((c) => c.quality === 'maj7')).toBe(true);
  });

  it('is deterministic for a given seed when no preset is fixed', () => {
    const opts = { key: cMajor, style: 'rock' as const, bars: 4, seed: 42 };
    expect(generateProgression(opts)).toEqual(generateProgression(opts));
  });
});
