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

/** The index arrays of meter_segments(). */
MeterIndex build_meter_index(const MeterMap& map) {
  MeterIndex index;
  for (const MeterSegment& segment : meter_segments(map)) {
    index.startBeats.push_back(segment.startBeat);
    index.barAnchors.push_back(segment.barAnchor);
    index.barBeats.push_back(segment.barBeats);
    index.barsBefore.push_back(segment.barsBefore);
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

std::vector<MeterSegment> meter_segments(const MeterMap& map) {
  std::vector<MeterSegment> segments;
  segments.reserve(map.size());
  double bars = 0;
  std::size_t at_zero = 0;
  for (std::size_t i = 0; i < map.size(); ++i) {
    double start_beat = map[i].startBeat;
    double bar_len = bar_beats_of(map[i].ts);
    double bar_anchor = i == 0 ? 0 : start_beat;
    segments.push_back(MeterSegment{start_beat, map[i].ts, bar_anchor, bar_len, bars});
    if (i > 0 && start_beat <= BEAT_EPS) {
      at_zero = i;
    }
    if (i + 1 < map.size() && bar_len > 0) {
      // The opening span may end at or before beat 0; every later span holds the bar it starts.
      double span = std::ceil((map[i + 1].startBeat - bar_anchor) / bar_len - BEAT_EPS);
      bars += i == 0 ? span : js::max(1, span);
    }
  }
  if (at_zero > 0 && segments[at_zero].barBeats > 0) {
    const MeterSegment& zero = segments[at_zero];
    double shift = zero.barsBefore + std::floor(-zero.barAnchor / zero.barBeats + BEAT_EPS);
    if (shift != 0) {
      for (MeterSegment& segment : segments) {
        segment.barsBefore -= shift;
      }
    }
  }
  return segments;
}

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
