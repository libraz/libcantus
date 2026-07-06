import { describe, expect, it } from 'vitest';
import { makeChord } from '../src/chord/index.js';
import {
  chordToRoman,
  detectCadence,
  functionOf,
  romanToChord,
  secondaryDominant,
} from '../src/functional/index.js';
import { majorKey } from '../src/scale/index.js';

const cMajor = majorKey(0);

describe('romanToChord', () => {
  it('parses diatonic numerals with case-based quality', () => {
    expect(romanToChord('V7', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7' });
    expect(romanToChord('ii', cMajor)).toMatchObject({ rootPc: 2, quality: 'min' });
    expect(romanToChord('Imaj7', cMajor)).toMatchObject({ rootPc: 0, quality: 'maj7' });
  });

  it('parses borrowed and altered numerals', () => {
    expect(romanToChord('bVII', cMajor)).toMatchObject({ rootPc: 10, quality: 'maj' });
    expect(romanToChord('viio7', cMajor)).toMatchObject({ rootPc: 11, quality: 'dim7' });
    expect(romanToChord('iiø7', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
  });

  it('parses secondary dominants', () => {
    expect(romanToChord('V7/V', cMajor)).toMatchObject({ rootPc: 2, quality: 'dom7' });
    expect(romanToChord('V/ii', cMajor)).toMatchObject({ rootPc: 9, quality: 'maj' });
  });

  it('rejects nonsense', () => {
    expect(() => romanToChord('Q', cMajor)).toThrow();
  });
});

describe('chordToRoman', () => {
  it('names diatonic chords', () => {
    expect(chordToRoman(makeChord(7, 'maj'), cMajor)).toBe('V');
    expect(chordToRoman(makeChord(9, 'min'), cMajor)).toBe('vi');
    expect(chordToRoman(makeChord(7, 'dom7'), cMajor)).toBe('V7');
    expect(chordToRoman(makeChord(11, 'dim'), cMajor)).toBe('viio');
  });

  it('names borrowed chords with accidentals', () => {
    expect(chordToRoman(makeChord(10, 'maj'), cMajor)).toBe('bVII');
  });

  it('round-trips with romanToChord', () => {
    for (const roman of ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'viio', 'V7', 'bVII']) {
      expect(chordToRoman(romanToChord(roman, cMajor), cMajor)).toBe(roman);
    }
  });
});

describe('half-diminished implies a seventh', () => {
  it('reads a bare ø as a half-diminished seventh', () => {
    expect(romanToChord('iiø', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
    expect(romanToChord('viiø', cMajor)).toMatchObject({ rootPc: 11, quality: 'm7b5' });
  });

  it('still reads an explicit ø7 as a half-diminished seventh', () => {
    expect(romanToChord('iiø7', cMajor)).toMatchObject({ rootPc: 2, quality: 'm7b5' });
  });
});

describe('extension figures', () => {
  it('maps a ninth figure to a root-position dominant ninth', () => {
    expect(romanToChord('V9', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom9' });
  });

  it('maps eleventh and thirteenth figures to their qualities', () => {
    expect(romanToChord('V11', cMajor)).toMatchObject({ rootPc: 7, quality: '11' });
    expect(romanToChord('V13', cMajor)).toMatchObject({ rootPc: 7, quality: '13' });
  });

  it('throws on an unsupported figure rather than silently downgrading', () => {
    expect(() => romanToChord('V8', cMajor)).toThrow();
    expect(() => romanToChord('V99', cMajor)).toThrow();
  });
});

describe('maj7 / minMaj7 inversion round-trips', () => {
  it('round-trips maj7 in every inversion', () => {
    expect(chordToRoman(makeChord(0, 'maj7'), cMajor)).toBe('Imaj7');
    for (const [bass, roman] of [
      [4, 'Imaj765'],
      [7, 'Imaj743'],
      [11, 'Imaj742'],
    ] as const) {
      const chord = makeChord(0, 'maj7', bass);
      expect(chordToRoman(chord, cMajor)).toBe(roman);
      expect(romanToChord(roman, cMajor)).toMatchObject({
        rootPc: 0,
        quality: 'maj7',
        bassPc: bass,
      });
    }
  });

  it('round-trips minMaj7 in every inversion', () => {
    expect(chordToRoman(makeChord(0, 'minMaj7'), cMajor)).toBe('imaj7');
    for (const [bass, roman] of [
      [3, 'imaj765'],
      [7, 'imaj743'],
      [11, 'imaj742'],
    ] as const) {
      const chord = makeChord(0, 'minMaj7', bass);
      expect(chordToRoman(chord, cMajor)).toBe(roman);
      expect(romanToChord(roman, cMajor)).toMatchObject({
        rootPc: 0,
        quality: 'minMaj7',
        bassPc: bass,
      });
    }
  });
});

describe('chordToRoman with a tension in the bass', () => {
  it('falls back to root-position rendering instead of a bare numeral', () => {
    expect(chordToRoman(makeChord(7, 'dom9', 9), cMajor)).not.toBe('V');
    expect(chordToRoman(makeChord(7, 'dom9', 9), cMajor)).toContain('V');
  });
});

describe('functionOf', () => {
  it('maps degrees to tonal functions', () => {
    expect(functionOf(makeChord(0, 'maj'), cMajor)).toBe('tonic');
    expect(functionOf(makeChord(9, 'min'), cMajor)).toBe('tonic');
    expect(functionOf(makeChord(5, 'maj'), cMajor)).toBe('subdominant');
    expect(functionOf(makeChord(2, 'min'), cMajor)).toBe('subdominant');
    expect(functionOf(makeChord(7, 'dom7'), cMajor)).toBe('dominant');
    expect(functionOf(makeChord(11, 'dim'), cMajor)).toBe('dominant');
  });
});

describe('detectCadence', () => {
  it('classifies the common cadences', () => {
    expect(detectCadence(makeChord(7, 'dom7'), makeChord(0, 'maj'), cMajor)).toBe('authentic');
    expect(detectCadence(makeChord(5, 'maj'), makeChord(0, 'maj'), cMajor)).toBe('plagal');
    expect(detectCadence(makeChord(7, 'maj'), makeChord(9, 'min'), cMajor)).toBe('deceptive');
    expect(detectCadence(makeChord(2, 'min'), makeChord(7, 'maj'), cMajor)).toBe('half');
    expect(detectCadence(makeChord(0, 'maj'), makeChord(2, 'min'), cMajor)).toBeNull();
  });
});

describe('secondaryDominant', () => {
  it('builds V7 of a target degree', () => {
    expect(secondaryDominant(4, cMajor)).toMatchObject({ rootPc: 2, quality: 'dom7' });
  });
});
