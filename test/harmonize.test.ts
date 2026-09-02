import { describe, expect, it } from 'vitest';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { buildCandidates } from '../src/generate/harmonize/candidates.js';
import type { HarmonizeOptions, HarmonizeResult } from '../src/generate/harmonize/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import type { ChordSpan } from '../src/generate/progression/index.js';
import {
  chordFromSpan,
  chordPitchClasses,
  diatonicTriad,
  makeChord,
} from '../src/theory/chord/index.js';
import { roleOf } from '../src/theory/harmony/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  scaleByName,
  scaleTonesInDegreeOrder,
  toKeyScale,
} from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Quarter notes from beat 0. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
}

/** The chord sounding at a beat: chords are reported once per change, not per slot. */
function chordAt(result: HarmonizeResult, beat: number): ChordSpan | undefined {
  return result.chords.filter((chord) => chord.startBeat <= beat).at(-1);
}

/**
 * Twinkle, Twinkle: C C G G A A G / F F E E D D C, the long notes twice as long.
 */
const twinkle: NoteEvent[] = (
  [
    [60, 1],
    [60, 1],
    [67, 1],
    [67, 1],
    [69, 1],
    [69, 1],
    [67, 2],
    [65, 1],
    [65, 1],
    [64, 1],
    [64, 1],
    [62, 1],
    [62, 1],
    [60, 2],
  ] as const
).reduce<NoteEvent[]>((notes, [pitch, durationBeat]) => {
  const prev = notes.at(-1);
  const startBeat = prev ? prev.startBeat + prev.durationBeat : 0;
  notes.push({ pitch, startBeat, durationBeat });
  return notes;
}, []);

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
    expect(result.key.scale.rootPc).toBe(7); // G major
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
    expect(result.key.scale.rootPc).toBe(9); // A minor, not C major
    expect(result.key.scale.modeMask12).toBe(NATURAL_MINOR_MASK);
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
    const a = harmonizeMelody({ ...base, ctx: { seed: 1 } });
    const b = harmonizeMelody({ ...base, ctx: { seed: 9999 } });
    expect(a.chords).toEqual(b.chords);
    // And the same seed is always reproducible.
    expect(harmonizeMelody({ ...base, ctx: { seed: 1 } })).toEqual(
      harmonizeMelody({ ...base, ctx: { seed: 1 } }),
    );
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
    const second = chordAt(result, 2);
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
      ctx: { seed: 99 },
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
    expect(result.key.scale).toEqual(toKeyScale(cMajor));
  });

  it('starts the harmonic grid at the first sounding section instead of adding an intro', () => {
    const result = harmonizeMelody({
      melody: [60, 64, 67, 71].map((pitch, index) => ({
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
    // The grid runs from the first sounding beat, so every change lands on it.
    for (const chord of result.chords) {
      expect(chord.startBeat).toBeGreaterThanOrEqual(8);
      expect((chord.startBeat - 8) % 2).toBe(0);
    }
  });

  it('reports a chord once per change rather than once per slot', () => {
    // Sixteen beats at two beats a slot is eight slots; a chord held across two
    // of them is reported once, so the count follows the harmony.
    const result = harmonizeMelody({
      melody: twinkle,
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.chords).toHaveLength(7);
    for (const [index, chord] of result.chords.entries()) {
      const prev = result.chords[index - 1];
      if (prev) {
        expect([chord.rootPc, chord.quality]).not.toEqual([prev.rootPc, prev.quality]);
      }
    }
  });

  it('honours a harmonic rhythm finer than a quarter note', () => {
    // A stepwise figure, so each slot asks for a chord of its own: an arpeggio
    // would be one chord at every grid and could not show the grid was read.
    const melody = [60, 62, 64, 65].map((pitch, i) => ({
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

  it('names its chords by quality alone, recording no interval template', () => {
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
    expect(result.chords.length).toBeGreaterThan(0);
    for (const span of result.chords) {
      expect('intervals' in span).toBe(false);
      expect(chordFromSpan(span)).toEqual(makeChord(span.rootPc, span.quality, span.bassPc));
    }
  });

  it('reads the default chord grid from the time signature', () => {
    // Twelve beats of waltz: with a 4/4 grid the chords would change every two
    // beats, which is across the barline in three, so the grid follows the metre.
    const melody = quarters([60, 64, 67, 62, 65, 69, 60, 64, 67, 67, 71, 62]);
    const waltz = harmonizeMelody({
      melody,
      key: cMajor,
      ts: { numerator: 3, denominator: 4 },
      placement: { transposeSearch: false, octaveSearch: false },
    });
    for (const chord of waltz.chords) {
      expect(chord.startBeat % 3).toBe(0);
    }
    // In 4/4 the default is what it has always been: one chord per half bar.
    const common = {
      melody,
      key: cMajor,
      placement: { transposeSearch: false, octaveSearch: false },
    };
    expect(harmonizeMelody(common)).toEqual(harmonizeMelody({ ...common, harmonicRhythm: 2 }));
  });

  it('weights metric accents by the given time signature', () => {
    // A waltz whose bars open on I and whose second bar leans on the notes each
    // accent grid reads differently: the D falls on a downbeat in three, the A
    // on one in four. Read against the wrong grid the accents fall in the wrong
    // places, so the readings must not agree.
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
      { pitch: 62, startBeat: 3, durationBeat: 1 },
      { pitch: 69, startBeat: 4, durationBeat: 1 },
      { pitch: 64, startBeat: 5, durationBeat: 1 },
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

describe('harmonizeMelody follows the harmony rather than the melody notes', () => {
  const common = {
    melody: twinkle,
    key: cMajor,
    harmonicRhythm: 2,
    placement: { transposeSearch: false, octaveSearch: false },
  } as const;

  it('closes a nursery tune on its tonic and uses the tonic along the way', () => {
    const result = harmonizeMelody({ ...common, reharmonize: 'diatonic' });
    expect(result.chords.map((c) => c.rootPc)).toEqual([0, 5, 0, 5, 0, 7, 0]);
    expect(result.chords.at(-1)).toMatchObject({ rootPc: 0, quality: 'maj', degree: 1 });
    expect(result.chords.some((c) => c.degree === 1)).toBe(true);
    // The close is a cadence, not just a chord that happens to fit.
    expect(result.chords.at(-2)).toMatchObject({ rootPc: 7, degree: 5 });
  });

  it('leaves a nursery tune where it was when the vocabulary opens up', () => {
    // The tune has no accidental in it, so the chords that tonicize a degree
    // explain nothing the key's own triads do not: widening the vocabulary adds
    // what the melody asks for, and this melody asks for nothing.
    const result = harmonizeMelody({ ...common, reharmonize: 'secondaryDominant' });
    expect(result.chords).toEqual(harmonizeMelody({ ...common, reharmonize: 'diatonic' }).chords);
    expect(result.chords.map((c) => c.rootPc)).toEqual([0, 5, 0, 5, 0, 7, 0]);
    expect(result.chords.some((c) => c.degree === 1)).toBe(true);
    expect(result.chords.some((c) => c.secondaryDominant)).toBe(false);
  });

  it('reads the same vocabulary from the dial as from the name', () => {
    // The three names are three points on the harmonic dial, so asking by dial
    // position has to give what asking by name always did.
    expect(harmonizeMelody({ ...common, ctx: { seed: 0, complexity: { harmonic: 0 } } })).toEqual(
      harmonizeMelody({ ...common, reharmonize: 'diatonic' }),
    );
    expect(harmonizeMelody({ ...common, ctx: { seed: 0, complexity: { harmonic: 0.5 } } })).toEqual(
      harmonizeMelody({ ...common, reharmonize: 'secondaryDominant' }),
    );
    expect(harmonizeMelody({ ...common, ctx: { seed: 0, complexity: { harmonic: 1 } } })).toEqual(
      harmonizeMelody({ ...common, reharmonize: 'borrowed' }),
    );
  });

  it('opens the vocabulary a chord at a time rather than a family at a time', () => {
    // A dial barely off zero has opened the dominant's own dominant and nothing
    // else, so a melody that spells another tonicization cannot have it yet.
    const tonicizesTwo = quarters([62, 66, 69, 62, 74, 69, 65, 62]);
    const partial = harmonizeMelody({
      melody: tonicizesTwo,
      key: cMajor,
      harmonicRhythm: 2,
      ctx: { seed: 0, complexity: { harmonic: 0.125 } },
      placement: { transposeSearch: false, octaveSearch: false },
    });
    for (const chord of partial.chords) {
      expect(chord.secondaryDominant ? chord.rootPc : 2).toBe(2);
    }
    // The whole family is open half way up, and the vocabulary itself is what
    // the dial moves — a melody only shows which part of it it needs.
    const roots = (harmonic: number) =>
      buildCandidates(cMajor, harmonic)
        .filter((candidate) => candidate.secondaryDominant)
        .map((candidate) => candidate.rootPc);
    expect(roots(0)).toEqual([]);
    expect(roots(0.125)).toEqual([2]);
    expect(roots(0.5)).toEqual([9, 0, 2, 4]);
  });

  it('lets the context outrank the name and the seed it is sugar for', () => {
    // The context speaks for the whole piece, so it wins wherever both are given.
    expect(
      harmonizeMelody({
        ...common,
        reharmonize: 'borrowed',
        ctx: { seed: 0, complexity: { harmonic: 0 } },
      }),
    ).toEqual(harmonizeMelody({ ...common, reharmonize: 'diatonic' }));
    expect(harmonizeMelody({ ...common, ctx: { seed: 3 } })).toEqual(
      harmonizeMelody({ ...common, ctx: { seed: 3 } }),
    );
    // A bare number is the seed, exactly as `seed` is.
    expect(harmonizeMelody({ ...common, ctx: 5 })).toEqual(
      harmonizeMelody({ ...common, ctx: { seed: 5 } }),
    );
  });

  it('does not give a passing tone a chord of its own', () => {
    // C D E C: the D passes between C and E, so the harmony is what the C and
    // the E ask for and the D is left to the melody.
    const melody = quarters([60, 62, 64, 60]);
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(result.chords).toHaveLength(1);
    expect(result.chords.length).toBeLessThan(melody.length);
    const overD = chordAt(result, 1);
    expect(overD).toBeDefined();
    if (overD) {
      // Nothing was chosen to cover the D: the chord sounding under it does not
      // contain it. Charged for, it would have pulled the slot to G or ii.
      expect(chordPitchClasses(makeChord(overD.rootPc, overD.quality))).not.toContain(62 % 12);
    }

    // One slot per note gives the search every chance to change chord on the D,
    // and it still leaves the tonic where it was.
    const perNote = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 1,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(perNote.chords.length).toBeLessThan(melody.length);
    expect(perNote.chords.map((c) => c.rootPc)).toEqual([0]);
  });

  it('keeps a chain of secondary dominants resolving down a scale', () => {
    // A line that spells one applied dominant after another: each accidental is
    // the third of the chord that tonicizes the degree the line lands on next.
    const melody = quarters([72, 68, 69, 73, 74, 78, 79, 72]);
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 1,
      reharmonize: 'secondaryDominant',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    const applied = result.chords.filter((c) => c.secondaryDominant);
    expect(applied.length).toBeGreaterThanOrEqual(2);
    for (const [index, chord] of result.chords.entries()) {
      if (chord.secondaryDominant) {
        // Each one steps down a fifth onto the chord it tonicizes.
        expect(result.chords[index + 1]?.rootPc).toBe((chord.rootPc + 5) % 12);
      }
    }
    expect(result.chords.at(-1)?.rootPc).toBe(0);
    // The key's own triads alone cannot spell them, so none of it is there when
    // the vocabulary is closed.
    const diatonic = harmonizeMelody({
      melody,
      key: cMajor,
      harmonicRhythm: 1,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(diatonic.chords.some((c) => c.secondaryDominant)).toBe(false);
  });
});

describe('harmonizeMelody placement', () => {
  const cScale = quarters([60, 62, 64, 65, 67, 69, 71, 72]);

  it('moves the melody into the key it harmonizes in', () => {
    const gMajor = majorKey(7);
    const result = harmonizeMelody({
      melody: cScale,
      key: gMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: true, octaveSearch: false },
    });
    expect(result.transposeSemitones).toBe(-5);
    expect(result.key.scale).toEqual(toKeyScale(gMajor));
    // The melody the caller is told to play and the key it is told to play it
    // in are the same key: every transposed note belongs to the reported scale.
    const moved = cScale.map((n) => n.pitch + result.transposeSemitones);
    for (const pitch of moved) {
      expect(scaleTonesInDegreeOrder(result.key)).toContain(pitch % 12);
    }
    for (const chord of result.chords) {
      expect(scaleTonesInDegreeOrder(result.key)).toContain(chord.rootPc);
    }
  });

  it('leaves the melody where it is when it already sits in the key', () => {
    const result = harmonizeMelody({
      melody: cScale,
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: true, octaveSearch: false },
    });
    expect(result.transposeSemitones).toBe(0);
    expect(result.key.scale).toEqual(toKeyScale(cMajor));
  });

  it('moves a melody written out of register by octaves alone', () => {
    const low = cScale.map((n) => ({ ...n, pitch: n.pitch - 24 }));
    const common = {
      melody: low,
      key: cMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
    } as const;
    const placed = harmonizeMelody({
      ...common,
      placement: { transposeSearch: false, octaveSearch: true },
    });
    const asWritten = harmonizeMelody({
      ...common,
      placement: { transposeSearch: false, octaveSearch: false },
    });
    expect(placed.transposeSemitones).toBe(12);
    expect(placed.transposeSemitones % 12).toBe(0);
    // An octave changes register and nothing else, so the harmony is untouched.
    expect(placed.key).toEqual(asWritten.key);
    expect(placed.chords).toEqual(asWritten.chords);
  });

  it('adds the two searches together when both are asked for', () => {
    const low = cScale.map((n) => ({ ...n, pitch: n.pitch - 24 }));
    const gMajor = majorKey(7);
    const result = harmonizeMelody({
      melody: low,
      key: gMajor,
      harmonicRhythm: 2,
      reharmonize: 'diatonic',
      placement: { transposeSearch: true, octaveSearch: true },
    });
    // Down a fifth into G major, then up an octave into a comfortable register.
    expect(result.transposeSemitones).toBe(7);
    expect(result.key.scale).toEqual(toKeyScale(gMajor));
  });
});

describe('reharmonize validation', () => {
  const melody = quarters([72, 71, 69, 67]);

  it('rejects a strength that names no dial position', () => {
    // Read against the dial table unchecked, an unknown name is `undefined`,
    // and the NaN dial position that follows opens every secondary dominant
    // while suppressing the borrowed chords — with no diagnostic either way.
    expect(() =>
      harmonizeMelody({
        melody,
        key: cMajor,
        reharmonize: 'chromatic' as HarmonizeOptions['reharmonize'],
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects it even where the context supplies the dial', () => {
    expect(() =>
      harmonizeMelody({
        melody,
        key: cMajor,
        reharmonize: 'chromatic' as HarmonizeOptions['reharmonize'],
        ctx: { complexity: { harmonic: 0.5 } },
      }),
    ).toThrow(InvalidInputError);
  });

  it('maps every named strength to a dial position the vocabulary grows with', () => {
    const sizes = (['diatonic', 'secondaryDominant', 'borrowed'] as const).map((reharmonize) => {
      const result = harmonizeMelody({ melody, key: cMajor, reharmonize });
      expect(result.chords.length).toBeGreaterThan(0);
      return buildCandidates(cMajor, REHARMONIZE_POSITION[reharmonize]).length;
    });
    expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
  });
});

/** The dial position each named strength stands for, as the generator reads it. */
const REHARMONIZE_POSITION = {
  diatonic: 0,
  secondaryDominant: 0.5,
  borrowed: 1,
} as const;

describe('the role a note is reported in', () => {
  /** The chord the result has sounding at a beat, as a chord. */
  function chordUnder(result: HarmonizeResult, beat: number) {
    const span = chordAt(result, beat);
    return span ? chordFromSpan(span) : undefined;
  }

  /** A performed onset: a beat played a little early or late. */
  function played(pitch: number, startBeat: number, durationBeat: number): NoteEvent {
    return { pitch, startBeat, durationBeat };
  }

  // The chord grid changes on beat 2, and the B is played 0.03 of a beat early:
  // the snap that decides which slot the note is charged against reads it as
  // beat 2, so the role reported for it is its role in the chord chosen there.
  const jittered: NoteEvent[] = [
    played(60, 0, 1),
    played(64, 1.02, 0.95),
    played(71, 1.97, 1),
    played(67, 3.01, 1),
    played(65, 3.98, 1),
    played(64, 5.02, 1),
    played(62, 5.99, 1),
    played(60, 7, 1),
  ];

  it('reports a note against the chord chosen for the slot it was charged to', () => {
    const result = harmonizeMelody({
      melody: jittered,
      key: cMajor,
      harmonicRhythm: 2,
      placement: { transposeSearch: false, octaveSearch: false },
    });
    for (const [index, note] of jittered.entries()) {
      const snapped =
        Math.abs(Math.round(note.startBeat) - note.startBeat) <= 0.05
          ? Math.round(note.startBeat)
          : note.startBeat;
      const chord = chordUnder(result, snapped);
      expect(chord).toBeDefined();
      expect(result.melodyRoles[index]?.role).toBe(
        roleOf(note.pitch + result.transposeSemitones, chord ?? makeChord(0, 'maj')).role,
      );
    }
  });

  it('reports a note that begins just before a boundary as a tone of the chord after it', () => {
    // The B lands on the slot beginning at beat 2, which the search covers with
    // a chord that has it: a note the cost model paid to explain is not then
    // reported as one the harmony left unexplained.
    const result = harmonizeMelody({
      melody: jittered,
      key: cMajor,
      harmonicRhythm: 2,
      placement: { transposeSearch: false, octaveSearch: false },
    });
    const chord = chordUnder(result, 2);
    expect(chordPitchClasses(chord ?? makeChord(0, 'maj'))).toContain(11);
    expect(result.melodyRoles[2]?.role).not.toBe('tension');
  });

  it('reports every note of a melody played straight against its own slot', () => {
    const result = harmonizeMelody({ melody: twinkle, key: cMajor });
    for (const [index, note] of twinkle.entries()) {
      const chord = chordUnder(result, note.startBeat);
      expect(result.melodyRoles[index]?.role).toBe(
        roleOf(note.pitch, chord ?? makeChord(0, 'maj')).role,
      );
    }
  });
});

describe('the work a harmonization may do', () => {
  /** A whole piece: 120 bars of 4/4, one note a beat. */
  const FIGURE = [0, 2, 4, 5, 7, 5, 4, 2];
  const wholePiece: NoteEvent[] = Array.from({ length: 480 }, (_, index) => ({
    pitch: 60 + (FIGURE[index % FIGURE.length] ?? 0),
    startBeat: index,
    durationBeat: 1,
  }));

  it('harmonizes a whole piece with the transposition search when given the budget', () => {
    const result = harmonizeMelody({
      melody: wholePiece,
      key: cMajor,
      reharmonize: 'borrowed',
      placement: { transposeSearch: true, octaveSearch: false },
      budget: 10_000_000,
    });
    expect(result.chords.length).toBeGreaterThan(0);
    expect(result.melodyRoles.length).toBe(wholePiece.length);
  });

  it('honours a budget the caller lowers', () => {
    expect(() => harmonizeMelody({ melody: twinkle, key: cMajor, budget: 1 })).toThrow(
      BudgetExceededError,
    );
  });

  it('leaves the harmonization a raised budget yields identical to the one it allows', () => {
    const opts = { melody: twinkle, key: cMajor } as const;
    expect(harmonizeMelody({ ...opts, budget: 10_000_000 })).toEqual(harmonizeMelody(opts));
  });
});

describe('the diatonic tier stays inside the mode it names', () => {
  const modes = [
    { name: 'dorian', key: scaleByName('dorian', 2) },
    { name: 'phrygian', key: scaleByName('phrygian', 4) },
    { name: 'locrian', key: scaleByName('locrian', 11) },
  ];

  it.each(modes)('uses only the scale tones of $name', ({ key }) => {
    // `diatonic` promises the key's own triads. A mode is not a minor key
    // waiting to have its seventh raised: D dorian harmonized with A major
    // sounds a C#, and B locrian offered a triad on F# overwrites the lowered
    // fifth the mode is named for.
    for (const candidate of buildCandidates(key, 0)) {
      for (const pc of candidate.pcs) {
        expect(isScaleTone(pc, key), `${pc} of ${candidate.rootPc}:${candidate.quality}`).toBe(
          true,
        );
      }
    }
  });

  it('harmonizes a dorian melody with dorian chords', () => {
    const dDorian = scaleByName('dorian', 2);
    const result = harmonizeMelody({
      melody: quarters([62, 65, 67, 69, 71, 69, 65, 62]),
      key: dDorian,
      reharmonize: 'diatonic',
      placement: { transposeSearch: false, octaveSearch: false },
    });
    for (const span of result.chords) {
      for (const pc of chordPitchClasses(chordFromSpan(span))) {
        expect(isScaleTone(pc, dDorian)).toBe(true);
      }
    }
  });

  it('still lets a minor key cadence through its raised seventh', () => {
    // The allowance is the minor key's: it writes that seventh as an accidental
    // rather than in its scale, and without the major dominant a minor melody
    // can be harmonized but never closed.
    const candidates = buildCandidates(minorKey(9), 0);
    expect(candidates.some((c) => c.rootPc === 4 && c.quality === 'maj')).toBe(true);
    expect(candidates.some((c) => c.rootPc === 4 && c.quality === 'min')).toBe(true);
  });
});

describe('a secondary dominant tonicizes only a degree that can be a tonic', () => {
  const keys = [
    { name: 'C major', key: cMajor },
    { name: 'A minor', key: minorKey(9) },
    { name: 'C lydian', key: scaleByName('lydian', 0) },
    { name: 'D dorian', key: scaleByName('dorian', 2) },
  ];

  it.each(keys)('offers no dominant of a diminished degree in $name', ({ key }) => {
    for (const candidate of buildCandidates(key, 1)) {
      if (!candidate.secondaryDominant || candidate.targetDegree === undefined) {
        continue;
      }
      const target = diatonicTriad(candidate.targetDegree, key);
      expect(['maj', 'min'], `degree ${candidate.targetDegree}`).toContain(target.quality);
    }
  });

  it('puts no F#7 in front of the diminished supertonic of A minor', () => {
    const candidates = buildCandidates(minorKey(9), 1).filter((c) => c.secondaryDominant);
    expect(candidates.map((c) => c.targetDegree)).not.toContain(2);
    expect(candidates.map((c) => c.rootPc)).not.toContain(6);
  });

  it('leaves the diminished fourth degree of lydian alone', () => {
    // C lydian raises its fourth, so the triad there is F# diminished and its
    // dominant would tonicize a chord that is no tonic.
    const candidates = buildCandidates(scaleByName('lydian', 0), 1).filter(
      (c) => c.secondaryDominant,
    );
    expect(candidates.map((c) => c.targetDegree)).not.toContain(4);
  });

  it('keeps the whole family a major key has', () => {
    const targets = buildCandidates(cMajor, 0.5)
      .filter((c) => c.secondaryDominant)
      .map((c) => c.targetDegree);
    expect(targets).toEqual([2, 4, 5, 6]);
  });
});

describe('the borrowed chords open in the order an arranger uses them', () => {
  /** The roots of the borrowings a dial position has opened. */
  const borrowedRoots = (harmonic: number): number[] =>
    buildCandidates(cMajor, harmonic)
      .filter((candidate) => !candidate.secondaryDominant && candidate.degree === undefined)
      .map((candidate) => candidate.rootPc);

  /** The lowest dial position at which a root has entered the vocabulary. */
  const entersAt = (rootPc: number): number => {
    for (let step = 0; step <= 8; step += 1) {
      const dial = 0.5 + step / 16;
      if (borrowedRoots(dial).includes(rootPc)) {
        return dial;
      }
    }
    return Number.POSITIVE_INFINITY;
  };

  it('opens bVII before the minor tonic and the diminished supertonic', () => {
    // bVII is the borrowing pop writing reaches for most and the minor tonic
    // the least; taking them in scale-degree order opened them the other way
    // round, so the top of the dial was where bVII finally arrived.
    expect(entersAt(10)).toBeLessThan(entersAt(0));
    expect(entersAt(10)).toBeLessThan(entersAt(2));
    expect(entersAt(5)).toBeLessThanOrEqual(entersAt(10));
  });

  it('has the useful borrowings and none of the rare ones part way up', () => {
    const opened = borrowedRoots(0.65);
    expect(opened).toContain(5);
    expect(opened).toContain(10);
    expect(opened).not.toContain(0);
    expect(opened).not.toContain(2);
  });

  it('still opens every one of them at the top of the dial', () => {
    expect(borrowedRoots(1).sort((a, b) => a - b)).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });
});
