import { describe, expect, it } from 'vitest';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { KeyScale } from '../src/core/types.js';
import {
  developMotif,
  generateMotif,
  type MotifCell,
  type MotifTransform,
  transformMotif,
} from '../src/generate/motif/index.js';
import { type Chord, chordPitchClasses } from '../src/theory/chord/index.js';
import { MAJOR_MASK, NATURAL_MINOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };
const fMajor: KeyScale = { rootPc: 5, modeMask12: MAJOR_MASK };
const aMinor: KeyScale = { rootPc: 9, modeMask12: NATURAL_MINOR_MASK };
const cell: MotifCell = {
  notes: [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 64, startBeat: 1, durationBeat: 1 },
    { pitch: 67, startBeat: 2, durationBeat: 1 },
  ],
};

const pitchClass = (p: number) => ((p % 12) + 12) % 12;

/** Beats from a cell's first onset to its last offset, as tiling measures it. */
const spanOf = (source: MotifCell): number =>
  Math.max(...source.notes.map((n) => n.startBeat + n.durationBeat)) -
  Math.min(...source.notes.map((n) => n.startBeat));

describe('transformMotif involutions', () => {
  it('inverts to itself twice', () => {
    expect(transformMotif(transformMotif(cell, 'invert'), 'invert')).toEqual(cell);
  });

  it('retrogrades to itself twice', () => {
    expect(transformMotif(transformMotif(cell, 'retrograde'), 'retrograde')).toEqual(cell);
  });

  it('preserves rests and is self-inverse when retrograding a gapped cell', () => {
    const withRest: MotifCell = {
      notes: [
        { pitch: 60, startBeat: 0, durationBeat: 1 },
        { pitch: 64, startBeat: 2, durationBeat: 1 }, // rest across beat 1
      ],
    };
    const once = transformMotif(withRest, 'retrograde');
    // Span preserved: last offset still lands on beat 3.
    expect(Math.max(...once.notes.map((n) => n.startBeat + n.durationBeat))).toBe(3);
    // Rest preserved: the pitches are mirrored, not packed together, and the
    // notes are written in the order they now sound.
    expect(once.notes.map((n) => ({ ...n }))).toEqual([
      { pitch: 64, startBeat: 0, durationBeat: 1 },
      { pitch: 60, startBeat: 2, durationBeat: 1 },
    ]);
    expect(transformMotif(once, 'retrograde')).toEqual(withRest);
  });

  it('augments about the earliest onset for an unsorted cell', () => {
    const unsorted: MotifCell = {
      notes: [
        { pitch: 64, startBeat: 2, durationBeat: 1 },
        { pitch: 60, startBeat: 0, durationBeat: 1 },
      ],
    };
    const augmented = transformMotif(unsorted, 'augment', 2);
    // Origin is the minimum onset (beat 0), so nothing is pushed to negative time.
    expect(Math.min(...augmented.notes.map((n) => n.startBeat))).toBe(0);
    // A transform hands back a line: the notes run in the order they sound,
    // whichever order the cell was written in.
    expect(augmented.notes.map((n) => n.startBeat)).toEqual([0, 4]);
    expect(augmented.notes.map((n) => n.pitch)).toEqual([60, 64]);
  });

  it('hands back every transform in onset order', () => {
    const unsorted: MotifCell = {
      notes: [
        { pitch: 67, startBeat: 2, durationBeat: 2 },
        { pitch: 60, startBeat: 0, durationBeat: 1 },
        { pitch: 64, startBeat: 1, durationBeat: 1 },
      ],
    };
    const transforms: MotifTransform[] = [
      'invert',
      'retrograde',
      'augment',
      'diminish',
      'transposeChromatic',
      'transposeDiatonic',
      'sequence',
    ];
    for (const transform of transforms) {
      const onsets = transformMotif(unsorted, transform, 2, cMajor).notes.map((n) => n.startBeat);
      expect(onsets, transform).toEqual([...onsets].sort((a, b) => a - b));
    }
  });

  it('inverts about the note that sounds first, not the one written first', () => {
    const unsorted: MotifCell = {
      notes: [
        { pitch: 67, startBeat: 2, durationBeat: 1 },
        { pitch: 60, startBeat: 0, durationBeat: 1 },
      ],
    };
    // Reflected about 60, the earliest note: 67 lands a fifth below it.
    expect(transformMotif(unsorted, 'invert').notes.map((n) => n.pitch)).toEqual([60, 53]);
  });

  it('turns a retrograde upside down about the note the retrograde put first', () => {
    // A retrograde inversion of C-E-G: read back to front to G-E-C, then
    // reflected about the G it now starts on, which turns the falling thirds
    // into rising ones — G-Bb-D.
    const turned = transformMotif(transformMotif(cell, 'retrograde'), 'invert');
    expect(turned.notes.map((n) => n.startBeat)).toEqual([0, 1, 2]);
    expect(turned.notes.map((n) => n.pitch)).toEqual([67, 70, 74]);
  });

  it('augments then diminishes back to the original durations', () => {
    const augmented = transformMotif(cell, 'augment', 2);
    expect(augmented.notes.map((n) => n.durationBeat)).toEqual([2, 2, 2]);
    const restored = transformMotif(augmented, 'diminish', 2);
    expect(restored).toEqual(cell);
  });

  it('diminishes durations by half', () => {
    expect(transformMotif(cell, 'diminish', 2).notes.map((n) => n.durationBeat)).toEqual([
      0.5, 0.5, 0.5,
    ]);
  });

  it('transposes chromatically by an octave', () => {
    expect(transformMotif(cell, 'transposeChromatic', 12).notes.map((n) => n.pitch)).toEqual([
      72, 76, 79,
    ]);
  });
});

describe('transformMotif range', () => {
  it('rejects a transform that leaves the MIDI range instead of emitting it', () => {
    const high: MotifCell = { notes: [{ pitch: 120, startBeat: 0, durationBeat: 1 }] };
    expect(() => transformMotif(high, 'transposeChromatic', 12)).toThrow(RangeError);
    const low: MotifCell = { notes: [{ pitch: 5, startBeat: 0, durationBeat: 1 }] };
    expect(() => transformMotif(low, 'transposeChromatic', -12)).toThrow(/0/);
  });

  it('accepts a transform that lands on the range boundary', () => {
    const cellAt: MotifCell = { notes: [{ pitch: 115, startBeat: 0, durationBeat: 1 }] };
    expect(transformMotif(cellAt, 'transposeChromatic', 12).notes[0]?.pitch).toBe(127);
  });
});

describe('transformMotif shifts', () => {
  it('transposes diatonically by one scale degree', () => {
    const shifted = transformMotif(cell, 'transposeDiatonic', 1, cMajor);
    expect(shifted.notes.map((n) => n.pitch)).toEqual([62, 65, 69]); // C->D, E->F, G->A
  });

  it('transposes diatonically without a key by raw degrees', () => {
    expect(transformMotif(cell, 'transposeDiatonic', 3).notes.map((n) => n.pitch)).toEqual([
      63, 67, 70,
    ]);
  });

  it('sequences the cell with a diatonically shifted copy', () => {
    const seq = transformMotif(cell, 'sequence', 2, cMajor);
    expect(seq.notes).toHaveLength(cell.notes.length * 2);
    expect(seq.notes[3]?.startBeat).toBe(3); // copy begins after the original span
  });

  it('sequences by semitones when no key is given', () => {
    // Documented fallback: without a key, sequence shifts the copy chromatically
    // by `amount` semitones (not diatonic degrees).
    const seq = transformMotif(cell, 'sequence', 2);
    expect(seq.notes).toHaveLength(cell.notes.length * 2);
    const copy = seq.notes.slice(cell.notes.length);
    expect(copy.map((n) => n.pitch)).toEqual([62, 66, 69]); // 60/64/67 + 2 semitones
  });
});

describe('generateMotif', () => {
  it('is deterministic for a given seed', () => {
    const a = generateMotif({ key: cMajor, bars: 2, contour: 'arch', ctx: { seed: 7 } });
    const b = generateMotif({ key: cMajor, bars: 2, contour: 'arch', ctx: { seed: 7 } });
    expect(a).toEqual(b);
  });

  it('produces in-scale pitches for every contour', () => {
    for (const contour of ['arch', 'ascending', 'descending', 'wave'] as const) {
      const motif = generateMotif({ key: cMajor, bars: 1, contour, ctx: { seed: 3 } });
      for (const note of motif.notes) {
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(pitchClass(note.pitch));
      }
    }
  });

  it('snaps downbeat notes to chord tones when a chord is given', () => {
    const chord: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };
    const motif = generateMotif({
      key: cMajor,
      chord,
      bars: 1,
      contour: 'ascending',
      ctx: { seed: 1 },
    });
    const first = motif.notes[0];
    expect(first && chordPitchClasses(chord).includes(pitchClass(first.pitch))).toBe(true);
  });

  it('builds a symmetric arch that returns to the tonic for even lengths', () => {
    // bars=2 => 4 notes (an even length); the arch must be a palindrome that
    // starts and ends on the tonic (C4 = 60).
    const motif = generateMotif({ key: cMajor, bars: 2, contour: 'arch' });
    const pitches = motif.notes.map((n) => n.pitch);
    expect(pitches).toEqual([60, 62, 62, 60]);
    expect(pitches[0]).toBe(60);
    expect(pitches[pitches.length - 1]).toBe(60);
    expect(pitches).toEqual([...pitches].reverse());
  });

  it('keeps an odd-length arch symmetric and tonic-anchored', () => {
    const pitches = generateMotif({ key: cMajor, bars: 3, contour: 'arch' }).notes.map(
      (n) => n.pitch,
    );
    expect(pitches).toEqual([60, 62, 64, 64, 62, 60]);
    expect(pitches).toEqual([...pitches].reverse());
  });

  it('honors the requested contour with no upward drift by default', () => {
    // Without jitter the ascending contour is exactly the diatonic climb from
    // the tonic, with no random upward nudge.
    const pitches = generateMotif({
      key: cMajor,
      bars: 1,
      contour: 'ascending',
      ctx: { seed: 5 },
    }).notes.map((n) => n.pitch);
    expect(pitches).toEqual([60, 62, 64]);
    for (let i = 1; i < pitches.length; i += 1) {
      expect(pitches[i]).toBeGreaterThan(pitches[i - 1] ?? Number.NEGATIVE_INFINITY);
    }
  });

  it('ignores the seed while jitter is off (contour is seed-independent)', () => {
    const a = generateMotif({ key: cMajor, bars: 2, contour: 'wave', ctx: { seed: 1 } });
    const b = generateMotif({ key: cMajor, bars: 2, contour: 'wave', ctx: { seed: 999 } });
    expect(a).toEqual(b);
  });

  it('applies opt-in jitter deterministically per seed', () => {
    const withJitter = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'ascending',
      jitter: 1,
      ctx: { seed: 4 },
    });
    const again = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'ascending',
      jitter: 1,
      ctx: { seed: 4 },
    });
    expect(withJitter).toEqual(again);
    // Enabling jitter perturbs the plain contour, and never by more than the
    // single diatonic step the nudge is defined as.
    const plain = generateMotif({ key: cMajor, bars: 2, contour: 'ascending', ctx: { seed: 4 } });
    expect(withJitter).not.toEqual(plain);
    withJitter.notes.forEach((note, index) => {
      const straight = plain.notes[index]?.pitch ?? note.pitch;
      expect(Math.abs(note.pitch - straight)).toBeLessThanOrEqual(2);
    });
  });
});

describe('motif meter', () => {
  it('counts bars in the requested meter instead of assuming four beats', () => {
    const waltz = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'ascending',
      ts: { numerator: 3, denominator: 4 },
    });
    const span = waltz.notes.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0);
    expect(span).toBe(6);
    const common = generateMotif({ key: cMajor, bars: 2, contour: 'ascending' });
    expect(common.notes.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeat), 0)).toBe(8);
  });

  it('snaps the bar lines of the requested meter to chord tones', () => {
    // In 3/4 the second bar starts at beat 3, which a four-beat bar never treats
    // as a downbeat; F#, a non-chord tone, must still be pulled onto the chord.
    const chord: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };
    const waltz = generateMotif({
      key: cMajor,
      chord,
      bars: 2,
      contour: 'ascending',
      ts: { numerator: 3, denominator: 4 },
    });
    const downbeats = waltz.notes.filter((n) => n.startBeat % 3 === 0);
    expect(downbeats.length).toBeGreaterThanOrEqual(2);
    for (const note of downbeats) {
      expect(chordPitchClasses(chord)).toContain(pitchClass(note.pitch));
    }
  });

  it('fills the requested meter when developing across bars', () => {
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 12);
    const cell: MotifCell = { notes: [{ pitch: 60, startBeat: 0, durationBeat: 1 }] };
    const waltz = developMotif(cell, timeline, cMajor, 2, { numerator: 3, denominator: 4 });
    expect(waltz.notes).toHaveLength(6);
    expect(developMotif(cell, timeline, cMajor, 2, '4/4').notes).toHaveLength(8);
  });
});

describe('developMotif', () => {
  it('snaps the structural positions to the active segment chord tones', () => {
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'maj', startBeat: 4 },
      ],
      8,
    );
    const source: MotifCell = {
      notes: [
        { pitch: 62, startBeat: 0, durationBeat: 2 }, // D over C (non-chord)
        { pitch: 65, startBeat: 2, durationBeat: 2 }, // F over C (non-chord)
        { pitch: 69, startBeat: 4, durationBeat: 2 }, // A over G (non-chord)
        { pitch: 65, startBeat: 6, durationBeat: 2 }, // F over G (non-chord)
      ],
    };
    const developed = developMotif(source, timeline, cMajor, 2, '4/4');
    for (const note of developed.notes) {
      const chord = timeline.at(note.startBeat);
      if (!chord) {
        throw new Error('expected a chord for every developed note');
      }
      // The bar lines spell the chord; the notes between them stay in the key,
      // which is what a passing or neighbour tone is.
      if (note.startBeat % 4 === 0) {
        expect(chordPitchClasses(chord)).toContain(pitchClass(note.pitch));
      } else {
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(pitchClass(note.pitch));
      }
    }
  });

  it('keeps the cell recognizable: distinct pitches stay distinct', () => {
    // The library's own documented example: a C-D-C cell over a C major
    // timeline must come back as C-D-C, not as one repeated chord tone.
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);
    const source = generateMotif({ key: cMajor, bars: 1 });
    const developed = developMotif(source, timeline, cMajor, 2, '4/4');

    expect(developed.notes.map((n) => n.pitch)).toEqual([60, 62, 60, 60, 62, 60]);
    expect(new Set(source.notes.map((n) => n.pitch)).size).toBe(
      new Set(developed.notes.slice(0, source.notes.length).map((n) => n.pitch)).size,
    );
    // Downbeats land on the chord.
    for (const note of developed.notes.filter((n) => n.startBeat % 4 === 0)) {
      expect(chordPitchClasses({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] })).toContain(
        pitchClass(note.pitch),
      );
    }
  });

  it('separates two structural notes that want the same chord tone', () => {
    // Both notes are on a bar line over the same chord, and a plain nearest-tone
    // snap would pull C# and D onto the same C. The step has to survive.
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);
    const source: MotifCell = {
      notes: [
        { pitch: 61, startBeat: 0, durationBeat: 4 },
        { pitch: 62, startBeat: 4, durationBeat: 4 },
      ],
    };
    const developed = developMotif(source, timeline, cMajor, 2, '4/4');
    const pitches = developed.notes.map((n) => n.pitch);
    expect(new Set(pitches).size).toBe(2);
    for (const pitch of pitches) {
      expect(chordPitchClasses({ rootPc: 0, quality: 'maj', intervals: [0, 4, 7] })).toContain(
        pitchClass(pitch),
      );
    }
  });

  // Cells, keys, and harmonies that a development has to survive: a generated
  // cell and a hand-written one, over a static chord and over changing ones, in
  // major and in minor, including a chromatic passing note the key has to take
  // in without folding it onto its neighbour.
  const developCases = [
    {
      name: 'generated arch over a static C',
      cell: generateMotif({ key: cMajor, bars: 1 }),
      key: cMajor,
      chords: [{ rootPc: 0, quality: 'maj', startBeat: 0 }],
      scalePcs: [0, 2, 4, 5, 7, 9, 11],
    },
    {
      name: 'generated ascending over C - F',
      cell: generateMotif({ key: cMajor, bars: 1, contour: 'ascending' }),
      key: cMajor,
      chords: [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 5, quality: 'maj', startBeat: 4 },
      ],
      scalePcs: [0, 2, 4, 5, 7, 9, 11],
    },
    {
      name: 'stepwise cell over A minor - E minor',
      cell: {
        notes: [69, 71, 72, 71].map((pitch, index) => ({
          pitch,
          startBeat: index,
          durationBeat: 1,
        })),
      },
      key: aMinor,
      chords: [
        { rootPc: 9, quality: 'min', startBeat: 0 },
        { rootPc: 4, quality: 'min', startBeat: 4 },
      ],
      scalePcs: [9, 11, 0, 2, 4, 5, 7],
    },
    {
      name: 'chromatic climb over C - G',
      cell: {
        notes: [60, 61, 62, 63].map((pitch, index) => ({
          pitch,
          startBeat: index,
          durationBeat: 1,
        })),
      },
      key: cMajor,
      chords: [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'maj', startBeat: 4 },
      ],
      scalePcs: [0, 2, 4, 5, 7, 9, 11],
    },
    {
      name: 'wave cell in F over F - Bb',
      cell: generateMotif({ key: fMajor, bars: 2, contour: 'wave' }),
      key: fMajor,
      chords: [
        { rootPc: 5, quality: 'maj', startBeat: 0 },
        { rootPc: 10, quality: 'maj', startBeat: 4 },
      ],
      scalePcs: [5, 7, 9, 10, 0, 2, 4],
    },
  ] as const;

  it.each(developCases)(
    'keeps distinct cell pitches distinct and spells the harmony: $name',
    ({ cell, key, chords, scalePcs }) => {
      const timeline = chordTimelineFromChords(chords, 8);
      const developed = developMotif(cell, timeline, key, 2, '4/4');
      const span = spanOf(cell);
      const origin = Math.min(...cell.notes.map((n) => n.startBeat));
      // Placed pitch by cell pitch, per tile: the development repeats the cell,
      // so the mapping only has to be one-to-one within a single pass of it.
      const perTile = new Map<number, Map<number, number>>();

      for (const note of developed.notes) {
        const tile = Math.floor((note.startBeat + 1e-9) / span);
        const source = cell.notes.find(
          (n) => Math.abs(n.startBeat - origin - (note.startBeat - tile * span)) < 1e-6,
        );
        if (source === undefined) {
          throw new Error(`developed note at beat ${note.startBeat} matches no cell note`);
        }
        const placed = perTile.get(tile) ?? new Map<number, number>();
        perTile.set(tile, placed);
        for (const [cellPitch, developedPitch] of placed) {
          if (cellPitch !== source.pitch) {
            expect(developedPitch).not.toBe(note.pitch);
          }
        }
        placed.set(source.pitch, note.pitch);

        const chord = timeline.at(note.startBeat);
        if (chord && note.startBeat % 4 === 0) {
          expect(chordPitchClasses(chord)).toContain(pitchClass(note.pitch));
        } else {
          expect(scalePcs).toContain(pitchClass(note.pitch));
        }
      }
      expect(perTile.size).toBeGreaterThan(0);
    },
  );

  it('terminates quickly for a degenerate tiny-span cell', () => {
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 4);
    const tiny: MotifCell = { notes: [{ pitch: 60, startBeat: 0, durationBeat: 1e-9 }] };
    const startedAt = Date.now();
    const developed = developMotif(tiny, timeline, cMajor, 1, '4/4');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(developed.notes.length).toBeGreaterThan(0);
  });
});
