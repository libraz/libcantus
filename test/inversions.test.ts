import { describe, expect, it } from 'vitest';
import { detectChord, detectChordBest } from '../src/detect/index.js';
import { chordToRoman, romanToChord } from '../src/functional/index.js';
import { majorKey } from '../src/scale/index.js';

const cMajor = majorKey(0);

describe('romanToChord inversions', () => {
  it('parses triad inversions into a bass', () => {
    expect(romanToChord('V6', cMajor)).toMatchObject({ rootPc: 7, quality: 'maj', bassPc: 11 });
    expect(romanToChord('IV64', cMajor)).toMatchObject({ rootPc: 5, quality: 'maj', bassPc: 0 });
  });

  it('parses seventh-chord inversions', () => {
    expect(romanToChord('V65', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 11 });
    expect(romanToChord('V43', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 2 });
    expect(romanToChord('V42', cMajor)).toMatchObject({ rootPc: 7, quality: 'dom7', bassPc: 5 });
  });

  it('round-trips figured-bass numerals', () => {
    for (const roman of ['V6', 'IV64', 'V65', 'ii43', 'V42']) {
      expect(chordToRoman(romanToChord(roman, cMajor), cMajor)).toBe(roman);
    }
  });

  it('leaves root-position numerals unchanged', () => {
    expect(chordToRoman(romanToChord('V7', cMajor), cMajor)).toBe('V7');
  });
});

describe('detectChord inversions', () => {
  it('reports the inversion from the lowest note', () => {
    const best = detectChord([64, 67, 72])[0]; // E G C = C/E, first inversion
    expect(best).toMatchObject({ rootPc: 0, quality: 'maj', inversion: 1, bassPc: 4 });
  });

  it('carries the bass into the best Chord', () => {
    expect(detectChordBest([64, 67, 72])).toMatchObject({ rootPc: 0, quality: 'maj', bassPc: 4 });
  });

  it('prefers the root-position reading of an ambiguous set', () => {
    // A C E G with A in the bass reads as Am7 (root position), not C6/A.
    const best = detectChord([57, 60, 64, 67])[0];
    expect(best).toMatchObject({ rootPc: 9, quality: 'min7', inversion: 0 });
  });
});
