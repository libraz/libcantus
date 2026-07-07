import { describe, expect, it } from 'vitest';
import { makeChord } from '../src/chord/index.js';
import { parseNote } from '../src/pitch/index.js';
import { majorKey, minorKey, scaleByName } from '../src/scale/index.js';
import {
  noteNames,
  spellChord,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from '../src/spelling/index.js';

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

  it('derives a double-sharp leading tone in G# harmonic minor (Fx)', () => {
    // G# harmonic minor raises the seventh degree F# to F double-sharp (Fx),
    // which must keep the F letter rather than collapsing to a natural G.
    const scale = spellScale(parseNote('G#'), scaleByName('harmonicMinor', 8));
    expect(noteNames(scale)).toEqual(['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F##']);
    expect(scale[6]).toEqual({ letter: 3, alter: 2 });
  });

  it('derives a double-sharp seventh in D# harmonic minor (Cx)', () => {
    expect(noteNames(spellScale(parseNote('D#'), scaleByName('harmonicMinor', 3)))).toEqual([
      'D#',
      'E#',
      'F#',
      'G#',
      'A#',
      'B',
      'C##',
    ]);
  });
});

describe('spellPitchClass', () => {
  it('spells a sharp minor key raised leading tone with a sharp letter (E# in F# minor)', () => {
    // F# natural minor omits pc 5; its raised leading tone must spell E#, not F.
    expect(spellPitchClass(5, parseNote('F#'), minorKey(6))).toEqual({ letter: 2, alter: 1 });
  });

  it('spells a sharp minor key raised sixth with a sharp letter (E# in G# minor)', () => {
    // G# natural minor's sixth degree is E; its raised sixth must spell E#, not F.
    expect(spellPitchClass(5, parseNote('G#'), minorKey(8))).toEqual({ letter: 2, alter: 1 });
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

  it('spells a leading-tone diminished seventh with a double-sharp root (Fx in G# minor)', () => {
    // The vii°7 of G# harmonic minor is rooted on the double-sharp leading tone.
    expect(
      noteNames(spellChord(makeChord(7, 'dim7'), parseNote('G#'), scaleByName('harmonicMinor', 8))),
    ).toEqual(['F##', 'A#', 'C#', 'E']);
  });
});

describe('spellPitchClasses', () => {
  it('spells an arbitrary pitch-class list in input order', () => {
    expect(noteNames(spellPitchClasses([0, 4, 7], parseNote('C'), majorKey(0)))).toEqual([
      'C',
      'E',
      'G',
    ]);
  });

  it('falls back to a sharp spelling of the nearest natural for a non-heptatonic scale', () => {
    // A whole-tone scale is not heptatonic, so degrees are named tone-by-tone.
    expect(
      noteNames(spellPitchClasses([0, 2, 6, 10], parseNote('C'), scaleByName('wholeTone', 0))),
    ).toEqual(['C', 'D', 'F#', 'A#']);
  });
});
