#include "cantus/model/rhythm.h"

#include <algorithm>
#include <set>
#include <string>
#include <utility>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "generate/context/difficulty.h"
#include "generate/vocabulary/limits.gen.h"
#include "generate/vocabulary/transform.h"
#include "js/math.h"
#include "model/limits.gen.h"
#include "model/shared.h"

namespace cantus {

namespace {

/** The part name the pattern's draws are addressed under (`PART`). */
constexpr const char* kPart = "rhythm";

/** A grid onset that remembers the pattern onset it was built from (`SourcedGridEvent`). */
struct SourcedGridEvent {
  double step = 0;
  double velocity = 0;
  RhythmEvent source;
};

/** The grid model of a pattern's onsets: each carries its source onset through a transform. */
struct SourcedGridModel {
  using Event = SourcedGridEvent;
  using Velocity = double;
  using StreamKey = std::string;

  static double step(const Event& e) { return e.step; }
  static double velocity(const Event& e) { return e.velocity; }
  static double scaled(double v, double factor) { return v * factor; }
  static bool louder(double a, double b) { return a > b; }
  // A pattern onset names no limb and no voice, so every onset is in the one stream.
  static std::string stream_text(const Event&) { return std::string(); }
  static std::string stream_key(const Event&) { return std::string(); }
  static bool same_stream(const std::string& a, const std::string& b) { return a == b; }
  static Event placed(const Event& e, double at) {
    Event out = e;
    out.step = at;
    return out;
  }
  static Event placed(const Event& e, double at, double v) {
    Event out = e;
    out.step = at;
    out.velocity = v;
    return out;
  }
};

/** A part's samplers bound to the empty path the class draws under. */
struct PartSampler {
  const Draw& draw;

  bool prob(double p, std::string_view tag, double step) const {
    return draw.prob(p, SeedPath{std::string(tag), step});
  }
};

/** Defensive copy of one onset, checked as it is copied (`copyEvent`). */
RhythmEvent copy_event(const RhythmEvent& event, const std::string& name) {
  RhythmEvent copy;
  copy.position =
      without_negative_zero(assert_range(event.position, 0, kMaxSafeInteger, name + ".position"));
  copy.duration =
      without_negative_zero(assert_range(event.duration, 0, kMaxSafeInteger, name + ".duration"));
  return copy;
}

/** The onsets checked and copied, in time order (`copyEvents`). */
std::vector<RhythmEvent> copy_events(const std::vector<RhythmEvent>& events,
                                     const std::string& name) {
  std::vector<RhythmEvent> out;
  for (std::size_t index = 0; index < events.size(); ++index) {
    out.push_back(copy_event(events[index], name + "[" + index_text(index) + "]"));
  }
  std::stable_sort(out.begin(), out.end(), [](const RhythmEvent& a, const RhythmEvent& b) {
    double order = a.position - b.position;
    if (order == 0) {
      order = a.duration - b.duration;
    }
    return order < 0;
  });
  return out;
}

/** Where the pattern stops: the furthest point any onset sounds to (`spanOf`). */
double span_of(const std::vector<RhythmEvent>& events) {
  double end = 0;
  for (const RhythmEvent& event : events) {
    end = js::max(end, event.position + event.duration);
  }
  return end;
}

/** The pattern's onsets on the sixteenth grid (`toGrid`). */
std::vector<SourcedGridEvent> to_grid(const std::vector<RhythmEvent>& events) {
  std::vector<SourcedGridEvent> out;
  for (const RhythmEvent& event : events) {
    out.push_back(SourcedGridEvent{event.position / STEP_BEATS, GRID_VELOCITY, event});
  }
  return out;
}

/** The onsets a transform returned, read back as a pattern over the same span (`fromGrid`). */
std::vector<RhythmEvent> from_grid(const std::vector<SourcedGridEvent>& events, double span_beats) {
  std::vector<double> positions;
  for (const SourcedGridEvent& event : events) {
    double position = event.step * STEP_BEATS;
    if (std::find(positions.begin(), positions.end(), position) == positions.end()) {
      positions.push_back(position);
    }
  }
  std::stable_sort(positions.begin(), positions.end());
  std::vector<RhythmEvent> out;
  for (std::size_t index = 0; index < positions.size(); ++index) {
    double next = index + 1 < positions.size() ? positions[index + 1] : span_beats;
    out.push_back(RhythmEvent{positions[index], next - positions[index]});
  }
  return out;
}

/** deform()'s options, read in the order TS reads them. */
struct RhythmDeformPlan {
  const RhythmDeformOptions& opts;
  const ResolvedContext& resolved;
  const TimeSignature& ts;

  FigureRate rate() const { return opts.rate.value_or(FigureRate::kStraight); }
  std::optional<double> rhythmic() const {
    if (!resolved.rhythmic) {
      return std::nullopt;
    }
    return assert_range(*resolved.rhythmic, 0, 1, "complexity rhythmic");
  }
  TimeSignature signature() const { return figure_signature(MeterArg(ts)); }
  std::optional<OrnamentRequest<SourcedGridModel>> ornament() const {
    if (!resolved.ornament || !opts.isOrnament) {
      return std::nullopt;
    }
    const RhythmOrnamentTest& test = opts.isOrnament;
    std::function<bool(const SourcedGridEvent&)> marks = [&test](const SourcedGridEvent& e) {
      return test(e.source);
    };
    return OrnamentRequest<SourcedGridModel>{
        marks, assert_range(*resolved.ornament, 0, 1, "ornament amount")};
  }
};

}  // namespace

Rhythm::Rhythm(const RhythmData& data)
    : data_{copy_events(data.events, "rhythm events"), copy_time_signature(data.ts, "rhythm ts")} {}

Rhythm Rhythm::generate(const MeterArg& ts, const RhythmOptions& opts) {
  TimeSignature meter = meter_at(0, to_meter_data(ts, "ts"));
  return Rhythm(RhythmData{generate_rhythm(MeterArg(meter), opts), meter});
}

Rhythm Rhythm::of(const std::vector<RhythmEvent>& events, const MeterArg& ts) {
  return Rhythm(RhythmData{events, meter_at(0, to_meter_data(ts, "ts"))});
}

Rhythm Rhythm::from_data(const RhythmData& data) { return Rhythm(data); }

Rhythm Rhythm::from_json(const RhythmData& data) { return Rhythm(data); }

double Rhythm::total_beats() const { return span_of(data_.events); }

double Rhythm::density() const { return rhythm_density(data_.events, MeterArg(data_.ts)); }

namespace {

/** The same meter carrying the onsets a transform returned (`#withGrid`). */
Rhythm with_grid(const RhythmData& data, const std::vector<SourcedGridEvent>& events) {
  return Rhythm(RhythmData{from_grid(events, span_of(data.events)), data.ts});
}

/** The pattern's span as a count of sixteenths, for the transforms (`#spanSteps`). */
double span_steps(const RhythmData& data) { return span_of(data.events) / STEP_BEATS; }

}  // namespace

Rhythm Rhythm::thin(double amount) const {
  assert_range(amount, 0, 1, "thin amount");
  return with_grid(data_, thin_figure<SourcedGridModel>(to_grid(data_.events), amount,
                                                        figure_signature(MeterArg(data_.ts))));
}

Rhythm Rhythm::syncopate(double amount, const std::optional<GenerationContextInput>& ctx) const {
  std::vector<SourcedGridEvent> grid = to_grid(data_.events);
  Draw draw = resolve_context(ctx).part(kPart);
  TimeSignature signature = figure_signature(MeterArg(data_.ts));
  assert_range(amount, 0, 1, "syncopate amount");
  return with_grid(data_,
                   syncopate_figure<SourcedGridModel>(grid, amount, signature, PartSampler{draw}));
}

Rhythm Rhythm::double_time() const {
  double span = assert_span_steps(span_steps(data_));
  return with_grid(data_, double_time_figure<SourcedGridModel>(to_grid(data_.events), span));
}

Rhythm Rhythm::half_time() const {
  double span = assert_span_steps(span_steps(data_));
  return with_grid(data_, half_time_figure<SourcedGridModel>(to_grid(data_.events), span));
}

Rhythm Rhythm::ornament_by(const RhythmOrnamentTest& is_ornament, double amount,
                           const std::optional<GenerationContextInput>& ctx) const {
  std::vector<SourcedGridEvent> grid = to_grid(data_.events);
  Draw draw = resolve_context(ctx).part(kPart);
  assert_range(amount, 0, 1, "ornament amount");
  std::function<bool(const SourcedGridEvent&)> marks = [&is_ornament](const SourcedGridEvent& e) {
    return is_ornament(e.source);
  };
  return with_grid(data_,
                   ornament_figure<SourcedGridModel>(grid, marks, amount, PartSampler{draw}));
}

Rhythm Rhythm::deform(const RhythmDeformOptions& opts,
                      const std::optional<GenerationContextInput>& ctx) const {
  ResolvedContext resolved = resolve_context(ctx);
  Draw draw = resolved.part(kPart);
  double span = assert_span_steps(span_steps(data_));
  RhythmDeformPlan plan{opts, resolved, data_.ts};
  return with_grid(
      data_, deform_figure<SourcedGridModel>(to_grid(data_.events), span, plan, PartSampler{draw}));
}

bool Rhythm::within_ceiling(const std::optional<GenerationContextInput>& ctx) const {
  ResolvedContext resolved = resolve_context(ctx);
  if (!resolved.difficulty || !resolved.bpm) {
    return true;
  }
  assert_finite_number(*resolved.bpm, "bpm");
  assert_difficulty(*resolved.difficulty);
  return figure_within_ceiling<SourcedGridModel>(to_grid(data_.events), *resolved.bpm,
                                                 *resolved.difficulty);
}

Score Rhythm::to_score(int pitch, std::optional<int> velocity) const {
  ScoreOptions opts;
  opts.meters = MeterArg(data_.ts);
  return Score::of(rhythm_to_note_events(data_.events, pitch, velocity), opts);
}

bool Rhythm::equals(const Rhythm& other) const {
  const RhythmData& theirs = other.data_;
  if (data_.events.size() != theirs.events.size()) {
    return false;
  }
  for (std::size_t index = 0; index < theirs.events.size(); ++index) {
    if (data_.events[index].position != theirs.events[index].position ||
        data_.events[index].duration != theirs.events[index].duration) {
      return false;
    }
  }
  std::vector<int> grouping = data_.ts.grouping.value_or(std::vector<int>{});
  std::vector<int> other_grouping = theirs.ts.grouping.value_or(std::vector<int>{});
  return data_.ts.numerator == theirs.ts.numerator &&
         data_.ts.denominator == theirs.ts.denominator && grouping == other_grouping;
}

}  // namespace cantus
