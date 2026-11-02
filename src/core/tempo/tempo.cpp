// Tempo maps and time conversion of ts/src/core/tempo/index.ts.

#include "core/tempo/tempo.h"

#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "core/tempo/internal.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** Validate a tempo map: non-empty, within budget, finite, in range and sorted. */
const TempoMap& assert_tempo_map(const TempoMap& map, std::string_view name = "tempo map") {
  if (map.empty()) {
    throw InvalidInputError(std::string(name) + " must hold at least one tempo event");
  }
  assert_generation_budget(static_cast<double>(map.size()), join_name(name, " count"),
                           MAX_TEMPO_CHANGES);
  for (std::size_t index = 0; index < map.size(); ++index) {
    const TempoEvent& event = map[index];
    // The element name is built only for an event that fails.
    if (std::isfinite(event.startBeat) && std::isfinite(event.bpm) && event.bpm >= MIN_TEMPO_BPM &&
        event.bpm <= MAX_TEMPO_BPM && (index == 0 || event.startBeat > map[index - 1].startBeat)) {
      continue;
    }
    std::string at = std::string(name) + "[" + index_text(index) + "]";
    assert_finite_number(event.startBeat, at + ".startBeat");
    assert_range(event.bpm, MIN_TEMPO_BPM, MAX_TEMPO_BPM, at + ".bpm");
    if (index > 0 && event.startBeat <= map[index - 1].startBeat) {
      throw InvalidInputError(std::string(name) +
                              " must be sorted by startBeat with no repeats; [" +
                              index_text(index) + "].startBeat " + js::to_string(event.startBeat) +
                              " does not follow " + js::to_string(map[index - 1].startBeat));
    }
  }
  return map;
}

/** Seconds from `from_beat` to `to_beat` through the segments between (`integrateSeconds`). */
double integrate_seconds(const TempoMap& map, double from_beat, double to_beat) {
  if (to_beat < from_beat) {
    return -integrate_seconds(map, to_beat, from_beat);
  }
  double seconds = 0;
  for (std::size_t index = tempo_segment_at(map, from_beat); index < map.size(); ++index) {
    const TempoEvent& event = map[index];
    // The opening tempo reaches back before the beat it is marked on.
    double segment_start = index == 0 ? -std::numeric_limits<double>::infinity() : event.startBeat;
    double segment_end =
        index + 1 < map.size() ? map[index + 1].startBeat : std::numeric_limits<double>::infinity();
    double low = js::max(from_beat, segment_start);
    double high = js::min(to_beat, segment_end);
    if (high > low) {
      seconds += ((high - low) * SECONDS_PER_MINUTE) / event.bpm;
    }
    if (to_beat <= segment_end) {
      break;
    }
  }
  return seconds;
}

}  // namespace

double beats_to_seconds(double beat, const TempoMap& map) {
  assert_finite_number(beat, "beat");
  assert_tempo_map(map);
  return elapsed_seconds_at(map, beat);
}

double seconds_to_beats(double seconds, const TempoMap& map) {
  assert_finite_number(seconds, "seconds");
  assert_tempo_map(map);
  return beat_at_elapsed_seconds(map, seconds);
}

double duration_to_seconds(double start_beat, double length_beats, const TempoMap& map) {
  assert_finite_number(start_beat, "startBeat");
  assert_range(length_beats, 0, kMaxSafeInteger, "lengthBeats");
  assert_tempo_map(map);
  return integrate_seconds(map, start_beat, start_beat + length_beats);
}

double tempo_at(double beat, const TempoMap& map) {
  assert_finite_number(beat, "beat");
  assert_tempo_map(map);
  return map[tempo_segment_at(map, beat)].bpm;
}

TempoReader::TempoReader(const TempoMap& map) : index_(tempo_index_of(assert_tempo_map(map))) {}

double TempoReader::seconds_at(double beat) const {
  return elapsed_seconds_in(index_, assert_finite_number(beat, "beat"));
}

double TempoReader::beat_at(double seconds) const {
  return beat_at_elapsed_in(index_, assert_finite_number(seconds, "seconds"));
}

double beats_to_ticks(double beat, int ppq) {
  assert_finite_number(beat, "beat");
  assert_positive_int(ppq, "ppq");
  double ticks = js::round(beat * ppq);
  // A count past the safe integers is not a whole tick, and ticks_to_beats refuses it.
  assert_integer(ticks, "ticks result");
  return ticks == 0 ? 0 : ticks;
}

double ticks_to_beats(double ticks, int ppq) {
  assert_integer(ticks, "ticks");
  assert_positive_int(ppq, "ppq");
  return ticks / ppq;
}

}  // namespace cantus
