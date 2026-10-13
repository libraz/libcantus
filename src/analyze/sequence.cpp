// Graded edit distance between two sequences: ts/src/analyze/sequence.ts.

#include "analyze/sequence.h"

namespace cantus {

double distance_to_similarity(double distance, double a, double b) {
  double longest = js::max(a, b);
  if (longest == 0) {
    return 1;
  }
  return js::min(1, js::max(0, 1 - distance / longest));
}

}  // namespace cantus
