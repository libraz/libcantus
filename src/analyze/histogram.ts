/**
 * Pitch-class weight histograms over a span of notes.
 *
 * Chord inference and key inference both ask the same question of a stretch of
 * music — how much of each pitch class is sounding, and how prominently — so
 * they read it from one place. Sharing the histogram is what lets a chord
 * boundary and a key boundary be compared on the same scale.
 */

import type { MeterLike } from '../core/meter/index.js';
import { metricWeight } from '../core/meter/index.js';
import { pitchClassOf as pitchClass } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertGenerationBudget } from '../core/validation/index.js';
import { BEAT_EPS } from './adjacency.js';

/** Loudest a MIDI velocity goes, which is what a velocity is read against. */
const MAX_VELOCITY = 127;

/** How much a metric accent may add to a note's weight, as a divisor of it. */
const ACCENT_DIVISOR = 3;

/**
 * How much one note counts towards a pitch-class histogram.
 *
 * The one definition of prominence the chord route and the key route both
 * weigh their notes by, so the two never read the same music as emphasising
 * different pitch classes. A note counts for the beats it sounds, scaled by how
 * hard it is struck and, where a meter is in hand, by the accent of the beat it
 * starts on. A note carrying no velocity is counted at full weight: an import
 * that records velocity for one part and not another would otherwise have the
 * silent part outweigh the played one.
 *
 * @param note The note to weigh.
 * @param beats How many beats of it are being counted: its whole duration, or
 *   its overlap with the window being weighed.
 * @param meter The meter supplying the metric accent; omit it where the note is
 *   counted without one, which weighs every onset alike.
 * @returns The weight, in the same units for either caller.
 */
export function noteWeight(note: NoteEvent, beats: number, meter?: MeterLike): number {
  const velocityFactor = note.velocity !== undefined ? note.velocity / MAX_VELOCITY : 1;
  const accent = meter === undefined ? 1 : 1 + metricWeight(note.startBeat, meter) / ACCENT_DIVISOR;
  return beats * velocityFactor * accent;
}

/** An equal-slot grid: slot `i` covers `[origin + i * slotBeats, + slotBeats)`. */
export type SlotGrid = {
  /** First beat of slot 0. */
  origin: number;
  /** Length of one slot in beats. */
  slotBeats: number;
};

/**
 * Sort notes into the slots of an equal grid they overlap.
 *
 * A per-slot histogram asks one question once per slot, so the notes are
 * grouped once rather than rescanned for every slot: scanning them per slot
 * costs the note count times the slot count, and at a fixed note density the
 * slot count grows with the piece, so the total grows with its square. Both the
 * chord search and the key search cut a piece into slots, and they group their
 * notes here so neither can drift back to rescanning.
 *
 * Notes are kept by identity, so a caller may deduplicate a note spanning
 * several slots with a `Set`.
 *
 * @param notes The notes to group; the parts of one falling outside the grid
 *   are dropped.
 * @param grid The grid to group them on.
 * @param slotCount How many slots the grid holds.
 * @param opts `name` labels the budget error, `budget` bounds the total number
 *   of note-to-slot memberships.
 * @returns One array per slot, each holding the notes overlapping that slot in
 *   input order.
 * @throws If the memberships exceed `budget`.
 */
export function bucketNotesBySlot(
  notes: readonly NoteEvent[],
  grid: SlotGrid,
  slotCount: number,
  opts: { name: string; budget?: number },
): NoteEvent[][] {
  const buckets: NoteEvent[][] = Array.from({ length: slotCount }, () => []);
  let memberships = 0;
  for (const note of notes) {
    const first = Math.max(0, Math.floor((note.startBeat - grid.origin) / grid.slotBeats));
    const lastExclusive = Math.min(
      slotCount,
      Math.ceil((note.startBeat + note.durationBeat - grid.origin) / grid.slotBeats),
    );
    memberships += Math.max(0, lastExclusive - first);
    assertGenerationBudget(memberships, opts.name, opts.budget);
    for (let slot = first; slot < lastExclusive; slot += 1) {
      buckets[slot]?.push(note);
    }
  }
  return buckets;
}

/** A window's pitch-class weight histogram and the summaries drawn from it. */
export type WindowWeights = {
  /** Weight per pitch class, indexed 0-11. */
  weights: number[];
  /** Sum of every pitch class's weight. */
  totalWeight: number;
  /** The single largest pitch-class weight. */
  maxWeight: number;
  /** Lowest sounding MIDI pitch, or +Infinity when the window is empty. */
  lowestPitch: number;
};

/**
 * Weigh the pitch classes sounding across `[windowStart, windowEnd)`.
 *
 * A note contributes its overlap with the window, scaled by velocity and, when
 * its onset falls inside the window, by a metric-accent bonus. Weighing by
 * overlap rather than by full duration is what makes the result additive over
 * adjacent windows: a note held across a boundary counts in each window only
 * for the part of it that sounds there.
 *
 * The accents are read from the meter itself rather than from the signature in
 * force at the window's start, so an onset under a meter change is weighed
 * against the bar it actually falls in and a pickup at a negative beat is
 * weighed as the upbeat it is.
 *
 * @param notes The notes to weigh; those not overlapping the window are ignored.
 * @param windowStart First beat of the window.
 * @param windowEnd End of the window, exclusive.
 * @param meter A single signature, or the piece's meter map, supplying the
 *   metric accents.
 * @returns The histogram and its summaries.
 */
export function windowWeights(
  notes: readonly NoteEvent[],
  windowStart: number,
  windowEnd: number,
  meter: MeterLike,
): WindowWeights {
  const weights = new Array<number>(12).fill(0);
  let lowestPitch = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const noteEnd = note.startBeat + note.durationBeat;
    const overlap = Math.min(noteEnd, windowEnd) - Math.max(note.startBeat, windowStart);
    if (overlap <= BEAT_EPS) {
      continue;
    }
    const onsetInWindow =
      note.startBeat >= windowStart - BEAT_EPS && note.startBeat < windowEnd - BEAT_EPS;
    const pc = pitchClass(note.pitch);
    // The accent is asked for only where the onset falls in the window: a note
    // held across the boundary is already counted for its part of it.
    weights[pc] = (weights[pc] ?? 0) + noteWeight(note, overlap, onsetInWindow ? meter : undefined);
    if (note.pitch < lowestPitch) {
      lowestPitch = note.pitch;
    }
  }
  let totalWeight = 0;
  let maxWeight = 0;
  for (const w of weights) {
    totalWeight += w;
    maxWeight = Math.max(maxWeight, w);
  }
  return { weights, totalWeight, maxWeight, lowestPitch };
}
