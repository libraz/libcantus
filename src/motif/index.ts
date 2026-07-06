import type { Chord } from '../chord/index.js';
import { chordPitchClasses } from '../chord/index.js';
import { isScaleTone, nearestScaleTone } from '../scale/index.js';
import type { ChordTimeline } from '../timeline/index.js';
import type { KeyScale } from '../types.js';

/** A transformation applicable to a motif cell. */
export type MotifTransform =
  | 'transposeDiatonic'
  | 'transposeChromatic'
  | 'invert'
  | 'retrograde'
  | 'augment'
  | 'diminish'
  | 'sequence';

/** A single note within a motif cell. */
export type MotifNote = {
  pitch: number;
  startBeat: number;
  durationBeat: number;
};

/** A short melodic cell. */
export type MotifCell = {
  notes: MotifNote[];
};

/** Melodic contour shape for {@link generateMotif}. */
export type MotifContour = 'arch' | 'ascending' | 'descending' | 'wave';

/** Options controlling {@link generateMotif}. */
export type GenerateMotifOptions = {
  key: KeyScale;
  chord?: Chord | null;
  bars: number;
  contour?: MotifContour;
  seed?: number;
};

function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/** Nearest in-scale pitch strictly above `pitch`. */
function upScaleTone(pitch: number, key: KeyScale): number {
  for (let d = 1; d <= 12; d += 1) {
    if (isScaleTone(pitch + d, key)) {
      return pitch + d;
    }
  }
  return pitch + 12;
}

/** Nearest in-scale pitch strictly below `pitch`. */
function downScaleTone(pitch: number, key: KeyScale): number {
  for (let d = 1; d <= 12; d += 1) {
    if (isScaleTone(pitch - d, key)) {
      return pitch - d;
    }
  }
  return pitch - 12;
}

/** Shift a pitch by a number of diatonic scale degrees. */
function stepDiatonic(pitch: number, degrees: number, key: KeyScale): number {
  let p = nearestScaleTone(pitch, key);
  const steps = Math.abs(Math.trunc(degrees));
  for (let i = 0; i < steps; i += 1) {
    p = degrees >= 0 ? upScaleTone(p, key) : downScaleTone(p, key);
  }
  return p;
}

/** Nearest chord tone to `pitch`, preferring the lower pitch on a tie. */
function nearestChordTone(pitch: number, chord: Chord): number {
  const pcs = chordPitchClasses(chord);
  for (let d = 0; d <= 12; d += 1) {
    if (pcs.includes(pitchClass(pitch - d))) {
      return pitch - d;
    }
    if (pcs.includes(pitchClass(pitch + d))) {
      return pitch + d;
    }
  }
  return pitch;
}

/** Earliest onset in a cell; the time origin for timing transforms. */
function cellOrigin(notes: MotifNote[]): number {
  return notes.length === 0 ? 0 : Math.min(...notes.map((n) => n.startBeat));
}

/** Total beat span covered by a cell (from first onset to last offset). */
function cellSpan(cell: MotifCell): number {
  if (cell.notes.length === 0) {
    return 0;
  }
  const start = cellOrigin(cell.notes);
  const end = Math.max(...cell.notes.map((n) => n.startBeat + n.durationBeat));
  return end - start;
}

function clone(cell: MotifCell): MotifCell {
  return { notes: cell.notes.map((n) => ({ ...n })) };
}

/** Deterministic 32-bit PRNG in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Diatonic scale-degree offsets shaping a contour of `count` notes. */
function contourOffsets(contour: MotifContour, count: number): number[] {
  const offsets: number[] = [];
  const half = Math.floor(count / 2);
  for (let i = 0; i < count; i += 1) {
    switch (contour) {
      case 'ascending':
        offsets.push(i);
        break;
      case 'descending':
        offsets.push(-i);
        break;
      case 'arch':
        offsets.push(i <= half ? i : count - 1 - i);
        break;
      case 'wave':
        offsets.push([0, 1, 0, -1][i % 4] ?? 0);
        break;
    }
  }
  return offsets;
}

/**
 * Generate a short seed motif over `bars`.
 *
 * The melody follows the requested contour in diatonic steps from the tonic,
 * snapped to the key. When a chord is supplied, notes landing on bar downbeats
 * are pulled to the nearest chord tone. Output is deterministic for a given seed.
 *
 * @param opts Key, optional chord, length, contour, and seed.
 * @returns The generated motif cell.
 */
export function generateMotif(opts: GenerateMotifOptions): MotifCell {
  const contour = opts.contour ?? 'arch';
  const bars = Math.max(1, Math.trunc(opts.bars));
  const totalBeats = bars * 4;
  const noteCount = Math.max(3, bars * 2);
  const beatsPerNote = totalBeats / noteCount;
  const rng = mulberry32(opts.seed ?? 0);
  const tonic = pitchClass(opts.key.rootPc) + 60;
  const offsets = contourOffsets(contour, noteCount);

  const notes: MotifNote[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    const jitter = rng() < 0.25 ? 1 : 0;
    let pitch = stepDiatonic(tonic, (offsets[i] ?? 0) + jitter, opts.key);
    const startBeat = i * beatsPerNote;
    if (opts.chord && startBeat % 4 === 0) {
      pitch = nearestChordTone(pitch, opts.chord);
    }
    notes.push({ pitch, startBeat, durationBeat: beatsPerNote });
  }
  return { notes };
}

/**
 * Apply a transformation to a motif cell.
 *
 * `invert` reflects pitches about the first note (chromatic, self-inverse);
 * `retrograde` mirrors onsets about the cell span, preserving rests (self-inverse);
 * `augment`/`diminish` scale time by `amount ?? 2` and its reciprocal;
 * `transposeChromatic` adds `amount` semitones; `transposeDiatonic` shifts by
 * `amount` scale degrees; `sequence` appends a diatonically shifted copy.
 *
 * @param cell The cell to transform.
 * @param t The transformation.
 * @param amount Optional parameter (semitones, degrees, or time factor).
 * @param key Key context required by the diatonic transforms.
 * @returns The transformed cell.
 */
export function transformMotif(
  cell: MotifCell,
  t: MotifTransform,
  amount?: number,
  key?: KeyScale,
): MotifCell {
  const notes = cell.notes;
  switch (t) {
    case 'transposeChromatic': {
      const semis = amount ?? 0;
      return { notes: notes.map((n) => ({ ...n, pitch: n.pitch + semis })) };
    }
    case 'transposeDiatonic': {
      const degrees = amount ?? 1;
      return {
        notes: notes.map((n) => ({
          ...n,
          pitch: key ? stepDiatonic(n.pitch, degrees, key) : n.pitch + degrees,
        })),
      };
    }
    case 'invert': {
      const pivot = notes[0]?.pitch ?? 0;
      return { notes: notes.map((n) => ({ ...n, pitch: 2 * pivot - n.pitch })) };
    }
    case 'retrograde': {
      if (notes.length === 0) {
        return { notes: [] };
      }
      const start = cellOrigin(notes);
      const end = Math.max(...notes.map((n) => n.startBeat + n.durationBeat));
      return {
        notes: notes.map((n) => ({
          pitch: n.pitch,
          startBeat: start + (end - (n.startBeat + n.durationBeat)),
          durationBeat: n.durationBeat,
        })),
      };
    }
    case 'augment':
      return scaleTime(cell, amount ?? 2);
    case 'diminish':
      return scaleTime(cell, 1 / (amount ?? 2));
    case 'sequence': {
      const degrees = amount ?? 2;
      const span = cellSpan(cell);
      const copy = transformMotif(cell, 'transposeDiatonic', degrees, key);
      const shifted = copy.notes.map((n) => ({ ...n, startBeat: n.startBeat + span }));
      return { notes: [...clone(cell).notes, ...shifted] };
    }
  }
}

/** Scale a cell's timing about its origin by `factor`. */
function scaleTime(cell: MotifCell, factor: number): MotifCell {
  const origin = cellOrigin(cell.notes);
  return {
    notes: cell.notes.map((n) => ({
      pitch: n.pitch,
      startBeat: origin + (n.startBeat - origin) * factor,
      durationBeat: n.durationBeat * factor,
    })),
  };
}

/**
 * Lay a motif across `bars` and snap it to a chord timeline.
 *
 * The cell is tiled back-to-back to fill the requested span; each note is then
 * pulled to the nearest chord tone of the segment sounding at its onset, so the
 * developed line spells the underlying harmony.
 *
 * @param cell The source motif.
 * @param timeline Chord segments to snap against.
 * @param key Key context (used to keep snapped pitches sensible).
 * @param bars Number of four-beat bars to fill.
 * @returns The developed, harmony-aware cell.
 */
export function developMotif(
  cell: MotifCell,
  timeline: ChordTimeline,
  key: KeyScale,
  bars: number,
): MotifCell {
  const span = cellSpan(cell);
  const totalBeats = Math.max(1, Math.trunc(bars)) * 4;
  const origin = cellOrigin(cell.notes);
  const out: MotifNote[] = [];

  if (span <= 0) {
    return clone(cell);
  }

  for (let offset = 0; offset < totalBeats; offset += span) {
    for (const n of cell.notes) {
      const startBeat = offset + (n.startBeat - origin);
      if (startBeat >= totalBeats) {
        continue;
      }
      const chord = timeline.at(startBeat);
      let pitch = n.pitch;
      if (chord) {
        const isMember = chordPitchClasses(chord).includes(pitchClass(pitch));
        pitch = isMember ? pitch : nearestChordTone(pitch, chord);
      } else {
        pitch = nearestScaleTone(pitch, key);
      }
      out.push({ pitch, startBeat, durationBeat: n.durationBeat });
    }
  }
  return { notes: out };
}
