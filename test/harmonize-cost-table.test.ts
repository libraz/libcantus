import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { buildCandidates } from '../src/generate/harmonize/candidates.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import type { Candidate } from '../src/generate/harmonize/internal.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** Quarter notes from beat 0. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
}

/** A candidate as its identity alone: what chord it is, not what it costs. */
function chordOf(candidate: Candidate): [number, string, number | null, number | null] {
  return [
    candidate.rootPc,
    candidate.quality,
    candidate.degree ?? null,
    candidate.targetDegree ?? null,
  ];
}

const asWritten = { transposeSearch: false, octaveSearch: false } as const;

/**
 * Sixteen singable melodies that come to rest on the tonic of C major, each
 * eight quarter notes long: the shape a first call to the harmonizer has.
 */
const TONIC_ENDINGS: number[][] = [
  [64, 62, 60, 62, 64, 64, 62, 60],
  [60, 62, 64, 60, 65, 64, 62, 60],
  [67, 69, 67, 64, 60, 64, 62, 60],
  [60, 64, 67, 64, 65, 64, 62, 60],
  [72, 71, 69, 67, 65, 64, 62, 60],
  [60, 62, 64, 65, 67, 65, 64, 60],
  [64, 65, 67, 65, 64, 62, 64, 60],
  [67, 65, 64, 62, 60, 62, 64, 60],
  [60, 60, 67, 67, 69, 67, 65, 60],
  [64, 64, 65, 67, 67, 65, 64, 60],
  [67, 67, 65, 64, 62, 64, 62, 60],
  [60, 65, 64, 62, 67, 65, 62, 60],
  [71, 72, 74, 72, 71, 69, 67, 60],
  [62, 64, 65, 67, 69, 71, 72, 60],
  [60, 64, 62, 65, 64, 67, 62, 60],
  [69, 67, 65, 64, 62, 65, 64, 60],
];

/** The same shapes in A minor, each closing on A through its leading tone. */
const MINOR_ENDINGS: number[][] = [
  [69, 71, 72, 71, 69, 68, 71, 69],
  [69, 72, 76, 74, 72, 68, 71, 69],
  [76, 74, 72, 71, 69, 68, 71, 69],
  [69, 71, 72, 74, 76, 68, 71, 69],
  [72, 71, 69, 71, 72, 68, 71, 69],
  [69, 76, 72, 71, 72, 68, 71, 69],
];

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

describe('a chord slot costs what the music in it is worth', () => {
  // A melody held across many slots is one harmony however finely the grid
  // divides it: the reward for changing chord is charged by the beats the
  // change spans, exactly as the melody's own cost is, so a finer harmonic
  // rhythm cannot buy chords the melody never asked for.
  it('harmonizes a held note with one chord at every harmonic rhythm', () => {
    const held: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 16 }];
    for (const harmonicRhythm of [4, 2, 1, 0.5, 0.25]) {
      const result = harmonizeMelody({ melody: held, key: cMajor, harmonicRhythm });
      expect(result.chords).toEqual([{ rootPc: 0, quality: 'maj', startBeat: 0, degree: 1 }]);
    }
  });

  it('never spends more chords than the melody has notes, however fine the grid', () => {
    const tunes = [
      [60, 62, 64, 65, 67, 65, 64, 62],
      [60, 64, 67, 72, 67, 64, 60, 72],
      [67, 69, 71, 72, 71, 69, 67, 60],
    ];
    for (const pitches of tunes) {
      for (const harmonicRhythm of [4, 2, 1, 0.5, 0.25]) {
        const result = harmonizeMelody({
          melody: quarters(pitches),
          key: cMajor,
          harmonicRhythm,
          placement: asWritten,
        });
        expect(result.chords.length).toBeLessThanOrEqual(pitches.length);
      }
    }
  });

  it('keeps the harmony of an arpeggiated bar the same at every harmonic rhythm', () => {
    // Every note of the bar belongs to one chord, so no grid has anything to
    // add: the answer is that chord, once.
    for (const harmonicRhythm of [4, 2, 1, 0.5, 0.25]) {
      const result = harmonizeMelody({
        melody: quarters([60, 64, 67, 72, 67, 64, 60, 72]),
        key: cMajor,
        harmonicRhythm,
        placement: asWritten,
      });
      expect(result.chords.map((c) => c.rootPc)).toEqual([0]);
    }
  });
});

describe('chords from outside the key are bought by the melody, not by chord flow', () => {
  it('harmonizes a melody with no accidentals the same however wide the vocabulary', () => {
    for (const pitches of TONIC_ENDINGS) {
      const common = {
        melody: quarters(pitches),
        key: cMajor,
        harmonicRhythm: 2,
        placement: asWritten,
      } as const;
      const diatonic = harmonizeMelody({ ...common, reharmonize: 'diatonic' });
      expect(harmonizeMelody({ ...common, reharmonize: 'secondaryDominant' }).chords).toEqual(
        diatonic.chords,
      );
      expect(harmonizeMelody({ ...common, reharmonize: 'borrowed' }).chords).toEqual(
        diatonic.chords,
      );
    }
  });

  it('starts a minor melody on its tonic instead of an applied dominant', () => {
    for (const pitches of MINOR_ENDINGS) {
      const result = harmonizeMelody({
        melody: quarters(pitches),
        key: aMinor,
        harmonicRhythm: 2,
        reharmonize: 'secondaryDominant',
        placement: asWritten,
      });
      expect(result.chords[0]).toMatchObject({ rootPc: 9, degree: 1 });
      expect(result.chords.every((chord) => chord.secondaryDominant !== true)).toBe(true);
    }
  });

  it('reaches for the applied dominant the melody does spell', () => {
    // Bar 1 outlines E major (V/vi), bar 2 outlines A minor (vi): the G# is
    // evidence no diatonic chord can answer.
    const result = harmonizeMelody({
      melody: [
        { pitch: 64, startBeat: 0, durationBeat: 1 },
        { pitch: 68, startBeat: 1, durationBeat: 1 },
        { pitch: 71, startBeat: 2, durationBeat: 1 },
        { pitch: 69, startBeat: 4, durationBeat: 1 },
        { pitch: 72, startBeat: 5, durationBeat: 1 },
        { pitch: 76, startBeat: 6, durationBeat: 1 },
      ],
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'secondaryDominant',
      placement: asWritten,
    });
    expect(result.chords[0]).toMatchObject({ rootPc: 4, secondaryDominant: true });
    expect(result.chords[1]).toMatchObject({ rootPc: 9, degree: 6 });
  });
});

describe('a phrase that comes to rest on the tonic is closed by the tonic chord', () => {
  it('closes every tonic-ending melody on I', () => {
    for (const pitches of TONIC_ENDINGS) {
      const result = harmonizeMelody({
        melody: quarters(pitches),
        key: cMajor,
        harmonicRhythm: 2,
        placement: asWritten,
      });
      expect(result.chords.at(-1)).toMatchObject({ rootPc: 0, quality: 'maj', degree: 1 });
    }
  });

  it('closes every tonic-ending minor melody on i', () => {
    for (const pitches of MINOR_ENDINGS) {
      const result = harmonizeMelody({
        melody: quarters(pitches),
        key: aMinor,
        harmonicRhythm: 2,
        placement: asWritten,
      });
      expect(result.chords.at(-1)).toMatchObject({ rootPc: 9, quality: 'min', degree: 1 });
    }
  });

  it('closes on the tonic whatever the chord before it turned out to be', () => {
    // The same close reached along different paths: an accented structural tone
    // in the last slot cannot buy it for a chord the melody has left behind.
    for (const pitches of TONIC_ENDINGS) {
      for (const harmonicRhythm of [4, 2, 1]) {
        const result = harmonizeMelody({
          melody: quarters(pitches),
          key: cMajor,
          harmonicRhythm,
          placement: asWritten,
        });
        expect(result.chords.at(-1)?.degree).toBe(1);
      }
    }
  });

  it('leaves a phrase that ends anywhere else open', () => {
    // The melody comes to rest on the supertonic, which the tonic chord cannot
    // support, so the close is what the melody sounds rather than a forced I.
    const result = harmonizeMelody({
      melody: quarters([60, 64, 67, 65, 64, 67, 65, 62]),
      key: cMajor,
      harmonicRhythm: 2,
      placement: asWritten,
    });
    expect(result.chords.at(-1)?.degree).not.toBe(1);
  });
});

describe('a minor key can cadence', () => {
  it('approaches the close from the dominant when the melody spells its leading tone', () => {
    const result = harmonizeMelody({
      melody: quarters([69, 71, 72, 74, 76, 68, 71, 69]),
      key: aMinor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: asWritten,
    });
    expect(result.chords.at(-2)).toMatchObject({ rootPc: 4, quality: 'maj', degree: 5 });
    expect(result.chords.at(-1)).toMatchObject({ rootPc: 9, quality: 'min', degree: 1 });
  });

  it('counts the raised seventh of a minor key as one of its own notes', () => {
    // A leading tone is what a minor cadence is made of, so it is no reason to
    // move the melody into another key.
    const result = harmonizeMelody({
      melody: quarters([69, 71, 72, 74, 76, 68, 71, 69]),
      key: aMinor,
      harmonicRhythm: 2,
      placement: { transposeSearch: true, octaveSearch: false },
    });
    expect(result.transposeSemitones).toBe(0);
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
    for (let tonic = 0; tonic < 12; tonic += 1) {
      for (const key of [majorKey(tonic), minorKey(tonic)]) {
        for (const candidate of buildCandidates(key, 0)) {
          if (candidate.quality === 'dim') {
            expect(candidate.base).toBe(0.9);
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

describe('a minor key is harmonized by what its chords are', () => {
  it('harmonizes the subtonic triad the melody spells with the subtonic triad', () => {
    // G-B-D over a slot of A minor is the subtonic, the chord idiomatic minor
    // harmony reaches for; nothing else in the key covers all three notes.
    const result = harmonizeMelody({
      melody: quarters([67, 71, 74, 71]),
      key: aMinor,
      harmonicRhythm: 4,
      placement: asWritten,
    });
    expect(result.chords[0]).toMatchObject({ rootPc: 7, quality: 'maj' });
  });

  it('prefers a stable triad to the diminished one where both explain the notes', () => {
    // B and D belong to the subtonic triad as well as to the diminished triad
    // on the supertonic, and a root-position diminished triad is not what a
    // minor phrase is built on.
    const result = harmonizeMelody({
      melody: quarters([71, 74, 71, 74]),
      key: aMinor,
      harmonicRhythm: 4,
      placement: asWritten,
    });
    expect(result.chords[0]?.quality).not.toBe('dim');
  });
});
