import type { NoteEvent } from '@libraz/libcantus/core';
import { harmonizeMelody } from '@libraz/libcantus/generate';
import { majorKey, minorKey } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** Quarter notes from beat 0. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
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
