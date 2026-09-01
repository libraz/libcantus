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
 * `startBeat` — and its tempo also governs the beats before it, which is where
 * a pickup sounds. A map cannot say anything else about that stretch, and a
 * piece is played into its first downbeat at the tempo it starts in, so elapsed
 * time there is negative rather than an error.
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
 * Lower bound on a tempo. One beat lasts ten minutes here; anything slower is a
 * corrupt or mis-scaled value rather than a marking, and letting it through
 * would make the conversions overflow to infinity while still reporting a
 * validated tempo.
 */
const MIN_BPM = 0.1;

/**
 * Validate a tempo map: non-empty, strictly ascending, finite onsets, and
 * tempos inside the range the conversions stay finite over.
 *
 * An onset is not bounded below, for the reason the note events are not: beat 0
 * is the first downbeat, so a piece that opens with a pickup marks its tempo
 * before it.
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
    assertFiniteNumber(event.startBeat, `${name}[${index}].startBeat`);
    assertRange(event.bpm, MIN_BPM, MAX_BPM, `${name}[${index}].bpm`);
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

/**
 * Elapsed seconds over `[fromBeat, toBeat]`, summed segment by segment. Both
 * bounds are assumed validated; a span running backwards reports negative time,
 * which is what keeps the integral additive across the origin.
 */
function integrateSeconds(map: TempoMap, fromBeat: number, toBeat: number): number {
  if (toBeat < fromBeat) {
    return -integrateSeconds(map, toBeat, fromBeat);
  }
  let seconds = 0;
  for (let index = 0; index < map.length; index += 1) {
    const event = map[index];
    if (event === undefined) {
      continue;
    }
    // The opening tempo reaches back before the beat it is marked on: a pickup
    // is played at the tempo of the piece it leads into, and the map names no
    // other one to play it at.
    const segmentStart = index === 0 ? Number.NEGATIVE_INFINITY : event.startBeat;
    const segmentEnd = map[index + 1]?.startBeat ?? Number.POSITIVE_INFINITY;
    const low = Math.max(fromBeat, segmentStart);
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
 * A beat before the map's first event reports negative elapsed time, at the
 * opening tempo: a pickup sounds before the downbeat, and asking when it sounds
 * is a fair question.
 *
 * @param beat Position in quarter-note beats.
 * @param map The tempo map; its first event is the time origin.
 * @returns Elapsed seconds, 0 at the map's first event and negative before it.
 * @throws If the map is empty, unsorted, or carries a tempo outside 0.1..1000
 *   quarter-note beats per minute.
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
  return integrateSeconds(map, firstEvent(map).startBeat, beat);
}

/**
 * The beat reached after a number of seconds — the inverse of
 * {@link beatsToSeconds}.
 *
 * @param seconds Elapsed seconds from the map's first event; negative for a
 *   position before it, such as a pickup.
 * @param map The tempo map.
 * @returns The position in quarter-note beats.
 * @throws If the map is malformed or `seconds` is not finite.
 * @example
 * ```ts
 * import { secondsToBeats } from '@libraz/libcantus';
 * const map = [{ startBeat: 0, bpm: 120 }, { startBeat: 4, bpm: 60 }];
 * secondsToBeats(6, map); // 8
 * ```
 * @category Rhythm & Meter
 */
export function secondsToBeats(seconds: number, map: TempoMap): number {
  assertFiniteNumber(seconds, 'seconds');
  assertTempoMap(map);
  const origin = firstEvent(map);
  if (seconds < 0) {
    // Before the origin only the opening tempo is in force, which is the same
    // segment {@link beatsToSeconds} integrates backwards over.
    return origin.startBeat + (seconds * origin.bpm) / SECONDS_PER_MINUTE;
  }
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
 * @param startBeat Where the span begins, in quarter-note beats; a pickup
 *   starts before the map's first event and is measured like any other span.
 * @param lengthBeats How long the span lasts, in quarter-note beats.
 * @param map The tempo map.
 * @returns The span's duration in seconds, never negative.
 * @throws If the map is malformed or the length is negative.
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
  return integrateSeconds(map, startBeat, startBeat + lengthBeats);
}

/**
 * The tempo in effect at a beat.
 *
 * A beat before the first event reads the opening tempo, which is the tempo a
 * pickup is played at.
 *
 * @param beat Position in quarter-note beats.
 * @param map The tempo map.
 * @returns Quarter-note beats per minute.
 * @throws If the map is malformed.
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
 * A position before the first downbeat is a negative tick count, which is how a
 * pickup crosses the MIDI boundary and comes back. A position that rounds to
 * the downbeat from below comes back as positive zero: `-0` and `0` are the
 * same tick, and only one of them keys as it under `Object.is`.
 *
 * @param beat Position or length in quarter-note beats.
 * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
 * @returns The whole tick count.
 * @throws If `beat` is not finite or `ppq` is not a positive integer.
 * @example
 * ```ts
 * import { beatsToTicks } from '@libraz/libcantus';
 * beatsToTicks(1.5, 480); // 720
 * ```
 * @category Rhythm & Meter
 */
export function beatsToTicks(beat: number, ppq: number): number {
  assertFiniteNumber(beat, 'beat');
  assertPositiveInt(ppq, 'ppq');
  const ticks = Math.round(beat * ppq);
  return ticks === 0 ? 0 : ticks;
}

/**
 * Convert MIDI ticks to quarter-note beats.
 *
 * @param ticks Whole tick count, negative before the first downbeat.
 * @param ppq Pulses (ticks) per quarter note, e.g. 96, 480, or 960.
 * @returns The position or length in quarter-note beats.
 * @throws If `ticks` is not an integer or `ppq` is not a positive integer.
 * @example
 * ```ts
 * import { ticksToBeats } from '@libraz/libcantus';
 * ticksToBeats(720, 480); // 1.5
 * ```
 * @category Rhythm & Meter
 */
export function ticksToBeats(ticks: number, ppq: number): number {
  assertInteger(ticks, 'ticks');
  assertPositiveInt(ppq, 'ppq');
  return ticks / ppq;
}
