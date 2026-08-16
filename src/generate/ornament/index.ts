/**
 * Ornaments applied to material that already exists.
 *
 * Decoration is not a property of generation: this layer takes notes and gives
 * notes back, the way {@link humanize} does, so a line from any source — a
 * generator, a MIDI import, a caller's own array — can be decorated without
 * being generated again by whichever generator happens to write ghost notes.
 *
 * The decoration is carried as an {@link Articulation}, not baked into extra
 * onsets: a flam is one note marked `'flam'`, so the grace stroke stays the
 * reader's to voice and nothing downstream has to guess which of two onsets was
 * the ornament.
 */

import type { Articulation } from '../../core/instrument/index.js';
import { isStrongBeat, type TimeSignature } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertNoteEvents,
  assertOneOf,
  assertRange,
  assertTimeSignature,
  dropSilentNotes,
} from '../../core/validation/index.js';
import {
  type GenerationContextInput,
  resolveContextWith,
  sustainsStrokes,
} from '../context/index.js';

/**
 * Every ornament idiom, in declaration order.
 *
 * @category Composition
 */
export const ORNAMENT_STYLES = Object.freeze(['ghost', 'flam', 'drag', 'slide', 'accent'] as const);

/**
 * The kind of ornament to apply.
 *
 * - `'ghost'`: soften weak-position notes into ghosted strokes.
 * - `'flam'`: mark accented notes as flammed — the strong positions `'accent'`
 *   also takes, voiced as a grace stroke instead of a velocity lift.
 * - `'drag'`: mark notes leading into a strong position as dragged. A weak-position
 *   note qualifies only when the next onset in the material falls on a strong one.
 * - `'slide'`: mark a note reached by a step or a leap as slid into.
 * - `'accent'`: mark strong-position notes as accented, and lift their velocity.
 *
 * @category Composition
 */
export type OrnamentStyle = (typeof ORNAMENT_STYLES)[number];

/**
 * Options controlling {@link ornament}.
 *
 * @category Composition
 */
export type OrnamentOptions = {
  /**
   * The ornament to apply.
   *
   * @defaultValue `'ghost'`
   */
  style?: OrnamentStyle;
  /**
   * How much of the eligible material is decorated, in [0, 1]. Raising it only
   * ornaments more notes; the notes already ornamented keep the ornament they
   * had. Defaults to `complexity.ornament` from the context, or 0.5.
   */
  amount?: number;
  /**
   * Seed for the deterministic choice of which notes are decorated. Sugar for
   * `ctx: { seed }`.
   *
   * @defaultValue 0
   */
  seed?: number;
  /**
   * Time signature, used to tell strong positions from weak ones.
   *
   * @defaultValue 4/4
   */
  ts?: TimeSignature;
  /**
   * The generation context. Its `complexity.ornament` sets the amount, and its
   * `complexity.difficulty` — with a tempo — keeps ornaments off passages too
   * fast to play them in.
   */
  ctx?: GenerationContextInput;
};

const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_STYLE: OrnamentStyle = 'ghost';
const DEFAULT_AMOUNT = 0.5;
/** Velocity a ghosted stroke keeps, as a fraction of what it had. */
const GHOST_VELOCITY_SCALE = 0.45;
/** Velocity an accent adds, in MIDI units. */
const ACCENT_VELOCITY_BOOST = 12;
/** Velocity assumed for a note that carries none. */
const DEFAULT_VELOCITY = 80;
const MIN_VELOCITY = 1;
const MAX_VELOCITY = 127;
/** Interval, in semitones, from which a move reads as slid into rather than fingered. */
const SLIDE_MIN_SEMITONES = 2;

/** Whether a note is a candidate for an ornament of this style. */
function eligible(
  style: OrnamentStyle,
  note: NoteEvent,
  previous: NoteEvent | undefined,
  next: NoteEvent | undefined,
  ts: TimeSignature,
): boolean {
  const strong = isStrongBeat(note.startBeat, ts);
  switch (style) {
    case 'ghost':
      return !strong;
    case 'flam':
    case 'accent':
      return strong;
    case 'drag':
      // A drag leads somewhere: it is the weak note before a strong one, so the
      // next onset in the material has to be the strong position it runs into.
      return !strong && next !== undefined && isStrongBeat(next.startBeat, ts);
    case 'slide':
      return previous !== undefined && Math.abs(note.pitch - previous.pitch) >= SLIDE_MIN_SEMITONES;
  }
}

/** The articulation a style writes. */
function articulationOf(style: OrnamentStyle): Articulation {
  return style;
}

/** Velocity after an ornament, or the note's own where the ornament changes none. */
function ornamentedVelocity(style: OrnamentStyle, note: NoteEvent): number | undefined {
  if (note.velocity === undefined && style !== 'ghost' && style !== 'accent') {
    return undefined;
  }
  const velocity = note.velocity ?? DEFAULT_VELOCITY;
  if (style === 'ghost') {
    return clampVelocity(velocity * GHOST_VELOCITY_SCALE);
  }
  if (style === 'accent') {
    return clampVelocity(velocity + ACCENT_VELOCITY_BOOST);
  }
  return velocity;
}

function clampVelocity(velocity: number): number {
  return Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, Math.round(velocity)));
}

/**
 * Decorate existing notes with an ornament.
 *
 * Which notes are eligible follows from the style and the meter — ghosts fall on
 * weak positions, drags on the weak position before a strong one, flams and
 * accents on strong ones, slides on notes reached by a leap — and `amount`
 * decides how many of those eligible notes are taken. The choice is addressed by
 * each note's own position, so raising `amount` adds ornaments without moving the
 * ones already there, and no onset is ever added or shifted: a decorated note is
 * the same note carrying an {@link Articulation}. A note that already carries one
 * is left alone, so ornament passes can be layered.
 *
 * With a difficulty ceiling and a tempo in the context, a passage whose strokes
 * come too fast for that ceiling is left plain — the ornament is exactly the
 * kind of candidate a ceiling exists to reject.
 *
 * @param notes The material to decorate.
 * @param opts Style, amount, seed, meter, and context.
 * @returns Copies of the sounding notes, in input order, with ornaments applied.
 * @example
 * ```ts
 * import { generateBassLine, majorKey, makeChord, ornament } from '@libraz/libcantus';
 * const line = generateBassLine({
 *   segments: [{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') }],
 *   key: majorKey(0),
 *   style: 'pop',
 * });
 * ornament(line, { style: 'ghost', amount: 0.4, seed: 3 });
 * ```
 * Notes with a zero or negative duration never sound and are dropped, so the
 * result can be shorter than the input.
 *
 * @category Composition
 */
export function ornament(notes: readonly NoteEvent[], opts: OrnamentOptions = {}): NoteEvent[] {
  assertNoteEvents(notes, 'ornament notes', { allowNonPositiveDuration: true });
  const style = assertOneOf(opts.style ?? DEFAULT_STYLE, ORNAMENT_STYLES, 'ornament style');
  const ts = opts.ts ?? DEFAULT_TS;
  assertTimeSignature(ts);
  if (opts.amount !== undefined) {
    assertRange(opts.amount, 0, 1, 'ornament amount');
  }
  const ctx = resolveContextWith(opts.ctx, { seed: opts.seed, ornament: opts.amount });
  const amount = ctx.ornament ?? DEFAULT_AMOUNT;
  const draw = ctx.part('ornament');

  // Zero-length artefacts are routine in MIDI imports and never sound, so they
  // are accepted and dropped here, exactly as humanize and the analysis layer do.
  const sounding = dropSilentNotes(notes);
  const ordered = [...sounding].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const previousOf = new Map<NoteEvent, NoteEvent | undefined>();
  for (let index = 0; index < ordered.length; index += 1) {
    const note = ordered[index];
    if (note) {
      previousOf.set(note, index === 0 ? undefined : ordered[index - 1]);
    }
  }
  const nextOf = nextOnsets(ordered);
  const gaps = strokeGaps(ordered);

  return sounding.map((note) => {
    const decorated: NoteEvent = { ...note };
    if (
      note.articulation !== undefined ||
      !eligible(style, note, previousOf.get(note), nextOf.get(note), ts)
    ) {
      return decorated;
    }
    // The ceiling only ever rejects: an ornament this fast is a candidate the
    // player at that level would not take.
    if (!sustainsStrokes(gaps.get(note) ?? Number.POSITIVE_INFINITY, ctx.bpm, ctx.difficulty)) {
      return decorated;
    }
    if (!draw.prob(amount, style, note.startBeat, note.pitch)) {
      return decorated;
    }
    decorated.articulation = articulationOf(style);
    const velocity = ornamentedVelocity(style, note);
    if (velocity !== undefined) {
      decorated.velocity = velocity;
    }
    return decorated;
  });
}

/**
 * The first note of the next onset after each note.
 *
 * The next onset rather than the next note: the notes of a chord share a
 * position and say nothing about where the line is heading.
 */
function nextOnsets(ordered: readonly NoteEvent[]): Map<NoteEvent, NoteEvent | undefined> {
  const nextOf = new Map<NoteEvent, NoteEvent | undefined>();
  let later: NoteEvent | undefined;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const note = ordered[index];
    if (!note) continue;
    if (later !== undefined && later.startBeat === note.startBeat) {
      nextOf.set(note, nextOf.get(later));
    } else {
      nextOf.set(note, later);
    }
    later = note;
  }
  return nextOf;
}

/**
 * The tightest gap around each onset, in beats.
 *
 * Both neighbours count: a stroke is hard to place because of how close it sits
 * to the one before it as much as the one after, and reading only the following
 * onset would let the last note of a fast passage pass as unhurried.
 */
function strokeGaps(ordered: readonly NoteEvent[]): Map<NoteEvent, number> {
  const distinct = [...new Set(ordered.map((note) => note.startBeat))].sort((a, b) => a - b);
  const gapAt = new Map<number, number>();
  for (let index = 0; index < distinct.length; index += 1) {
    const beat = distinct[index] ?? 0;
    const before = index === 0 ? Number.POSITIVE_INFINITY : beat - (distinct[index - 1] ?? 0);
    const after =
      index === distinct.length - 1 ? Number.POSITIVE_INFINITY : (distinct[index + 1] ?? 0) - beat;
    gapAt.set(beat, Math.min(before, after));
  }
  const gaps = new Map<NoteEvent, number>();
  for (const note of ordered) {
    gaps.set(note, gapAt.get(note.startBeat) ?? Number.POSITIVE_INFINITY);
  }
  return gaps;
}
