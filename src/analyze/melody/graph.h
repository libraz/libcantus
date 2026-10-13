/**
 * @file graph.h
 * @brief Internal helpers of ts/src/analyze/melody/graph.ts: the derivation forest over statements
 *        already read off the line. motif_graph() is declared in cantus/analyze/melody.h.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_GRAPH_H_
#define CANTUS_SRC_ANALYZE_MELODY_GRAPH_H_

#include <optional>
#include <vector>

#include "analyze/melody/relation.h"
#include "cantus/analyze/melody.h"

namespace cantus {

/** One node together with the occurrence it stands for, as a motif of its own (`NodeInfo`). */
struct GraphNodeInfo {
  MotifGraphNode node;
  MotifData data;
};

/**
 * The nodes ordered, and the derivation drawn to each from an earlier one. `key_source`, when
 * given, is resolved by each relation drawn.
 */
MotifGraph graph_of_nodes(std::vector<GraphNodeInfo> infos, const KeySource* key_source,
                          std::optional<double> budget, double variation_threshold);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_GRAPH_H_
