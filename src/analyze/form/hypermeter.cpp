// Hypermeter, the grouping of bars into hyperbars: ts/src/analyze/form/hypermeter.ts.

#include "analyze/form/hypermeter.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <string>

#include "analyze/adjacency.h"
#include "analyze/form/internal.h"
#include "analyze/grid.h"
#include "analyze/timeline/timeline.h"
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
    if (js::floor_mod(slices[i].index - phase, group_bars) == 0) {
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

/** A cadence read in bars: where it arrives, and the last bar its chord sounds in. */
struct CadenceBar {
  double arrival;
  double last;
  double strength;
};

/** The cadences as bars, in the meters the search resolved. */
using CadenceBarsOf = std::function<std::vector<CadenceBar>(const MeterArg&)>;

/** How well a reading's group ends meet the cadences (`CadenceFit`). */
struct CadenceFit {
  /** Share of the group ends a cadence closes, whatever its type. */
  double closed = 0;
  /** The same share with each end weighed by the strongest cadence closing it. */
  double weighted = 0;
};

/** `bars.set(bar, Math.max(bars.get(bar) ?? 0, strength))`. */
void credit(std::map<double, double>& bars, double bar, double strength) {
  auto held = bars.find(bar);
  bars[bar] = js::max(held != bars.end() ? held->second : 0, strength);
}

/** Share of the hyperbar ends the reading predicts that a cadence closes (`cadenceFitOf`). */
CadenceFit cadence_fit_of(const std::vector<CadenceBar>& cadences,
                          const std::vector<BarSlice>& slices, int group_bars, int phase) {
  double last_bar = slices.empty() ? -1 : slices.back().index;
  // Each cadence counts once: it closes the first group end at or after its arrival while its
  // chord still sounds there; failing that, one arriving on a group head is elided into it.
  std::map<double, double> closing;
  std::map<double, double> eliding;
  for (const CadenceBar& cadence : cadences) {
    double end =
        cadence.arrival + js::floor_mod(group_bars - 1 + phase - cadence.arrival, group_bars);
    if (end <= cadence.last) {
      credit(closing, end, cadence.strength);
    } else if (js::floor_mod(cadence.arrival - phase, group_bars) == 0 &&
               // Elision needs a next group to arrive into.
               cadence.arrival <= last_bar) {
      credit(eliding, cadence.arrival - 1, cadence.strength);
    }
  }
  double ends = 0;
  double closed = 0;
  double weighted = 0;
  for (const BarSlice& slice : slices) {
    // A pickup heads no group, so it ends none either.
    if (slice.index < 0 || js::floor_mod(slice.index - phase, group_bars) != group_bars - 1) {
      continue;
    }
    ends += 1;
    auto final_found = closing.find(slice.index);
    auto elided_found = eliding.find(slice.index);
    bool has_final = final_found != closing.end();
    bool has_elided = elided_found != eliding.end();
    closed += js::max(has_final ? GROUP_FINAL_FIT : 0, has_elided ? ELIDED_FIT : 0);
    weighted += js::max(GROUP_FINAL_FIT * (has_final ? final_found->second : 0),
                        ELIDED_FIT * (has_elided ? elided_found->second : 0));
  }
  return ends == 0 ? CadenceFit{} : CadenceFit{clamp01(closed / ends), clamp01(weighted / ends)};
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

/** The search behind hypermeter_with() and hypermeter_over(), over cadences read as bars. */
Hypermeter hypermeter_core(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceBarsOf& cadence_bars) {
  // Read once, here: every bar question below is asked of the resolved map.
  ResolveMetersOptions meter_options;
  meter_options.meters = meter;
  MeterMap meters_map = resolve_meters(meter_options, "meter");
  const MeterArg meters(meters_map);
  NoteEventAssertOptions note_options;
  note_options.allowNonPositiveDuration = true;
  note_options.budget = opts.budget;
  assert_note_events(notes, "hypermeter notes", note_options);
  std::vector<NoteEvent> sounding = drop_silent_notes(notes);
  double first_onset = first_sounding_beat(sounding);
  double span_end = resolve_span_end(opts.totalBeats, first_onset, latest_sounding_end(sounding),
                                     "hypermeter totalBeats");
  // Whether the music starts before the downbeat is the analysis-wide pickup question.
  double span_start = bar_grid_start(first_onset, meters);
  if (sounding.empty() || span_end <= span_start + BEAT_EPS) {
    // Nothing sounds, so there is no bar to group, as sections report no section for it.
    return undecided_reading({});
  }
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
  std::vector<CadenceBar> bars = cadence_bars(meters);
  bool has_cadences = !bars.empty();

  std::vector<Reading> readings;
  for (int group_bars : candidates) {
    struct Phase {
      int phase;
      double contrast;
      CadenceFit fit;
    };
    std::vector<Phase> phases;
    for (int phase = 0; phase < group_bars; ++phase) {
      phases.push_back(Phase{phase, accent_contrast(novelty, slices, group_bars, phase),
                             cadence_fit_of(bars, slices, group_bars, phase)});
    }
    // Where the cadences are known, they decide the phase on the weighted fit; across the
    // groupings it is the share of ends closed that counts.
    double best_fit = 0;
    for (const Phase& reading : phases) {
      best_fit = js::max(best_fit, reading.fit.weighted);
    }
    for (const Phase& entry : phases) {
      if (has_cadences && entry.fit.weighted < best_fit - BEAT_EPS) {
        continue;
      }
      double cadence_fit = entry.fit.closed;
      double evidence = clamp01(has_cadences ? CONTRAST_SHARE * clamp01(entry.contrast) +
                                                   CADENCE_SHARE * cadence_fit
                                             : entry.contrast);
      readings.push_back(Reading{group_bars, entry.phase, entry.contrast, cadence_fit, evidence,
                                 evidence * prior_of(group_bars)});
    }
  }
  // Ties keep the commoner grouping, then the shorter one, then the earlier phase.
  std::stable_sort(readings.begin(), readings.end(), [](const Reading& a, const Reading& b) {
    double order = js::or_else(
        b.score - a.score, js::or_else(prior_of(b.groupBars) - prior_of(a.groupBars),
                                       js::or_else(a.groupBars - b.groupBars, a.phase - b.phase)));
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
    if (slice.index >= 0 && js::floor_mod(slice.index - best.phase, best.groupBars) == 0) {
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

}  // namespace

std::vector<CadenceSpan> cadence_spans(const std::vector<CadenceArrival>& arrivals,
                                       const std::vector<SegmentSpan>& segments) {
  std::vector<CadenceSpan> spans;
  for (const CadenceArrival& arrival : arrivals) {
    const SegmentSpan* arriving = segment_span_starting_at(segments, arrival.atBeat);
    spans.push_back(CadenceSpan{arrival.atBeat,
                                arriving != nullptr ? arriving->endBeat : arrival.atBeat,
                                arrival.strength});
  }
  return spans;
}

Hypermeter hypermeter_with(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceBars& cadence_bars) {
  return hypermeter_core(notes, meter, opts, [&](const MeterArg& meters) {
    std::vector<CadenceBar> bars;
    for (double bar : cadence_bars(meters)) {
      bars.push_back(CadenceBar{bar, bar, 1});
    }
    return bars;
  });
}

Hypermeter hypermeter_over(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceSpans& spans) {
  return hypermeter_core(notes, meter, opts, [&](const MeterArg& meters) {
    std::vector<CadenceBar> bars;
    for (const CadenceSpan& span : spans()) {
      bars.push_back(CadenceBar{bar_index_at(span.atBeat, meters),
                                last_bar_of(meters, span.atBeat, span.endBeat), span.strength});
    }
    return bars;
  });
}

Hypermeter hypermeter(const std::vector<NoteEvent>& notes, const std::optional<MeterArg>& meter,
                      const HypermeterOptions& opts) {
  return hypermeter_over(notes, meter, opts, [&] {
    std::vector<CadenceArrival> arrivals;
    if (opts.cadenceBeats) {
      for (double beat : *opts.cadenceBeats) {
        arrivals.push_back(CadenceArrival{beat, 1});
      }
    }
    return cadence_spans(arrivals, {});
  });
}

}  // namespace cantus
