import { describe, expect, it } from 'vitest';
import { chordQualities, makeChord } from '../src/chord/index.js';
import { formatChordSymbol, parseChordSymbol, transposeChordSymbol } from '../src/symbol/index.js';

describe('parseChordSymbol', () => {
  it('parses a maj7 chord', () => {
    const chord = parseChordSymbol('Cmaj7');
    expect(chord.rootPc).toBe(0);
    expect(chord.quality).toBe('maj7');
    expect(chord.bassPc).toBeUndefined();
  });

  it('parses a sharp root half-diminished chord', () => {
    const chord = parseChordSymbol('F#m7b5');
    expect(chord.rootPc).toBe(6);
    expect(chord.quality).toBe('m7b5');
  });

  it('parses a flat root dominant seventh', () => {
    const chord = parseChordSymbol('Bb7');
    expect(chord.rootPc).toBe(10);
    expect(chord.quality).toBe('dom7');
  });

  it('parses a slash bass', () => {
    const chord = parseChordSymbol('C/G');
    expect(chord.rootPc).toBe(0);
    expect(chord.quality).toBe('maj');
    expect(chord.bassPc).toBe(7);
  });

  it('parses the 6/9 quality without a bass', () => {
    const chord = parseChordSymbol('C6/9');
    expect(chord.rootPc).toBe(0);
    expect(chord.quality).toBe('6/9');
    expect(chord.bassPc).toBeUndefined();
  });

  it('parses the dash minor spelling', () => {
    const chord = parseChordSymbol('A-');
    expect(chord.rootPc).toBe(9);
    expect(chord.quality).toBe('min');
  });

  it('parses a sharp-11 dominant', () => {
    const chord = parseChordSymbol('G7#11');
    expect(chord.rootPc).toBe(7);
    expect(chord.quality).toBe('7#11');
  });

  it('throws on an unrecognized root', () => {
    expect(() => parseChordSymbol('H7')).toThrow();
  });

  it('throws on an unrecognized quality', () => {
    expect(() => parseChordSymbol('Cfoo')).toThrow();
  });
});

describe('formatChordSymbol', () => {
  const cases: [string, string][] = [
    ['Cmaj7', 'Cmaj7'],
    ['Cm7', 'Cm7'],
    ['C7', 'C7'],
    ['Cdim7', 'Cdim7'],
    ['Cm7b5', 'Cm7b5'],
    ['Csus4', 'Csus4'],
    ['C6/9', 'C6/9'],
    ['Caug', 'Caug'],
  ];

  for (const [input, expected] of cases) {
    it(`round-trips ${input}`, () => {
      expect(formatChordSymbol(parseChordSymbol(input))).toBe(expected);
    });
  }

  it('appends a slash bass when present', () => {
    expect(formatChordSymbol(parseChordSymbol('C/G'))).toBe('C/G');
  });

  it('omits the bass when it equals the root', () => {
    const chord = parseChordSymbol('Cmaj7');
    chord.bassPc = chord.rootPc;
    expect(formatChordSymbol(chord)).toBe('Cmaj7');
  });

  it('prefers flat spellings when requested', () => {
    const chord = parseChordSymbol('F#m7');
    expect(formatChordSymbol(chord, { flats: true })).toBe('Gbm7');
  });
});

describe('transposeChordSymbol', () => {
  it('transposes the root up by semitones', () => {
    expect(transposeChordSymbol('Cmaj7', 2)).toBe('Dmaj7');
  });

  it('transposes both root and bass, honoring flat spelling', () => {
    expect(transposeChordSymbol('C/G', 5, { flats: true })).toBe('F/C');
  });

  it('wraps the root around the octave', () => {
    expect(transposeChordSymbol('Bb7', 3)).toBe('C#7');
  });
});

describe('symbol round-trip', () => {
  it('formats then re-parses every chord quality without drift', () => {
    for (const quality of chordQualities()) {
      const formatted = formatChordSymbol(makeChord(0, quality));
      const reparsed = parseChordSymbol(formatted);
      expect(reparsed.rootPc).toBe(0);
      expect(reparsed.quality).toBe(quality);
      expect(reparsed.bassPc).toBeUndefined();
    }
  });
});
