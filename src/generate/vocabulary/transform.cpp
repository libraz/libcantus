// The figure transforms of ts/src/generate/vocabulary/transform.ts, over GridEvent.

#include "generate/vocabulary/transform.h"

#include <cmath>
#include <string>
#include <variant>

#include "cantus/core/errors.h"
#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/context/difficulty.h"
#include "generate/context/draw.h"

namespace cantus {

const TimeSignature kFigureTs =
#include "generate/vocabulary/figure_ts.gen.inc"
    ;

namespace {

/** The first subdivision of a pulse: half of it in a simple meter, a third in a compound one. */
double subdivision_beats(const TimeSignature& ts) {
  double pulse = pulse_beats(ts);
  return is_compound(ts) ? pulse / 3 : pulse / 2;
}

/** GridEvent as a grid model: the stream is the limb, else the voice, else the one stream. */
struct GridEventModel {
  using Event = GridEvent;
  using Velocity = double;
  using StreamKey = std::string;

  static double step(const GridEvent& e) { return e.step; }
  static double velocity(const GridEvent& e) { return e.velocity; }
  static double scaled(double v, double factor) { return v * factor; }
  static bool louder(double a, double b) { return a > b; }
  static std::string stream_text(const GridEvent& e) {
    return e.limb ? *e.limb : e.voice ? *e.voice : std::string();
  }
  static std::string stream_key(const GridEvent& e) { return stream_text(e); }
  static bool same_stream(const std::string& a, const std::string& b) { return a == b; }
  static GridEvent placed(const GridEvent& e, double at) {
    GridEvent out = e;
    out.step = at;
    return out;
  }
  static GridEvent placed(const GridEvent& e, double at, double v) {
    GridEvent out = e;
    out.step = at;
    out.velocity = v;
    return out;
  }
};

/** A Draw bound to a path. */
struct PathSampler {
  const Draw& draw;
  const SeedPath& path;

  bool prob(double p, const SeedPath& key) const {
    SeedPath full = path;
    full.insert(full.end(), key.begin(), key.end());
    return draw.prob(p, full);
  }
};

/** `assertGridEvents`: every onset has a finite step. */
const std::vector<GridEvent>& assert_grid_events(const std::vector<GridEvent>& events) {
  for (std::size_t index = 0; index < events.size(); ++index) {
    assert_finite_number(events[index].step, "figure events[" + index_text(index) + "].step");
  }
  return events;
}

const OrnamentTest& assert_ornament_test(const OrnamentTest& test, std::string_view name) {
  if (!test) {
    throw InvalidInputError(std::string(name) + " must be a function; received undefined");
  }
  return test;
}

/** deform()'s options, read in the order `resolveDials` reads them. */
struct TypedDeformPlan {
  const DeformOptions& opts;
  const MeterArg& ts;

  FigureRate rate() const { return opts.rate.value_or(FigureRate::kStraight); }
  std::optional<double> rhythmic() const {
    if (!opts.rhythmic) {
      return std::nullopt;
    }
    return assert_range(*opts.rhythmic, 0, 1, "complexity rhythmic");
  }
  TimeSignature signature() const { return figure_signature(ts); }
  std::optional<OrnamentRequest<GridEventModel>> ornament() const {
    if (!opts.ornament) {
      return std::nullopt;
    }
    double amount = assert_range(*opts.ornament, 0, 1, "ornament amount");
    if (!opts.isOrnament) {
      return std::nullopt;
    }
    return OrnamentRequest<GridEventModel>{opts.isOrnament, amount};
  }
};

}  // namespace

int step_weight(double step, const TimeSignature& ts) {
  double beats = step * STEP_BEATS;
  int weight = metric_weight(beats, ts);
  if (weight > 0) {
    return weight + 1;
  }
  double divisions = beats / subdivision_beats(ts);
  return std::abs(divisions - js::round(divisions)) < 1e-9 ? 1 : 0;
}

double assert_span_steps(double span_steps) {
  return assert_positive_int(span_steps, "figure span steps");
}

TimeSignature figure_signature(const MeterArg& ts) { return meter_at(0, to_meter_data(ts, "ts")); }

std::string_view to_string(FigureRate rate) {
  switch (rate) {
    case FigureRate::kStraight:
      return "straight";
    case FigureRate::kHalf:
      return "half";
    case FigureRate::kDouble:
      return "double";
  }
  return "straight";
}

std::vector<std::string_view> figure_rate_names() {
  return {to_string(FigureRate::kStraight), to_string(FigureRate::kHalf),
          to_string(FigureRate::kDouble)};
}

std::optional<FigureRate> parse_figure_rate(std::string_view name) {
  for (FigureRate rate : {FigureRate::kStraight, FigureRate::kHalf, FigureRate::kDouble}) {
    if (to_string(rate) == name) {
      return rate;
    }
  }
  return std::nullopt;
}

int grid_metric_weight(double step, const MeterArg& ts) {
  // Checked first: a missing step would read as beat 0, the downbeat.
  assert_finite_number(step, "step");
  return step_weight(step, figure_signature(ts));
}

std::vector<GridEvent> thin(const std::vector<GridEvent>& events, double amount,
                            const MeterArg& ts) {
  const std::vector<GridEvent>& figure = assert_grid_events(events);
  assert_range(amount, 0, 1, "thin amount");
  return thin_figure<GridEventModel>(figure, amount, figure_signature(ts));
}

std::vector<GridEvent> double_(const std::vector<GridEvent>& events, int span_steps) {
  double span = assert_span_steps(span_steps);
  return double_figure<GridEventModel>(assert_grid_events(events), span);
}

std::vector<GridEvent> half_time(const std::vector<GridEvent>& events, int span_steps) {
  double span = assert_span_steps(span_steps);
  return half_time_figure<GridEventModel>(assert_grid_events(events), span);
}

std::vector<GridEvent> double_time(const std::vector<GridEvent>& events, int span_steps) {
  double span = assert_span_steps(span_steps);
  return double_time_figure<GridEventModel>(assert_grid_events(events), span);
}

std::vector<GridEvent> syncopate(const std::vector<GridEvent>& events,
                                 const SyncopateAmount& amount, const Draw& draw,
                                 const SeedPath& path) {
  const std::vector<GridEvent>& figure = assert_grid_events(events);
  assert_seed_path(path);
  const SyncopateOptions* asked = std::get_if<SyncopateOptions>(&amount);
  double dial = asked == nullptr ? std::get<double>(amount) : asked->amount;
  TimeSignature signature =
      asked != nullptr && asked->ts ? figure_signature(*asked->ts) : figure_signature(kFigureTs);
  assert_range(dial, 0, 1, "syncopate amount");
  return syncopate_figure<GridEventModel>(figure, dial, signature, PathSampler{draw, path});
}

std::vector<GridEvent> ornament_by(const std::vector<GridEvent>& events,
                                   const OrnamentTest& is_ornament, double amount, const Draw& draw,
                                   const SeedPath& path) {
  const std::vector<GridEvent>& figure = assert_grid_events(events);
  const OrnamentTest& marks = assert_ornament_test(is_ornament, "isOrnament");
  assert_seed_path(path);
  assert_range(amount, 0, 1, "ornament amount");
  return ornament_figure<GridEventModel>(figure, marks, amount, PathSampler{draw, path});
}

std::vector<GridEvent> deform(const std::vector<GridEvent>& events, const DeformOptions& opts,
                              const Draw& draw, const SeedPath& path) {
  const std::vector<GridEvent>& figure = assert_grid_events(events);
  assert_seed_path(path);
  double span = assert_span_steps(opts.spanSteps.value_or(BAR_STEPS));
  MeterArg ts = opts.ts.value_or(MeterArg(kFigureTs));
  TypedDeformPlan plan{opts, ts};
  return deform_figure<GridEventModel>(figure, span, plan, PathSampler{draw, path});
}

bool within_ceiling(const std::vector<GridEvent>& events, std::optional<double> bpm,
                    std::optional<double> difficulty) {
  const std::vector<GridEvent>& figure = assert_grid_events(events);
  if (!difficulty || !bpm) {
    return true;
  }
  assert_finite_number(*bpm, "bpm");
  assert_difficulty(*difficulty);
  return figure_within_ceiling<GridEventModel>(figure, *bpm, *difficulty);
}

}  // namespace cantus
