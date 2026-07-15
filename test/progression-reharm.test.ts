import { describe, expect, it } from 'vitest';
import { generateProgression } from '../src/generate/progression/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

describe('generateProgression reharmonize', () => {
  it('is deterministic for a given seed', () => {
    const opts = {
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol' as const,
      bars: 8,
      reharmonize: true,
      seed: 7,
    };
    expect(generateProgression(opts)).toEqual(generateProgression(opts));
  });

  it('preserves the seeded public-output golden after RNG consolidation', () => {
    expect(
      generateProgression({
        key: cMajor,
        style: 'rock',
        bars: 4,
        seed: 42,
        reharmonize: true,
      }),
    ).toEqual([
      { rootPc: 5, quality: 'dom7', startBeat: 0, secondaryDominant: true },
      { rootPc: 10, quality: 'maj', startBeat: 4 },
      { rootPc: 5, quality: 'maj', startBeat: 8, degree: 3 },
      { rootPc: 0, quality: 'maj', startBeat: 12, degree: 0 },
    ]);
  });

  it('introduces at least one secondary dominant across seeds', () => {
    let sawSecondary = false;
    for (let seed = 0; seed < 12; seed += 1) {
      const chords = generateProgression({
        presetId: 'fourChordPop',
        key: cMajor,
        style: 'idol',
        bars: 8,
        reharmonize: true,
        seed,
      });
      for (const chord of chords) {
        if (chord.secondaryDominant) {
          sawSecondary = true;
          expect(chord.quality).toBe('dom7');
        }
      }
    }
    expect(sawSecondary).toBe(true);
  });

  it('never orphans a secondary dominant by replacing its resolution target', () => {
    // A dominant inserted at index i-1 targets chords[i]; that target must not
    // itself be replaced by another dominant, which would leave two consecutive
    // secondary dominants with the first resolving to nothing.
    for (let seed = 0; seed < 24; seed += 1) {
      const chords = generateProgression({
        presetId: 'fourChordPop',
        key: cMajor,
        style: 'idol',
        bars: 8,
        reharmonize: true,
        seed,
      });
      for (let i = 0; i < chords.length - 1; i += 1) {
        if (chords[i]?.secondaryDominant) {
          expect(chords[i + 1]?.secondaryDominant).not.toBe(true);
        }
      }
    }
  });

  it('leaves the progression unchanged without reharmonize', () => {
    const plain = generateProgression({
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol',
      bars: 4,
    });
    expect(plain.some((c) => c.secondaryDominant)).toBe(false);
  });
});
