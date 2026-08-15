/**
 * The placement rules a bass line is built from, shared by the phrase-shape
 * styles and the lick dictionary.
 *
 * They are the part of a bass part that is derivable — where in the register a
 * pitch class lands, which beats a segment offers, how one note leads into the
 * next. What is not derivable is which figure to play, and that is the
 * dictionary's business.
 */

import { instrumentRange, type StringedProfile } from '../../core/instrument/index.js';
import { beatsPerBar, pulseBeats, type TimeSignature } from '../../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../../core/pitch/index.js';
import type { KeyScale } from '../../core/types.js';
import type { Chord } from '../../theory/chord/index.js';
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

/** Shift a pitch by whole octaves until it lies in the band `[low, low + 12]`. */
export function foldIntoBand(midi: number, low: number): number {
  let result = midi;
  while (result < low) {
    result += 12;
  }
  while (result > low + 12) {
    result -= 12;
  }
  return result;
}

/**
 * The register band's floor, moved by whole octaves until `[low, low + 12]`
 * lies inside the instrument.
 *
 * Moving the band rather than each note is what keeps the line intact: every
 * interval between consecutive notes survives, and only the register — the one
 * thing a player would have chosen differently — moves.
 */
export function bandFloor(low: number, instrument: StringedProfile | undefined): number {
  if (!instrument) {
    return low;
  }
  const range = instrumentRange(instrument);
  let floor = low;
  while (floor + 12 > range.high) {
    floor -= 12;
  }
  while (floor < range.low) {
    floor += 12;
  }
  return floor;
}

/**
 * A diatonic or chromatic neighbor of `target`, a step toward `from`.
 *
 * The result is folded back into the register band: an approach note may be
 * emitted with an explicit MIDI value, bypassing the placement clamp, and a
 * target on the band edge would otherwise put it a semitone outside — below
 * MIDI 0 at the lowest accepted octave.
 *
 * @param target The note being led into.
 * @param from Where the line is coming from, which decides the direction.
 * @param low Floor of the register band.
 * @param key Key context for the diatonic neighbour.
 * @param chromatic Whether to take the semitone rather than the scale step. The
 *   choice is the caller's so that each caller addresses its own draw.
 */
export function approachNote(
  target: number,
  from: number,
  low: number,
  key: KeyScale,
  chromatic: boolean,
): number {
  const dir = from <= target ? -1 : 1;
  const semitone = target + dir;
  if (chromatic) {
    return foldIntoBand(semitone, low);
  }
  const cand = nearestScaleTone(target + dir * 2, key);
  const step = Math.abs(cand - target);
  return foldIntoBand(step >= 1 && step <= 2 ? cand : semitone, low);
}
