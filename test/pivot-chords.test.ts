import { describe, expect, it } from 'vitest';
import type { PivotChord } from '../src/analyze/functional/index.js';
import { pivotChords } from '../src/analyze/functional/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const fMajor = majorKey(5);
const fSharpMajor = majorKey(6);
const gMajor = majorKey(7);
const dMinor = minorKey(2);
const eMinor = minorKey(4);
const aMinor = minorKey(9);

/** The identity and both readings of each pivot, in the order reported. */
function view(pivots: PivotChord[]) {
  return pivots.map(({ chord, romanFrom, romanTo }) => ({
    rootPc: chord.rootPc,
    quality: chord.quality,
    romanFrom,
    romanTo,
  }));
}

describe('pivotChords', () => {
  it('shares four triads between C major and G major', () => {
    // C Dm Em F G Am Bdim against G Am Bm C D Em F#dim: F natural rules out
    // Dm, F and Bdim, and Bm is not diatonic to C.
    expect(view(pivotChords(cMajor, gMajor))).toEqual([
      { rootPc: 0, quality: 'maj', romanFrom: 'I', romanTo: 'IV' },
      { rootPc: 4, quality: 'min', romanFrom: 'iii', romanTo: 'vi' },
      { rootPc: 7, quality: 'maj', romanFrom: 'V', romanTo: 'I' },
      { rootPc: 9, quality: 'min', romanFrom: 'vi', romanTo: 'ii' },
    ]);
  });

  it('shares every triad with the relative minor, read a third apart', () => {
    expect(view(pivotChords(cMajor, aMinor))).toEqual([
      { rootPc: 0, quality: 'maj', romanFrom: 'I', romanTo: 'III' },
      { rootPc: 2, quality: 'min', romanFrom: 'ii', romanTo: 'iv' },
      { rootPc: 4, quality: 'min', romanFrom: 'iii', romanTo: 'v' },
      { rootPc: 5, quality: 'maj', romanFrom: 'IV', romanTo: 'VI' },
      { rootPc: 7, quality: 'maj', romanFrom: 'V', romanTo: 'VII' },
      { rootPc: 9, quality: 'min', romanFrom: 'vi', romanTo: 'i' },
      { rootPc: 11, quality: 'dim', romanFrom: 'viio', romanTo: 'iio' },
    ]);
  });

  it('finds nothing between keys a tritone apart', () => {
    expect(pivotChords(cMajor, fSharpMajor)).toEqual([]);
  });

  it('reads every triad the same way when the key does not change', () => {
    const pivots = pivotChords(cMajor, cMajor);
    expect(pivots.map((pivot) => pivot.romanFrom)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'viio',
    ]);
    for (const pivot of pivots) {
      expect(pivot.romanTo).toBe(pivot.romanFrom);
    }
  });

  it('shares four triads with the subdominant key', () => {
    // Bb rules out Em, G and Bdim; the rest sit a fifth lower in F major.
    expect(view(pivotChords(cMajor, fMajor))).toEqual([
      { rootPc: 0, quality: 'maj', romanFrom: 'I', romanTo: 'V' },
      { rootPc: 2, quality: 'min', romanFrom: 'ii', romanTo: 'vi' },
      { rootPc: 5, quality: 'maj', romanFrom: 'IV', romanTo: 'I' },
      { rootPc: 9, quality: 'min', romanFrom: 'vi', romanTo: 'iii' },
    ]);
  });

  it('shares the subdominant collection with D minor', () => {
    // D natural minor holds the same tones as F major, so the same four triads
    // survive; they are read from D instead.
    expect(view(pivotChords(cMajor, dMinor))).toEqual([
      { rootPc: 0, quality: 'maj', romanFrom: 'I', romanTo: 'VII' },
      { rootPc: 2, quality: 'min', romanFrom: 'ii', romanTo: 'i' },
      { rootPc: 5, quality: 'maj', romanFrom: 'IV', romanTo: 'III' },
      { rootPc: 9, quality: 'min', romanFrom: 'vi', romanTo: 'v' },
    ]);
  });

  it('swaps the two readings when the modulation is reversed', () => {
    expect(view(pivotChords(gMajor, cMajor))).toEqual([
      { rootPc: 7, quality: 'maj', romanFrom: 'I', romanTo: 'V' },
      { rootPc: 9, quality: 'min', romanFrom: 'ii', romanTo: 'vi' },
      { rootPc: 0, quality: 'maj', romanFrom: 'IV', romanTo: 'I' },
      { rootPc: 4, quality: 'min', romanFrom: 'vi', romanTo: 'iii' },
    ]);
    const byRoot = (pivots: PivotChord[]) =>
      [...view(pivots)].sort((left, right) => left.rootPc - right.rootPc);
    expect(byRoot(pivotChords(gMajor, cMajor))).toEqual(
      byRoot(pivotChords(cMajor, gMajor)).map((pivot) => ({
        ...pivot,
        romanFrom: pivot.romanTo,
        romanTo: pivot.romanFrom,
      })),
    );
  });

  it('pivots out of a minor key', () => {
    // A minor into E minor: F natural rules out Bdim, Dm and F.
    expect(view(pivotChords(aMinor, eMinor))).toEqual([
      { rootPc: 9, quality: 'min', romanFrom: 'i', romanTo: 'iv' },
      { rootPc: 0, quality: 'maj', romanFrom: 'III', romanTo: 'VI' },
      { rootPc: 4, quality: 'min', romanFrom: 'v', romanTo: 'i' },
      { rootPc: 7, quality: 'maj', romanFrom: 'VII', romanTo: 'III' },
    ]);
  });

  it('reports no pivot out of a key that has no diatonic triads', () => {
    expect(pivotChords(scaleByName('majorPentatonic', 0), cMajor)).toEqual([]);
    expect(pivotChords(scaleByName('wholeTone', 0), cMajor)).toEqual([]);
    expect(pivotChords(scaleByName('chromatic', 0), cMajor)).toEqual([]);
  });

  it('pivots between two scales that share no key signature', () => {
    // C altered is {C Db Eb Fb Gb Ab Bb} and C locrian {C Db Eb F Gb Ab Bb}:
    // they differ only in the fourth degree, Fb against F. Stacking thirds on
    // the altered scale gives Cdim, Dbm, Ebm, Eaug, Gb, Ab and Bbdim, and the
    // three built over the Fb — on degrees 2, 4 and 7 — are the ones locrian
    // cannot take, leaving four.
    expect(view(pivotChords(scaleByName('altered', 0), scaleByName('locrian', 0)))).toEqual([
      { rootPc: 0, quality: 'dim', romanFrom: 'io', romanTo: 'io' },
      { rootPc: 3, quality: 'min', romanFrom: 'iii', romanTo: 'iii' },
      { rootPc: 6, quality: 'maj', romanFrom: 'V', romanTo: 'V' },
      { rootPc: 8, quality: 'maj', romanFrom: 'VI', romanTo: 'VI' },
    ]);
    // Against C major none survive: every one of the four rests on Eb or Gb.
    expect(pivotChords(scaleByName('altered', 0), cMajor)).toEqual([]);
  });

  it('accepts a non-heptatonic destination, which is only tested for membership', () => {
    // C and Am fit the C major pentatonic collection; the pentatonic key has no
    // numerals of its own, so its readings fall back to the parallel major.
    expect(view(pivotChords(cMajor, scaleByName('majorPentatonic', 0)))).toEqual([
      { rootPc: 0, quality: 'maj', romanFrom: 'I', romanTo: 'I' },
      { rootPc: 9, quality: 'min', romanFrom: 'vi', romanTo: 'vi' },
    ]);
  });
});
