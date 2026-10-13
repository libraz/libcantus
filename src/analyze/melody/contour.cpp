// The shape of a line: ts/src/analyze/melody/contour.ts.

#include "analyze/melody/contour.h"

#include <array>
#include <cmath>
#include <string>

#include "cantus/core/limits.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

constexpr std::size_t kShapeCount = static_cast<std::size_t>(MelodicContourShape::kStatic) + 1;

/** MELODIC_CONTOUR_SHAPES, indexed by MelodicContourShape. */
constexpr std::array<std::string_view, kShapeCount> kShapeNames = {
#include "analyze/melody/melodic_contour_shapes.gen.inc"
};
static_assert(!kShapeNames.back().empty(),
              "MELODIC_CONTOUR_SHAPES and MelodicContourShape disagree");

/** Where the highest and lowest notes of a line sit; ties keep the earliest (`extremes`). */
struct Extremes {
  int peak;
  int trough;
};

Extremes extremes(const std::vector<LineNote>& notes) {
  if (notes.empty()) {
    return {-1, -1};
  }
  int peak = 0;
  int trough = 0;
  for (std::size_t i = 1; i < notes.size(); ++i) {
    if (notes[i].pitch > notes[static_cast<std::size_t>(peak)].pitch) {
      peak = static_cast<int>(i);
    }
    if (notes[i].pitch < notes[static_cast<std::size_t>(trough)].pitch) {
      trough = static_cast<int>(i);
    }
  }
  return {peak, trough};
}

}  // namespace

std::string_view to_string(ContourDirection direction) {
  switch (direction) {
    case ContourDirection::kUp:
      return "up";
    case ContourDirection::kDown:
      return "down";
    case ContourDirection::kSame:
      return "same";
  }
  return {};
}

std::string_view to_string(MelodicContourShape shape) {
  return kShapeNames[static_cast<std::size_t>(shape)];
}

std::optional<MelodicContourShape> parse_melodic_contour_shape(std::string_view name) {
  for (std::size_t i = 0; i < kShapeNames.size(); ++i) {
    if (kShapeNames[i] == name) {
      return static_cast<MelodicContourShape>(i);
    }
  }
  return std::nullopt;
}

std::vector<MelodicContourShape> melodic_contour_shapes() {
  std::vector<MelodicContourShape> shapes;
  for (std::size_t i = 0; i < kShapeNames.size(); ++i) {
    shapes.push_back(static_cast<MelodicContourShape>(i));
  }
  return shapes;
}

MelodicContour contour_of(const std::vector<NoteEvent>& ordered) {
  std::vector<LineNote> line = line_of(ordered);
  std::vector<double> intervals = intervals_of(line);
  MelodicContour out;
  for (double step : intervals) {
    out.directions.push_back(step > 0
                                 ? ContourDirection::kUp
                                 : (step < 0 ? ContourDirection::kDown : ContourDirection::kSame));
  }
  Extremes ends = extremes(line);
  out.peakIndex = ends.peak;
  out.troughIndex = ends.trough;
  auto at = [&](int index) {
    return index >= 0 ? line[static_cast<std::size_t>(index)].pitch : 0.0;
  };
  double range = at(ends.peak) - at(ends.trough);
  double motion = 0;
  for (double step : intervals) {
    motion += std::fabs(step);
  }
  if (motion == 0) {
    out.shape = MelodicContourShape::kStatic;
    out.range = 0;
    out.rationale = line.size() < 2 ? "Too short to have a direction, so the line is static"
                                    : "Every note at the same pitch, so the line is static";
    return out;
  }

  double first = line.front().pitch;
  double last = line.back().pitch;
  double net = last - first;
  double directness = std::fabs(net) / motion;
  double share = js::round(directness * 100);
  out.range = range;
  if (directness >= DIRECTIONAL_SHARE) {
    out.shape = net > 0 ? MelodicContourShape::kAscending : MelodicContourShape::kDescending;
    out.rationale = js::to_string(share) + "% of the motion runs " + (net > 0 ? "up" : "down") +
                    ", so the line is " + std::string(to_string(out.shape));
    return out;
  }

  double peak_pitch = at(ends.peak);
  double arch_motion = peak_pitch - first + (peak_pitch - last);
  if (ends.peak > 0 && static_cast<std::size_t>(ends.peak) < line.size() - 1 &&
      arch_motion >= DIRECTIONAL_SHARE * motion) {
    out.shape = MelodicContourShape::kArch;
    out.rationale = "Rises to its peak at note " + js::to_string(ends.peak + 1) + " of " +
                    js::to_string(static_cast<double>(line.size())) +
                    " and falls back, so the line is an arch";
    return out;
  }
  out.shape = MelodicContourShape::kWave;
  out.rationale = "Changes direction without settling either way (" + js::to_string(share) +
                  "% of the motion nets out), so the line is a wave";
  return out;
}

MelodicContour melodic_contour(const MelodicPhraseArg& notes) {
  return contour_of(ordered_notes(notes.notes(), "contour notes"));
}

}  // namespace cantus
