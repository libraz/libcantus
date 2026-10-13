// Meter arithmetic of ts/src/core/meter/internal.ts.

#include "core/meter/internal.h"

#include <cmath>
#include <cstdint>
#include <limits>

#include "core/meter/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

/** The bar arithmetic of one meter map (`MeterIndex`), derived per question. */
struct MeterIndex {
  std::vector<double> startBeats;
  /** Beat each entry's bars are counted from. */
  std::vector<double> barAnchors;
  /** Bar length of each entry's signature. */
  std::vector<double> barBeats;
  /** Bars completed before each entry. */
  std::vector<double> barsBefore;
};

/** A meter change starts a new bar, so a span ending in a partial bar still counts it whole. */
MeterIndex build_meter_index(const MeterMap& map) {
  MeterIndex index;
  std::size_t n = map.size();
  index.startBeats.resize(n);
  index.barAnchors.resize(n);
  index.barBeats.resize(n);
  index.barsBefore.resize(n);
  double bars = 0;
  for (std::size_t i = 0; i < n; ++i) {
    double start_beat = map[i].startBeat;
    double bar_len = bar_beats_of(map[i].ts);
    // The opening signature counts its bars from beat 0, wherever the map starts.
    double anchor = i == 0 ? 0 : start_beat;
    index.startBeats[i] = start_beat;
    index.barAnchors[i] = anchor;
    index.barBeats[i] = bar_len;
    index.barsBefore[i] = bars;
    if (i + 1 < n && bar_len > 0) {
      bars += js::max(1, std::ceil((map[i + 1].startBeat - anchor) / bar_len - BEAT_EPS));
    }
  }
  return index;
}

/** Index of the last key at or before `value`, at least 0; the keys strictly increase. */
std::size_t last_at_or_before(const std::vector<double>& keys, double value) {
  std::int64_t low = 1;
  auto high = static_cast<std::int64_t>(keys.size()) - 1;
  std::size_t index = 0;
  while (low <= high) {
    std::int64_t mid = (low + high) / 2;
    if (keys[static_cast<std::size_t>(mid)] <= value) {
      index = static_cast<std::size_t>(mid);
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return index;
}

}  // namespace

double unit_beats_of(const TimeSignature& ts) { return 4.0 / ts.denominator; }

bool is_compound_numerator(double numerator) {
  return std::fmod(numerator, 3) == 0 && numerator > 3;
}

std::optional<double> grouping_sum_of(const TimeSignature& ts) {
  if (!ts.grouping) {
    return std::nullopt;
  }
  double sum = 0;
  for (int entry : *ts.grouping) {
    sum += entry;
  }
  return sum;
}

bool is_additive_reading(const TimeSignature& ts) {
  std::optional<double> sum = grouping_sum_of(ts);
  if (!ts.grouping || !sum || *sum == 0) {
    return false;
  }
  if (!is_compound_numerator(ts.numerator) || *sum != ts.numerator) {
    return false;
  }
  // Groups of nothing but threes spell the compound division itself.
  for (int entry : *ts.grouping) {
    if (entry != 3) {
      return true;
    }
  }
  return false;
}

double pulse_count_of(const TimeSignature& ts) {
  if (is_additive_reading(ts)) {
    return ts.numerator;
  }
  return is_compound_numerator(ts.numerator) ? ts.numerator / 3.0 : ts.numerator;
}

double pulse_beats_of(const TimeSignature& ts) {
  return (ts.numerator * unit_beats_of(ts)) / pulse_count_of(ts);
}

std::optional<std::vector<double>> pulse_grouping_of(const TimeSignature& ts) {
  if (!ts.grouping) {
    return std::nullopt;
  }
  std::vector<double> out(ts.grouping->begin(), ts.grouping->end());
  if (grouping_sum_of(ts) == pulse_count_of(ts)) {
    return out;
  }
  // The only accepted grouping not counted in pulses is the all-threes compound spelling.
  for (double& entry : out) {
    entry /= 3;
  }
  return out;
}

double bar_beats_of(const TimeSignature& ts) { return ts.numerator * unit_beats_of(ts); }

std::size_t entry_index_of(const MeterMap& map, double beat) {
  return last_at_or_before(build_meter_index(map).startBeats, beat + BEAT_EPS);
}

double bar_start_of(const MeterMap& map, double beat) {
  MeterIndex index = build_meter_index(map);
  std::size_t at = last_at_or_before(index.startBeats, beat + BEAT_EPS);
  double anchor = index.barAnchors[at];
  double bar_len = index.barBeats[at];
  if (bar_len == 0) {
    return 0;
  }
  return anchor + std::floor((beat - anchor) / bar_len + BEAT_EPS) * bar_len;
}

double bar_length_of(const MeterMap& map, double beat) {
  MeterIndex index = build_meter_index(map);
  std::size_t at = last_at_or_before(index.startBeats, beat + BEAT_EPS);
  double full = index.barBeats[at];
  if (at + 1 >= index.startBeats.size()) {
    return full;
  }
  return js::min(full, index.startBeats[at + 1] - bar_start_of(map, beat));
}

double bar_index_of(const MeterMap& map, double beat) {
  MeterIndex index = build_meter_index(map);
  std::size_t at = last_at_or_before(index.startBeats, beat + BEAT_EPS);
  double anchor = index.barAnchors[at];
  double bar_len = index.barBeats[at];
  if (bar_len == 0) {
    return 0;
  }
  return index.barsBefore[at] + std::floor((beat - anchor) / bar_len + BEAT_EPS);
}

double beat_of_bar_index(const MeterMap& map, double bar_index) {
  MeterIndex index = build_meter_index(map);
  std::size_t at = last_at_or_before(index.barsBefore, bar_index);
  return index.barAnchors[at] + (bar_index - index.barsBefore[at]) * index.barBeats[at];
}

}  // namespace cantus
