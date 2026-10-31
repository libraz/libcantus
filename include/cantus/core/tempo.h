/**
 * @file tempo.h
 * @brief Public C++ API of ts/src/core/tempo: tempo maps and conversions between beats, seconds
 *        and ticks.
 *
 * The opening tempo reaches back before its own onset, so a pickup is played at the tempo of the
 * piece it leads into and elapsed time there is negative rather than an error.
 */
#ifndef CANTUS_CORE_TEMPO_H_
#define CANTUS_CORE_TEMPO_H_

#include <vector>

namespace cantus {

/** A tempo from a beat onwards (`TempoEvent`). */
struct TempoEvent {
  /** Onset in quarter-note beats, absolute from the start of the timeline. */
  double startBeat = 0;
  /** Quarter-note beats per minute. */
  double bpm = 0;
};

/** Tempo events in strictly increasing onset order; the first is the time origin (`TempoMap`). */
using TempoMap = std::vector<TempoEvent>;

/**
 * Seconds elapsed from the map's origin to a beat (`beatsToSeconds`).
 * @throws InvalidInputError if the beat is not finite or the map is malformed.
 */
double beats_to_seconds(double beat, const TempoMap& map);

/** The beat reached after a number of seconds from the origin (`secondsToBeats`). */
double seconds_to_beats(double seconds, const TempoMap& map);

/** Seconds a span of `length_beats` beats starting at `start_beat` takes (`durationToSeconds`). */
double duration_to_seconds(double start_beat, double length_beats, const TempoMap& map);

/** The tempo in force at a beat (`tempoAt`). */
double tempo_at(double beat, const TempoMap& map);

/**
 * Ticks of a beat at a resolution of `ppq` ticks per quarter note (`beatsToTicks`).
 * @throws InvalidInputError if `beat` is not finite, `ppq` is not positive, or the tick count is
 *   past the safe integers.
 */
double beats_to_ticks(double beat, int ppq);

/**
 * Beats of a tick count at a resolution of `ppq` (`ticksToBeats`). `ticks` is an integer-valued
 * `double` so that a negative zero stays one, as in the result of the TS function.
 * @throws InvalidInputError if `ticks` is not a safe integer or `ppq` is not positive.
 */
double ticks_to_beats(double ticks, int ppq);

}  // namespace cantus

#endif  // CANTUS_CORE_TEMPO_H_
