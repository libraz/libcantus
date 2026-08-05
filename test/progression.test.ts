import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import {
  generateProgression,
  progressions,
  progressionsByStyle,
} from '../src/generate/progression/index.js';
import { MAJOR_MASK, majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('progressions', () => {
  it('includes the named presets with the expected degrees', () => {
    const byId = new Map(progressions().map((p) => [p.id, p]));
    expect(byId.get('royalRoad')?.degrees).toEqual([3, 4, 2, 5]);
    expect(byId.get('cityPop')?.degrees).toEqual([0, 5, 1, 4]);
    expect(byId.get('fourChordPop')?.degrees).toEqual([0, 4, 5, 3]);
  });

  it('exposes presets with unique ids and well-formed fields', () => {
    const presets = progressions();
    expect(presets.length).toBeGreaterThan(0);

    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // ids are unique

    // Degrees the generator can actually place: diatonic 0..6 plus the mapped
    // borrowed degrees. Any other value would silently collapse to the tonic.
    const validDegrees = new Set([0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14]);
    const validStyles = new Set(['minimal', 'dance', 'idol', 'rock']);
    const validFunctions = new Set(['loop', 'tensionBuild', 'cadenceStrong', 'stable']);

    for (const p of presets) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.degrees.length).toBeGreaterThan(0);
      expect(p.styles.length).toBeGreaterThan(0);
      expect(validFunctions.has(p.functional)).toBe(true);
      for (const degree of p.degrees) {
        expect(validDegrees.has(degree)).toBe(true);
      }
      for (const style of p.styles) {
        expect(validStyles.has(style)).toBe(true);
      }
    }
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
  it('uses a major dominant for cadence-oriented minor progressions', () => {
    const chords = generateProgression({
      key: minorKey(9),
      presetId: 'classic',
      style: 'rock',
      bars: 4,
    });
    expect(chords.map((chord) => chord.quality)).toEqual(['min', 'min', 'maj', 'min']);
  });

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

  it('rejects unrecognised custom degrees and extensions', () => {
    const base = { key: cMajor, style: 'idol' as const, bars: 1 };
    expect(() =>
      generateProgression({ ...base, preset: { degrees: [Number.NaN] as never[] } }),
    ).toThrow(RangeError);
    expect(() => generateProgression({ ...base, preset: { degrees: [7] as never[] } })).toThrow(
      /supported progression degree/,
    );
    expect(() => generateProgression({ ...base, ext: 'nonsense' as never })).toThrow(
      /progression extension/,
    );
  });

  it('derives diatonic qualities from a minor key', () => {
    // A natural minor: i=Am, v=Em, VI=Fmaj, iv=Dm. The VI degree must be major,
    // not minor as a hardcoded major-key table would produce.
    const chords = generateProgression({
      presetId: 'fourChordPop',
      key: minorKey(9),
      style: 'idol',
      bars: 4,
      ext: 'auto',
    });
    expect(chords.map((c) => c.rootPc)).toEqual([9, 4, 5, 2]);
    expect(chords.map((c) => c.quality)).toEqual(['min', 'min', 'maj', 'min']);
  });

  it('is deterministic for a given seed when no preset is fixed', () => {
    const opts = { key: cMajor, style: 'rock' as const, bars: 4, seed: 42 };
    expect(generateProgression(opts)).toEqual(generateProgression(opts));
  });

  it('throws on an unknown presetId instead of falling back silently', () => {
    expect(() =>
      generateProgression({
        presetId: 'noSuchPreset',
        key: cMajor,
        style: 'idol',
        bars: 4,
      }),
    ).toThrow(/noSuchPreset/);
  });
});

describe('preset degeneracy across keys', () => {
  it('never repeats the same chord twice in a row in any key', () => {
    // A preset's diatonic degrees and its chromatic borrowings can name the same
    // chord: `vi bVI bVII I` is a major-key device, and in a minor key its first
    // two degrees both land on bVI. Presets that name a degree twice on purpose
    // (`I IV V I`) are covered by the test below instead.
    const distinctDegrees = (preset: { degrees: number[] }) =>
      new Set(preset.degrees).size === preset.degrees.length;
    for (const preset of progressions().filter(distinctDegrees)) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        for (const key of [majorKey(tonic), minorKey(tonic)]) {
          const chords = generateProgression({
            key,
            style: 'dance',
            bars: 8,
            presetId: preset.id,
          });
          for (let i = 1; i < chords.length; i += 1) {
            const previous = chords[i - 1];
            const current = chords[i];
            const same =
              previous?.rootPc === current?.rootPc && previous?.quality === current?.quality;
            expect(same, `${preset.id} on ${tonic} (${key.modeMask12})`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps a preset that closes on its own tonic intact', () => {
    // `I IV V I` names degree 0 twice on purpose; that repeat is not degeneracy.
    const chords = generateProgression({
      key: majorKey(0),
      style: 'rock',
      bars: 4,
      presetId: 'classic',
    });
    expect(chords.map((chord) => chord.rootPc)).toEqual([0, 5, 7, 0]);
  });
});
