/**
 * @file vocabulary.h
 * @brief Internal pieces of ts/src/generate/drums/vocabulary.ts: placeDrumPattern written once over
 *        a pattern model, so the typed API and the op layer share one body.
 *
 * A dictionary entry chosen from caller vocabulary carries the caller's strokes as given, and TS
 * reads them as JS values: a duration or an articulation reaches the output as written. A model
 * `M` therefore says how entries and strokes are held:
 *
 * - `M::Grid`, the grid model of the strokes (see generate/vocabulary/transform.h);
 *   `M::Hit`, the hit record the accumulator writes.
 * - `m.dictionary()`, the merged dictionary (caller entries recognised and checked first);
 *   `m.any_in_meter(dictionary, ts)`; `m.pick(dictionary, plan, bar)`, an entry or a falsy value.
 * - `m.strokes(entry)` and `m.span_steps(entry)`, each checked as deform checks it.
 * - `M::pitch(stroke)`, `M::duration(stroke)`, `M::velocity(base, stroke)` (`base * velocity`)
 *   and `M::articulation(stroke)`.
 * - `m.playable(pitch)`, whether the kit named for the part has the voice.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_VOCABULARY_H_
#define CANTUS_SRC_GENERATE_DRUMS_VOCABULARY_H_

#include <algorithm>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "generate/drums/hit.h"
#include "generate/drums/swing.h"
#include "generate/vocabulary/transform.h"

namespace cantus {

/** What placeDrumPattern settles before its first bar, whatever holds the figures. */
struct PatternPlan {
  int bars = 0;
  Genre genre = Genre::kPop;
  std::optional<Section> section;
  TimeSignature ts;
  double baseVelocity = 0;
  GrooveFeel feel = GrooveFeel::kStraight;
  FigureRate rate = FigureRate::kStraight;
  double bpm = 0;
  std::optional<double> rhythmic;
  std::optional<double> ornament;
  std::optional<double> difficulty;
};

/** The deform options placeDrumPattern hands each figure, already checked. */
template <class Grid>
struct PatternDeformPlan {
  const PatternPlan& plan;
  std::function<bool(const typename Grid::Event&)> is_ghost;

  FigureRate rate() const { return plan.rate; }
  std::optional<double> rhythmic() const { return plan.rhythmic; }
  TimeSignature signature() const { return plan.ts; }
  std::optional<OrnamentRequest<Grid>> ornament() const {
    if (!plan.ornament) {
      return std::nullopt;
    }
    return OrnamentRequest<Grid>{is_ghost, *plan.ornament};
  }
};

/** placeDrumPattern from its first bar on, over a pattern model. */
template <class M>
std::vector<typename M::Hit> place_drum_pattern_with(const PatternPlan& plan, const Draw& draw,
                                                     M& model) {
  double bar_beats = beats_per_bar(plan.ts);
  double swing = effective_swing(plan.feel, feel_swing_amount(plan.feel));
  auto dictionary = model.dictionary();
  // A meter no figure is written in is refused rather than answered with an empty track.
  if (!model.any_in_meter(dictionary, plan.ts)) {
    throw InvalidInputError(
        "drum pattern ts names a meter no figure is written in: " + format_time_signature(plan.ts) +
        ". The built-in figures are written in 4/4; supply vocabulary in "
        "another meter through the context.");
  }
  HitList<typename M::Hit> track;
  PatternDeformPlan<typename M::Grid> deform_plan{plan, M::is_ghost};
  for (int bar = 0; bar < plan.bars; ++bar) {
    auto entry = model.pick(dictionary, plan, draw, bar);
    if (!entry) {
      continue;
    }
    const auto& figure = model.strokes(*entry);
    double span = model.span_steps(*entry);
    std::vector<typename M::Grid::Event> strokes = deform_figure<typename M::Grid>(
        figure, span, deform_plan,
        BoundSampler{draw, {std::string("pattern"), static_cast<double>(bar)}});
    // The ceiling judges what the dials produced: syncopating can bring two strokes together.
    if (plan.difficulty &&
        !figure_within_ceiling<typename M::Grid>(strokes, plan.bpm, *plan.difficulty)) {
      continue;
    }
    double bar_start = bar * bar_beats;
    for (const typename M::Grid::Event& stroke : strokes) {
      std::optional<int> pitch = M::pitch(stroke);
      if (!pitch) {
        continue;
      }
      // The bar's own grid is swung, and the bar start added back after.
      track.add(*pitch,
                bar_start + quantize_swing(M::Grid::step(stroke) * STEP_BEATS, swing,
                                           SwingResolution::kSixteenth),
                M::duration(stroke), M::velocity(plan.baseVelocity, stroke),
                M::articulation(stroke));
    }
  }
  // Naming a kit is the request that the part be playable on it.
  double end_beat = plan.bars * bar_beats;
  std::vector<typename M::Hit> out;
  for (const typename M::Hit& hit : track.hits()) {
    if (hit.startBeat < end_beat && model.playable(hit.pitch)) {
      out.push_back(hit);
    }
  }
  std::stable_sort(out.begin(), out.end(), [](const typename M::Hit& a, const typename M::Hit& b) {
    return a.startBeat != b.startBeat ? a.startBeat < b.startBeat : a.pitch < b.pitch;
  });
  return out;
}

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_VOCABULARY_H_
