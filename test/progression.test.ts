import { describe, expect, it } from 'vitest';
import type { KeyScale } from '../src/core/types.js';
import {
  generateProgression,
  progressions,
  progressionsByStyle,
} from '../src/generate/progression/index.js';
import { Progression } from '../src/model/progression.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { MAJOR_MASK, majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

describe('progressions', () => {
  it('includes the named presets with the expected degrees', () => {
    const byId = new Map(progressions().map((p) => [p.id, p]));
    expect(byId.get('royalRoad')?.degrees).toEqual([4, 5, 3, 6]);
    expect(byId.get('cityPop')?.degrees).toEqual([1, 6, 2, 5]);
    expect(byId.get('fourChordPop')?.degrees).toEqual([1, 5, 6, 4]);
  });

  it('exposes presets with unique ids and well-formed fields', () => {
    const presets = progressions();
    expect(presets.length).toBeGreaterThan(0);

    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // ids are unique

    // Degrees the generator can actually place: diatonic 1..7 plus the mapped
    // borrowed degrees. Any other value would silently collapse to the tonic.
    const validDegrees = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14]);
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
    expect(() => generateProgression({ ...base, preset: { degrees: [9] as never[] } })).toThrow(
      /supported progression degree/,
    );
    expect(() => generateProgression({ ...base, preset: { degrees: [0] as never[] } })).toThrow(
      RangeError,
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

  it('names its chords by quality alone, recording no interval template', () => {
    const chords = generateProgression({
      presetId: 'royalRoad',
      key: cMajor,
      style: 'idol',
      bars: 4,
    });
    for (const chord of chords) {
      expect('intervals' in chord).toBe(false);
    }
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

describe('Progression.fromSpans', () => {
  it('builds exactly the chord a span without a template always built', () => {
    const progression = Progression.fromSpans([{ rootPc: 5, quality: 'maj', startBeat: 0 }]);
    expect(progression.at(0)?.data).toEqual(makeChord(5, 'maj'));
  });

  it('keeps a custom interval template on the chord', () => {
    const span: ChordSpan = { rootPc: 0, quality: 'maj7', startBeat: 0, intervals: [0, 4, 11, 18] };
    const progression = Progression.fromSpans([span]);
    expect(progression.at(0)?.intervals).toEqual([0, 4, 11, 18]);
    // The progression holds its own template, not the caller's array.
    span.intervals?.push(21);
    expect(progression.at(0)?.intervals).toEqual([0, 4, 11, 18]);
  });

  it('carries a generated progression through unchanged', () => {
    const spans = generateProgression({
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol',
      bars: 4,
    });
    const progression = Progression.fromSpans(spans);
    expect(progression.chords.map((chord) => chord.data)).toEqual(
      spans.map((span) => makeChord(span.rootPc, span.quality, span.bassPc)),
    );
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
    // `I IV V I` names degree 1 twice on purpose; that repeat is not degeneracy.
    const chords = generateProgression({
      key: majorKey(0),
      style: 'rock',
      bars: 4,
      presetId: 'classic',
    });
    expect(chords.map((chord) => chord.rootPc)).toEqual([0, 5, 7, 0]);
  });
});
