#include "cantus/model/tempo.h"

#include "cantus/core/tempo.h"
#include "cantus/core/validation.h"
#include "js/number.h"
#include "model/limits.gen.h"

namespace cantus {

namespace {

/** The one-event tempo map every conversion is measured against. */
TempoMap map_of(double bpm) { return TempoMap{TempoEvent{0, bpm}}; }

}  // namespace

Tempo::Tempo(double bpm) : bpm_(assert_range(bpm, MIN_MODEL_BPM, MAX_MODEL_BPM, "bpm")) {}

Tempo Tempo::of(double bpm) { return Tempo(bpm); }

Tempo Tempo::from_data(const TempoData& data) { return Tempo(data.bpm); }

Tempo Tempo::from_json(const TempoData& data) { return Tempo(data.bpm); }

double Tempo::seconds_at(double beat) const { return beats_to_seconds(beat, map_of(bpm_)); }

double Tempo::beat_at_seconds(double seconds) const {
  return seconds_to_beats(seconds, map_of(bpm_));
}

double Tempo::seconds_of(double length_beats) const {
  return duration_to_seconds(0, length_beats, map_of(bpm_));
}

double Tempo::ticks_at(double beat, int ppq) const { return beats_to_ticks(beat, ppq); }

double Tempo::beat_at_ticks(double ticks, int ppq) const { return ticks_to_beats(ticks, ppq); }

std::string Tempo::to_string() const { return js::to_string(bpm_) + " bpm"; }

}  // namespace cantus
