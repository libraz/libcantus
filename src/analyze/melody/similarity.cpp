// How alike two phrases are, when they stand in no named relation:
// ts/src/analyze/melody/similarity.ts.

#include "analyze/melody/similarity.h"

#include <cmath>
#include <string>

#include "analyze/melody/internal.h"
#include "analyze/sequence.h"
#include "cantus/core/limits.h"
#include "cantus/core/validation.h"
#include "js/math.h"
#include "js/number.h"

namespace cantus {

namespace {

/** Cost of hearing one interval where another was expected (`intervalCost`). */
double interval_cost(double x, double y) {
  return js::min(1, std::fabs(x - y) / INTERVAL_TOLERANCE);
}

/**
 * Cost of hearing one onset gap where another was expected, measured in octaves of tempo
 * (`gapCost`).
 */
double gap_cost(double x, double y) {
  if (!(x > BEAT_EPS) || !(y > BEAT_EPS)) {
    return std::fabs(x - y) > BEAT_EPS ? 1 : 0;
  }
  return js::min(1, std::fabs(js::log2(x / y)));
}

}  // namespace

MelodicComparison compare_ordered(const std::vector<NoteEvent>& left,
                                  const std::vector<NoteEvent>& right) {
  std::vector<LineNote> left_line = line_of(left);
  std::vector<LineNote> right_line = line_of(right);
  std::vector<double> left_intervals = intervals_of(left_line);
  std::vector<double> right_intervals = intervals_of(right_line);
  assert_generation_budget(
      static_cast<double>(left_intervals.size()) * static_cast<double>(right_intervals.size()),
      "melody alignment");
  double pitch_similarity = distance_to_similarity(
      graded_edit_distance(left_intervals, right_intervals, interval_cost),
      static_cast<double>(left_intervals.size()), static_cast<double>(right_intervals.size()));
  std::vector<double> left_gaps = onset_gaps(left_line);
  std::vector<double> right_gaps = onset_gaps(right_line);
  std::vector<double> left_profile = rhythm_profile(left_gaps).value_or(left_gaps);
  std::vector<double> right_profile = rhythm_profile(right_gaps).value_or(right_gaps);
  double rhythm_similarity = distance_to_similarity(
      graded_edit_distance(left_profile, right_profile, gap_cost),
      static_cast<double>(left_profile.size()), static_cast<double>(right_profile.size()));
  double similarity = PITCH_WEIGHT * pitch_similarity + RHYTHM_WEIGHT * rhythm_similarity;
  MelodicComparison out;
  out.similarity = similarity;
  out.pitchSimilarity = pitch_similarity;
  out.rhythmSimilarity = rhythm_similarity;
  out.rationale = "Interval shapes " + js::to_string(js::round(pitch_similarity * 100)) + "%" +
                  " alike, rhythms " + js::to_string(js::round(rhythm_similarity * 100)) + "%" +
                  " alike, weighted " + js::to_string(PITCH_WEIGHT) + "/" +
                  js::to_string(RHYTHM_WEIGHT) + " into " + js::to_string(round_to(similarity, 3));
  return out;
}

MelodicComparison compare_melodies(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  std::vector<NoteEvent> left = ordered_notes(a.notes(), "melody a");
  std::vector<NoteEvent> right = ordered_notes(b.notes(), "melody b");
  return compare_ordered(left, right);
}

double melodic_similarity(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  return compare_melodies(a, b).similarity;
}

}  // namespace cantus
