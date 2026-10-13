// How the statements of a melody's motifs derive from one another:
// ts/src/analyze/melody/graph.ts.

#include "analyze/melody/graph.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "analyze/melody/internal.h"
#include "analyze/melody/motifs.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "js/number.h"

namespace cantus {

namespace {

/** A candidate parent for a node, ranked by better_parent() (`Candidate`). */
struct Candidate {
  std::size_t index = 0;
  double startBeat = 0;
  Nullable<MotifRelation> relation;
  double similarity = 0;
};

/** The fields a MotifRelation carries that a summary keeps (`summarize`). */
MotifRelationSummary summarize(const MotifRelation& relation) {
  MotifRelationSummary out;
  out.kind = relation.kind;
  out.sequence = relation.sequence;
  out.semitones = relation.semitones;
  out.degrees = relation.degrees;
  out.timeRatio = relation.timeRatio;
  return out;
}

/**
 * Whether `candidate` outranks `current` as the parent of a node (`betterParent`): a named
 * transformation outranks the lack of one, then the closer match, then the more recent statement,
 * then the earlier index.
 */
bool better_parent(const Candidate& candidate, const Candidate& current) {
  bool candidate_named = candidate.relation.has_value();
  bool current_named = current.relation.has_value();
  if (candidate_named != current_named) {
    return candidate_named;
  }
  if (candidate.similarity != current.similarity) {
    return candidate.similarity > current.similarity;
  }
  if (candidate.startBeat != current.startBeat) {
    return candidate.startBeat > current.startBeat;
  }
  return candidate.index < current.index;
}

}  // namespace

MotifGraph graph_of_nodes(std::vector<GraphNodeInfo> infos, const KeySource* key_source,
                          std::optional<double> budget, double variation_threshold) {
  std::stable_sort(infos.begin(), infos.end(), [](const GraphNodeInfo& a, const GraphNodeInfo& b) {
    double by_onset = a.node.startBeat - b.node.startBeat;
    double order = by_onset != 0 && !std::isnan(by_onset)
                       ? by_onset
                       : static_cast<double>(a.node.motif) - static_cast<double>(b.node.motif);
    return order < 0;
  });

  auto node_count = static_cast<double>(infos.size());
  assert_generation_budget(node_count * node_count, "motif graph comparisons", budget);

  MotifGraph graph;
  for (std::size_t to = 1; to < infos.size(); ++to) {
    std::optional<Candidate> best;
    for (std::size_t from = 0; from < to; ++from) {
      Candidate candidate;
      candidate.index = from;
      candidate.startBeat = infos[from].node.startBeat;
      candidate.relation =
          relate_lines(line_of(infos[from].data.notes), line_of(infos[to].data.notes), key_source);
      candidate.similarity = melodic_similarity(infos[from].data, infos[to].data);
      if (!best || better_parent(candidate, *best)) {
        best = std::move(candidate);
      }
    }
    if (best && (best->relation || best->similarity >= variation_threshold)) {
      MotifGraphEdge edge;
      edge.from = best->index;
      edge.to = to;
      if (best->relation) {
        edge.relation = summarize(*best->relation);
      }
      edge.similarity = best->similarity;
      graph.edges.push_back(std::move(edge));
    }
  }
  for (GraphNodeInfo& info : infos) {
    graph.nodes.push_back(info.node);
  }
  return graph;
}

MotifGraph motif_graph(const std::vector<NoteEvent>& line, const std::vector<MotifData>& motifs,
                       const MotifGraphOptions& opts) {
  double variation_threshold =
      assert_range(opts.variationThreshold.value_or(DEFAULT_VARIATION_THRESHOLD), 0, 1,
                   "motif graph variationThreshold");
  std::vector<NoteEvent> ordered = ordered_notes(line, "line", opts.budget);

  std::vector<GraphNodeInfo> infos;
  for (std::size_t mi = 0; mi < motifs.size(); ++mi) {
    const MotifData& motif = motifs[mi];
    for (std::size_t oi = 0; oi < motif.occurrences.size(); ++oi) {
      const MotifOccurrence& occurrence = motif.occurrences[oi];
      bool on_line =
          occurrence.noteIndex + motif.notes.size() <= ordered.size() &&
          occurrence.noteIndex < ordered.size() &&
          std::fabs(ordered[occurrence.noteIndex].startBeat - occurrence.startBeat) <= BEAT_EPS;
      if (!on_line) {
        throw InvalidInputError(
            "motif occurrence motifs[" + js::to_string(static_cast<double>(mi)) + "].occurrences[" +
            js::to_string(static_cast<double>(oi)) + "] does not lie on the line");
      }
      GraphNodeInfo info;
      info.node = MotifGraphNode{mi, oi, occurrence.startBeat, occurrence.endBeat};
      std::vector<NoteEvent> statement(
          ordered.begin() + static_cast<std::ptrdiff_t>(occurrence.noteIndex),
          ordered.begin() + static_cast<std::ptrdiff_t>(occurrence.noteIndex + motif.notes.size()));
      info.data = motif_from_notes(statement);
      infos.push_back(std::move(info));
    }
  }
  KeySource source = [key = opts.key] { return resolve_key(*key); };
  return graph_of_nodes(std::move(infos), opts.key ? &source : nullptr, opts.budget,
                        variation_threshold);
}

}  // namespace cantus
