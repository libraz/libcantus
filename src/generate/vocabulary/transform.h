/**
 * @file transform.h
 * @brief The figure transforms of ts/src/generate/vocabulary/transform.ts, written once over a
 *        grid model so the typed API, the drum generators and the op layer share one body.
 *
 * TS writes the transforms generically over any record extending GridEvent. Here a model `M`
 * says how an onset is read and rebuilt:
 *
 * - `M::Event`, the onset; `M::Velocity`, what its `velocity` holds; `M::StreamKey`, `streamOf`
 *   as a Map key.
 * - `M::step(e)`, the already checked finite step; `M::velocity(e)`.
 * - `M::scaled(v, factor)`, `v * factor`; `M::louder(a, b)`, `a > b`.
 * - `M::stream_text(e)`, `${streamOf(e)}`; `M::stream_key(e)` and `M::same_stream(a, b)`, the
 *   SameValueZero identity of `streamOf(e)`.
 * - `M::placed(e, step)`, `{ ...e, step }`; `M::placed(e, step, v)`, `{ ...e, step, velocity }`.
 *
 * A sampler `S` is a draw bound to its path: `s.prob(p, key)` is `draw.prob(p, ...path, ...key)`,
 * with the key from draw_key(). The functions here run after their arguments have been checked;
 * the checks stay with the callers, in TS order.
 */
#ifndef CANTUS_SRC_GENERATE_VOCABULARY_TRANSFORM_H_
#define CANTUS_SRC_GENERATE_VOCABULARY_TRANSFORM_H_

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <functional>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/vocabulary.h"
#include "generate/context/draw.h"
#include "generate/vocabulary/limits.gen.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

/**
 * The model of an onset with a `step` and a `velocity`, but for how its stream is named: a model
 * derives from it and adds `stream_text(e)`.
 */
template <class Derived, class E>
struct StepModel {
  using Event = E;
  using Velocity = double;
  using StreamKey = std::string;

  static double step(const E& e) { return e.step; }
  static double velocity(const E& e) { return e.velocity; }
  static double scaled(double v, double factor) { return v * factor; }
  static bool louder(double a, double b) { return a > b; }
  static std::string stream_key(const E& e) { return Derived::stream_text(e); }
  static bool same_stream(const std::string& a, const std::string& b) { return a == b; }
  static E placed(const E& e, double at) {
    E out = e;
    out.step = at;
    return out;
  }
  static E placed(const E& e, double at, double v) {
    E out = e;
    out.step = at;
    out.velocity = v;
    return out;
  }
};

/** A Draw bound to a path, as the transforms sample it. */
struct BoundSampler {
  const Draw& draw;
  SeedPath path;

  bool prob(double p, const SeedPath& key) const {
    SeedPath full = path;
    full.insert(full.end(), key.begin(), key.end());
    return draw.prob(p, full);
  }
};

/** gridMetricWeight against a signature already read (`stepWeight`). */
int step_weight(double step, const TimeSignature& ts);

/**
 * The figure's length in steps (`assertSpanSteps`).
 * @throws InvalidInputError if it is not a positive integer.
 */
double assert_span_steps(double span_steps);

/** `meterAt(0, toMeterData(ts, 'ts'))`. */
TimeSignature figure_signature(const MeterArg& ts);

/** The names of the figure rates (`FIGURE_RATES`), for assert_one_of(). */
std::vector<std::string_view> figure_rate_names();

/** Stable sort by step, as `sort((a, b) => a.step - b.step)` orders finite steps. */
template <class M>
void sort_by_step(std::vector<typename M::Event>& events) {
  std::stable_sort(events.begin(), events.end(),
                   [](const typename M::Event& a, const typename M::Event& b) {
                     return M::step(a) < M::step(b);
                   });
}

/** `${streamOf(event)}@${step}`, the key a stream's position is held under (`positionKey`). */
template <class M>
std::string position_key(const typename M::Event& event, double step) {
  return M::stream_text(event) + "@" + js::to_string(step);
}

/** The draw an onset is decided by, after its tag: its stream, when it has one, and its step. */
template <class M>
SeedPath draw_key(std::string_view tag, const typename M::Event& event) {
  std::string stream = M::stream_text(event);
  if (stream.empty()) {
    return SeedPath{std::string(tag), M::step(event)};
  }
  return SeedPath{std::string(tag), std::move(stream), M::step(event)};
}

/** Where an onset lands at double time: a whole step on the nearest sixteenth, any other exactly.
 */
inline double halved_step(double step) {
  return std::trunc(step) == step ? js::round(step / 2) : step / 2;
}

/** `thin`: keep the onsets ranked at or above the floor the amount names. */
template <class M>
std::vector<typename M::Event> thin_figure(const std::vector<typename M::Event>& figure,
                                           double amount, const TimeSignature& signature) {
  // Five ranks (0..4), so a full turn of the dial reaches the downbeat alone.
  double floor_rank = js::min(4, std::floor(amount * 5));
  std::vector<typename M::Event> out;
  for (const typename M::Event& event : figure) {
    if (step_weight(M::step(event), signature) >= floor_rank) {
      out.push_back(event);
    }
  }
  return out;
}

/** `double`: one softer note halfway into each gap of a stream the grid has a position for. */
template <class M>
std::vector<typename M::Event> double_figure(const std::vector<typename M::Event>& figure,
                                             double span_steps) {
  std::vector<typename M::Event> sorted = figure;
  sort_by_step<M>(sorted);
  // The next onset of each event's own stream, found walking back from the end.
  std::vector<double> next_step(sorted.size(), span_steps);
  std::vector<std::pair<typename M::StreamKey, double>> following;
  for (std::size_t i = sorted.size(); i-- > 0;) {
    typename M::StreamKey key = M::stream_key(sorted[i]);
    auto held = std::find_if(following.begin(), following.end(), [&key](const auto& entry) {
      return M::same_stream(entry.first, key);
    });
    if (held == following.end()) {
      following.emplace_back(std::move(key), M::step(sorted[i]));
    } else {
      next_step[i] = held->second;
      held->second = M::step(sorted[i]);
    }
  }
  std::vector<typename M::Event> out;
  for (std::size_t i = 0; i < sorted.size(); ++i) {
    const typename M::Event& event = sorted[i];
    out.push_back(event);
    double step = M::step(event);
    double mid = step + (next_step[i] - step) / 2;
    if (std::isfinite(mid) && std::trunc(mid) == mid && mid > step && mid < span_steps) {
      out.push_back(M::placed(event, mid, M::scaled(M::velocity(event), ADDED_NOTE_VELOCITY)));
    }
  }
  sort_by_step<M>(out);
  return out;
}

/** `halfTime`: every step doubled, and what falls past the span dropped. */
template <class M>
std::vector<typename M::Event> half_time_figure(const std::vector<typename M::Event>& figure,
                                                double span_steps) {
  std::vector<typename M::Event> out;
  for (const typename M::Event& event : figure) {
    double step = M::step(event) * 2;
    if (step < span_steps) {
      out.push_back(M::placed(event, step));
    }
  }
  return out;
}

/** `doubleTime`: halved and repeated, at most one onset per stream and step, the louder kept. */
template <class M>
std::vector<typename M::Event> double_time_figure(const std::vector<typename M::Event>& figure,
                                                  double span_steps) {
  // A Map keeps the position of a key's first insertion when its value is replaced.
  std::vector<typename M::Event> merged;
  std::map<std::string, std::size_t> slots;
  auto place = [&merged, &slots](const typename M::Event& event, double step,
                                 const typename M::Velocity& velocity) {
    std::string key = position_key<M>(event, step);
    auto held = slots.find(key);
    if (held == slots.end()) {
      slots.emplace(std::move(key), merged.size());
      merged.push_back(M::placed(event, step, velocity));
    } else if (M::louder(velocity, M::velocity(merged[held->second]))) {
      merged[held->second] = M::placed(event, step, velocity);
    }
  };
  for (const typename M::Event& event : figure) {
    // An odd step is placed on the nearest position rather than dropped.
    double step = halved_step(M::step(event));
    place(event, step, M::velocity(event));
    double repeated = step + span_steps / 2;
    if (repeated < span_steps) {
      place(event, repeated, M::scaled(M::velocity(event), ADDED_NOTE_VELOCITY));
    }
  }
  sort_by_step<M>(merged);
  return merged;
}

/** `syncopate`: a softer anticipation one sixteenth before the beats the draw takes. */
template <class M, class S>
std::vector<typename M::Event> syncopate_figure(const std::vector<typename M::Event>& figure,
                                                double dial, const TimeSignature& signature,
                                                const S& sampler) {
  std::set<std::string> occupied;
  for (const typename M::Event& event : figure) {
    occupied.insert(position_key<M>(event, M::step(event)));
  }
  std::vector<typename M::Event> out = figure;
  for (const typename M::Event& event : figure) {
    double step = M::step(event);
    double anticipated = step - 1;
    // The downbeat takes none: its anticipation would fall in the bar before.
    if (step_weight(step, signature) < 2 || anticipated < 1 ||
        occupied.count(position_key<M>(event, anticipated)) > 0) {
      continue;
    }
    if (!sampler.prob(dial, draw_key<M>("syncopate", event))) {
      continue;
    }
    out.push_back(
        M::placed(event, anticipated, M::scaled(M::velocity(event), ADDED_NOTE_VELOCITY)));
  }
  sort_by_step<M>(out);
  return out;
}

/** `ornamentBy`: a decorated note survives on its own draw; the rest are untouched. */
template <class M, class S>
std::vector<typename M::Event> ornament_figure(
    const std::vector<typename M::Event>& figure,
    const std::function<bool(const typename M::Event&)>& marks, double amount, const S& sampler) {
  std::vector<typename M::Event> out;
  for (const typename M::Event& event : figure) {
    if (!marks(event) || sampler.prob(amount, draw_key<M>("ornament", event))) {
      out.push_back(event);
    }
  }
  return out;
}

/** The ornament half of a deform request, once its checks have passed. */
template <class M>
struct OrnamentRequest {
  std::function<bool(const typename M::Event&)> marks;
  double amount = 0;
};

/**
 * `deform` after `resolveDials`: every dial is read and checked up front, in TS order, whichever
 * of them the figure then uses:
 *
 * - `plan.rate()`: the FigureRate `asked.rate` selects;
 * - `plan.rhythmic()`: the checked rhythmic dial, or nullopt;
 * - `plan.signature()`: the checked meter;
 * - `plan.ornament()`: the checked ornament request, or nullopt when either the amount or the
 *   test is absent; each one present is checked, the amount first.
 */
template <class M, class P, class S>
std::vector<typename M::Event> deform_figure(const std::vector<typename M::Event>& figure,
                                             double span_steps, P& plan, const S& sampler) {
  FigureRate rate = plan.rate();
  std::optional<double> rhythmic = plan.rhythmic();
  TimeSignature signature = plan.signature();
  std::optional<OrnamentRequest<M>> ornament = plan.ornament();
  std::vector<typename M::Event> out =
      rate == FigureRate::kHalf     ? half_time_figure<M>(figure, span_steps)
      : rate == FigureRate::kDouble ? double_time_figure<M>(figure, span_steps)
                                    : figure;
  if (rhythmic && *rhythmic < NEUTRAL_RHYTHMIC) {
    // Less means the notes that carry the least of the figure's own metre.
    out = thin_figure<M>(out, (NEUTRAL_RHYTHMIC - *rhythmic) / NEUTRAL_RHYTHMIC, signature);
  } else if (rhythmic && *rhythmic > NEUTRAL_RHYTHMIC) {
    out = syncopate_figure<M>(out, (*rhythmic - NEUTRAL_RHYTHMIC) / NEUTRAL_RHYTHMIC, signature,
                              sampler);
  }
  if (ornament) {
    out = ornament_figure<M>(out, ornament->marks, ornament->amount, sampler);
  }
  sort_by_step<M>(out);
  return out;
}

/** `withinCeiling` after its checks: the closest pair of onsets within one stream. */
template <class M>
bool figure_within_ceiling(const std::vector<typename M::Event>& figure, double bpm,
                           double difficulty) {
  if (figure.size() < 2) {
    return true;
  }
  std::vector<std::pair<typename M::StreamKey, std::vector<double>>> streams;
  for (const typename M::Event& event : figure) {
    typename M::StreamKey key = M::stream_key(event);
    auto stream = std::find_if(streams.begin(), streams.end(), [&key](const auto& held) {
      return M::same_stream(held.first, key);
    });
    double step = M::step(event);
    if (stream == streams.end()) {
      streams.emplace_back(std::move(key), std::vector<double>{step});
    } else if (std::find(stream->second.begin(), stream->second.end(), step) ==
               stream->second.end()) {
      stream->second.push_back(step);
    }
  }
  double closest = std::numeric_limits<double>::infinity();
  for (auto& stream : streams) {
    std::vector<double>& steps = stream.second;
    std::stable_sort(steps.begin(), steps.end());
    for (std::size_t i = 1; i < steps.size(); ++i) {
      double gap = steps[i] - steps[i - 1];
      if (gap > 0 && gap < closest) {
        closest = gap;
      }
    }
  }
  if (!std::isfinite(closest)) {
    return true;
  }
  return sustains_strokes(closest * STEP_BEATS, bpm, difficulty);
}

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_VOCABULARY_TRANSFORM_H_
