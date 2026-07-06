import { describe, expect, it } from 'vitest';
import { chordPitchClasses } from '../src/chord/index.js';
import { developMotif, generateMotif, type MotifCell, transformMotif } from '../src/motif/index.js';
import { MAJOR_MASK } from '../src/scale/index.js';
import { chordTimelineFromChords } from '../src/timeline/index.js';
import type { KeyScale } from '../src/types.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };
const cell: MotifCell = {
  notes: [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 64, startBeat: 1, durationBeat: 1 },
    { pitch: 67, startBeat: 2, durationBeat: 1 },
  ],
};

const pitchClass = (p: number) => ((p % 12) + 12) % 12;

describe('transformMotif involutions', () => {
  it('inverts to itself twice', () => {
    expect(transformMotif(transformMotif(cell, 'invert'), 'invert')).toEqual(cell);
  });

  it('retrogrades to itself twice', () => {
    expect(transformMotif(transformMotif(cell, 'retrograde'), 'retrograde')).toEqual(cell);
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
});

describe('generateMotif', () => {
  it('is deterministic for a given seed', () => {
    const a = generateMotif({ key: cMajor, bars: 2, contour: 'arch', seed: 7 });
    const b = generateMotif({ key: cMajor, bars: 2, contour: 'arch', seed: 7 });
    expect(a).toEqual(b);
  });

  it('produces in-scale pitches for every contour', () => {
    for (const contour of ['arch', 'ascending', 'descending', 'wave'] as const) {
      const motif = generateMotif({ key: cMajor, bars: 1, contour, seed: 3 });
      for (const note of motif.notes) {
        expect([0, 2, 4, 5, 7, 9, 11]).toContain(pitchClass(note.pitch));
      }
    }
  });

  it('snaps downbeat notes to chord tones when a chord is given', () => {
    const chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] } as const;
    const motif = generateMotif({ key: cMajor, chord, bars: 1, contour: 'ascending', seed: 1 });
    const first = motif.notes[0];
    expect(first && chordPitchClasses(chord).includes(pitchClass(first.pitch))).toBe(true);
  });
});

describe('developMotif', () => {
  it('snaps non-chord tones to the active segment chord tones', () => {
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
    const developed = developMotif(source, timeline, cMajor, 2);
    for (const note of developed.notes) {
      const chord = timeline.at(note.startBeat);
      if (!chord) {
        throw new Error('expected a chord for every developed note');
      }
      expect(chordPitchClasses(chord)).toContain(pitchClass(note.pitch));
    }
  });
});
