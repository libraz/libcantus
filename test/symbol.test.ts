import { describe, expect, it } from 'vitest';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import {
  formatChordSymbol,
  parseChordSymbol,
  transposeChordSymbol,
} from '../src/theory/symbol/index.js';

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

  it('parses the 6/9 quality with a slash bass', () => {
    const chord = parseChordSymbol('C6/9/E');
    expect(chord.rootPc).toBe(0);
    expect(chord.quality).toBe('6/9');
    expect(chord.bassPc).toBe(4);
  });

  it('accepts lowercase roots like parseNote does', () => {
    expect(parseChordSymbol('cmaj7')).toEqual(parseChordSymbol('Cmaj7'));
    expect(parseChordSymbol('f#m7b5')).toEqual(parseChordSymbol('F#m7b5'));
    expect(parseChordSymbol('bb7')).toEqual(parseChordSymbol('Bb7'));
  });

  it('accepts a lowercase slash bass', () => {
    const chord = parseChordSymbol('c/g');
    expect(chord.rootPc).toBe(0);
    expect(chord.quality).toBe('maj');
    expect(chord.bassPc).toBe(7);
  });

  it('records the parsed root and bass spellings', () => {
    const chord = parseChordSymbol('Ab/C');
    expect(chord.rootSpelling).toEqual({ letter: 5, alter: -1 });
    expect(chord.bassSpelling).toEqual({ letter: 0, alter: 0 });
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

  it('respells with sharps when flats is explicitly false', () => {
    const chord = parseChordSymbol('Bb7');
    expect(formatChordSymbol(chord, { flats: false })).toBe('A#7');
  });

  it('uppercases a lowercase input root', () => {
    expect(formatChordSymbol(parseChordSymbol('bbm7'))).toBe('Bbm7');
  });

  it('formats the 6/9 quality with a slash bass', () => {
    expect(formatChordSymbol(makeChord(0, '6/9', 4))).toBe('C6/9/E');
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

  it('keeps the original spelling on an identity transpose', () => {
    expect(transposeChordSymbol('Bbmaj7', 0)).toBe('Bbmaj7');
    expect(transposeChordSymbol('Eb/Bb', 12)).toBe('Eb/Bb');
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

  it('formats then re-parses every chord quality with a slash bass', () => {
    for (const quality of chordQualities()) {
      const formatted = formatChordSymbol(makeChord(0, quality, 4));
      const reparsed = parseChordSymbol(formatted);
      expect(reparsed.rootPc).toBe(0);
      expect(reparsed.quality).toBe(quality);
      expect(reparsed.bassPc).toBe(4);
    }
  });

  const stableSymbols = [
    // Qualities shown in the README examples.
    'Cmaj7',
    'F#m7b5',
    'G7',
    'Dm7b5',
    'C/G',
    // Flat roots that previously respelled to sharps.
    'Bbmaj7',
    'Ebm7',
    'Ab7',
    'Dbm7b5',
    'Gbmaj7',
    // Slash chords, including flat basses and the 6/9 quality with a bass.
    'Ab/C',
    'Eb7/Db',
    'Bbm7/Ab',
    'C6/9',
    'C6/9/E',
    'Bb6/9/D',
  ];

  for (const symbol of stableSymbols) {
    it(`round-trips ${symbol} exactly`, () => {
      const chord = parseChordSymbol(symbol);
      const formatted = formatChordSymbol(chord);
      expect(formatted).toBe(symbol);
      // parse -> format -> parse must be stable, not merely non-throwing.
      expect(parseChordSymbol(formatted)).toEqual(chord);
    });
  }
});
