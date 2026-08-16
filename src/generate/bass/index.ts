/**
 * Deterministic bass-line generation over a chord placement.
 *
 * Given a sequence of chord segments and a key, this builds a monophonic bass
 * line in a chosen low register. Several idiomatic styles are supported, from a
 * single held root per segment to a quarter-note walking line that leads by
 * step into each chord change. All pitches are kept in a narrow bass band and
 * consecutive notes move by small intervals; given a seed the output is fully
 * reproducible.
 *
 * Positions and durations are measured in quarter-note beats, matching the
 * library-wide convention.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { foldIntoRange, type StringedProfile } from '../../core/instrument/index.js';
import { isStrongBeat, type TimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  assertRange,
  assertTimeSignature,
  clampToMidi,
} from '../../core/validation/index.js';
import type { ChordSegment } from '../../theory/chord/index.js';
import {
  type Draw,
  type GenerationContextInput,
  resolveContext,
  sustainsShift,
} from '../context/index.js';
import {
  bandFloor,
  bassPcOf,
  beatPositions,
  chordTonePcs,
  EPS,
  fifthPcOf,
  approachNote as neighborOf,
  placePc,
  STRONG_VELOCITY,
  WEAK_VELOCITY,
} from './internal.js';

export type {
  BassLick,
  LickMaterial,
  LickNote,
  PlaceLicksOptions,
} from './licks.js';
export { BASS_LICKS, isLickMaterial, placeLicks } from './licks.js';

/**
 * A chord sounding over a half-open beat span `[startBeat, endBeat)`.
 *
 * The same record {@link ChordSegment} names, so a timeline segment can be fed
 * straight to the bass generator.
 *
 * @category Composition
 */
export type BassSegment = ChordSegment;

/**
 * Every bass-line idiom, in declaration order.
 *
 * @category Composition
 */
export const BASS_STYLES = Object.freeze([
  'root',
  'rootFifth',
  'pop',
  'walking',
  'arpeggio',
] as const);

/**
 * The bass-line idiom to generate.
 *
 * @category Composition
 */
export type BassStyle = (typeof BASS_STYLES)[number];

/**
 * Options controlling {@link generateBassLine}.
 *
 * @category Composition
 */
export type BassLineOptions = {
  /** Chord placement to follow; need not be pre-sorted. */
  segments: readonly BassSegment[];
  /** Key/scale context, used for diatonic approach tones in `walking`. */
  key: KeyScale;
  /**
   * Time signature; used for metric accents.
   *
   * @defaultValue `{ numerator: 4, denominator: 4 }`
   */
  ts?: TimeSignature;
  /**
   * Bass-line idiom.
   *
   * @defaultValue `'root'`
   */
  style?: BassStyle;
  /**
   * Target register as a base MIDI octave; roots land around `octave*12+12`.
   * An octave pickup in the `pop` style may drop a note into the octave below
   * that band, which is where such a pickup belongs.
   *
   * @defaultValue 2
   */
  octave?: number;
  /**
   * The instrument the line is written for. Giving one is itself the request
   * that the line be playable on it: `octave` then says where in that
   * instrument to aim rather than which absolute band to use, and where the two
   * disagree the instrument wins — a note below the lowest string comes back an
   * octave up, the way a player would take it. Leave it out for a programmed
   * part, which is generated exactly as before.
   */
  instrument?: StringedProfile;
  /**
   * The generation context. Its `complexity.rhythmic` sets how often the `pop`
   * style takes a weak-beat pickup, its `instruments.bass` names the instrument
   * when `instrument` does not, its `bpm` together with
   * `complexity.difficulty` keeps leaps the hand could not make in time out of
   * the line, and its `seed` fixes every deterministic choice the line makes.
   *
   * @defaultValue `{ seed: 0 }`
   */
  ctx?: GenerationContextInput;
  /**
   * Maximum number of segments, and of notes, {@link generateBassLine} may
   * work through. The line is built segment by segment, so this is the guard
   * against an unbounded caller rather than a limit on any search.
   *
   * @defaultValue 1000000
   */
  budget?: number;
};

const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_STYLE: BassStyle = 'root';
const DEFAULT_OCTAVE = 2;

/** How often the `pop` style takes a weak-beat pickup when nothing else says. */
const DEFAULT_PICKUP_DENSITY = 0.35;

type RawNote = { startBeat: number; pitch: number; velocity: number };

/** Working state threaded through the per-segment builders. */
type BuildContext = {
  ts: TimeSignature;
  low: number;
  key: KeyScale;
  /** Position-addressed draws: every decision is keyed by where it happens. */
  draw: Draw;
  notes: RawNote[];
  prevMidi: number;
  instrument: StringedProfile | undefined;
  /** How often a weak beat takes a pickup, in [0, 1]. */
  pickupDensity: number;
  bpm: number | undefined;
  difficulty: number | undefined;
};

/** Append a note for pitch class `pc` at `pos`, placed near the running anchor. */
function emit(ctx: BuildContext, pos: number, pc: number, midiOverride?: number): number {
  const placed = clampToMidi(
    midiOverride ?? placePc(pc, ctx.prevMidi, ctx.low),
    'generated bass pitch',
  );
  // The band already sits inside the instrument, so this catches the placements
  // that deliberately leave it — the pop octave pickup and walking approach
  // notes — rather than transposing the line wholesale.
  const midi = ctx.instrument ? foldIntoRange(placed, ctx.instrument) : placed;
  const velocity = isStrongBeat(pos, ctx.ts) ? STRONG_VELOCITY : WEAK_VELOCITY;
  ctx.notes.push({ startBeat: pos, pitch: midi, velocity });
  return midi;
}

/** One root note per segment. */
function buildRoot(ctx: BuildContext, seg: BassSegment): void {
  ctx.prevMidi = emit(ctx, seg.startBeat, bassPcOf(seg.chord));
}

/** Root on the downbeat, fifth on the segment's midpoint. */
function buildRootFifth(ctx: BuildContext, seg: BassSegment): void {
  ctx.prevMidi = emit(ctx, seg.startBeat, bassPcOf(seg.chord));
  const mid = (seg.startBeat + seg.endBeat) / 2;
  if (mid > seg.startBeat + EPS && mid < seg.endBeat - EPS) {
    ctx.prevMidi = emit(ctx, mid, fifthPcOf(seg.chord));
  }
}

/** Root on every strong beat, with occasional octave/fifth pickups on weak beats. */
function buildPop(ctx: BuildContext, seg: BassSegment, index: number): void {
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  const rootPc = bassPcOf(seg.chord);
  let emitted = false;
  for (const pos of positions) {
    if (isStrongBeat(pos, ctx.ts)) {
      ctx.prevMidi = emit(ctx, pos, rootPc);
      emitted = true;
    } else if (ctx.draw.prob(ctx.pickupDensity, 'pickup', index, pos)) {
      // The octave pickup is a leap, so it is the candidate a difficulty
      // ceiling rejects first: at that tempo the hand does not get there, and
      // the player takes the fifth instead of dropping the pickup.
      if (ctx.draw.prob(0.5, 'pickupKind', index, pos) && reachableLeap(ctx, pos, 12)) {
        // Octave pickup: the root an octave below where it would normally sit.
        // `placePc` already lands inside `[low, low + 12]`, so clamping the drop
        // back into that band would return the band's floor — pitch class 0 —
        // whatever the chord root is. The pickup is allowed the octave below the
        // band instead, and falls back to the plain root when that leaves MIDI.
        const base = placePc(rootPc, ctx.prevMidi, ctx.low);
        const dropped = base - 12;
        emit(ctx, pos, rootPc, dropped >= 0 ? dropped : base);
      } else {
        ctx.prevMidi = emit(ctx, pos, fifthPcOf(seg.chord));
      }
    }
  }
  if (!emitted) {
    ctx.prevMidi = emit(ctx, seg.startBeat, rootPc);
  }
}

/**
 * Whether the hand covers a leap of `semitones` in the time since the last note.
 *
 * Answers true whenever no ceiling or no tempo was given: a limit nobody stated
 * constrains nothing, which is what keeps the programmed case unchanged.
 */
function reachableLeap(ctx: BuildContext, pos: number, semitones: number): boolean {
  const previous = ctx.notes[ctx.notes.length - 1];
  const available = previous === undefined ? Number.POSITIVE_INFINITY : pos - previous.startBeat;
  return sustainsShift(semitones, available, ctx.bpm, ctx.difficulty);
}

/** Cycle root -> third -> fifth (-> seventh) across the segment's beats. */
function buildArpeggio(ctx: BuildContext, seg: BassSegment): void {
  const tones = chordTonePcs(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  positions.forEach((pos, i) => {
    const pc = tones[i % tones.length] ?? bassPcOf(seg.chord);
    ctx.prevMidi = emit(ctx, pos, pc);
  });
}

/**
 * The neighbour a walking line leads into the next chord with.
 *
 * Whether it is the semitone or the scale step is drawn per segment, so the
 * choice is fixed by where in the piece it happens.
 */
function approachNote(ctx: BuildContext, target: number, from: number, index: number): number {
  return neighborOf(target, from, ctx.low, ctx.key, ctx.draw.prob(0.5, 'approach', index));
}

/** A quarter-note line of chord tones that leads by step into each chord change. */
function buildWalking(
  ctx: BuildContext,
  seg: BassSegment,
  next: BassSegment | undefined,
  index: number,
): void {
  const tones = chordTonePcs(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  const count = positions.length;
  positions.forEach((pos, i) => {
    if (i === 0) {
      ctx.prevMidi = emit(ctx, pos, bassPcOf(seg.chord));
      return;
    }
    if (next && count > 1 && i === count - 1) {
      const nextBass = placePc(bassPcOf(next.chord), ctx.prevMidi, ctx.low);
      const midi = approachNote(ctx, nextBass, ctx.prevMidi, index);
      ctx.prevMidi = emit(ctx, pos, pitchClass(midi), midi);
      return;
    }
    const pc = tones[i % tones.length] ?? bassPcOf(seg.chord);
    ctx.prevMidi = emit(ctx, pos, pc);
  });
}

/**
 * Generate a bass line following a chord placement.
 *
 * Each segment contributes notes in the chosen bass register per the selected
 * style; consecutive notes are kept within roughly a fifth. Every note's
 * duration extends to the next onset (the final note extends to the last
 * segment's end). Given a seed the output is fully reproducible.
 *
 * The `pop` style's pickups are drawn per position, so raising
 * `complexity.rhythmic` adds pickups without moving the notes already written.
 *
 * With an `instrument` the line is written for that instrument: the register
 * band is moved into its range and any note still outside comes back an octave,
 * so every pitch has a fret. Nothing is dropped or replaced — the rhythm and
 * the note count are the same either way.
 *
 * @param opts Segments, key, and generation options.
 * @returns Bass notes sorted by onset, non-overlapping.
 *
 * @example
 * ```ts
 * import { generateBassLine, makeChord, majorKey } from '@libraz/libcantus';
 * const segments = [
 *   { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
 *   { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
 * ];
 * const notes = generateBassLine({ segments, key: majorKey(0), style: 'walking' });
 * ```
 *
 * @category Composition
 */
export function generateBassLine(opts: BassLineOptions): NoteEvent[] {
  assertGenerationBudget(opts.segments.length, 'bass segments', opts.budget);
  for (let index = 0; index < opts.segments.length; index += 1) {
    const segment = opts.segments[index];
    if (!segment) continue;
    assertRange(segment.startBeat, 0, Number.MAX_SAFE_INTEGER, `segments[${index}].startBeat`);
    assertRange(segment.endBeat, 0, Number.MAX_SAFE_INTEGER, `segments[${index}].endBeat`);
    if (segment.endBeat <= segment.startBeat) {
      throw new InvalidInputError(`segments[${index}] must have a positive duration`);
    }
  }
  const segments = [...opts.segments].sort((a, b) => a.startBeat - b.startBeat);
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (previous !== undefined && current !== undefined && current.startBeat < previous.endBeat) {
      throw new InvalidInputError(
        `bass segments must not overlap: segments ${index - 1} and ${index} overlap`,
      );
    }
  }
  if (segments.length === 0) {
    return [];
  }

  const ts = opts.ts ?? DEFAULT_TS;
  assertTimeSignature(ts);
  const style = assertOneOf(opts.style ?? DEFAULT_STYLE, BASS_STYLES, 'bass style');
  const octave = opts.octave ?? DEFAULT_OCTAVE;
  // The generated bass band spans `low..low + 12`, so octave 8 is the highest
  // base that can keep every emitted pitch in the MIDI domain.
  assertInteger(octave, 'bass octave', -1, 8);
  const estimatedNotes = segments.reduce(
    (count, segment) => count + Math.max(1, Math.ceil(segment.endBeat - segment.startBeat)),
    0,
  );
  assertGenerationBudget(estimatedNotes, 'bass notes', opts.budget);
  const resolved = resolveContext(opts.ctx);
  const named = resolved.instrument('bass');
  const instrument =
    opts.instrument ?? (named !== undefined && named.kind === 'stringed' ? named : undefined);
  const low = bandFloor(octave * 12 + 12, instrument);

  const ctx: BuildContext = {
    ts,
    low,
    key: opts.key,
    draw: resolved.part('bass'),
    notes: [],
    prevMidi: low,
    instrument,
    pickupDensity: resolved.rhythmic ?? DEFAULT_PICKUP_DENSITY,
    bpm: resolved.bpm,
    difficulty: resolved.difficulty,
  };

  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s];
    if (!seg) {
      continue;
    }
    switch (style) {
      case 'rootFifth':
        buildRootFifth(ctx, seg);
        break;
      case 'pop':
        buildPop(ctx, seg, s);
        break;
      case 'walking':
        buildWalking(ctx, seg, segments[s + 1], s);
        break;
      case 'arpeggio':
        buildArpeggio(ctx, seg);
        break;
      default:
        buildRoot(ctx, seg);
        break;
    }
  }

  ctx.notes.sort((a, b) => a.startBeat - b.startBeat);
  const lastEnd = segments.reduce((m, seg) => Math.max(m, seg.endBeat), Number.NEGATIVE_INFINITY);

  const out: NoteEvent[] = [];
  for (let i = 0; i < ctx.notes.length; i += 1) {
    const note = ctx.notes[i];
    if (!note) {
      continue;
    }
    const nextStart = ctx.notes[i + 1]?.startBeat ?? lastEnd;
    const durationBeat = nextStart - note.startBeat;
    if (durationBeat <= EPS) {
      continue;
    }
    out.push({
      pitch: clampToMidi(note.pitch, 'generated bass pitch'),
      startBeat: note.startBeat,
      durationBeat,
      velocity: note.velocity,
    });
  }
  return out;
}
