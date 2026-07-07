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
    // Rest preserved: the pitches are mirrored, not packed together.
    expect(once.notes.map((n) => ({ ...n }))).toEqual([
      { pitch: 60, startBeat: 2, durationBeat: 1 },
      { pitch: 64, startBeat: 0, durationBeat: 1 },
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
    expect(augmented.notes.map((n) => n.startBeat)).toEqual([4, 0]);
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
      seed: 5,
    }).notes.map((n) => n.pitch);
    expect(pitches).toEqual([60, 62, 64]);
    for (let i = 1; i < pitches.length; i += 1) {
      expect(pitches[i]).toBeGreaterThan(pitches[i - 1] ?? Number.NEGATIVE_INFINITY);
    }
  });

  it('ignores the seed while jitter is off (contour is seed-independent)', () => {
    const a = generateMotif({ key: cMajor, bars: 2, contour: 'wave', seed: 1 });
    const b = generateMotif({ key: cMajor, bars: 2, contour: 'wave', seed: 999 });
    expect(a).toEqual(b);
  });

  it('applies opt-in jitter deterministically per seed', () => {
    const withJitter = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'ascending',
      jitter: 1,
      seed: 4,
    });
    const again = generateMotif({
      key: cMajor,
      bars: 2,
      contour: 'ascending',
      jitter: 1,
      seed: 4,
    });
    expect(withJitter).toEqual(again);
    // Enabling jitter perturbs the plain contour.
    const plain = generateMotif({ key: cMajor, bars: 2, contour: 'ascending', seed: 4 });
    expect(withJitter).not.toEqual(plain);
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

  it('terminates quickly for a degenerate tiny-span cell', () => {
    const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 4);
    const tiny: MotifCell = { notes: [{ pitch: 60, startBeat: 0, durationBeat: 1e-9 }] };
    const startedAt = Date.now();
    const developed = developMotif(tiny, timeline, cMajor, 1);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(developed.notes.length).toBeGreaterThan(0);
  });
});
