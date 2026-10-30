// Tonicization: ts/src/analyze/functional/tonicization.ts.

#include "analyze/functional/tonicization.h"

#include <algorithm>

#include "analyze/functional/borrowed.h"
#include "cantus/analyze/functional.h"
#include "cantus/core/pitch.h"

namespace cantus {

namespace {

/** Whether a pitch class is a degree of `key` that can be made a local tonic (`isTonicizableRoot`).
 */
bool is_tonicizable_root(double root_pc, const KeyScale& key) {
  int target = pitch_class_of(root_pc);
  std::vector<TonicizableDegree> degrees = tonicizable_degrees(key);
  return std::any_of(degrees.begin(), degrees.end(),
                     [&](const TonicizableDegree& degree) { return degree.rootPc == target; });
}

}  // namespace

Nullable<TonicizableDegree> applied_target(const Chord& chord, const KeyScale& key) {
  return applied_chord_target(chord, key);
}

bool is_applied_dominant(const Chord& chord, const KeyScale& key) {
  if (is_diatonic_chord(chord, key)) {
    return false;
  }
  Nullable<BorrowedSource> source = borrowed_source_of(chord, key);
  if (source &&
      (*source == BorrowedSource::kParallelMajor || *source == BorrowedSource::kParallelMinor)) {
    return false;
  }
  return points_at_tonicizable_degree(chord, key);
}

bool points_at_tonicizable_degree(const Chord& chord, const KeyScale& key) {
  if (applied_target(chord, key)) {
    return true;
  }
  return sounds_dominant_seventh(chord) &&
         is_tonicizable_root(pitch_class_of(chord.rootPc - 1), key);
}

}  // namespace cantus
