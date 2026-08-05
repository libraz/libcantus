import { describe, expect, it } from 'vitest';
import { type HarmonizeOptions, harmonizeMelody } from '../src/generate/harmonize/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import {
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  scaleTonesInDegreeOrder,
} from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

describe('harmonizeMelody', () => {
  it('harmonizes a diatonic C-major melody with an I-centered progression', () => {
    const melody = [60, 64, 67, 72, 67, 64, 60, 72].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    const diatonic = scaleTonesInDegreeOrder(cMajor);
    expect(result.chords[0]?.rootPc).toBe(0);
    expect(result.chords.at(-1)?.rootPc).toBe(0);
    for (const chord of result.chords) {
      expect(diatonic).toContain(chord.rootPc);
    }
  });

  it('inserts a secondary dominant when the melody tonicizes vi', () => {
    // Bar 1 outlines E major (V/vi), bar 2 outlines A minor (vi).
    const melody = [
      { pitch: 64, startBeat: 0, durationBeat: 1 },
      { pitch: 68, startBeat: 1, durationBeat: 1 }, // G#
      { pitch: 71, startBeat: 2, durationBeat: 1 },
      { pitch: 69, startBeat: 4, durationBeat: 1 },
      { pitch: 72, startBeat: 5, durationBeat: 1 },
      { pitch: 76, startBeat: 6, durationBeat: 1 },
    ];
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'secondaryDominant',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    const secondary = result.chords.find((c) => c.secondaryDominant);
    expect(secondary).toBeDefined();
    expect(secondary?.rootPc).toBe(4); // E major = V/vi
  });

  it('finds a non-zero transpose when the melody is a tritone from the key', () => {
    // F#-major material harmonized against C major: shifting by a tritone fits.
    const melody = [66, 68, 70, 71, 73, 75].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: true, octaveSearch: false },
    });
    expect(result.transposeSemitones).not.toBe(0);
  });

  it('infers the key from the melody', () => {
    // G A B C D F#: contains C natural and F#, unique to G major.
    const melody = [67, 69, 71, 72, 74, 78].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const result = harmonizeMelody({
      melody,
      key: 'infer',
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.key.rootPc).toBe(7); // G major
  });

  it('does not let a zero-length imported artefact change the inferred key', () => {
    const melody = [{ pitch: 72, startBeat: 0, durationBeat: 4 }];
    const base = harmonizeMelody({ melody, key: 'infer' });
    const withSilentArtefact = harmonizeMelody({
      melody: [...melody, { pitch: 66, startBeat: 60, durationBeat: 0 }],
      key: 'infer',
    });
    expect(withSilentArtefact.key).toEqual(base.key);
  });

  it('infers a minor key for a clearly minor melody instead of the relative major', () => {
    // A C E C A G A: centered and cadencing on A, using natural-minor tones
    // (including G natural). The relative major (C) shares the same pitch
    // classes, so only the tonic emphasis on A distinguishes A minor.
    const melody = [69, 72, 76, 72, 69, 67, 69].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const result = harmonizeMelody({
      melody,
      key: 'infer',
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.key.rootPc).toBe(9); // A minor, not C major
    expect(result.key.modeMask12).toBe(NATURAL_MINOR_MASK);
  });

  it('treats the seed as a tie-break only: seed does not change a well-determined result', () => {
    // A strongly diatonic C-major melody has a single lowest-cost harmonization,
    // so the seed (which only perturbs otherwise-equal candidates) cannot alter
    // it. Different seeds must yield the same chords.
    const melody = [60, 64, 67, 72, 67, 64, 60, 72].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const base: Omit<HarmonizeOptions, 'seed'> = {
      melody,
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    };
    const a = harmonizeMelody({ ...base, seed: 1 });
    const b = harmonizeMelody({ ...base, seed: 9999 });
    expect(a.chords).toEqual(b.chords);
    // And the same seed is always reproducible.
    expect(harmonizeMelody({ ...base, seed: 1 })).toEqual(harmonizeMelody({ ...base, seed: 1 }));
  });

  it('avoids clashing with a note sustained across a segment boundary', () => {
    // A whole-note B4 sounds through both segments; the short notes in the
    // second segment outline a C-major triad. Without accounting for the held
    // note, the second segment would pick C major, which clashes with the B.
    const melody = [
      { pitch: 71, startBeat: 0, durationBeat: 4 }, // held B4 across both segments
      { pitch: 72, startBeat: 2, durationBeat: 0.5 }, // C5
      { pitch: 76, startBeat: 2.5, durationBeat: 0.5 }, // E5
      { pitch: 79, startBeat: 3, durationBeat: 1 }, // G5
    ];
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    const second = result.chords[1];
    expect(second).toBeDefined();
    if (second) {
      const pcs = chordPitchClasses(makeChord(second.rootPc, second.quality));
      expect(pcs).toContain(71 % 12); // the held B is a chord tone, not a clash
    }
  });

  it('is deterministic for identical options and seed', () => {
    const opts: HarmonizeOptions = {
      melody: [60, 62, 64, 65, 67].map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'borrowed',
      placement: { transposeSearch: true, octaveSearch: true },
      seed: 99,
    };
    expect(harmonizeMelody(opts)).toEqual(harmonizeMelody(opts));
  });

  it('adds parallel-major borrowed chords when harmonizing in minor', () => {
    const melody = [69, 73, 76].map((pitch, i) => ({
      pitch,
      startBeat: i,
      durationBeat: 1,
    }));
    const common = {
      melody,
      key: minorKey(9),
      harmonicRhythm: 4,
      placement: { transposeSearch: false, octaveSearch: false },
    } as const;
    const diatonic = harmonizeMelody({ ...common, reharmonize: 'diatonic' });
    const borrowed = harmonizeMelody({ ...common, reharmonize: 'borrowed' });
    expect(diatonic.chords[0]).not.toMatchObject({ rootPc: 9, quality: 'maj' });
    expect(borrowed.chords[0]).toMatchObject({ rootPc: 9, quality: 'maj' });
  });

  it('returns nothing for an empty melody instead of inventing a tonic bar', () => {
    const result = harmonizeMelody({
      melody: [],
      key: cMajor,
      harmonicRhythm: 4,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.chords).toEqual([]);
    expect(result.melodyRoles).toEqual([]);
    expect(result.transposeSemitones).toBe(0);
    expect(result.key).toEqual(cMajor);
  });

  it('starts the harmonic grid at the first sounding section instead of adding an intro', () => {
    const result = harmonizeMelody({
      melody: [60, 64, 67, 65].map((pitch, index) => ({
        pitch,
        startBeat: 8 + index,
        durationBeat: 1,
      })),
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.chords[0]?.startBeat).toBe(8);
    expect(result.chords.map((chord) => chord.startBeat)).toEqual([8, 10]);
  });

  it('honours a harmonic rhythm finer than a quarter note', () => {
    const melody = [60, 64, 67, 72].map((pitch, i) => ({
      pitch,
      startBeat: i * 0.125,
      durationBeat: 0.125,
    }));
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 0.125,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    // Four eighth-of-a-beat slots, not one quarter-note slot rounded up.
    expect(result.chords).toHaveLength(4);
    expect(result.chords.map((chord) => chord.startBeat)).toEqual([0, 0.125, 0.25, 0.375]);
  });

  it('weights metric accents by the given time signature', () => {
    // A waltz whose bar-initial notes outline I and whose beat-3 notes outline
    // V. Read against a 4/4 grid the strong beats fall in the wrong places, so
    // the two readings must not agree.
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 71, startBeat: 2, durationBeat: 1 },
      { pitch: 62, startBeat: 3, durationBeat: 1 },
      { pitch: 67, startBeat: 4, durationBeat: 1 },
      { pitch: 65, startBeat: 5, durationBeat: 1 },
    ];
    const common: Omit<HarmonizeOptions, 'ts'> = {
      melody,
      key: cMajor,
      harmonicRhythm: 3,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    };
    const waltz = harmonizeMelody({ ...common, ts: { numerator: 3, denominator: 4 } });
    const fourFour = harmonizeMelody({ ...common, ts: { numerator: 4, denominator: 4 } });
    expect(waltz.chords).toHaveLength(2);
    // The option has to reach the accent grid; if it were ignored the two
    // harmonizations would be identical by construction.
    expect(waltz.chords.map((c) => c.rootPc)).not.toEqual(fourFour.chords.map((c) => c.rootPc));

    // A compound metre and an additive one have to reach the accent grid too,
    // not just the simple triple case.
    const jig = harmonizeMelody({ ...common, ts: { numerator: 6, denominator: 8 } });
    const aksak = harmonizeMelody({
      ...common,
      ts: { numerator: 7, denominator: 8, grouping: [2, 2, 3] },
    });
    for (const result of [jig, aksak]) {
      expect(result.chords.map((c) => c.rootPc)).not.toEqual(fourFour.chords.map((c) => c.rootPc));
    }
  });
});
