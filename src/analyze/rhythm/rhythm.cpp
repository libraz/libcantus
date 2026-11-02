// Where a line places its onsets against the meter: ts/src/analyze/rhythm/index.ts.

#include "cantus/analyze/rhythm.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <string>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "analyze/rhythm/internal.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** RHYTHM_IOI_BINS: inter-onset intervals at half-octave steps. */
const std::vector<double>& ioi_bins() {
  static const std::vector<double> bins =
#include "analyze/rhythm/rhythm_ioi_bins.gen.inc"
      ;
  return bins;
}

/** Width of one grid slot, in quarter-note beats (`SLOT_WIDTH`). */
constexpr double kSlotWidth = 1.0 / RHYTHM_SLOTS_PER_BEAT;

/** The record analyze_rhythm() returns for a span with nothing sounding in it (`emptyAnalysis`). */
RhythmAnalysis empty_analysis() {
  RhythmAnalysis out;
  out.onsetLevels.assign(RHYTHM_LEVEL_COUNT, 0);
  out.interOnsetShares.assign(ioi_bins().size(), 0);
  out.rationale = "Nothing sounds, so there is no rhythm to place on a grid";
  return out;
}

/** One onset after folding near-simultaneous notes together (`Onset`). */
struct Onset {
  /** Earliest onset of the notes folded into this one. */
  double beat;
  /** Latest end among them. */
  double end;
};

/** Fold onsets within HUMANIZE_ADJACENCY of the group's first note into one (`foldOnsets`). */
std::vector<Onset> fold_onsets(const std::vector<NoteEvent>& sounding) {
  std::vector<NoteEvent> sorted = sounding;
  std::stable_sort(sorted.begin(), sorted.end(), [](const NoteEvent& a, const NoteEvent& b) {
    return a.startBeat - b.startBeat < 0;
  });
  std::vector<Onset> onsets;
  for (const NoteEvent& note : sorted) {
    double note_end = note.startBeat + note.durationBeat;
    if (!onsets.empty() && note.startBeat - onsets.back().beat <= HUMANIZE_ADJACENCY) {
      onsets.back().end = js::max(onsets.back().end, note_end);
    } else {
      onsets.push_back(Onset{note.startBeat, note_end});
    }
  }
  return onsets;
}

/** An onset read against the grid (`SnappedOnset`). */
struct SnappedOnset : Onset {
  TimeSignature ts;
  double barStart = 0;
  /** Nearest grid slot, relative to the bar's own downbeat. */
  double slot = 0;
  /** The onset's beat, moved to the nearest grid slot. */
  double snapped = 0;
  int level = 0;
  bool offGrid = false;
};

/** Read one onset against the twelfth-of-a-beat grid (`snapOnset`). */
SnappedOnset snap_onset(const Onset& onset, const MeterArg& meters) {
  SnappedOnset out;
  static_cast<Onset&>(out) = onset;
  out.ts = meter_at(onset.beat, meters);
  double bar_start = bar_start_beat(onset.beat, meters);
  out.barStart = bar_start;
  double offset = onset.beat - bar_start;
  out.slot = js::round(offset / kSlotWidth);
  out.snapped = bar_start + out.slot * kSlotWidth;
  out.offGrid = std::fabs(onset.beat - out.snapped) > RHYTHM_OFF_GRID_TOLERANCE;
  out.level = rhythm_level(out.snapped, meters);
  return out;
}

/** A key identifying a time signature's content, for grouping bars that share one (`tsKey`). */
std::string ts_key(const TimeSignature& ts) {
  std::string key = js::to_string(ts.numerator) + "/" + js::to_string(ts.denominator);
  if (ts.grouping) {
    key += ":";
    for (std::size_t i = 0; i < ts.grouping->size(); ++i) {
      key += (i > 0 ? "+" : "") + js::to_string((*ts.grouping)[i]);
    }
  }
  return key;
}

/** A grid position and its rhythmic level (`GridPoint`). */
struct GridPoint {
  double beat;
  int level;
};

/** A bar and the index of a pulse within it (`pulseKey`). */
using PulseKey = std::pair<double, double>;

/**
 * The pulses whose onsets sit on the division the meter does not use: thirds of a pulse in a
 * simple meter, halves in a compound one (`otherDivisionPulses`).
 */
std::set<PulseKey> other_division_pulses(const std::vector<SnappedOnset>& snapped,
                                         const MeterArg& meters) {
  std::set<PulseKey> pulses;
  for (const SnappedOnset& onset : snapped) {
    double pulse = pulse_beats(onset.ts);
    double offset = onset.snapped - onset.barStart;
    double index = std::floor(offset / pulse + BEAT_EPS);
    double within = offset - index * pulse;
    double used = is_compound(onset.ts) ? 3 : 2;
    double other = is_compound(onset.ts) ? 2 : 3;
    if (is_multiple_of(within, pulse / other) && !is_multiple_of(within, pulse / used)) {
      pulses.insert(PulseKey{bar_index_at(onset.beat, meters), index});
    }
  }
  return pulses;
}

/** The pulse and first-subdivision points of one bar, in bar order (`barGridPoints`). */
std::vector<GridPoint> bar_grid_points(double bar, const MeterArg& meters,
                                       const std::set<PulseKey>& other_pulses) {
  double bar_start = bar_position_to_beat(BarPosition{bar, 0}, meters);
  TimeSignature ts = meter_at(bar_start, meters);
  double bar_length = beats_per_bar_at(bar_start, meters);
  double pulse = pulse_beats(ts);
  double used = is_compound(ts) ? 3 : 2;
  double other = is_compound(ts) ? 2 : 3;
  double sub_unit = pulse / used;
  double steps = js::max(1, js::round(bar_length / sub_unit));
  std::vector<GridPoint> points;
  for (double k = 0; k < steps; k += 1) {
    double index = std::floor((k * sub_unit) / pulse + BEAT_EPS);
    if (std::fmod(k, used) == 0 || other_pulses.count(PulseKey{bar, index}) == 0) {
      double beat = bar_start + k * sub_unit;
      points.push_back(GridPoint{beat, rhythm_level(beat, meters)});
    }
  }
  for (double index = 0; index * pulse < steps * sub_unit - BEAT_EPS; index += 1) {
    if (other_pulses.count(PulseKey{bar, index}) != 0) {
      for (double m = 1; m < other; m += 1) {
        points.push_back(GridPoint{bar_start + index * pulse + (m * pulse) / other, 1});
      }
    }
  }
  std::stable_sort(points.begin(), points.end(),
                   [](const GridPoint& a, const GridPoint& b) { return a.beat - b.beat < 0; });
  return points;
}

/** Share of `[window_start, window_end)` during which nothing sounds (`restRatioOf`). */
double rest_ratio_of(const std::vector<NoteEvent>& sounding, double window_start,
                     double window_end) {
  double span = window_end - window_start;
  if (span <= 0) {
    return 0;
  }
  std::vector<std::pair<double, double>> intervals;
  for (const NoteEvent& note : sounding) {
    double from = js::max(window_start, note.startBeat);
    double to = js::min(window_end, note.startBeat + note.durationBeat);
    if (to > from) {
      intervals.emplace_back(from, to);
    }
  }
  std::stable_sort(intervals.begin(), intervals.end(),
                   [](const auto& a, const auto& b) { return a.first - b.first < 0; });
  double covered = 0;
  double cur_start = 0;
  double cur_end = -std::numeric_limits<double>::infinity();
  for (const auto& [from, to] : intervals) {
    if (from - cur_end > HUMANIZE_ADJACENCY) {
      if (cur_end > -std::numeric_limits<double>::infinity()) {
        covered += cur_end - cur_start;
      }
      cur_start = from;
      cur_end = to;
    } else {
      cur_end = js::max(cur_end, to);
    }
  }
  if (cur_end > -std::numeric_limits<double>::infinity()) {
    covered += cur_end - cur_start;
  }
  return 1 - covered / span;
}

/** Longuet-Higgins and Lee syncopation over the onsets read against the grid. */
double syncopation_of(const std::vector<SnappedOnset>& snapped, double start_beat, double end_beat,
                      const MeterArg& meters) {
  if (snapped.empty()) {
    return 0;
  }
  double first_bar = bar_index_at(start_beat, meters);
  double last_bar = bar_index_at(end_beat, meters);
  std::set<PulseKey> other_pulses = other_division_pulses(snapped, meters);
  std::vector<GridPoint> points;
  for (double bar = first_bar; bar <= last_bar; bar += 1) {
    for (const GridPoint& point : bar_grid_points(bar, meters, other_pulses)) {
      if (point.beat > start_beat + BEAT_EPS && point.beat <= end_beat + BEAT_EPS) {
        points.push_back(point);
      }
    }
  }
  double normalizer = 0;
  for (const GridPoint& point : points) {
    normalizer += point.level;
  }
  if (normalizer <= 0) {
    return 0;
  }
  double numerator = 0;
  std::size_t ptr = 0;
  for (std::size_t i = 0; i < snapped.size(); ++i) {
    const SnappedOnset& onset = snapped[i];
    double window_end = i + 1 < snapped.size() ? snapped[i + 1].snapped : onset.end;
    while (ptr < points.size() && points[ptr].beat <= onset.snapped + BEAT_EPS) {
      ptr += 1;
    }
    // An onset on a point of the division its pulse is read in sits at that division's level.
    int onset_level = onset.level;
    if (ptr > 0 && std::fabs(points[ptr - 1].beat - onset.snapped) < BEAT_EPS) {
      onset_level = static_cast<int>(js::max(onset.level, points[ptr - 1].level));
    }
    std::size_t scan = ptr;
    double max_level = 0;
    while (scan < points.size() && points[scan].beat < window_end - BEAT_EPS) {
      max_level = js::max(max_level, points[scan].level);
      scan += 1;
    }
    if (max_level > onset_level) {
      numerator += max_level - onset_level;
    }
    ptr = scan;
  }
  return numerator / normalizer;
}

}  // namespace

const std::vector<double>& rhythm_ioi_bins() { return ioi_bins(); }

RhythmAnalysis analyze_rhythm(const std::vector<NoteEvent>& notes,
                              const RhythmAnalysisOptions& opts) {
  return rhythm_over(notes, opts, std::nullopt);
}

RhythmAnalysis rhythm_over(const std::vector<NoteEvent>& notes, const RhythmAnalysisOptions& opts,
                           std::optional<double> window_start) {
  ResolveMetersOptions meter_options;
  meter_options.ts = opts.ts;
  meter_options.meters = opts.meters;
  MeterMap meters_map = resolve_meters(meter_options, "rhythm meters");
  const MeterArg meters(meters_map);
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "rhythm notes", note_options);
  std::vector<NoteEvent> sounding = drop_silent_notes(notes);
  double start_beat = window_start.value_or(bar_grid_start(first_sounding_beat(sounding), meters));
  double end_beat = resolve_span_end(opts.totalBeats, start_beat, latest_sounding_end(sounding),
                                     "rhythm totalBeats");
  if (sounding.empty()) {
    return empty_analysis();
  }

  double bars = bar_span_of(start_beat, end_beat, meters);
  assert_generation_budget(std::ceil(bars) * BUDGET_SLOTS_PER_BAR, "rhythm analysis slots",
                           opts.budget);

  std::vector<Onset> onsets = fold_onsets(sounding);
  std::vector<SnappedOnset> snapped;
  for (const Onset& onset : onsets) {
    snapped.push_back(snap_onset(onset, meters));
  }
  const auto onset_count = static_cast<double>(onsets.size());
  double onset_density = bars > 0 ? onset_count / bars : 0;

  double first_bar = bar_index_at(start_beat, meters);
  std::vector<std::size_t> bar_onsets(
      static_cast<std::size_t>(last_bar_of(meters, start_beat, end_beat) - first_bar + 1), 0);
  for (const Onset& onset : onsets) {
    double index = bar_index_at(onset.beat, meters) - first_bar;
    if (index >= 0 && index < static_cast<double>(bar_onsets.size())) {
      bar_onsets[static_cast<std::size_t>(index)] += 1;
    }
  }

  std::vector<double> onset_levels(RHYTHM_LEVEL_COUNT, 0);
  double off_grid_count = 0;
  for (const SnappedOnset& onset : snapped) {
    onset_levels[static_cast<std::size_t>(onset.level)] += 1;
    if (onset.offGrid) {
      off_grid_count += 1;
    }
  }
  for (double& level : onset_levels) {
    level = level / onset_count;
  }

  std::vector<BarPositionProfile> profiles;
  std::map<std::string, std::size_t> profile_index;
  for (const SnappedOnset& onset : snapped) {
    std::string key = ts_key(onset.ts);
    auto found = profile_index.find(key);
    if (found == profile_index.end()) {
      found = profile_index.emplace(key, profiles.size()).first;
      BarPositionProfile profile;
      profile.ts = onset.ts;
      profile.slotsPerBar =
          static_cast<int>(std::ceil(beats_per_bar(onset.ts) * RHYTHM_SLOTS_PER_BEAT));
      profile.shares.assign(static_cast<std::size_t>(profile.slotsPerBar), 0);
      profiles.push_back(std::move(profile));
    }
    BarPositionProfile& profile = profiles[found->second];
    double slots = profile.slotsPerBar;
    double slot_index = js::floor_mod(onset.slot, slots);
    profile.shares[static_cast<std::size_t>(slot_index)] += 1;
    profile.onsets += 1;
  }
  for (BarPositionProfile& profile : profiles) {
    for (double& share : profile.shares) {
      share = share / static_cast<double>(profile.onsets);
    }
  }

  std::vector<double> inter_onset_shares(ioi_bins().size(), 0);
  for (std::size_t i = 0; i < onsets.size(); ++i) {
    double ioi = i + 1 < onsets.size() ? onsets[i + 1].beat - onsets[i].beat
                                       : onsets[i].end - onsets[i].beat;
    inter_onset_shares[static_cast<std::size_t>(ioi_bin_index(ioi))] += 1;
  }
  for (double& share : inter_onset_shares) {
    share = share / onset_count;
  }

  double rest_ratio = rest_ratio_of(sounding, start_beat, end_beat);
  double syncopation = syncopation_of(snapped, start_beat, end_beat, meters);

  RhythmAnalysis out;
  out.startBeat = start_beat;
  out.endBeat = end_beat;
  out.bars = bars;
  out.onsets = onsets.size();
  out.onsetDensity = onset_density;
  out.barOnsets = std::move(bar_onsets);
  out.onsetLevels = std::move(onset_levels);
  out.barPositions = std::move(profiles);
  out.interOnsetShares = std::move(inter_onset_shares);
  out.restRatio = rest_ratio;
  out.syncopation = syncopation;
  out.offGridRatio = off_grid_count / onset_count;
  out.rationale = js::to_string(onset_count) + " onsets over " + js::to_fixed(bars, 2) + " bars (" +
                  js::to_fixed(onset_density, 2) + " per bar), " +
                  js::to_string(js::round(rest_ratio * 100)) + "% rest, syncopation " +
                  js::to_fixed(syncopation, 2);
  return out;
}

}  // namespace cantus
