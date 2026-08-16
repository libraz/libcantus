import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { KeyScale } from '../src/core/types.js';
import { imitate } from '../src/generate/countermelody/index.js';
import {
  generateMotif,
  type MotifCell,
  type MotifTransform,
  motifToNoteEvents,
  transformMotif,
} from '../src/generate/motif/index.js';
import {
  isScaleTone,
  majorKey,
  minorKey,
  nearestScaleTone,
  scaleByName,
  scaleLadderPosition,
  shiftByScaleDegrees,
} from '../src/theory/scale/index.js';

/** Quarter notes from beat 0. */
function cell(pitches: readonly number[]): MotifCell {
  return {
    notes: pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 })),
  };
}

const CELLS: Record<string, MotifCell> = {
  diatonic: cell([60, 62, 64, 65]),
  // An ascending blues lick: the flat third and flat fifth are the whole point
  // of the figure and are foreign to the major scale it is transformed in.
  blues: cell([60, 63, 64, 66, 67, 70]),
  chromaticNeighbours: cell([60, 61, 60, 59, 60]),
  uneven: {
    notes: [
      { pitch: 61, startBeat: 0, durationBeat: 1.5 },
      { pitch: 66, startBeat: 2, durationBeat: 0.5 },
      { pitch: 68, startBeat: 3.25, durationBeat: 0.75 },
    ],
  },
};

const KEYS: Record<string, KeyScale> = {
  cMajor: majorKey(0),
  aMinor: minorKey(9),
  ebMajor: majorKey(3),
  fSharpMinor: minorKey(6),
  dDorian: scaleByName('dorian', 2),
  cPentatonic: scaleByName('majorPentatonic', 0),
};

/** The transforms that take a shift amount, for which zero has to be no shift. */
const SHIFTS: MotifTransform[] = ['transposeDiatonic', 'transposeChromatic'];

describe('a shift of nothing is the motif itself', () => {
  it.each(SHIFTS)('%s by 0 returns the cell, in every key and for every cell', (transform) => {
    for (const source of Object.values(CELLS)) {
      for (const key of Object.values(KEYS)) {
        expect(transformMotif(source, transform, 0, key)).toEqual(source);
      }
      // The key is optional on both, and leaving it out may not change the
      // identity either.
      expect(transformMotif(source, transform, 0)).toEqual(source);
    }
  });

  it('leaves a chromatic cell alone rather than folding it onto the scale', () => {
    // The failure this pins is silent: a shift of no degrees used to snap every
    // pitch to the key first, so a blues cell came back diatonic.
    const shifted = transformMotif(CELLS.blues as MotifCell, 'transposeDiatonic', 0, KEYS.cMajor);
    expect(shifted.notes.map((n) => n.pitch)).toEqual([60, 63, 64, 66, 67, 70]);
  });

  it('keeps every chromatic note of a sequenced cell in the copy it appends', () => {
    const sequenced = transformMotif(CELLS.blues as MotifCell, 'sequence', 0, KEYS.cMajor);
    const source = (CELLS.blues as MotifCell).notes.map((n) => n.pitch);
    expect(sequenced.notes.map((n) => n.pitch)).toEqual([...source, ...source]);
  });
});

describe('a diatonic shift counts degrees without rewriting the notes', () => {
  it('moves a note between two scale tones to the same place above its new one', () => {
    // C# is a semitone above C, so a step up the C-major ladder puts it a
    // semitone above D. Snapping first would answer D and lose the accidental.
    expect(shiftByScaleDegrees(61, 1, KEYS.cMajor as KeyScale)).toBe(63);
    expect(shiftByScaleDegrees(61, -1, KEYS.cMajor as KeyScale)).toBe(60);
    expect(shiftByScaleDegrees(60, 1, KEYS.cMajor as KeyScale)).toBe(62);
  });

  it('keeps the distance a pitch sounds above the scale tone below it', () => {
    // Stated against the ladder itself: wherever the step it lands in is wide
    // enough to hold the offset, the offset comes through unchanged.
    const key = KEYS.cMajor as KeyScale;
    for (let pitch = 55; pitch <= 79; pitch += 1) {
      const from = scaleLadderPosition(pitch, key);
      for (const degrees of [1, 2, -1, -2]) {
        const landed = scaleLadderPosition(shiftByScaleDegrees(pitch, degrees, key), key);
        if (landed.offset === from.offset) {
          // The offset survived, so the pitch counted exactly the degrees asked.
          expect(landed.rung).toBe(from.rung + degrees);
        } else {
          // The step it landed in was a semitone and had no room for it, so it
          // sits on the scale tone above — never further, and never on the scale
          // tone it would have had if the offset had been thrown away first.
          expect(landed.offset).toBe(0);
          expect(landed.rung).toBe(from.rung + degrees + 1);
        }
      }
    }
  });

  it('returns the pitch untouched for a shift of no degrees, at every pitch and key', () => {
    for (const key of Object.values(KEYS)) {
      for (let pitch = 24; pitch <= 96; pitch += 1) {
        expect(shiftByScaleDegrees(pitch, 0, key)).toBe(pitch);
      }
    }
  });

  it('undoes a shift of n degrees with a shift of -n, for a cell of scale tones', () => {
    // Counting degrees is exact on the ladder itself. A pitch between two rungs
    // keeps its distance above the lower one, which the scale has room for only
    // where the step it lands in is wide enough — a whole tone away from a
    // semitone step, a degree shift moves it onto a scale tone and the way back
    // is no longer the way it came. That is a property of counting degrees on an
    // uneven ladder, not of this transform.
    for (const key of Object.values(KEYS)) {
      const source = cell([60, 62, 64, 65].map((pitch) => nearestScaleTone(pitch, key)));
      for (const degrees of [1, 2, 3, 4, 7, -1, -2, -5]) {
        const there = transformMotif(source, 'transposeDiatonic', degrees, key);
        const back = transformMotif(there, 'transposeDiatonic', -degrees, key);
        expect(back).toEqual(source);
      }
    }
  });

  it('carries a blues cell through a shift as a blues cell', () => {
    // Every accidental of the figure is still an accidental afterwards: the
    // flat third and flat fifth are what the lick is, and a shift that filed
    // them onto the scale would return a different tune.
    const key = KEYS.cMajor as KeyScale;
    const shifted = transformMotif(CELLS.blues as MotifCell, 'transposeDiatonic', 2, key);
    expect(shifted.notes.map((n) => n.pitch)).toEqual([64, 66, 67, 70, 71, 73]);
    const chromatic = (motif: MotifCell) =>
      motif.notes.filter((n) => !isScaleTone(n.pitch, key)).length;
    expect(chromatic(shifted)).toBe(chromatic(CELLS.blues as MotifCell));
  });

  it('leaves timing untouched whatever the shift', () => {
    for (const degrees of [0, 1, -2, 5]) {
      const shifted = transformMotif(
        CELLS.uneven as MotifCell,
        'transposeDiatonic',
        degrees,
        KEYS.cMajor,
      );
      expect(shifted.notes.map((n) => [n.startBeat, n.durationBeat])).toEqual(
        (CELLS.uneven as MotifCell).notes.map((n) => [n.startBeat, n.durationBeat]),
      );
    }
  });
});

describe('a diatonic shift is one shift, wherever it is asked for', () => {
  // The motif transform and a tonal imitation both move a line by scale
  // degrees. Asserted through what they return rather than through what they
  // call, so the two stay answerable to the same contract however either is
  // written: a chromatic note keeps its distance above the scale tone below it
  // on both paths, at every degree count and in every key.
  const INTERVALS = ['M2', 'M3', 'P4', 'P5', 'M6', 'M7', 'P8'] as const;

  it.each(INTERVALS.map((interval, index) => [index + 1, interval] as const))(
    'answers a subject %s degrees up as the transform shifts it (%s)',
    (degrees, interval) => {
      for (const key of Object.values(KEYS)) {
        for (const source of Object.values(CELLS)) {
          const shifted = transformMotif(source, 'transposeDiatonic', degrees, key);
          const answered = imitate(motifToNoteEvents(source), {
            atBeat: source.notes[0]?.startBeat ?? 0,
            interval,
            key,
            answer: 'tonal',
          });
          expect(answered.map((n) => n.pitch)).toEqual(shifted.notes.map((n) => n.pitch));
        }
      }
    },
  );

  it.each(INTERVALS.map((interval, index) => [-(index + 1), `-${interval}`] as const))(
    'answers a subject %s degrees down as the transform shifts it (%s)',
    (degrees, interval) => {
      for (const key of Object.values(KEYS)) {
        for (const source of Object.values(CELLS)) {
          const shifted = transformMotif(source, 'transposeDiatonic', degrees, key);
          const answered = imitate(motifToNoteEvents(source), {
            atBeat: source.notes[0]?.startBeat ?? 0,
            interval,
            key,
            answer: 'tonal',
          });
          expect(answered.map((n) => n.pitch)).toEqual(shifted.notes.map((n) => n.pitch));
        }
      }
    },
  );

  it('answers a subject at the unison exactly as it stands', () => {
    for (const key of Object.values(KEYS)) {
      for (const source of Object.values(CELLS)) {
        const answered = imitate(motifToNoteEvents(source), {
          atBeat: source.notes[0]?.startBeat ?? 0,
          interval: 'P1',
          key,
          answer: 'tonal',
        });
        expect(answered.map((n) => n.pitch)).toEqual(source.notes.map((n) => n.pitch));
      }
    }
  });
});

describe('the jitter sugar and the dial it stands for take the same values', () => {
  const key = majorKey(0);
  const accepted = [0, 0.25, 1];
  const rejected = [-0.5, 1.5, 5, Number.NaN, Number.POSITIVE_INFINITY];

  it.each(accepted)('accepts %s through both spellings, with the same result', (jitter) => {
    const sugar = generateMotif({ key, bars: 2, jitter });
    const context = generateMotif({ key, bars: 2, ctx: { complexity: { ornament: jitter } } });
    expect(sugar).toEqual(context);
  });

  it.each(rejected)('rejects %s through both spellings', (jitter) => {
    expect(() => generateMotif({ key, bars: 2, jitter })).toThrow(InvalidInputError);
    expect(() =>
      generateMotif({ key, bars: 2, ctx: { complexity: { ornament: jitter } } }),
    ).toThrow(InvalidInputError);
  });
});

describe('every contour is written at every length', () => {
  // A one-turn wave is a short wave, not an input error: the generator writes
  // what was asked for at every length it accepts, and the length at which an
  // analysis can tell a wave from an arch is a fact about reading a line back,
  // stated where the contour vocabulary is documented.
  it.each(['arch', 'ascending', 'descending', 'wave'] as const)(
    'writes a %s cell for one bar as readily as for four',
    (contour) => {
      for (const bars of [1, 2, 3, 4]) {
        const motif = generateMotif({ key: majorKey(0), bars, contour });
        expect(motif.notes.length).toBe(Math.max(3, bars * 2));
      }
    },
  );
});
