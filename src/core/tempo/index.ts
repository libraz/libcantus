/**
 * Tempo and time conversion: beats to wall-clock seconds across tempo changes,
 * and beats to MIDI ticks.
 *
 * Positions are measured in quarter-note beats, matching the rest of the
 * library's beat convention. A {@link TempoMap} is piecewise constant: each
 * entry sets the tempo from its beat onwards, so the elapsed time over a span is
 * the sum of the segments it crosses rather than the tempo at either end.
 */

import { InvalidInputError } from '../errors/index.js';
import {
  assertFiniteNumber,
  assertInteger,
  assertPositiveInt,
  assertRange,
} from '../validation/index.js';

/**
 * A tempo change: the beat it takes effect on, and the tempo it sets.
 *
 * The tempo holds until the next entry, so a map of one entry is a constant
 * tempo for the whole timeline.
 *
 * @category Rhythm & Meter
 */
export type TempoEvent = {
  /** Onset in quarter-note beats, absolute from the start of the timeline. */
  readonly startBeat: number;
  /** Quarter-note beats per minute from `startBeat` onwards. */
  readonly bpm: number;
};

/**
 * A tempo track: {@link TempoEvent}s sorted by `startBeat`, strictly ascending.
 *
 * The first entry is the time origin — {@link beatsToSeconds} returns 0 for its
 * `startBeat`, and beats before it have no elapsed time to report, so they are
 * rejected rather than extrapolated.
 *
 * @category Rhythm & Meter
 */
export type TempoMap = readonly TempoEvent[];

const SECONDS_PER_MINUTE = 60;

/**
 * Upper bound on a tempo, matching the bound the generators accept. A faster
 * marking is a notation of a slower pulse, not a distinct tempo.
 */
const MAX_BPM = 1000;

/**
 * Validate a tempo map: non-empty, strictly ascending, non-negative onsets, and
 * positive tempos.
 *
 * An unsorted map is rejected rather than sorted: reordering it would silently
 * accept a data error, and two entries on the same beat name no segment at all.
 */
function assertTempoMap(map: TempoMap, name = 'tempo map'): TempoMap {
  if (!Array.isArray(map) || map.length === 0) {
    throw new InvalidInputError(`${name} must hold at least one tempo event`);
  }
  for (let index = 0; index < map.length; index += 1) {
    const event = map[index];
    if (event === undefined) {
      throw new InvalidInputError(`${name}[${index}] must be a tempo event; received undefined`);
    }
    assertRange(event.startBeat, 0, Number.MAX_SAFE_INTEGER, `${name}[${index}].startBeat`);
    assertRange(event.bpm, Number.MIN_VALUE, MAX_BPM, `${name}[${index}].bpm`);
    const previous = map[index - 1];
    if (previous !== undefined && event.startBeat <= previous.startBeat) {
      throw new InvalidInputError(
        `${name} must be sorted by startBeat with no repeats; ` +
          `[${index}].startBeat ${event.startBeat} does not follow ${previous.startBeat}`,
      );
    }
  }
  return map;
}

/** The map's first event, which is its time origin. */
function firstEvent(map: TempoMap): TempoEvent {
  const first = map[0];
  if (first === undefined) {
    throw new InvalidInputError('tempo map must hold at least one tempo event');
  }
  return first;
}

/** Reject a beat the map says nothing about, i.e. one before its first entry. */
function assertCoveredBeat(beat: number, map: TempoMap, name: string): number {
  const origin = firstEvent(map).startBeat;
  if (beat < origin) {
    throw new InvalidInputError(
      `${name} must be at or after the tempo map's first event at beat ${origin}; received ${beat}`,
    );
  }
  return beat;
}

/**
 * Elapsed seconds over `[fromBeat, toBeat]`, summed segment by segment. Both
 * bounds are assumed validated and ordered.
 */
function integrateSeconds(map: TempoMap, fromBeat: number, toBeat: number): number {
  let seconds = 0;
  for (let index = 0; index < map.length; index += 1) {
    const event = map[index];
    if (event === undefined) {
      continue;
    }
    const segmentEnd = map[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
    const low = Math.max(fromBeat, event.startBeat);
    const high = Math.min(toBeat, segmentEnd);
    if (high > low) {
      seconds += ((high - low) * SECONDS_PER_MINUTE) / event.bpm;
    }
    if (toBeat <= segmentEnd) {
      break;
    }
  }
  return seconds;
}

/**
 * Wall-clock seconds from the start of a tempo map to a beat.
 *
 * The result integrates every tempo segment the span crosses; it is not the
 * tempo in effect at `beat` applied to the whole span.
 *
 * @param beat Position in quarter-note beats.
 * @param map The tempo map; its first event is the time origin.
 * @returns Elapsed seconds, 0 at the map's first event.
 * @throws If the map is empty, unsorted, or carries a non-positive tempo, or if
 *   `beat` falls before the map's first event.
 * @example
 * ```ts
 * import { beatsToSeconds } from '@libraz/libcantus';
 * const map = [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }];
 * beatsToSeconds(8, map); // 6 = 4 beats at 120 + 4 beats at 60
 * ```
 * @category Rhythm & Meter
 */
export function beatsToSeconds(beat: number, map: TempoMap): number {
  assertFiniteNumber(beat, 'beat');
  assertTempoMap(map);
  assertCoveredBeat(beat, map, 'beat');
  return integrateSeconds(map, firstEvent(map).startBeat, beat);
}

/**
 * The beat reached after a number of seconds — the inverse of
 * {@link beatsToSeconds}.
 *
 * @param seconds Elapsed seconds from the map's first event.
 * @param map The tempo map.
 * @returns The position in quarter-note beats.
 * @throws If the map is malformed or `seconds` is negative.
 * @example
 * ```ts
 * import { secondsToBeats } from '@libraz/libcantus';
 * const map = [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }];
 * secondsToBeats(6, map); // 8
 * ```
 * @category Rhythm & Meter
 */
export function secondsToBeats(seconds: number, map: TempoMap): number {
  assertRange(seconds, 0, Number.MAX_SAFE_INTEGER, 'seconds');
  assertTempoMap(map);
  let remaining = seconds;
  for (let index = 0; index < map.length - 1; index += 1) {
    const event = map[index];
    const next = map[index + 1];
    if (event === undefined || next === undefined) {
      continue;
    }
    const spanSeconds = ((next.startBeat - event.startBeat) * SECONDS_PER_MINUTE) / event.bpm;
    if (remaining < spanSeconds) {
      return event.startBeat + (remaining * event.bpm) / SECONDS_PER_MINUTE;
    }
    remaining -= spanSeconds;
  }
  const last = map[map.length - 1];
  if (last === undefined) {
    throw new InvalidInputError('tempo map must hold at least one tempo event');
  }
  return last.startBeat + (remaining * last.bpm) / SECONDS_PER_MINUTE;
}

/**
 * Duration in seconds of a span of beats.
 *
 * Equal to the difference of two {@link beatsToSeconds} calls — the integral is
 * additive, so that reading is exact — but integrated over the span directly, so
 * a short note late in a long piece does not lose precision to the subtraction
 * of two large elapsed times.
 *
 * @param startBeat Where the span begins, in quarter-note beats.
 * @param lengthBeats How long the span lasts, in quarter-note beats.
 * @param map The tempo map.
 * @returns The span's duration in seconds.
 * @throws If the map is malformed, the length is negative, or the span starts
 *   before the map's first event.
 * @example
 * ```ts
 * import { durationToSeconds } from '@libraz/libcantus';
 * const map = [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }];
 * durationToSeconds(2, 4, map); // 3 = 2 beats at 120 + 2 beats at 60
 * ```
 * @category Rhythm & Meter
 */
export function durationToSeconds(startBeat: number, lengthBeats: number, map: TempoMap): number {
  assertFiniteNumber(startBeat, 'startBeat');
  assertRange(lengthBeats, 0, Number.MAX_SAFE_INTEGER, 'lengthBeats');
  assertTempoMap(map);
  assertCoveredBeat(startBeat, map, 'startBeat');
  return integrateSeconds(map, startBeat, startBeat + lengthBeats);
}

/**
 * The tempo in effect at a beat.
 *
 * @param beat Position in quarter-note beats.
 * @param map The tempo map.
 * @returns Quarter-note beats per minute.
 * @throws If the map is malformed or `beat` falls before its first event.
 * @example
 * ```ts
 * import { tempoAt } from '@libraz/libcantus';
 * tempoAt(5, [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }]); // 60
 * ```
 * @category Rhythm & Meter
 */
export function tempoAt(beat: number, map: TempoMap): number {
  assertFiniteNumber(beat, 'beat');
  assertTempoMap(map);
  assertCoveredBeat(beat, map, 'beat');
  let bpm = firstEvent(map).bpm;
  for (const event of map) {
    if (event.startBeat > beat) {
      break;
    }
    bpm = event.bpm;
  }
  return bpm;
}

/**
 * Convert quarter-note beats to MIDI ticks.
 *
 * Ticks are whole units of a sequencer's grid, so the result is rounded to the
 * nearest tick; a beat that is not on the grid is not representable and comes
 * back quantized.
 *
 * @param beat Position or length in quarter-note beats.
 * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
 * @returns The whole tick count.
 * @throws If `beat` is negative or `ppq` is not a positive integer.
 * @example
 * ```ts
 * import { beatsToTicks } from '@libraz/libcantus';
 * beatsToTicks(1.5, 480); // 720
 * ```
 * @category Rhythm & Meter
 */
export function beatsToTicks(beat: number, ppq: number): number {
  assertRange(beat, 0, Number.MAX_SAFE_INTEGER, 'beat');
  assertPositiveInt(ppq, 'ppq');
  return Math.round(beat * ppq);
}

/**
 * Convert MIDI ticks to quarter-note beats.
 *
 * @param ticks Whole tick count.
 * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
 * @returns The position or length in quarter-note beats.
 * @throws If `ticks` is not a non-negative integer or `ppq` is not a positive
 *   integer.
 * @example
 * ```ts
 * import { ticksToBeats } from '@libraz/libcantus';
 * ticksToBeats(720, 480); // 1.5
 * ```
 * @category Rhythm & Meter
 */
export function ticksToBeats(ticks: number, ppq: number): number {
  assertInteger(ticks, 'ticks', 0);
  assertPositiveInt(ppq, 'ppq');
  return ticks / ppq;
}
