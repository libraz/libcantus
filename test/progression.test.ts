import { describe, expect, it } from 'vitest';
import { chordToRoman } from '../src/analyze/functional/index.js';
import type { KeyScale } from '../src/core/types.js';
import {
  generateProgression,
  progressions,
  progressionsByStyle,
} from '../src/generate/progression/index.js';
import { Progression } from '../src/model/progression.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { chordFromSpan, makeChord } from '../src/theory/chord/index.js';
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

  it('gives no secondary dominant to a degree the key cannot make a local tonic', () => {
    // The supertonic of a minor key is a diminished triad, and nothing
    // tonicizes one: an F#7 in front of that B diminished is a chord the
    // numeral layer reads against A minor as #VI7, not as an applied dominant.
    const aMinor = minorKey(9);
    const offenders: string[] = [];
    let diminished = 0;
    let flagged = 0;
    for (const harmonic of [0.3, 0.5, 1]) {
      for (let seed = 0; seed < 6; seed += 1) {
        const chords = generateProgression({
          key: aMinor,
          presetId: 'cityPop',
          style: 'idol',
          bars: 8,
          ctx: { seed, complexity: { harmonic } },
        });
        const where = `harmonic ${harmonic}, seed ${seed}`;
        for (let i = 0; i < chords.length; i += 1) {
          const chord = chords[i] as ChordSpan;
          if (chord.quality === 'dim') {
            diminished += 1;
          }
          if (chord.secondaryDominant !== true) {
            continue;
          }
          flagged += 1;
          if (chords[i + 1]?.quality === 'dim') {
            offenders.push(`${where}: a dominant stands in front of a diminished triad`);
          }
          // The analysis layer has to be able to name what the generator
          // claims: an absolute numeral back means it tonicizes nothing.
          const numeral = chordToRoman(chordFromSpan(chord), aMinor, { applied: true });
          if (!numeral.includes('/')) {
            offenders.push(`${where}: ${numeral} is flagged as a secondary dominant`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // The diminished supertonic still reaches the output, so the rule above is
    // measured rather than vacuous, and the key still offers the dominants it
    // can carry.
    expect(diminished).toBeGreaterThan(0);
    expect(flagged).toBeGreaterThan(0);
  });

  it('still offers the secondary dominants a major key can carry', () => {
    const chords = generateProgression({
      key: cMajor,
      presetId: 'cityPop',
      style: 'idol',
      bars: 8,
      ctx: { seed: 0, complexity: { harmonic: 1 } },
    });
    const applied = chords.filter((chord) => chord.secondaryDominant === true);
    expect(applied.length).toBeGreaterThan(0);
    for (const chord of applied) {
      expect(chord.quality).toBe('dom7');
      expect(chordToRoman(chordFromSpan(chord), cMajor, { applied: true })).toContain('/');
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
  it('turns over on the preset period in every key', () => {
    // A preset's diatonic degrees and its chromatic borrowings can name the same
    // chord: `vi bVI bVII I` is a major-key device, and in a minor key its first
    // two degrees both land on bVI. That is one chord held over two bars, not a
    // loop one bar shorter — a harmony that turns over every three bars while
    // the parts around it are written in four crosses every phrase boundary.
    for (const preset of progressions()) {
      const period = preset.degrees.length;
      for (let tonic = 0; tonic < 12; tonic += 1) {
        for (const key of [majorKey(tonic), minorKey(tonic)]) {
          const chords = generateProgression({
            key,
            style: 'dance',
            bars: period * 2,
            presetId: preset.id,
          });
          const label = `${preset.id} on ${tonic} (${key.modeMask12})`;
          for (let i = 0; i < period; i += 1) {
            expect(chords[i + period]?.rootPc, label).toBe(chords[i]?.rootPc);
            expect(chords[i + period]?.quality, label).toBe(chords[i]?.quality);
          }
        }
      }
    }
  });

  it('holds a chord for the bar a borrowed degree doubles, in the key it doubles in', () => {
    // `aeolianPop` is vi bVI bVII I. In C major the four degrees are four
    // chords; in A minor the first two are both F, which is F held for two bars
    // and then G and Am — still a four-bar loop the phrase can be built on.
    const major = generateProgression({
      key: majorKey(0),
      style: 'dance',
      presetId: 'aeolianPop',
      bars: 4,
    });
    expect(major.map((chord) => chord.rootPc)).toEqual([9, 8, 10, 0]);
    const minor = generateProgression({
      key: minorKey(9),
      style: 'dance',
      presetId: 'aeolianPop',
      bars: 8,
    });
    expect(minor.map((chord) => `${chord.rootPc}${chord.quality}`)).toEqual([
      '5maj',
      '5maj',
      '7maj',
      '9min',
      '5maj',
      '5maj',
      '7maj',
      '9min',
    ]);
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
