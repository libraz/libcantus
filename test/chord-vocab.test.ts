import { describe, expect, it } from 'vitest';
import {
  chordPitchClasses,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  makeChord,
} from '../src/chord/index.js';
import { majorKey, scaleByName } from '../src/scale/index.js';

describe('extended chord vocabulary', () => {
  it('builds a half-diminished seventh', () => {
    expect(chordPitchClasses(makeChord(11, 'm7b5'))).toEqual([2, 5, 9, 11]);
  });

  it('builds a fully diminished seventh', () => {
    expect(chordPitchClasses(makeChord(0, 'dim7'))).toEqual([0, 3, 6, 9]);
  });

  it('builds a sixth chord', () => {
    expect(chordPitchClasses(makeChord(0, '6'))).toEqual([0, 4, 7, 9]);
  });

  it('builds a power chord', () => {
    expect(chordPitchClasses(makeChord(0, '5'))).toEqual([0, 7]);
  });
});

describe('chordToneRole with sixths and diminished sevenths', () => {
  it('names the sixth of a sixth chord', () => {
    expect(chordToneRole(9, makeChord(0, '6'))).toBe('sixth');
  });

  it('names the diminished seventh, not a sixth', () => {
    expect(chordToneRole(9, makeChord(0, 'dim7'))).toBe('seventh');
  });

  it('treats the #11 of a 7#11 chord as a tension, not the fifth', () => {
    const chord = makeChord(0, '7#11');
    expect(chordToneRole(6, chord)).toBeNull();
    expect(chordToneRole(7, chord)).toBe('fifth');
  });

  it('treats the b13 of a 7b13 chord as a tension, not the fifth', () => {
    const chord = makeChord(0, '7b13');
    expect(chordToneRole(8, chord)).toBeNull();
    expect(chordToneRole(7, chord)).toBe('fifth');
  });

  it('does not report a seventh for a plain triad without one', () => {
    expect(chordToneRole(10, makeChord(0, 'maj'))).toBeNull();
    expect(chordToneRole(11, makeChord(0, 'maj'))).toBeNull();
  });
});

describe('diatonic stacking', () => {
  const cMajor = majorKey(0);

  it('stacks the correct diatonic triad qualities in C major', () => {
    expect(diatonicTriad(0, cMajor).quality).toBe('maj');
    expect(diatonicTriad(1, cMajor).quality).toBe('min');
    expect(diatonicTriad(6, cMajor).quality).toBe('dim');
  });

  it('stacks diatonic seventh chords in C major', () => {
    expect(diatonicSeventh(0, cMajor).quality).toBe('maj7');
    expect(diatonicSeventh(4, cMajor).quality).toBe('dom7');
    expect(diatonicSeventh(6, cMajor).quality).toBe('m7b5');
  });

  it('handles harmonic-minor sevenths', () => {
    const aHarmonic = scaleByName('harmonicMinor', 9);
    expect(diatonicSeventh(0, aHarmonic).quality).toBe('minMaj7');
    expect(diatonicSeventh(6, aHarmonic).quality).toBe('dim7');
  });

  it('labels the harmonic-minor mediant seventh as augMaj7 with matching intervals', () => {
    const aHarmonic = scaleByName('harmonicMinor', 9);
    const chord = diatonicSeventh(2, aHarmonic);
    expect(chord.intervals).toEqual([0, 4, 8, 11]);
    expect(chord.quality).toBe('augMaj7');
    // The reported quality must rebuild the same intervals.
    expect(makeChord(chord.rootPc, chord.quality).intervals).toEqual(chord.intervals);
  });
});
