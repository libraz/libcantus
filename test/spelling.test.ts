import { describe, expect, it } from 'vitest';
import { makeChord } from '../src/chord/index.js';
import { parseNote } from '../src/pitch/index.js';
import { majorKey, minorKey, scaleByName } from '../src/scale/index.js';
import { noteNames, spellChord, spellScale } from '../src/spelling/index.js';

describe('spellScale', () => {
  it('spells C major with natural letters', () => {
    expect(noteNames(spellScale(parseNote('C'), majorKey(0)))).toEqual([
      'C',
      'D',
      'E',
      'F',
      'G',
      'A',
      'B',
    ]);
  });

  it('spells F major with a B flat', () => {
    expect(noteNames(spellScale(parseNote('F'), majorKey(5)))).toEqual([
      'F',
      'G',
      'A',
      'Bb',
      'C',
      'D',
      'E',
    ]);
  });

  it('spells A harmonic minor with a raised seventh', () => {
    expect(noteNames(spellScale(parseNote('A'), scaleByName('harmonicMinor', 9)))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G#',
    ]);
  });

  it('spells the natural minor', () => {
    expect(noteNames(spellScale(parseNote('E'), minorKey(4)))).toEqual([
      'E',
      'F#',
      'G',
      'A',
      'B',
      'C',
      'D',
    ]);
  });
});

describe('spellChord', () => {
  const cMajor = majorKey(0);

  it('spells a diatonic seventh chord exactly', () => {
    expect(noteNames(spellChord(makeChord(7, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'G',
      'B',
      'D',
      'F',
    ]);
  });

  it('spells a secondary dominant with a sharp fourth', () => {
    expect(noteNames(spellChord(makeChord(2, 'dom7'), parseNote('C'), cMajor))).toEqual([
      'D',
      'F#',
      'A',
      'C',
    ]);
  });

  it('spells a borrowed flat-seven chord with flats', () => {
    expect(noteNames(spellChord(makeChord(10, 'maj'), parseNote('C'), cMajor))).toEqual([
      'Bb',
      'D',
      'F',
    ]);
  });
});
