import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { createRng } from '../../core/random/index.js';
import type { KeyScale } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertInteger,
  assertNoteEvents,
  assertPositiveInt,
} from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import { isScaleTone, nearestScaleTone } from '../../theory/scale/index.js';

/**
 * A transformation applicable to a motif cell.
 *
 * @category Composition
 */
export type MotifTransform =
  | 'transposeDiatonic'
  | 'transposeChromatic'
  | 'invert'
  | 'retrograde'
  | 'augment'
  | 'diminish'
  | 'sequence';

/**
 * A single note within a motif cell.
 *
 * @category Composition
 */
export type MotifNote = {
  pitch: number;
  startBeat: number;
  durationBeat: number;
};

/**
 * A short melodic cell.
 *
 * @category Composition
 */
export type MotifCell = {
  notes: MotifNote[];
};

/**
 * Melodic contour shape for {@link generateMotif}.
 *
 * @category Composition
 */
export type MotifContour = 'arch' | 'ascending' | 'descending' | 'wave';

/**
 * Options controlling {@link generateMotif}.
 *
 * @category Composition
 */
export type MotifOptions = {
  key: KeyScale;
  chord?: Chord | null;
  bars: number;
  /**
   * Melodic contour shape the line follows.
   *
   * @defaultValue `'arch'`
   */
  contour?: MotifContour;
  /**
   * Probability in [0, 1] that a note is nudged by a single diatonic step. The
   * nudge direction is balanced (up or down with equal odds), so it adds
   * variety without biasing the line off its contour. Default 0, which
   * reproduces the requested contour exactly (no drift, tails return to tonic).
   *
   * @defaultValue 0
   */
  jitter?: number;
  /**
   * Seed for the deterministic PRNG.
   *
   * @defaultValue 0
   */
  seed?: number;
};

function pitchClass(pitch: number): number {
  return ((Math.trunc(pitch) % 12) + 12) % 12;
}

/**
 * Smallest span, in beats, treated as a distinct tile step. A positive but
 * near-zero cell span is clamped to this so tiling cannot stall.
 */
const MIN_TILE_SPAN = 1 / 256;

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
  let origin = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    origin = Math.min(origin, note.startBeat);
  }
  return Number.isFinite(origin) ? origin : 0;
}

/** Latest offset in a cell, without spreading an unbounded caller array. */
function cellEnd(notes: MotifNote[]): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    end = Math.max(end, note.startBeat + note.durationBeat);
  }
  return Number.isFinite(end) ? end : 0;
}

/** Total beat span covered by a cell (from first onset to last offset). */
function cellSpan(cell: MotifCell): number {
  if (cell.notes.length === 0) {
    return 0;
  }
  const start = cellOrigin(cell.notes);
  const end = cellEnd(cell.notes);
  return end - start;
}

function clone(cell: MotifCell): MotifCell {
  return { notes: cell.notes.map((n) => ({ ...n })) };
}

/** Diatonic scale-degree offsets shaping a contour of `count` notes. */
function contourOffsets(contour: MotifContour, count: number): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    switch (contour) {
      case 'ascending':
        offsets.push(i);
        break;
      case 'descending':
        offsets.push(-i);
        break;
      case 'arch':
        // Symmetric rise-and-fall: a palindrome that starts and ends on the
        // tonic (offset 0) for both odd and even lengths.
        offsets.push(Math.min(i, count - 1 - i));
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
 * are pulled to the nearest chord tone. An optional `jitter` adds balanced
 * per-note variation without biasing the contour; it is off by default, so the
 * contour is reproduced exactly. Output is deterministic for a given seed.
 *
 * @param opts Key, optional chord, length, contour, jitter, and seed.
 * @returns The generated motif cell.
 *
 * @example
 * ```ts
 * import { generateMotif, majorKey } from '@libraz/libcantus';
 * const cell = generateMotif({ key: majorKey(0), bars: 2, contour: 'arch' });
 * // cell.notes is a deterministic MotifCell (seed defaults to 0)
 * ```
 *
 * @category Composition
 */
export function generateMotif(opts: MotifOptions): MotifCell {
  const contour = opts.contour ?? 'arch';
  const bars = assertPositiveInt(opts.bars, 'motif bars');
  const totalBeats = bars * 4;
  const noteCount = Math.max(3, bars * 2);
  assertGenerationBudget(noteCount, 'motif notes');
  const beatsPerNote = totalBeats / noteCount;
  const rng = createRng(opts.seed ?? 0);
  const requestedJitter = assertFiniteNumber(opts.jitter ?? 0, 'motif jitter');
  const jitterProb = Math.min(1, Math.max(0, requestedJitter));
  const tonic = pitchClass(opts.key.rootPc) + 60;
  const offsets = contourOffsets(contour, noteCount);

  const notes: MotifNote[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    // Opt-in, direction-balanced jitter: disabled by default so the contour is
    // preserved exactly. When enabled it nudges up or down with equal odds,
    // avoiding the upward bias that used to drift arch/wave tails off the tonic.
    let jitter = 0;
    if (jitterProb > 0 && rng.next() < jitterProb) {
      jitter = rng.next() < 0.5 ? 1 : -1;
    }
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
 * `amount` scale degrees when a `key` is given, or — with no `key` — falls back
 * to a chromatic shift of `amount` semitones; `sequence` appends a shifted copy
 * (by `amount` diatonic degrees with a `key`, or by `amount` semitones without
 * one, since it delegates to `transposeDiatonic`).
 *
 * @param cell The cell to transform.
 * @param t The transformation.
 * @param amount Optional parameter (semitones, degrees, or time factor).
 * @param key Key context for the diatonic transforms; without it,
 *   `transposeDiatonic` and `sequence` shift chromatically by semitones.
 * @returns The transformed cell.
 *
 * @example
 * ```ts
 * import { generateMotif, transformMotif, majorKey } from '@libraz/libcantus';
 * const cell = generateMotif({ key: majorKey(0), bars: 1 });
 * const inverted = transformMotif(cell, 'invert');
 * ```
 *
 * @category Composition
 */
export function transformMotif(
  cell: MotifCell,
  t: MotifTransform,
  amount?: number,
  key?: KeyScale,
): MotifCell {
  assertNoteEvents(cell.notes, 'motif notes');
  if (amount !== undefined) {
    assertFiniteNumber(amount, 'motif transform amount');
  }
  if ((t === 'transposeDiatonic' || t === 'sequence') && amount !== undefined) {
    assertInteger(amount, 'diatonic transform amount');
  }
  if ((t === 'augment' || t === 'diminish') && amount !== undefined && amount <= 0) {
    throw new RangeError('time transform amount must be positive');
  }
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
          // With a key, shift by scale degrees; without one, fall back to a
          // chromatic shift of `degrees` semitones.
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
      const end = cellEnd(notes);
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
      // Delegates to transposeDiatonic: a diatonic shift when `key` is given,
      // otherwise a chromatic shift of `degrees` semitones.
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
 *
 * @example
 * ```ts
 * import { chordTimelineFromChords, developMotif, generateMotif, majorKey } from '@libraz/libcantus';
 * const key = majorKey(0);
 * const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);
 * const developed = developMotif(generateMotif({ key, bars: 1 }), timeline, key, 2);
 * ```
 *
 * @category Composition
 */
export function developMotif(
  cell: MotifCell,
  timeline: ChordTimeline,
  key: KeyScale,
  bars: number,
): MotifCell {
  assertPositiveInt(bars, 'development bars');
  assertNoteEvents(cell.notes, 'motif notes');
  const span = cellSpan(cell);
  const totalBeats = bars * 4;
  const origin = cellOrigin(cell.notes);
  const out: MotifNote[] = [];

  if (span <= 0) {
    return clone(cell);
  }

  // Clamp a degenerate near-zero span so the tile count stays finite, and step
  // the offset multiplicatively so rounding error cannot accumulate over tiles.
  const tileSpan = Math.max(span, MIN_TILE_SPAN);
  const tileCount = Math.ceil(totalBeats / tileSpan);
  assertGenerationBudget(tileCount * cell.notes.length, 'developed motif notes');
  for (let k = 0; k < tileCount; k += 1) {
    const offset = k * tileSpan;
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
