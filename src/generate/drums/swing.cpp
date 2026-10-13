// Swing quantization of ts/src/generate/drums/swing.ts.

#include "generate/drums/swing.h"

#include <array>
#include <cmath>
#include <string_view>
#include <vector>

#include "js/math.h"

namespace cantus {

namespace {

/** One `[position, delay at full swing]` node within a beat. */
struct SwingNode {
  double at;
  double delay;
};

/** One SWING_NODES row: a resolution's name and its nodes. */
struct SwingNodesRow {
  std::string_view resolution;
  std::vector<SwingNode> nodes;
};

const std::array<SwingNodesRow, 2>& swing_nodes() {
  static const std::array<SwingNodesRow, 2> rows = {
#include "generate/drums/swing_nodes.gen.inc"
  };
  return rows;
}

const std::vector<SwingNode>& nodes_of(SwingResolution resolution) {
  std::string_view name = resolution == SwingResolution::kEighth ? "eighth" : "sixteenth";
  for (const SwingNodesRow& row : swing_nodes()) {
    if (row.resolution == name) {
      return row.nodes;
    }
  }
  return swing_nodes()[0].nodes;
}

}  // namespace

double effective_swing(GrooveFeel feel, double swing_amount) {
  if (feel == GrooveFeel::kStraight) {
    return 0;
  }
  return js::max(0, js::min(1, swing_amount));
}

double quantize_swing(double start_beat, double swing, SwingResolution resolution) {
  double clamped = js::max(0, js::min(1, swing));
  if (clamped <= 0) {
    return start_beat;
  }
  double base = std::floor(start_beat);
  double offset = start_beat - base;
  const std::vector<SwingNode>& nodes = nodes_of(resolution);
  for (std::size_t i = 1; i < nodes.size(); ++i) {
    const SwingNode& from = nodes[i - 1];
    const SwingNode& to = nodes[i];
    if (offset < from.at || offset > to.at) {
      continue;
    }
    double span = to.at - from.at;
    double share = span <= 0 ? 0 : (offset - from.at) / span;
    double delay = from.delay + (to.delay - from.delay) * share;
    return start_beat + delay * clamped;
  }
  return start_beat;
}

}  // namespace cantus
