import { chordToRoman } from '@libraz/libcantus/analyze';
import { generateProgression, progressions } from '@libraz/libcantus/generate';
import { majorKey, makeChord, minorKey, scaleByName } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

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

  it('returns the same progression for a given seed', () => {
    expect(
      generateProgression({
        key: cMajor,
        style: 'rock',
        bars: 4,
        ctx: { seed: 42, complexity: { harmonic: 0.5 } },
      }),
    ).toEqual([
      { rootPc: 9, quality: 'min', startBeat: 0, degree: 6 },
      { rootPc: 8, quality: 'maj', startBeat: 4 },
      { rootPc: 10, quality: 'maj', startBeat: 8 },
      { rootPc: 0, quality: 'maj', startBeat: 12, degree: 1 },
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
        ctx: { complexity: { harmonic: 0.5 }, seed: seed },
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
        ctx: { complexity: { harmonic: 0.5 }, seed: seed },
      });
      for (let i = 0; i < chords.length - 1; i += 1) {
        if (chords[i]?.secondaryDominant) {
          expect(chords[i + 1]?.secondaryDominant).not.toBe(true);
        }
      }
    }
  });

  it('retains at least one tonic statement when reharmonizing', () => {
    const chords = generateProgression({
      presetId: 'fourChordPop',
      key: cMajor,
      style: 'idol',
      bars: 8,
      ctx: { complexity: { harmonic: 0.5 }, seed: 4 },
    });
    expect(chords.some((chord) => chord.rootPc === 0 && chord.secondaryDominant !== true)).toBe(
      true,
    );
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

describe('generateProgression dominants', () => {
  it('flags only chords the key reads as applied dominants', () => {
    const keys = [
      majorKey(0),
      minorKey(9),
      scaleByName('mixolydian', 7),
      scaleByName('lydian', 5),
      scaleByName('dorian', 2),
    ];
    let flagged = 0;
    for (const key of keys) {
      for (const preset of progressions()) {
        for (let seed = 0; seed < 4; seed += 1) {
          const chords = generateProgression({
            key,
            style: 'idol',
            bars: 8,
            presetId: preset.id,
            ctx: { seed, complexity: { harmonic: 1 } },
          });
          for (const chord of chords) {
            if (chord.secondaryDominant === true) {
              const roman = chordToRoman(makeChord(chord.rootPc, chord.quality), key, {
                applied: true,
              });
              expect(roman, `${preset.id} ${key.rootPc}`).toContain('/');
              flagged += 1;
            }
          }
        }
      }
    }
    expect(flagged).toBeGreaterThan(0);
  });

  it('leaves a dominant that already resolves onto the next chord as written', () => {
    const chords = generateProgression({
      key: majorKey(0),
      style: 'idol',
      bars: 4,
      ext: '7alt',
      preset: { degrees: [2, 5, 1, 4] },
      ctx: { complexity: { harmonic: 1 } },
    });
    // II7alt falls a fifth onto V: it is already the dominant of the chord after it.
    expect(chords[0]).toMatchObject({ rootPc: 2, quality: '7alt' });
    expect(chords.every((chord) => chord.quality === '7alt')).toBe(true);
    expect(chords[0]?.secondaryDominant).toBeUndefined();
  });

  it('raises the fifth degree of a cadence-strong progression only where the key cadences through a raised seventh', () => {
    const preset = { degrees: [1, 4, 5, 1], functional: 'cadenceStrong' as const };
    const qualityOfFifth = (key: ReturnType<typeof minorKey>) =>
      generateProgression({ key, style: 'idol', bars: 4, preset })[2]?.quality;
    expect(qualityOfFifth(minorKey(9))).toBe('maj');
    expect(qualityOfFifth(scaleByName('dorian', 9))).toBe('min');
    expect(qualityOfFifth(scaleByName('phrygian', 4))).toBe('dim');
  });
});
