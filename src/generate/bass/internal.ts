/**
 * The placement rules a bass line is built from, shared by the phrase-shape
 * styles and the lick dictionary.
 *
 * They are the part of a bass part that is derivable — where in the register a
 * pitch class lands, which beats a segment offers, how one note leads into the
 * next. What is not derivable is which figure to play, and that is the
 * dictionary's business.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import { instrumentRange, type StringedProfile } from '../../core/instrument/index.js';
import { beatsPerBar, pulseBeats, type TimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import { assertRange } from '../../core/validation/index.js';
import type { Chord, ChordSegment } from '../../theory/chord/index.js';
import { nearestScaleTone } from '../../theory/scale/index.js';

/** Velocity for notes on metrically strong positions. */
export const STRONG_VELOCITY = 100;

/** Velocity for notes on weak positions. */
export const WEAK_VELOCITY = 80;

/** Tolerance for comparing beat positions. */
export const EPS = 1e-9;

/**
 * Place a pitch class as a MIDI note near an anchor, clamped to the bass band.
 *
 * The octave nearest the anchor is chosen first (so motion from the previous
 * note is minimal), then the result is shifted by whole octaves into the band
 * `[low, low + 12]` if it falls outside.
 */
export function placePc(pc: number, anchor: number, low: number): number {
  return foldIntoBand(pc + 12 * Math.round((anchor - pc) / 12), low);
}

/**
 * Place a segment's bass note in the register band.
 *
 * The octave is a function of the pitch class and the band alone rather than of
 * whatever sounded last, so a chord that comes back lands on the note it landed
 * on before however far the line travelled in between: a two-chord vamp holds
 * the register the caller asked for instead of climbing out of it by its second
 * bar, and every degree measured from the root is then fixed by the chord too.
 */
export function placeRoot(pc: number, low: number): number {
  return low + pitchClass(pc - low);
}

/** A bar-long slice of a segment: the span one turn of a figure fills. */
export type BarTile = {
  startBeat: number;
  endBeat: number;
};

/**
 * The bars a segment spans, one tile per bar of it.
 *
 * A figure is a bar long and a chord is not: a ballad or a modal vamp holds one
 * chord for four of them. What a bass part writes over such a chord repeats
 * once per bar rather than being stretched across the whole span, so the bar
 * after the first is played rather than held. The tiles run from the segment's
 * own onset, which is where the harmony changed, and the last one is cut at the
 * next change.
 */
export function barTiles(startBeat: number, endBeat: number, ts: TimeSignature): BarTile[] {
  const barBeats = beatsPerBar(ts);
  const tiles: BarTile[] = [];
  for (let index = 0; ; index += 1) {
    const tileStart = startBeat + index * barBeats;
    if (tileStart >= endBeat - EPS) {
      break;
    }
    tiles.push({ startBeat: tileStart, endBeat: Math.min(tileStart + barBeats, endBeat) });
  }
  return tiles;
}

/**
 * The pulse a bar's second half begins on, which is where an alternating bass
 * answers the root.
 *
 * The bar's midpoint need not be a pulse — a three-beat bar has none there — so
 * the pulse at or before it is taken, keeping the answer on the grid the meter
 * states rather than on an invented local one.
 */
export function midBarPulse(barStart: number, ts: TimeSignature): number {
  const pulse = pulseBeats(ts);
  return barStart + Math.floor((beatsPerBar(ts) / 2 + EPS) / pulse) * pulse;
}

/**
 * Check a chord placement a bass part can be written over.
 *
 * Both entry points consume the same {@link ChordSegment} contract, so both ask
 * the same questions of it: a segment runs forward in time, and no two of them
 * sound at once. Overlapping segments are rejected rather than laid over each
 * other, because a bass part is monophonic and interleaving two lines produces
 * notes belonging to neither chord.
 *
 * @param segments The placement, sorted by onset.
 * @throws If a segment starts outside the timeline, has a non-positive
 *   duration, or overlaps the segment before it.
 */
export function assertBassSegments(segments: readonly ChordSegment[]): void {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    assertRange(segment.startBeat, 0, Number.MAX_SAFE_INTEGER, `segments[${index}].startBeat`);
    assertRange(segment.endBeat, 0, Number.MAX_SAFE_INTEGER, `segments[${index}].endBeat`);
    if (segment.endBeat <= segment.startBeat) {
      throw new InvalidInputError(`segments[${index}] must have a positive duration`);
    }
    const previous = segments[index - 1];
    if (previous !== undefined && segment.startBeat < previous.endBeat - EPS) {
      throw new InvalidInputError(
        `bass segments must not overlap: segments ${index - 1} and ${index} overlap`,
      );
    }
  }
}

/** Chord-tone pitch classes in stacked-thirds order, deduplicated. */
export function chordTonePcs(chord: Chord): number[] {
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
export function fifthPcOf(chord: Chord): number {
  const fifths = new Set(chord.intervals.map((i) => pitchClass(i)));
  const chosen = fifths.has(7) ? 7 : fifths.has(6) ? 6 : fifths.has(8) ? 8 : undefined;
  return chosen === undefined ? pitchClass(chord.rootPc) : pitchClass(chord.rootPc + chosen);
}

/** The sounding bass pitch class of a chord: its slash bass, else its root. */
export function bassPcOf(chord: Chord): number {
  return pitchClass(chord.bassPc ?? chord.rootPc);
}

/**
 * The chord tones an arpeggiating line cycles through, starting from the bass.
 *
 * A slash bass says which note sounds under the chord, so it has to be the one
 * the cycle begins on; the chord's own tones then follow in stacked-thirds
 * order from where the bass sits among them. A bass the chord does not contain
 * is prefixed rather than substituted, so no chord tone is lost.
 */
export function bassToneCycle(chord: Chord): number[] {
  const bass = bassPcOf(chord);
  const tones = chordTonePcs(chord);
  const at = tones.indexOf(bass);
  return at < 0 ? [bass, ...tones] : [...tones.slice(at), ...tones.slice(0, at)];
}

/** Main-pulse positions within `[start, end)`, aligned to the global bar grid. */
export function beatPositions(start: number, end: number, ts: TimeSignature): number[] {
  const positions: number[] = [];
  const barBeats = beatsPerBar(ts);
  const pulse = pulseBeats(ts);
  const firstBar = Math.floor(start / barBeats);
  const lastBar = Math.floor((end - EPS) / barBeats);
  for (let bar = firstBar; bar <= lastBar; bar += 1) {
    const barStart = bar * barBeats;
    const firstPulse = Math.max(0, Math.ceil((start - barStart - EPS) / pulse));
    for (let index = firstPulse; ; index += 1) {
      const position = barStart + index * pulse;
      if (position >= barStart + barBeats - EPS || position >= end - EPS) {
        break;
      }
      if (position >= start - EPS) {
        positions.push(position);
      }
    }
  }
  // A segment shorter than a pulse still needs a bass note. Its boundary is
  // necessarily the harmonic placement rather than an invented local grid.
  if (positions.length === 0) {
    positions.push(start);
  }
  return positions;
}

/**
 * Shift a pitch by whole octaves until it lies in the band `[low, low + 12]`.
 *
 * The octave count is computed rather than stepped, so a pitch arbitrarily far
 * from the band costs the same as one just outside it.
 */
export function foldIntoBand(midi: number, low: number): number {
  const raised = midi + 12 * Math.max(0, Math.ceil((low - midi) / 12));
  return raised - 12 * Math.max(0, Math.ceil((raised - low - 12) / 12));
}

/**
 * The register band's floor, moved by whole octaves until `[low, low + 12]`
 * lies inside the instrument.
 *
 * Moving the band rather than each note is what keeps the line intact: every
 * interval between consecutive notes survives, and only the register — the one
 * thing a player would have chosen differently — moves.
 *
 * Each move is computed as an octave count rather than stepped one octave at a
 * time, so a band far outside the instrument costs the same as one just outside
 * it. The band is dropped under the top fret first and then lifted over the
 * lowest string, so an instrument spanning less than an octave keeps its lowest
 * note reachable.
 */
export function bandFloor(low: number, instrument: StringedProfile | undefined): number {
  if (!instrument) {
    return low;
  }
  const range = instrumentRange(instrument);
  const dropped = low - 12 * Math.max(0, Math.ceil((low + 12 - range.high) / 12));
  return dropped + 12 * Math.max(0, Math.ceil((range.low - dropped) / 12));
}

/**
 * A diatonic or chromatic neighbor of `target`, a step toward `from`.
 *
 * The note stays where the step puts it, a semitone or a scale step from the
 * target, even when that is just outside the register band: leading into the
 * next chord is what this note is for, and folding it by an octave to keep it
 * in the band would turn the step into a leap of eleven semitones whenever the
 * target sat on the band's floor.
 *
 * Where the line already sits on that neighbour — the note it is coming from is
 * a step from the target — the neighbour on the far side of the target is taken
 * instead. The approach then comes from the other direction, which is the one
 * thing that cannot happen on the beat whose whole job is to move: repeating
 * the note just played would stop the line at the chord change. The far side is
 * taken for a neighbour outside the MIDI domain too, which is the only thing
 * that can happen to a target on the lowest accepted octave's floor.
 *
 * @param target The note being led into.
 * @param from Where the line is coming from, which decides the direction.
 * @param key Key context for the diatonic neighbour.
 * @param chromatic Whether to take the semitone rather than the scale step. The
 *   choice is the caller's so that each caller addresses its own draw.
 */
export function approachNote(
  target: number,
  from: number,
  key: KeyScale,
  chromatic: boolean,
): number {
  const dir = from <= target ? -1 : 1;
  const near = neighborOnSide(target, dir, key, chromatic);
  const far = neighborOnSide(target, -dir, key, chromatic);
  const playable = (midi: number): boolean => midi >= 0 && midi <= 127;
  if (playable(near) && near !== from) {
    return near;
  }
  return playable(far) ? far : near;
}

/** The neighbour of `target` on the side `dir` points to. */
function neighborOnSide(target: number, dir: number, key: KeyScale, chromatic: boolean): number {
  const semitone = target + dir;
  if (chromatic) {
    return semitone;
  }
  const cand = nearestScaleTone(target + dir * 2, key);
  const step = Math.abs(cand - target);
  return step >= 1 && step <= 2 ? cand : semitone;
}
