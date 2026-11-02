/**
 * @file sequence.h
 * @brief Internal helpers of ts/src/analyze/sequence.ts: graded edit distance between two
 *        sequences, shared by every structural comparison that aligns one ordered list against
 *        another.
 */
#ifndef CANTUS_SRC_ANALYZE_SEQUENCE_H_
#define CANTUS_SRC_ANALYZE_SEQUENCE_H_

#include <cstddef>
#include <vector>

#include "analyze/form/internal.h"
#include "js/math.h"

namespace cantus {

/**
 * Edit distance between two sequences under a graded substitution cost and a caller-chosen gap
 * cost for insertion or deletion (`gradedEditDistance`).
 */
template <class T, class Cost>
double graded_edit_distance(const std::vector<T>& a, const std::vector<T>& b, Cost&& cost,
                            double gap = 1) {
  std::vector<double> previous(b.size() + 1);
  for (std::size_t i = 0; i < previous.size(); ++i) {
    previous[i] = static_cast<double>(i) * gap;
  }
  // Two rows, swapped: every cell of `row` is written before it is read.
  std::vector<double> row(b.size() + 1);
  for (std::size_t i = 1; i <= a.size(); ++i) {
    row[0] = static_cast<double>(i) * gap;
    for (std::size_t j = 1; j <= b.size(); ++j) {
      double substitution = previous[j - 1] + cost(a[i - 1], b[j - 1]);
      double deletion = previous[j] + gap;
      double insertion = row[j - 1] + gap;
      row[j] = js::min(substitution, deletion, insertion);
    }
    previous.swap(row);
  }
  return previous[b.size()];
}

/** Turn an edit distance into a likeness in [0, 1] (`distanceToSimilarity`). */
double distance_to_similarity(double distance, double a, double b);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_SEQUENCE_H_
