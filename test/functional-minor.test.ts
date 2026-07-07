import { describe, expect, it } from 'vitest';
import {
  chordToRoman,
  detectCadence,
  isMinorKey,
  romanToChord,
} from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

const aMinor = minorKey(9);

describe('isMinorKey', () => {
  it('distinguishes minor from major keys', () => {
    expect(isMinorKey(aMinor)).toBe(true);
    expect(isMinorKey(scaleByName('harmonicMinor', 9))).toBe(true);
    expect(isMinorKey(majorKey(0))).toBe(false);
  });
});

describe('chordToRoman in a minor key', () => {
  it('numbers diatonic minor chords by scale degree', () => {
    expect(chordToRoman(makeChord(9, 'min'), aMinor)).toBe('i');
    expect(chordToRoman(makeChord(0, 'maj'), aMinor)).toBe('III');
    expect(chordToRoman(makeChord(2, 'min'), aMinor)).toBe('iv');
    expect(chordToRoman(makeChord(5, 'maj'), aMinor)).toBe('VI');
    expect(chordToRoman(makeChord(7, 'maj'), aMinor)).toBe('VII');
  });

  it('round-trips minor-key numerals', () => {
    for (const roman of ['i', 'III', 'iv', 'v', 'VI', 'VII']) {
      expect(chordToRoman(romanToChord(roman, aMinor), aMinor)).toBe(roman);
    }
  });

  it('spells the raised leading-tone chord as sharp-vii, not a flat tonic', () => {
    expect(chordToRoman(makeChord(8, 'dim'), aMinor)).toBe('#viio');
    expect(chordToRoman(makeChord(8, 'dim7'), aMinor)).toBe('#viio7');
  });

  it('spells a flat-two chromatic root as bII', () => {
    expect(chordToRoman(makeChord(10, 'maj'), aMinor)).toBe('bII');
  });

  it('round-trips every triad root through chordToRoman and romanToChord', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      const roman = chordToRoman(makeChord(pc, 'maj'), aMinor);
      expect(romanToChord(roman, aMinor).rootPc).toBe(pc);
    }
  });

  it('spells the tritone above the tonic with a sharp, not a flat fifth', () => {
    // pc 3 is the tritone above the A-minor tonic; it spells as #IV, not bV.
    expect(chordToRoman(makeChord(3, 'maj'), aMinor)).toBe('#IV');
    expect(romanToChord('#IV', aMinor).rootPc).toBe(3);
  });
});

describe('half-diminished supertonic in a minor key', () => {
  it('reads a bare iiø as a half-diminished seventh', () => {
    expect(romanToChord('iiø', aMinor)).toMatchObject({ rootPc: 11, quality: 'm7b5' });
  });
});

describe('detectCadence in a minor key', () => {
  it('recognizes the raised-dominant authentic cadence', () => {
    expect(detectCadence(makeChord(4, 'maj'), makeChord(9, 'min'), aMinor)).toBe('authentic');
  });

  it('treats V to flat-VI as deceptive in minor', () => {
    expect(detectCadence(makeChord(4, 'maj'), makeChord(5, 'maj'), aMinor)).toBe('deceptive');
  });
});
