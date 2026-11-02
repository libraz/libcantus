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

namespace {

/** The numbers `compareMelodies` reports for two ordered lines, without its rationale. */
struct Likeness {
  double similarity;
  double pitchSimilarity;
  double rhythmSimilarity;
};

/** Likeness of two ordered lines by their interval sequences (`pitchLikeness`). */
double pitch_likeness(const std::vector<LineNote>& left, const std::vector<LineNote>& right) {
  std::vector<double> left_intervals = intervals_of(left);
  std::vector<double> right_intervals = intervals_of(right);
  assert_generation_budget(
      static_cast<double>(left_intervals.size()) * static_cast<double>(right_intervals.size()),
      "melody alignment");
  return distance_to_similarity(
      graded_edit_distance(left_intervals, right_intervals, interval_cost),
      static_cast<double>(left_intervals.size()), static_cast<double>(right_intervals.size()));
}

/** Likeness of two ordered lines by their rhythmic profiles (`rhythmLikeness`). */
double rhythm_likeness(const std::vector<LineNote>& left, const std::vector<LineNote>& right) {
  std::vector<double> left_gaps = onset_gaps(left);
  std::vector<double> right_gaps = onset_gaps(right);
  std::vector<double> left_profile = rhythm_profile(left_gaps).value_or(left_gaps);
  std::vector<double> right_profile = rhythm_profile(right_gaps).value_or(right_gaps);
  return distance_to_similarity(graded_edit_distance(left_profile, right_profile, gap_cost),
                                static_cast<double>(left_profile.size()),
                                static_cast<double>(right_profile.size()));
}

Likeness likeness_of_ordered(const std::vector<NoteEvent>& left,
                             const std::vector<NoteEvent>& right) {
  std::vector<LineNote> left_line = line_of(left);
  std::vector<LineNote> right_line = line_of(right);
  double pitch_similarity = pitch_likeness(left_line, right_line);
  double rhythm_similarity = rhythm_likeness(left_line, right_line);
  return Likeness{PITCH_WEIGHT * pitch_similarity + RHYTHM_WEIGHT * rhythm_similarity,
                  pitch_similarity, rhythm_similarity};
}

Likeness likeness_of(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  std::vector<NoteEvent> left = ordered_notes(a.notes(), "melody a");
  std::vector<NoteEvent> right = ordered_notes(b.notes(), "melody b");
  return likeness_of_ordered(left, right);
}

}  // namespace

MelodicComparison compare_ordered(const std::vector<NoteEvent>& left,
                                  const std::vector<NoteEvent>& right) {
  Likeness likeness = likeness_of_ordered(left, right);
  MelodicComparison out;
  out.similarity = likeness.similarity;
  out.pitchSimilarity = likeness.pitchSimilarity;
  out.rhythmSimilarity = likeness.rhythmSimilarity;
  out.rationale =
      "Interval shapes " + js::to_string(js::round(likeness.pitchSimilarity * 100)) + "%" +
      " alike, rhythms " + js::to_string(js::round(likeness.rhythmSimilarity * 100)) + "%" +
      " alike, weighted " + js::to_string(PITCH_WEIGHT) + "/" + js::to_string(RHYTHM_WEIGHT) +
      " into " + js::to_string(round_to(likeness.similarity, 3));
  return out;
}

MelodicComparison compare_melodies(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  std::vector<NoteEvent> left = ordered_notes(a.notes(), "melody a");
  std::vector<NoteEvent> right = ordered_notes(b.notes(), "melody b");
  return compare_ordered(left, right);
}

double melodic_similarity(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  return likeness_of(a, b).similarity;
}

double pitch_similarity_of(const MelodicPhraseArg& a, const MelodicPhraseArg& b) {
  std::vector<NoteEvent> left = ordered_notes(a.notes(), "melody a");
  std::vector<NoteEvent> right = ordered_notes(b.notes(), "melody b");
  return pitch_likeness(line_of(left), line_of(right));
}

}  // namespace cantus
