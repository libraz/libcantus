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
  assertGenerationBudget,
  assertInteger,
  assertPositiveInt,
  assertRange,
  describeRejected,
} from '../validation/index.js';
import {
  beatAtElapsedIn,
  beatAtElapsedSeconds,
  elapsedSecondsAt,
  elapsedSecondsIn,
  isValidatedTempoMap,
  rememberValidatedTempoMap,
  tempoIndexOf,
  tempoSegmentAt,
} from './internal.js';

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
 * Upper bound on the number of changes one tempo map may declare.
 *
 * A map is read on every conversion asked of it, so an unbounded map is an
 * unbounded per-note cost the way an unbounded event array is an unbounded
 * pass. The bound is the one the meter map takes, and for the same reason: far
 * above any notated piece — a change on every bar of a hundred thousand bars —
 * and it rejects the map rather than the work built on it. A recorded
 * accelerando reaches it, which is exactly the import the bound is for.
 */
const MAX_TEMPO_CHANGES = 100_000;

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
  assertGenerationBudget(map.length, `${name} count`, MAX_TEMPO_CHANGES);
  // A map is re-validated on every conversion asked of it, so a pass over a
  // piece pays for the whole map per note unless a map it has already read is
  // recognized as one. The meter map is read the same way.
  if (isValidatedTempoMap(map)) {
    return map;
  }
  for (let index = 0; index < map.length; index += 1) {
    const event = map[index];
    // A hole in a sparse array, an explicit null, and a number are all rejected
    // here rather than at the first field read, which would surface as the
    // library's own TypeError instead of as the malformed input it is. The
    // meter map is read the same way.
    if (typeof event !== 'object' || event === null) {
      throw new InvalidInputError(
        `${name}[${index}] must be a tempo event; received ${describeRejected(event)}`,
      );
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
  rememberValidatedTempoMap(map);
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
 *
 * The sum starts at the segment the span starts in rather than at the map's
 * first, so a note late in a piece is not charged for every tempo change before
 * it. What it costs is the segments the span actually crosses, which is what
 * the span is made of.
 */
function integrateSeconds(map: TempoMap, fromBeat: number, toBeat: number): number {
  if (toBeat < fromBeat) {
    return -integrateSeconds(map, toBeat, fromBeat);
  }
  let seconds = 0;
  for (let index = tempoSegmentAt(map, fromBeat); index < map.length; index += 1) {
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
  // The origin-to-beat integral crosses every segment before `beat`, so a pass
  // that asks it of every note re-adds the whole map per note. The sum of the
  // whole segments is the map's own, made once and read here.
  return elapsedSecondsAt(map, beat);
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
  // Before the origin only the opening tempo is in force, which is the segment
  // {@link beatsToSeconds} integrates backwards over; the prefix sums place a
  // negative elapsed time there without a case of its own.
  return beatAtElapsedSeconds(map, seconds);
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
  return map[tempoSegmentAt(map, beat)]?.bpm ?? firstEvent(map).bpm;
}

/** A reader that converts many positions against one tempo map. */
export type TempoReader = {
  /** Elapsed seconds from the map's origin to a beat. */
  secondsAt(beat: number): number;
  /** The beat reached after a number of seconds from the origin. */
  beatAt(seconds: number): number;
};

/**
 * Hold a tempo map for the length of one pass, and convert against it.
 *
 * A conversion validates the map it is handed and re-reads it to know the
 * caller has not written to it since, so a pass that converts every note of a
 * piece pays for the whole map per note — and an imported accelerando marks a
 * tempo every tick. A pass that reads the map once instead pays for it once.
 *
 * The map is read when the reader is made, so the reader answers for the map as
 * it was then: a pass hands out no reader it does not own the map of.
 *
 * Not part of the public surface: it hands out a view of a validated map, which
 * only the pass that validated it can say is still current.
 *
 * @param map The tempo map, validated here.
 * @returns The conversions, reading one snapshot of the map.
 */
export function tempoReader(map: TempoMap): TempoReader {
  assertTempoMap(map);
  const index = tempoIndexOf(map);
  return {
    secondsAt: (beat) => elapsedSecondsIn(index, assertFiniteNumber(beat, 'beat')),
    beatAt: (seconds) => beatAtElapsedIn(index, assertFiniteNumber(seconds, 'seconds')),
  };
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
