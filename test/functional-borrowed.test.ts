import { describe, expect, it } from 'vitest';
import {
  analyzeChord,
  borrowedSource,
  isBorrowedChord,
  isDiatonic,
  parallelKey,
} from '../src/analyze/functional/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { MAJOR_MASK, majorKey, minorKey, NATURAL_MINOR_MASK } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

describe('isDiatonic', () => {
  it('accepts diatonic chords and rejects chromatic ones', () => {
    expect(isDiatonic(makeChord(0, 'maj'), cMajor)).toBe(true);
    expect(isDiatonic(makeChord(7, 'dom7'), cMajor)).toBe(true);
    expect(isDiatonic(makeChord(5, 'min'), cMajor)).toBe(false);
    expect(isDiatonic(makeChord(8, 'maj'), cMajor)).toBe(false);
  });
});

describe('parallelKey', () => {
  it('mirrors major to natural minor and back on the same tonic', () => {
    expect(parallelKey(cMajor)).toEqual({ rootPc: 0, modeMask12: NATURAL_MINOR_MASK });
    expect(parallelKey(aMinor)).toEqual({ rootPc: 9, modeMask12: MAJOR_MASK });
  });
});

describe('modal interchange in C major', () => {
  it('detects the minor subdominant iv as borrowed from the parallel minor', () => {
    const iv = makeChord(5, 'min');
    expect(isBorrowedChord(iv, cMajor)).toBe(true);
    expect(borrowedSource(iv, cMajor)).toBe('parallel-minor');
    expect(analyzeChord(iv, cMajor)).toEqual({
      function: 'subdominant',
      borrowed: true,
      source: 'parallel-minor',
      roman: 'iv',
    });
  });

  it('detects bVI as borrowed subdominant harmony', () => {
    const flatSix = makeChord(8, 'maj');
    expect(isBorrowedChord(flatSix, cMajor)).toBe(true);
    expect(analyzeChord(flatSix, cMajor)).toEqual({
      function: 'subdominant',
      borrowed: true,
      source: 'parallel-minor',
      roman: 'bVI',
    });
  });

  it('detects bVII as borrowed subdominant harmony', () => {
    const flatSeven = makeChord(10, 'maj');
    expect(isBorrowedChord(flatSeven, cMajor)).toBe(true);
    expect(analyzeChord(flatSeven, cMajor)).toEqual({
      function: 'subdominant',
      borrowed: true,
      source: 'parallel-minor',
      roman: 'bVII',
    });
  });

  it('recognizes the Neapolitan as its own source with subdominant function', () => {
    const neapolitan = makeChord(1, 'maj');
    // The Neapolitan fits neither parallel mode, so the strict parallel-mode
    // predicate rejects it while borrowedSource names it.
    expect(isBorrowedChord(neapolitan, cMajor)).toBe(false);
    expect(borrowedSource(neapolitan, cMajor)).toBe('neapolitan');
    expect(analyzeChord(neapolitan, cMajor)).toEqual({
      function: 'subdominant',
      borrowed: true,
      source: 'neapolitan',
      roman: 'bII',
    });
  });

  it('does not flag diatonic ii, IV, and V as borrowed', () => {
    for (const chord of [makeChord(2, 'min'), makeChord(5, 'maj'), makeChord(7, 'dom7')]) {
      expect(isBorrowedChord(chord, cMajor)).toBe(false);
      expect(borrowedSource(chord, cMajor)).toBeNull();
      expect(analyzeChord(chord, cMajor).borrowed).toBe(false);
    }
  });

  it('treats a chord diatonic to neither mode as chromatic, not borrowed', () => {
    // D major (V/V) fits neither C major nor C natural minor.
    const two = makeChord(2, 'maj');
    expect(isBorrowedChord(two, cMajor)).toBe(false);
    expect(borrowedSource(two, cMajor)).toBeNull();
  });

  it('gives dominant function to diminished chords on vii and #iv', () => {
    expect(analyzeChord(makeChord(11, 'dim'), cMajor).function).toBe('dominant');
    expect(analyzeChord(makeChord(11, 'dim7'), cMajor).function).toBe('dominant');
    expect(analyzeChord(makeChord(6, 'dim7'), cMajor).function).toBe('dominant');
  });
});

describe('modal interchange in A minor', () => {
  it('detects the major IV as borrowed from the parallel major', () => {
    const majorFour = makeChord(2, 'maj');
    expect(isDiatonic(majorFour, aMinor)).toBe(false);
    expect(isBorrowedChord(majorFour, aMinor)).toBe(true);
    expect(borrowedSource(majorFour, aMinor)).toBe('parallel-major');
    expect(analyzeChord(majorFour, aMinor)).toMatchObject({
      borrowed: true,
      source: 'parallel-major',
      roman: 'IV',
    });
  });

  it('detects the Picardy tonic as borrowed from the parallel major', () => {
    expect(borrowedSource(makeChord(9, 'maj'), aMinor)).toBe('parallel-major');
  });

  it('treats the raised dominant as a harmonic-minor alteration, not interchange', () => {
    // isDiatonic tests strictly against the natural-minor mask, so E major is
    // not diatonic; but its raised leading tone comes from harmonic minor, an
    // in-key alteration, so it is neither borrowed nor sourced.
    const dominant = makeChord(4, 'maj');
    expect(isDiatonic(dominant, aMinor)).toBe(false);
    expect(isBorrowedChord(dominant, aMinor)).toBe(false);
    expect(borrowedSource(dominant, aMinor)).toBeNull();
    expect(analyzeChord(dominant, aMinor)).toMatchObject({
      function: 'dominant',
      borrowed: false,
      source: null,
    });
  });

  it('treats the raised-leading-tone diminished seventh the same way', () => {
    const leadingTone = makeChord(8, 'dim7');
    expect(isBorrowedChord(leadingTone, aMinor)).toBe(false);
    expect(borrowedSource(leadingTone, aMinor)).toBeNull();
    expect(analyzeChord(leadingTone, aMinor).function).toBe('dominant');
  });

  it('does not flag diatonic minor-key chords as borrowed', () => {
    for (const chord of [makeChord(9, 'min'), makeChord(2, 'min'), makeChord(5, 'maj')]) {
      expect(isBorrowedChord(chord, aMinor)).toBe(false);
      expect(borrowedSource(chord, aMinor)).toBeNull();
    }
  });
});
