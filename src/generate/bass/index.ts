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

import { isStrongBeat, type TimeSignature } from '../../core/meter/index.js';
import { createRng } from '../../core/random/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
import { nearestScaleTone } from '../../theory/scale/index.js';

/**
 * A chord sounding over a half-open beat span `[startBeat, endBeat)`.
 *
 * @category Composition
 */
export type BassSegment = {
  startBeat: number;
  endBeat: number;
  chord: Chord;
};

/**
 * The bass-line idiom to generate.
 *
 * @category Composition
 */
export type BassStyle = 'root' | 'rootFifth' | 'pop' | 'walking' | 'arpeggio';

/**
 * Options controlling {@link generateBassLine}.
 *
 * @category Composition
 */
export type BassLineOptions = {
  /** Chord placement to follow; need not be pre-sorted. */
  segments: BassSegment[];
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
   *
   * @defaultValue 2
   */
  octave?: number;
  /**
   * Seed for the deterministic PRNG.
   *
   * @defaultValue 0
   */
  seed?: number;
};

const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_STYLE: BassStyle = 'root';
const DEFAULT_OCTAVE = 2;

/** Velocity for notes on metrically strong positions. */
const STRONG_VELOCITY = 100;
/** Velocity for notes on weak positions. */
const WEAK_VELOCITY = 80;
/** Probability of a weak-beat pickup in the `pop` style. */
const PICKUP_PROB = 0.35;

const EPS = 1e-9;

/** Reduce a value to a pitch class in [0, 11]. */
function pitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

/**
 * Place a pitch class as a MIDI note near an anchor, clamped to the bass band.
 *
 * The octave nearest the anchor is chosen first (so motion from the previous
 * note is minimal), then the result is shifted by whole octaves into the band
 * `[low, low + 12]` if it falls outside.
 */
function placePc(pc: number, anchor: number, low: number): number {
  const high = low + 12;
  let midi = pc + 12 * Math.round((anchor - pc) / 12);
  while (midi < low) {
    midi += 12;
  }
  while (midi > high) {
    midi -= 12;
  }
  return midi;
}

/** Chord-tone pitch classes in stacked-thirds order, deduplicated. */
function chordTonePcs(chord: Chord): number[] {
  const seen = new Set<number>();
  const pcs: number[] = [];
  for (const interval of chord.intervals) {
    const pc = pitchClass(chord.rootPc + interval);
    if (!seen.has(pc)) {
      seen.add(pc);
      pcs.push(pc);
    }
  }
  if (pcs.length === 0) {
    pcs.push(pitchClass(chord.rootPc));
  }
  return pcs;
}

/**
 * The chord's fifth pitch class.
 *
 * Uses the perfect fifth when present, otherwise the chord's actual altered
 * fifth (diminished = 6, augmented = 8 semitones above the root), so dim/aug/
 * m7b5 chords sound their real fifth rather than a repeated root. Falls back to
 * the root only when the chord has no fifth degree at all.
 */
function fifthPcOf(chord: Chord): number {
  const fifths = new Set(chord.intervals.map((i) => pitchClass(i)));
  const chosen = fifths.has(7) ? 7 : fifths.has(6) ? 6 : fifths.has(8) ? 8 : undefined;
  return chosen === undefined ? pitchClass(chord.rootPc) : pitchClass(chord.rootPc + chosen);
}

/** The sounding bass pitch class of a chord: its slash bass, else its root. */
function bassPcOf(chord: Chord): number {
  return pitchClass(chord.bassPc ?? chord.rootPc);
}

/** Integer quarter-note beat positions within `[start, end)`, at least one. */
function beatPositions(start: number, end: number): number[] {
  const positions: number[] = [];
  for (let p = start; p < end - EPS; p += 1) {
    positions.push(p);
  }
  if (positions.length === 0) {
    positions.push(start);
  }
  return positions;
}

type RawNote = { startBeat: number; pitch: number; velocity: number };

/** Working state threaded through the per-segment builders. */
type BuildContext = {
  ts: TimeSignature;
  low: number;
  key: KeyScale;
  rng: ReturnType<typeof createRng>;
  notes: RawNote[];
  prevMidi: number;
};

/** Append a note for pitch class `pc` at `pos`, placed near the running anchor. */
function emit(ctx: BuildContext, pos: number, pc: number, midiOverride?: number): number {
  const midi = midiOverride ?? placePc(pc, ctx.prevMidi, ctx.low);
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
function buildPop(ctx: BuildContext, seg: BassSegment): void {
  const positions = beatPositions(seg.startBeat, seg.endBeat);
  const rootPc = bassPcOf(seg.chord);
  let emitted = false;
  for (const pos of positions) {
    if (isStrongBeat(pos, ctx.ts)) {
      ctx.prevMidi = emit(ctx, pos, rootPc);
      emitted = true;
    } else if (ctx.rng.prob(PICKUP_PROB)) {
      if (ctx.rng.prob(0.5)) {
        // Octave pickup: the root dropped toward the bottom of the register,
        // clamped so it never falls below the declared band.
        const base = placePc(rootPc, ctx.prevMidi, ctx.low);
        emit(ctx, pos, rootPc, Math.max(ctx.low, base - 12));
      } else {
        ctx.prevMidi = emit(ctx, pos, fifthPcOf(seg.chord));
      }
    }
  }
  if (!emitted) {
    ctx.prevMidi = emit(ctx, seg.startBeat, rootPc);
  }
}

/** Cycle root -> third -> fifth (-> seventh) across the segment's beats. */
function buildArpeggio(ctx: BuildContext, seg: BassSegment): void {
  const tones = chordTonePcs(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat);
  positions.forEach((pos, i) => {
    const pc = tones[i % tones.length] ?? bassPcOf(seg.chord);
    ctx.prevMidi = emit(ctx, pos, pc);
  });
}

/** A diatonic or chromatic neighbor of `target`, a step toward `from`. */
function approachNote(ctx: BuildContext, target: number, from: number): number {
  const dir = from <= target ? -1 : 1;
  if (ctx.rng.prob(0.5)) {
    return target + dir; // chromatic semitone
  }
  const cand = nearestScaleTone(target + dir * 2, ctx.key);
  const step = Math.abs(cand - target);
  return step >= 1 && step <= 2 ? cand : target + dir;
}

/** A quarter-note line of chord tones that leads by step into each chord change. */
function buildWalking(ctx: BuildContext, seg: BassSegment, next: BassSegment | undefined): void {
  const tones = chordTonePcs(seg.chord);
  const positions = beatPositions(seg.startBeat, seg.endBeat);
  const count = positions.length;
  positions.forEach((pos, i) => {
    if (i === 0) {
      ctx.prevMidi = emit(ctx, pos, bassPcOf(seg.chord));
      return;
    }
    if (next && count > 1 && i === count - 1) {
      const nextBass = placePc(bassPcOf(next.chord), ctx.prevMidi, ctx.low);
      const midi = approachNote(ctx, nextBass, ctx.prevMidi);
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
  const segments = [...opts.segments].sort((a, b) => a.startBeat - b.startBeat);
  if (segments.length === 0) {
    return [];
  }

  const ts = opts.ts ?? DEFAULT_TS;
  const style = opts.style ?? DEFAULT_STYLE;
  const octave = opts.octave ?? DEFAULT_OCTAVE;
  const low = octave * 12 + 12;

  const ctx: BuildContext = {
    ts,
    low,
    key: opts.key,
    rng: createRng(opts.seed ?? 0),
    notes: [],
    prevMidi: low,
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
        buildPop(ctx, seg);
        break;
      case 'walking':
        buildWalking(ctx, seg, segments[s + 1]);
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
      pitch: note.pitch,
      startBeat: note.startBeat,
      durationBeat,
      velocity: note.velocity,
    });
  }
  return out;
}
