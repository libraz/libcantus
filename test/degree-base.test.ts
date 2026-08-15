import { describe, expect, it } from 'vitest';
import { secondaryDominant } from '../src/analyze/functional/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { Chord, Key, Progression } from '../src/model/index.js';
import { majorKey, pitchToScaleDegree } from '../src/theory/scale/index.js';

// Scale degrees are counted from 1 across the whole public surface. These tests
// pin that numbering directly, so a silent drift back to 0-based degrees fails
// here rather than quietly renaming every chord the library builds.
describe('scale degrees are 1-based', () => {
  it('numbers the chords of C major from the tonic', () => {
    const c = Key.major('C');
    expect(c.chord(1).symbol()).toBe('C');
    expect(c.chord(5).symbol()).toBe('G');
    expect(c.chord(7).symbol()).toBe('Bdim');
  });

  it('agrees with the Roman numeral on the same degree', () => {
    const c = Key.major('C');
    expect(c.chord(1).symbol()).toBe(c.roman('I').symbol());
    expect(c.chord(5).symbol()).toBe(c.roman('V').symbol());
    // `vii` and `viio` name the same degree; the numeral's case and the `o`
    // choose the quality, so only the diminished form spells degree 7 of a
    // major key in full.
    expect(c.chord(7).rootPc).toBe(c.roman('vii').rootPc);
    expect(c.chord(7).symbol()).toBe(c.roman('viio').symbol());
    expect(c.chord(1).roman()).toBe('I');
    expect(c.chord(5).roman()).toBe('V');
    expect(c.chord(7).roman()).toBe('viio');
  });

  it('keeps the minor v minor in a natural minor key', () => {
    expect(Key.minor('A').diatonicTriad(5).symbol()).toBe('Em');
    expect(Key.minor('A').diatonicTriad(5).quality).toBe('min');
  });

  it('stacks the dominant seventh on degree 5', () => {
    const g7 = Key.major('C').diatonicSeventh(5);
    expect(g7.symbol()).toBe('G7');
    expect(g7.quality).toBe('dom7');
    expect(g7.pitchClasses()).toEqual([2, 5, 7, 11]);
  });

  it('rejects degree 0 and negative degrees, and wraps degree 8 onto the tonic', () => {
    const c = Key.major('C');
    expect(() => c.chord(0)).toThrow(InvalidInputError);
    expect(() => c.chord(-1)).toThrow(InvalidInputError);
    expect(c.chord(8).symbol()).toBe('C');
  });

  it('reports a pitch as the degree a musician would name, and -1 outside the scale', () => {
    const cMajor = majorKey(0);
    expect(pitchToScaleDegree(60, cMajor)).toBe(1);
    expect(pitchToScaleDegree(67, cMajor)).toBe(5);
    // C# belongs to no degree of C major; the sentinel stayed at -1 so it can
    // never be read as the tonic.
    expect(pitchToScaleDegree(61, cMajor)).toBe(-1);
  });

  it('tonicizes degree 5 with the dominant of the dominant', () => {
    expect(Chord.from(secondaryDominant(5, majorKey(0))).symbol()).toBe('D7');
  });

  it('plays the same chords from the renumbered progression presets', () => {
    const key = Key.major('C');
    const symbolsOf = (spans: ReturnType<typeof generateProgression>) =>
      Progression.fromSpans(spans)
        .withKey(key)
        .chords.map((chord) => chord.symbol());

    // Seed 42 in the dance pool selects `extended5` (I V vi iii).
    expect(
      symbolsOf(generateProgression({ key: key.scale, style: 'dance', bars: 4, seed: 42 })),
    ).toEqual(['C', 'G', 'Am', 'Em']);

    expect(
      symbolsOf(
        generateProgression({ key: key.scale, style: 'dance', bars: 4, presetId: 'classic' }),
      ),
    ).toEqual(['C', 'F', 'G', 'C']); // I IV V I
    expect(
      symbolsOf(
        generateProgression({ key: key.scale, style: 'dance', bars: 4, presetId: 'royalRoad' }),
      ),
    ).toEqual(['F', 'G', 'Em', 'Am']); // IV V iii vi
    expect(
      symbolsOf(
        generateProgression({ key: key.scale, style: 'dance', bars: 4, presetId: 'fourChordPop' }),
      ),
    ).toEqual(['C', 'G', 'Am', 'F']); // I V vi IV
  });
});
