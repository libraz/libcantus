import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { InvalidInputError } from '../../core/errors/index.js';
import type { TimeSignature } from '../../core/meter/index.js';
import { beatsPerBar } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertInteger,
  assertNoteEvents,
  assertPositiveInt,
  clampToMidi,
} from '../../core/validation/index.js';
import type { Chord } from '../../theory/chord/index.js';
import { chordPitchClasses } from '../../theory/chord/index.js';
import { isScaleTone, shiftByScaleDegrees } from '../../theory/scale/index.js';
import { type GenerationContextInput, resolveContextWith } from '../context/index.js';

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
  /** Length of the motif in bars of `ts`. */
  bars: number;
  /**
   * Meter the bars are counted in. It sets the bar length, so a motif shares a
   * bar grid with the other generators instead of assuming four beats.
   *
   * @defaultValue 4/4
   */
  ts?: TimeSignature;
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
   * Sugar for `ctx: { complexity: { ornament } }` — a nudge off the contour is
   * decoration rather than rhythm; the context wins where both are given. Being
   * the same dial, it takes the same values: one outside [0, 1] is rejected here
   * exactly as it is there, rather than being folded to the nearest end.
   *
   * @defaultValue 0
   * @throws If it is not a finite number in [0, 1].
   */
  jitter?: number;
  /**
   * The generation context. Its `complexity.ornament` is this generator's
   * jitter, and its `seed` fixes which notes are nudged.
   *
   * @defaultValue `{ seed: 0 }`
   */
  ctx?: GenerationContextInput;
};

/**
 * Smallest span, in beats, treated as a distinct tile step. A positive but
 * near-zero cell span is clamped to this so tiling cannot stall.
 */
const MIN_TILE_SPAN = 1 / 256;

/** Meter assumed when none is supplied. */
const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };

/** Tolerance for beat-position comparisons. */
const EPS = 1e-9;

/** Whether a beat position falls on a bar line of a `barBeats`-long bar. */
function isDownbeat(startBeat: number, barBeats: number): boolean {
  const bar = startBeat / barBeats;
  return Math.abs(bar - Math.round(bar)) < EPS;
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

/** Widest move, in semitones, a developed note is displaced by. */
const MAX_DEVELOP_SHIFT = 12;

/**
 * Pick the pitch a developed note takes.
 *
 * The note moves to the nearest pitch its position allows — a chord tone where
 * the position carries structural weight, any tone of the key elsewhere — and
 * skips a pitch a different note of the same tile already took, so two pitches
 * that differ in the cell still differ in the development. A tie is broken in
 * the direction the melody was already moving, which keeps a step a step
 * instead of folding it back onto the note before it.
 *
 * @param pitch The note's pitch in the cell.
 * @param allows Whether a candidate pitch is one this position may take.
 * @param direction Sign of the melodic motion into the note.
 * @param taken Pitches already placed in this tile, by the cell pitch that took
 *   them.
 * @returns The developed pitch, or `pitch` when the position allows nothing
 *   within reach.
 */
function developedPitch(
  pitch: number,
  allows: (candidate: number) => boolean,
  direction: number,
  taken: Map<number, number>,
): number {
  const ahead = direction >= 0 ? 1 : -1;
  for (let d = 0; d <= MAX_DEVELOP_SHIFT; d += 1) {
    for (const candidate of d === 0 ? [pitch] : [pitch + ahead * d, pitch - ahead * d]) {
      if (candidate < 0 || candidate > 127 || !allows(candidate)) {
        continue;
      }
      const owner = taken.get(candidate);
      if (owner === undefined || owner === pitch) {
        return candidate;
      }
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
 * @param opts Key, optional chord, length, contour, jitter, and context.
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
  const barBeats = beatsPerBar(opts.ts ?? DEFAULT_TS);
  const totalBeats = bars * barBeats;
  const noteCount = Math.max(3, bars * 2);
  assertGenerationBudget(noteCount, 'motif notes');
  const beatsPerNote = totalBeats / noteCount;
  // The dial is handed over as it was given: `jitter` is the sugar for the
  // context's ornament dial, so it has to accept and reject exactly what the
  // context does. Clamping here would make the sugar take a value its own
  // desugared form refuses, which is a different option wearing the same name.
  const ctx = resolveContextWith(opts.ctx, { ornament: opts.jitter });
  const jitterProb = ctx.ornament ?? 0;
  const draw = ctx.part('motif');
  const tonic = pitchClass(opts.key.rootPc) + 60;
  const offsets = contourOffsets(contour, noteCount);

  const notes: MotifNote[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    // Opt-in, direction-balanced jitter: disabled by default so the contour is
    // preserved exactly. When enabled it nudges up or down with equal odds,
    // avoiding the upward bias that used to drift arch/wave tails off the
    // tonic. Each note's draw belongs to its own index, so raising the dial
    // nudges further notes while the ones already nudged keep their nudge.
    let jitter = 0;
    if (draw.prob(jitterProb, 'jitter', i)) {
      jitter = draw.prob(0.5, 'direction', i) ? 1 : -1;
    }
    let pitch = shiftByScaleDegrees(tonic, (offsets[i] ?? 0) + jitter, opts.key);
    const startBeat = i * beatsPerNote;
    if (opts.chord && isDownbeat(startBeat, barBeats)) {
      pitch = nearestChordTone(pitch, opts.chord);
    }
    notes.push({
      pitch: clampToMidi(pitch, 'generated motif pitch'),
      startBeat,
      durationBeat: beatsPerNote,
    });
  }
  return { notes };
}

/**
 * Turn a motif cell into note events.
 *
 * A {@link MotifNote} already carries the {@link NoteEvent} fields, but a cell
 * wraps them in an object; this unwraps it, so a motif can be humanized,
 * grooved, or written out like any other line.
 *
 * @param cell The motif to convert.
 * @returns The cell's notes, copied, in the order they are stored.
 * @example
 * ```ts
 * import { generateMotif, humanize, majorKey, motifToNoteEvents } from '@libraz/libcantus';
 * humanize(motifToNoteEvents(generateMotif({ key: majorKey(0), bars: 2 })));
 * ```
 * @category Composition
 */
export function motifToNoteEvents(cell: MotifCell): NoteEvent[] {
  return cell.notes.map((note) => ({ ...note }));
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
 * @throws If a transformed pitch would fall outside the MIDI range 0..127.
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
  return assertInRange(transformUnchecked(cell, t, amount, key));
}

/**
 * Reject a cell whose pitches have left the MIDI range.
 *
 * Transposing far enough, or inverting about a low pivot, walks a motif off
 * either end of the range. Returning such a note would carry an unplayable
 * pitch through `developMotif` and into whatever consumes the result, so it is
 * a caller error rather than something to clamp — clamping would distort the
 * very intervals the transform exists to preserve.
 */
function assertInRange(cell: MotifCell): MotifCell {
  for (const note of cell.notes) {
    if (note.pitch < 0 || note.pitch > 127) {
      throw new InvalidInputError(
        `transformed motif pitch ${note.pitch} is outside the MIDI range 0..127`,
      );
    }
  }
  return cell;
}

/** The transform itself, before the range check. */
function transformUnchecked(
  cell: MotifCell,
  t: MotifTransform,
  amount?: number,
  key?: KeyScale,
): MotifCell {
  assertNoteEvents(cell.notes, 'motif notes');
  if (amount !== undefined) {
    assertFiniteNumber(amount, 'motif transform amount');
  }
  if (
    (t === 'transposeChromatic' || t === 'transposeDiatonic' || t === 'sequence') &&
    amount !== undefined
  ) {
    assertInteger(
      amount,
      `${t === 'transposeChromatic' ? 'chromatic' : 'diatonic'} transform amount`,
    );
  }
  if ((t === 'augment' || t === 'diminish') && amount !== undefined && amount <= 0) {
    throw new InvalidInputError('time transform amount must be positive');
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
          // chromatic shift of `degrees` semitones. A pitch between two scale
          // tones keeps its distance above the one below it, so the chromatic
          // notes a motif is written with — a blues lick, a semitone neighbour —
          // come through as themselves, and shifting by no degrees returns the
          // cell it was given.
          pitch: key ? shiftByScaleDegrees(n.pitch, degrees, key) : n.pitch + degrees,
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
 * The cell is tiled back-to-back to fill the requested span. Notes that carry
 * structural weight — the head of each tile and every bar line — are pulled to
 * the nearest chord tone of the segment sounding at that onset, so the
 * developed line spells the underlying harmony. The notes between them are kept
 * in the key as passing and neighbour tones, and two pitches that differ in the
 * cell still differ in the development, so the development is still recognizably
 * the motif rather than a chord arpeggiated over the cell's rhythm.
 *
 * @param cell The source motif.
 * @param timeline Chord segments to snap against.
 * @param key Key context; the notes off the structural positions are kept in it.
 * @param bars Number of bars to fill.
 * @param ts Meter the bars are counted in; defaults to 4/4.
 * @returns The developed, harmony-aware cell.
 *
 * @example
 * ```ts
 * import { chordTimelineFromChords, developMotif, generateMotif, majorKey } from '@libraz/libcantus';
 * const key = majorKey(0);
 * const timeline = chordTimelineFromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 8);
 * const developed = developMotif(generateMotif({ key, bars: 1 }), timeline, key, 2);
 * developed.notes.map((n) => n.pitch); // [60, 62, 60, 60, 62, 60] — the C-D-C cell, twice
 * ```
 *
 * @category Composition
 */
export function developMotif(
  cell: MotifCell,
  timeline: ChordTimeline,
  key: KeyScale,
  bars: number,
  ts: TimeSignature = DEFAULT_TS,
): MotifCell {
  assertPositiveInt(bars, 'development bars');
  assertNoteEvents(cell.notes, 'motif notes');
  const span = cellSpan(cell);
  const barBeats = beatsPerBar(ts);
  const totalBeats = bars * barBeats;
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
    // Placed pitch by cell pitch, so a tile cannot fold two of the cell's
    // pitches onto one. It is per tile: each tile is the same cell again, and
    // the same cell pitch under the same harmony wants the same answer.
    const taken = new Map<number, number>();
    let previous: number | undefined;
    for (const n of cell.notes) {
      const startBeat = offset + (n.startBeat - origin);
      if (startBeat >= totalBeats) {
        continue;
      }
      const chord = timeline.at(startBeat);
      // The head of the cell and the bar lines are where the ear reads the
      // harmony; everything else is free to pass between them.
      const structural = n.startBeat === origin || isDownbeat(startBeat, barBeats);
      const chordTones = chord && structural ? chordPitchClasses(chord) : null;
      const allows = chordTones
        ? (candidate: number) => chordTones.includes(pitchClass(candidate))
        : (candidate: number) => isScaleTone(candidate, key);
      const direction = previous === undefined ? 0 : n.pitch - previous;
      const pitch = developedPitch(n.pitch, allows, direction, taken);
      taken.set(pitch, n.pitch);
      previous = n.pitch;
      out.push({ pitch, startBeat, durationBeat: n.durationBeat });
    }
  }
  return { notes: out };
}
