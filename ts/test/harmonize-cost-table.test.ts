import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../src/generate/harmonize/candidates.js';
import type { Candidate } from '../src/generate/harmonize/internal.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** A candidate as its identity alone: what chord it is, not what it costs. */
function chordOf(candidate: Candidate): [number, string, number | null, number | null] {
  return [
    candidate.rootPc,
    candidate.quality,
    candidate.degree ?? null,
    candidate.targetDegree ?? null,
  ];
}

describe('the chord vocabulary a key opens', () => {
  // The candidate list of a major key is what it has always been, chord for
  // chord: making a minor key reach its dominant may not widen a major one.
  it('builds the same major-key candidates at every dial position', () => {
    const diatonic: [number, string, number | null, number | null][] = [
      [0, 'maj', 1, null],
      [2, 'min', 2, null],
      [4, 'min', 3, null],
      [5, 'maj', 4, null],
      [7, 'maj', 5, null],
      [9, 'min', 6, null],
      [11, 'dim', 7, null],
    ];
    const expected: Record<string, [number, string, number | null, number | null][]> = {
      '0': diatonic,
      '0.125': [...diatonic, [2, 'dom7', null, 5]],
      '0.25': [...diatonic, [2, 'dom7', null, 5], [4, 'dom7', null, 6]],
      '0.5': [
        ...diatonic,
        [9, 'dom7', null, 2],
        [0, 'dom7', null, 4],
        [2, 'dom7', null, 5],
        [4, 'dom7', null, 6],
      ],
      // The borrowings arrive in order of use, not of scale degree: the minor
      // subdominant and the flat-side major triads first, the minor tonic and
      // the diminished supertonic last.
      '0.75': [
        ...diatonic,
        [9, 'dom7', null, 2],
        [0, 'dom7', null, 4],
        [2, 'dom7', null, 5],
        [4, 'dom7', null, 6],
        [5, 'min', null, null],
        [10, 'maj', null, null],
        [8, 'maj', null, null],
        [3, 'maj', null, null],
      ],
      '1': [
        ...diatonic,
        [9, 'dom7', null, 2],
        [0, 'dom7', null, 4],
        [2, 'dom7', null, 5],
        [4, 'dom7', null, 6],
        [5, 'min', null, null],
        [10, 'maj', null, null],
        [8, 'maj', null, null],
        [3, 'maj', null, null],
        [7, 'min', null, null],
        [2, 'dim', null, null],
        [0, 'min', null, null],
      ],
    };
    for (const [dial, chords] of Object.entries(expected)) {
      expect(buildCandidates(cMajor, Number(dial)).map(chordOf)).toEqual(chords);
    }
  });

  it('gives every major key the same vocabulary, transposed', () => {
    for (const dial of [0, 0.125, 0.25, 0.5, 0.75, 1]) {
      const reference = buildCandidates(cMajor, dial).map(chordOf);
      for (let tonic = 1; tonic < 12; tonic += 1) {
        expect(buildCandidates(majorKey(tonic), dial).map(chordOf)).toEqual(
          reference.map(([rootPc, quality, degree, target]) => [
            (rootPc + tonic) % 12,
            quality,
            degree,
            target,
          ]),
        );
      }
    }
  });

  // A minor key cadences through its harmonic-minor dominant, so the chord is
  // part of the key's own vocabulary and is there at the default dial position.
  it('gives a minor key a dominant that can act as one, at every dial position', () => {
    for (const dial of [0, 0.125, 0.5, 1]) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        const candidates = buildCandidates(minorKey(tonic), dial);
        const dominant = candidates.filter(
          (c) => c.rootPc === (tonic + 7) % 12 && (c.quality === 'maj' || c.quality === 'dom7'),
        );
        expect(dominant.length).toBeGreaterThan(0);
        for (const chord of dominant) {
          expect(chord.degree).toBe(5);
        }
        // The natural-minor v stays alongside it, so the search still has both.
        expect(candidates.some((c) => c.rootPc === (tonic + 7) % 12 && c.quality === 'min')).toBe(
          true,
        );
      }
    }
  });
});

describe('what a chord of the key costs to use', () => {
  /** The vocabulary cost of one chord of a key, by root and quality. */
  function baseOf(key: Parameters<typeof buildCandidates>[0], rootPc: number, quality: string) {
    return buildCandidates(key, 0).find((c) => c.rootPc === rootPc && c.quality === quality)?.base;
  }

  it('prices the same triad the same in a major key and in a minor key', () => {
    // B diminished is the seventh degree of C major and the second of A minor.
    // It is the same unstable sonority in both, and the ordinal its degree
    // happens to occupy is no reason for one key to buy it more cheaply.
    expect(baseOf(aMinor, 11, 'dim')).toBe(baseOf(cMajor, 11, 'dim'));
  });

  it('prices a dominant triad the same in the major and the parallel minor', () => {
    expect(baseOf(minorKey(0), 7, 'maj')).toBe(baseOf(cMajor, 7, 'maj'));
  });

  it('charges every diminished triad what an unstable sonority costs', () => {
    // At every position of the harmonic dial, so the borrowed tier is priced by
    // the same reading as the key's own: a ii dim borrowed from the parallel
    // minor was charged the flat borrowing rate and came out cheaper than the
    // vii dim of the key it was borrowed into, which left the seed's tie-break
    // to choose between two chords a melody should be choosing between.
    for (const harmonic of [0, 0.4, 0.7, 1]) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        for (const key of [majorKey(tonic), minorKey(tonic)]) {
          for (const candidate of buildCandidates(key, harmonic)) {
            if (candidate.quality === 'dim') {
              expect(candidate.base, `${tonic} at ${harmonic}`).toBe(0.9);
            }
          }
        }
      }
    }
  });

  it('charges a subdominant and a dominant what their function is worth in either mode', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const major = buildCandidates(majorKey(tonic), 0);
      const minor = buildCandidates(minorKey(tonic), 0);
      const at = (candidates: Candidate[], semitones: number) =>
        candidates.filter((c) => c.rootPc === (tonic + semitones) % 12 && c.quality !== 'dim');
      for (const semitones of [0, 5, 7]) {
        for (const chord of [...at(major, semitones), ...at(minor, semitones)]) {
          expect(chord.base).toBe(at(major, semitones)[0]?.base);
        }
      }
    }
  });

  it('reads the price from what a chord is, not from where it sits in the list', () => {
    // Each key's own triads, priced by the semitones between root and tonic and
    // by the chord's own quality: a mode that spells its second degree as a
    // diminished triad pays for a diminished triad, and one whose seventh is a
    // major triad pays for a subtonic.
    const priced = new Map<string, number>();
    for (let tonic = 0; tonic < 12; tonic += 1) {
      for (const key of [majorKey(tonic), minorKey(tonic)]) {
        for (const candidate of buildCandidates(key, 0)) {
          const id = `${(candidate.rootPc - tonic + 12) % 12}:${candidate.quality}`;
          const seen = priced.get(id);
          if (seen === undefined) {
            priced.set(id, candidate.base);
          } else {
            expect(candidate.base).toBe(seen);
          }
        }
      }
    }
    expect(priced.get('2:dim')).toBe(priced.get('11:dim'));
    // The subtonic a minor key closes plagally through is one of its own
    // chords, not the leading-tone triad of a major key.
    expect(priced.get('10:maj')).toBeLessThan(priced.get('2:dim') ?? 0);
  });
});
