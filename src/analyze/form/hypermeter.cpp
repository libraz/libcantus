// Hypermeter, the grouping of bars into hyperbars: ts/src/analyze/form/hypermeter.ts.

#include "analyze/form/hypermeter.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <string>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** GROUP_CANDIDATES: the bar groupings the search considers. */
constexpr int kGroupCandidates[] =
#include "analyze/form/group_candidates.gen.inc"
    ;

/** A grouping and how readily it is believed before the music is consulted. */
struct GroupPrior {
  int groups;
  double prior;
};

/** GROUP_PRIOR_LIST. */
constexpr GroupPrior kGroupPriors[] =
#include "analyze/form/group_prior_list.gen.inc"
    ;

/** `GROUP_PRIOR.get(groupBars) ?? 0`. */
double prior_of(int group_bars) {
  for (const GroupPrior& entry : kGroupPriors) {
    if (entry.groups == group_bars) {
      return entry.prior;
    }
  }
  return 0;
}

/** One grouping-and-phase reading, with the evidence behind it (`Reading`). */
struct Reading {
  int groupBars;
  int phase;
  double contrast;
  double cadenceFit;
  double evidence;
  double score;
};

/** How much more the group heads are accented than the bars between them (`accentContrast`). */
double accent_contrast(const std::vector<double>& novelty, const std::vector<BarSlice>& slices,
                       int group_bars, int phase) {
  double head_sum = 0;
  double head_count = 0;
  double other_sum = 0;
  double other_count = 0;
  for (std::size_t i = 0; i < slices.size(); ++i) {
    double value = novelty[i];
    if (floor_mod(slices[i].index - phase, group_bars) == 0) {
      head_sum += value;
      head_count += 1;
    } else {
      other_sum += value;
      other_count += 1;
    }
  }
  if (head_count == 0 || other_count == 0) {
    return 0;
  }
  return head_sum / head_count - other_sum / other_count;
}

/** Share of the hyperbar ends the reading predicts that a cadence closes (`cadenceFitOf`). */
double cadence_fit_of(const std::set<double>& cadence_bars, const std::vector<BarSlice>& slices,
                      int group_bars, int phase) {
  double last_bar = slices.empty() ? -1 : slices.back().index;
  double ends = 0;
  double fit = 0;
  for (const BarSlice& slice : slices) {
    // A pickup heads no group, so it ends none either.
    if (slice.index < 0 || floor_mod(slice.index - phase, group_bars) != group_bars - 1) {
      continue;
    }
    ends += 1;
    if (cadence_bars.count(slice.index) > 0) {
      fit += GROUP_FINAL_FIT;
    } else if (slice.index < last_bar && cadence_bars.count(slice.index + 1) > 0) {
      // Elision needs a next group to arrive into.
      fit += ELIDED_FIT;
    }
  }
  return ends == 0 ? 0 : clamp01(fit / ends);
}

/** The reading a span too short to hold two of any candidate grouping gets. */
Hypermeter undecided_reading(const std::vector<BarSlice>& slices) {
  std::vector<const BarSlice*> full_bars;
  for (const BarSlice& slice : slices) {
    if (slice.index >= 0) {
      full_bars.push_back(&slice);
    }
  }
  Hypermeter out;
  out.groupBars = static_cast<int>(std::max<std::size_t>(1, full_bars.size()));
  if (!full_bars.empty()) {
    out.downbeats.push_back(full_bars.front()->startBeat);
  }
  out.confidence = 0;
  out.rationale = "Span of " + js::to_string(static_cast<double>(full_bars.size())) +
                  " bar(s) is too short to establish a grouping; read as one group";
  return out;
}

/** `a || b` over two sort keys: b where a is 0 or NaN. */
double or_else(double a, double b) { return a != 0 && !std::isnan(a) ? a : b; }

}  // namespace

Hypermeter hypermeter_with(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceBars& cadence_bars) {
  // Read once, here: every bar question below is asked of the resolved map.
  ResolveMetersOptions meter_options;
  meter_options.meters = meter;
  MeterMap meters_map = resolve_meters(meter_options, "meter");
  const MeterArg meters(meters_map);
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "hypermeter notes", note_options);
  std::vector<NoteEvent> sounding;
  for (const NoteEvent& note : notes) {
    if (note.durationBeat > 0) {
      sounding.push_back(note);
    }
  }
  double first_onset = first_sounding_beat(sounding);
  double span_end = opts.totalBeats.value_or(latest_sounding_end(sounding));
  assert_range(span_end, js::min(0, first_onset), kMaxSafeInteger, "hypermeter totalBeats");
  // Whether the music starts before the downbeat is the analysis-wide pickup question.
  double span_start = bar_grid_start(first_onset, meters);
  std::vector<BarSlice> slices = slice_bars(sounding, meters, span_start, span_end, opts.budget);

  // Counted over the bars a grouping can actually occupy: a pickup leads into the first hyperbar
  // rather than filling one.
  double full_bars = 0;
  for (const BarSlice& slice : slices) {
    if (slice.index >= 0) {
      full_bars += 1;
    }
  }
  std::vector<int> candidates;
  for (int group_bars : kGroupCandidates) {
    if (full_bars >= static_cast<double>(group_bars) * MIN_GROUPS) {
      candidates.push_back(group_bars);
    }
  }
  if (candidates.empty()) {
    return undecided_reading(slices);
  }
  double readings_cost = 0;
  for (int group_bars : candidates) {
    readings_cost += static_cast<double>(group_bars) * static_cast<double>(slices.size());
  }
  assert_generation_budget(readings_cost, "hypermeter readings", opts.budget);

  std::vector<double> novelty;
  for (std::size_t index = 0; index < slices.size(); ++index) {
    novelty.push_back(harmonic_novelty(slices, index));
  }
  std::set<double> bars;
  for (double bar : cadence_bars(meters)) {
    bars.insert(bar);
  }
  bool has_cadences = !bars.empty();

  std::vector<Reading> readings;
  for (int group_bars : candidates) {
    struct Phase {
      int phase;
      double contrast;
      double cadence_fit;
    };
    std::vector<Phase> phases;
    for (int phase = 0; phase < group_bars; ++phase) {
      phases.push_back(Phase{phase, accent_contrast(novelty, slices, group_bars, phase),
                             cadence_fit_of(bars, slices, group_bars, phase)});
    }
    // Where the cadences are known, they decide the phase.
    double best_fit = 0;
    for (const Phase& reading : phases) {
      best_fit = js::max(best_fit, reading.cadence_fit);
    }
    for (const Phase& entry : phases) {
      if (has_cadences && entry.cadence_fit < best_fit - BEAT_EPS) {
        continue;
      }
      double evidence = clamp01(has_cadences ? CONTRAST_SHARE * clamp01(entry.contrast) +
                                                   CADENCE_SHARE * entry.cadence_fit
                                             : entry.contrast);
      readings.push_back(Reading{group_bars, entry.phase, entry.contrast, entry.cadence_fit,
                                 evidence, evidence * prior_of(group_bars)});
    }
  }
  // Ties keep the commoner grouping, then the shorter one, then the earlier phase.
  std::stable_sort(readings.begin(), readings.end(), [](const Reading& a, const Reading& b) {
    double order =
        or_else(b.score - a.score, or_else(prior_of(b.groupBars) - prior_of(a.groupBars),
                                           or_else(a.groupBars - b.groupBars, a.phase - b.phase)));
    return order < 0;
  });
  if (readings.empty()) {
    return undecided_reading(slices);
  }
  const Reading& best = readings.front();
  const Reading* runner_up = nullptr;
  for (const Reading& reading : readings) {
    if (reading.groupBars != best.groupBars) {
      runner_up = &reading;
      break;
    }
  }
  double margin = runner_up == nullptr || best.score <= BEAT_EPS
                      ? 1
                      : clamp01((best.score - runner_up->score) / best.score);

  // An upbeat leads into the first hyperbar, so it never becomes a hypermetric downbeat.
  Hypermeter out;
  for (const BarSlice& slice : slices) {
    if (slice.index >= 0 && floor_mod(slice.index - best.phase, best.groupBars) == 0) {
      out.downbeats.push_back(slice.startBeat);
    }
  }
  std::string cadence_part = has_cadences ? js::to_string(js::round(best.cadenceFit * 100)) +
                                                "% of group ends closed by a cadence"
                                          : "no cadences given";
  out.groupBars = best.groupBars;
  out.confidence = clamp01(best.evidence * (MARGIN_FLOOR + (1 - MARGIN_FLOOR) * margin));
  out.rationale = js::to_string(best.groupBars) + "-bar groups from bar " +
                  js::to_string(best.phase) + ": harmonic change " +
                  js::to_string(js::round(best.contrast * 100)) + "% stronger on group heads, " +
                  cadence_part;
  return out;
}

Hypermeter hypermeter(const std::vector<NoteEvent>& notes, const std::optional<MeterArg>& meter,
                      const HypermeterOptions& opts) {
  return hypermeter_with(notes, meter, opts, [&](const MeterArg& meters) {
    std::vector<double> bars;
    if (opts.cadenceBeats) {
      for (double beat : *opts.cadenceBeats) {
        bars.push_back(bar_index_at(beat, meters));
      }
    }
    return bars;
  });
}

}  // namespace cantus
