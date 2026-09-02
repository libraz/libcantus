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

import { BEAT_EPS } from '../../analyze/adjacency.js';
import { foldIntoRange, type StringedProfile } from '../../core/instrument/index.js';
import {
  isStrongBeat,
  type MeterLike,
  meterAt,
  type TimeSignature,
  toMeterData,
} from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import {
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  clampToMidi,
} from '../../core/validation/index.js';
import type { ChordSegment } from '../../theory/chord/index.js';
import { type KeyLike, toKeyScale } from '../../theory/scale/index.js';
import { type ChordLike, toChordData } from '../../theory/symbol/index.js';
import {
  type Draw,
  type GenerationContextInput,
  resolveContext,
  sustainsShift,
} from '../context/index.js';
import {
  assertBassSegments,
  barTiles,
  bassPcOf,
  bassRegister,
  bassToneCycle,
  beatPositions,
  DEFAULT_OCTAVE,
  DEFAULT_TS,
  fifthPcOf,
  midBarPulse,
  approachNote as neighborOf,
  placePc,
  placeRoot,
  STRONG_VELOCITY,
  WEAK_VELOCITY,
} from './internal.js';

export type { PlaceLicksOptions } from './licks.js';
export { placeLicks } from './licks.js';
export type { BassLick, LickMaterial, LickNote } from './licks-data.js';
export { BASS_LICKS, isLickMaterial } from './licks-data.js';

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
  /**
   * Chord placement to follow; need not be pre-sorted. Each segment's chord may
   * be written as a chord symbol as well as given as chord data.
   */
  segments: readonly (Omit<BassSegment, 'chord'> & { chord: ChordLike })[];
  /**
   * Key/scale context, used for diatonic approach tones in `walking`. A key
   * name such as `'C major'` is read as that key.
   */
  key: KeyLike;
  /**
   * Time signature; used for metric accents.
   *
   * @defaultValue `{ numerator: 4, denominator: 4 }`
   */
  ts?: MeterLike;
  /**
   * Bass-line idiom.
   *
   * @defaultValue `'root'`
   */
  style?: BassStyle;
  /**
   * Target register as a base MIDI octave; roots land around `octave*12+12`.
   * An octave pickup in the `pop` style may drop a note into the octave below
   * that band, which is where such a pickup belongs, or take the octave above
   * instead on an instrument with nothing below the band to drop into.
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

const DEFAULT_STYLE: BassStyle = 'root';

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
  /**
   * Where the chord being written sounds its bass note. Every pitch of the
   * segment is placed against it rather than against the note before, so the
   * same chord degree over the same chord is the same MIDI note every time that
   * chord comes round.
   */
  rootMidi: number;
  /** The last note emitted, which decides which way an approach note leads. */
  prevMidi: number;
  instrument: StringedProfile | undefined;
  /** How often a weak beat takes a pickup, in [0, 1]. */
  pickupDensity: number;
  bpm: number | undefined;
  difficulty: number | undefined;
};

/**
 * The pitch a placement actually sounds as.
 *
 * The band already sits inside the instrument, so this catches the placements
 * that deliberately leave it — the pop octave pickup and walking approach notes
 * — rather than transposing the line wholesale. It is a function of its own so
 * that a builder choosing between two placements can ask what each of them will
 * sound as: a note is only an octave below the band if the instrument reaches
 * down there, and the choice has to be made about the note that will be heard.
 */
function sounding(ctx: BuildContext, placed: number): number {
  return ctx.instrument ? foldIntoRange(placed, ctx.instrument) : placed;
}

/** Append a note for pitch class `pc` at `pos`, placed against the chord's bass. */
function emit(ctx: BuildContext, pos: number, pc: number, midiOverride?: number): number {
  const placed = clampToMidi(
    midiOverride ?? placePc(pc, ctx.rootMidi, ctx.low),
    'generated bass pitch',
  );
  const midi = sounding(ctx, placed);
  const velocity = isStrongBeat(pos, ctx.ts) ? STRONG_VELOCITY : WEAK_VELOCITY;
  ctx.notes.push({ startBeat: pos, pitch: midi, velocity });
  ctx.prevMidi = midi;
  return midi;
}

/** One root note per segment. */
function buildRoot(ctx: BuildContext, seg: BassSegment): void {
  emit(ctx, seg.startBeat, bassPcOf(seg.chord));
}

/**
 * Root and fifth alternating, once per bar the segment covers.
 *
 * The alternation is the style's name, so it is written against the bar the
 * meter states rather than against the segment's length: a chord held for four
 * bars is played four times, not stretched into a root and a fifth of eight
 * beats each.
 */
function buildRootFifth(ctx: BuildContext, seg: BassSegment): void {
  for (const tile of barTiles(seg.startBeat, seg.endBeat, ctx.ts)) {
    emit(ctx, tile.startBeat, bassPcOf(seg.chord));
    const answer = midBarPulse(tile.startBeat, ctx.ts);
    if (answer > tile.startBeat + BEAT_EPS && answer < tile.endBeat - BEAT_EPS) {
      emit(ctx, answer, fifthPcOf(seg.chord));
    }
  }
}

/** Root on every strong beat, with occasional octave/fifth pickups on weak beats. */
function buildPop(ctx: BuildContext, seg: BassSegment, index: number): void {
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  const rootPc = bassPcOf(seg.chord);
  let emitted = false;
  for (const pos of positions) {
    if (isStrongBeat(pos, ctx.ts)) {
      emit(ctx, pos, rootPc);
      emitted = true;
    } else if (ctx.draw.prob(ctx.pickupDensity, 'pickup', index, pos)) {
      emitted = pickup(ctx, seg, pos, index) || emitted;
    }
  }
  if (!emitted) {
    emit(ctx, seg.startBeat, rootPc);
  }
}

/**
 * The weak-beat pickup a `pop` line leads into the next strong beat with.
 *
 * The octave is the idiom's own figure, so it is asked for first. It is a leap,
 * so it is also the candidate a difficulty ceiling rejects first: at that tempo
 * the hand does not get there, and the player takes the fifth instead of
 * dropping the pickup. The leap is measured against the note actually before
 * it, which sits anywhere in the band, rather than against the octave the
 * figure is named for.
 *
 * The fifth is taken again when the instrument has no octave to give. Where the
 * chord has no fifth of its own that is the root a second time, and rather than
 * repeat the note the beat is left empty: a pickup is an extra note, so not
 * playing it is always available.
 *
 * @returns Whether a note was written.
 */
function pickup(ctx: BuildContext, seg: BassSegment, pos: number, index: number): boolean {
  const octave = octavePickup(ctx);
  if (
    ctx.draw.prob(0.5, 'pickupKind', index, pos) &&
    octave !== undefined &&
    reachableLeap(ctx, pos, Math.abs(sounding(ctx, octave) - ctx.prevMidi))
  ) {
    emit(ctx, pos, bassPcOf(seg.chord), octave);
    return true;
  }
  const fifthPc = fifthPcOf(seg.chord);
  if (sounding(ctx, placePc(fifthPc, ctx.rootMidi, ctx.low)) === sounding(ctx, ctx.rootMidi)) {
    return false;
  }
  emit(ctx, pos, fifthPc);
  return true;
}

/**
 * Where an octave pickup goes, or nothing when the instrument has no octave.
 *
 * Below the band is where such a pickup belongs and it is taken whenever it can
 * be heard. The band is one octave wide, though, so an instrument that does not
 * reach under it folds the drop straight back onto the root already sounding —
 * a four-string bass has nothing below its E — and a pickup that repeats the
 * note under it is the one thing a pickup cannot be. The octave above is the
 * same figure played the other way, which is what a player without the low
 * string does, so it is taken before the figure is given up. Both are judged by
 * what they sound as rather than by where they are written, since the fold is
 * the whole question.
 */
function octavePickup(ctx: BuildContext): number | undefined {
  const root = sounding(ctx, ctx.rootMidi);
  for (const candidate of [ctx.rootMidi - 12, ctx.rootMidi + 12]) {
    if (candidate >= 0 && candidate <= 127 && sounding(ctx, candidate) !== root) {
      return candidate;
    }
  }
  return undefined;
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

/** Cycle bass -> third -> fifth (-> seventh) across the segment's beats. */
function buildArpeggio(ctx: BuildContext, seg: BassSegment): void {
  const tones = bassToneCycle(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  positions.forEach((pos, i) => {
    const pc = tones[i % tones.length] ?? bassPcOf(seg.chord);
    emit(ctx, pos, pc);
  });
}

/**
 * The neighbour a walking line leads into the next chord with.
 *
 * Whether it is the semitone or the scale step is drawn per segment, so the
 * choice is fixed by where in the piece it happens.
 */
function approachNote(ctx: BuildContext, target: number, from: number, index: number): number {
  return neighborOf(target, from, ctx.key, ctx.draw.prob(0.5, 'approach', index));
}

/** A quarter-note line of chord tones that leads by step into each chord change. */
function buildWalking(
  ctx: BuildContext,
  seg: BassSegment,
  next: BassSegment | undefined,
  index: number,
): void {
  const tones = bassToneCycle(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat, ctx.ts);
  const count = positions.length;
  positions.forEach((pos, i) => {
    if (i === 0) {
      emit(ctx, pos, bassPcOf(seg.chord));
      return;
    }
    if (next && count > 1 && i === count - 1) {
      // The next chord's bass is already fixed by its own pitch class and the
      // band, so the line leads into the note that will actually sound rather
      // than into a copy of it placed somewhere else.
      const nextBass = placeRoot(bassPcOf(next.chord), ctx.low);
      const midi = approachNote(ctx, nextBass, ctx.prevMidi, index);
      emit(ctx, pos, pitchClass(midi), midi);
      return;
    }
    const pc = tones[i % tones.length] ?? bassPcOf(seg.chord);
    emit(ctx, pos, pc);
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
  // The chords are read into their plain form once, here at the boundary; the
  // builders below work on chord data alone.
  const segments: BassSegment[] = opts.segments
    .map((segment) => ({ ...segment, chord: toChordData(segment.chord) }))
    .sort((a, b) => a.startBeat - b.startBeat);
  assertBassSegments(segments);
  if (segments.length === 0) {
    return [];
  }

  const ts = meterAt(0, toMeterData(opts.ts ?? DEFAULT_TS, 'ts'));
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
  const { instrument, low } = bassRegister(resolved.instrument('bass'), opts.instrument, octave);

  const ctx: BuildContext = {
    ts,
    low,
    key: toKeyScale(opts.key),
    draw: resolved.part('bass'),
    notes: [],
    rootMidi: low,
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
    ctx.rootMidi = placeRoot(bassPcOf(seg.chord), ctx.low);
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
    if (durationBeat <= BEAT_EPS) {
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
