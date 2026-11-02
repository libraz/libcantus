/**
 * The index a tempo map is read through, and the mark that says it is valid.
 *
 * A map is handed to a conversion once per note, so a pass over a piece asks
 * the same array the same questions tens of thousands of times: is it valid,
 * and which segment holds this beat. Answered from the array each time, both
 * cost the whole map per note — an imported accelerando marks a tempo every
 * tick, and the two counts multiply. They are answered from a snapshot instead,
 * which is the shape the meter map already reads through.
 */

import type { TempoMap } from './index.js';

/** One tempo map as it read when the index was built. */
export type TempoIndex = {
  /** Onsets in map order. */
  startBeats: number[];
  /** Tempo of each entry. */
  bpms: number[];
  /**
   * Seconds elapsed from the map's origin to each entry's own onset — the
   * prefix sum of the segments before it, summed in map order.
   *
   * The same additions the origin-to-beat integral makes, made once for the
   * map rather than once per note: asking when the last note of an imported
   * accelerando sounds otherwise re-adds every tempo change in the piece.
   */
  secondsBefore: number[];
};

export const SECONDS_PER_MINUTE = 60;

/**
 * Indexes of validated maps, held against the identity of the map they describe.
 *
 * A caller keeps its own array and may write to it after the library has read
 * it, so an index is only trusted while every entry still reads as it did when
 * the index was built. Anything else is validated again.
 */
const INDEX_CACHE = new WeakMap<TempoMap, TempoIndex>();

/** Whether the index still describes the map it was built from. */
function describesMap(index: TempoIndex, map: TempoMap): boolean {
  if (index.startBeats.length !== map.length) {
    return false;
  }
  for (let i = 0; i < map.length; i += 1) {
    const event = map[i];
    if (
      event === undefined ||
      event === null ||
      event.startBeat !== index.startBeats[i] ||
      event.bpm !== index.bpms[i]
    ) {
      return false;
    }
  }
  return true;
}

/** Build the index of a validated map and cache it. */
function buildTempoIndex(map: TempoMap): TempoIndex {
  const startBeats: number[] = [];
  const bpms: number[] = [];
  const secondsBefore: number[] = [];
  let elapsed = 0;
  for (let i = 0; i < map.length; i += 1) {
    const event = map[i];
    if (event === undefined) {
      continue;
    }
    const previousBeat = startBeats[i - 1];
    const previousBpm = bpms[i - 1];
    if (previousBeat !== undefined && previousBpm !== undefined) {
      elapsed += ((event.startBeat - previousBeat) * SECONDS_PER_MINUTE) / previousBpm;
    }
    startBeats.push(event.startBeat);
    bpms.push(event.bpm);
    secondsBefore.push(elapsed);
  }
  const index: TempoIndex = { startBeats, bpms, secondsBefore };
  INDEX_CACHE.set(map, index);
  return index;
}

/**
 * The index of a map that has already passed validation and is unchanged since.
 *
 * What this still pays on every call is a comparison per entry: an array the
 * caller keeps says nothing about whether it has been written to since, so the
 * only way to know a validated map is still the one that was validated is to
 * read it. What it saves is the validation itself — the range checks, the
 * ordering, and the error messages built to describe them.
 */
export function validatedTempoIndex(map: TempoMap): TempoIndex | undefined {
  const cached = INDEX_CACHE.get(map);
  return cached !== undefined && describesMap(cached, map) ? cached : undefined;
}

/** Snapshot a map that passed validation, and remember it. */
export function rememberValidatedTempoMap(map: TempoMap): TempoIndex {
  return buildTempoIndex(map);
}

/**
 * Index of the segment in force at `beat`, by binary search.
 *
 * The opening tempo reaches back before the beat it is marked on, so a beat
 * before the first entry answers with entry 0: a pickup is played at the tempo
 * of the piece it leads into, and the map names no other one to play it at.
 *
 * @param index The index of a validated tempo map.
 * @param beat The beat to place.
 * @returns The index of the entry whose tempo holds at `beat`.
 */
export function tempoSegmentIn(index: TempoIndex, beat: number): number {
  return segmentBy(index.startBeats, beat);
}

/**
 * Seconds from the map's origin to `beat`, read off the prefix sums.
 *
 * The same additions the segment-by-segment integral makes, in the same order:
 * every whole segment before `beat` was summed into the index in map order, and
 * the part of the segment holding `beat` is added last. A beat before the origin
 * comes back negative, at the opening tempo.
 *
 * @param index The index of a validated tempo map.
 * @param beat The beat to place in time.
 * @returns Elapsed seconds, 0 at the map's first event.
 */
export function elapsedSecondsIn(index: TempoIndex, beat: number): number {
  const at = segmentBy(index.startBeats, beat);
  const start = index.startBeats[at] ?? 0;
  const bpm = index.bpms[at] ?? 1;
  return (index.secondsBefore[at] ?? 0) + ((beat - start) * SECONDS_PER_MINUTE) / bpm;
}

/**
 * Beat reached after `seconds` from the map's origin — the inverse of
 * {@link elapsedSecondsIn}, read off the same prefix sums.
 *
 * @param index The index of a validated tempo map.
 * @param seconds Elapsed seconds; negative for a position before the origin.
 * @returns The position in quarter-note beats.
 */
export function beatAtElapsedIn(index: TempoIndex, seconds: number): number {
  const at = segmentBy(index.secondsBefore, seconds);
  const start = index.startBeats[at] ?? 0;
  const bpm = index.bpms[at] ?? 1;
  return start + ((seconds - (index.secondsBefore[at] ?? 0)) * bpm) / SECONDS_PER_MINUTE;
}

/**
 * The last index of an ascending run whose value is at or below `value`, and 0
 * for a value below the run's first: the opening segment governs what precedes
 * it, so there is no index before it to answer with.
 */
function segmentBy(ascending: readonly number[], value: number): number {
  let low = 0;
  let high = ascending.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    const at = ascending[mid];
    if (at !== undefined && at <= value) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, low);
}
