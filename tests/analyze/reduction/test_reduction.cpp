#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "cantus/analyze/reduction.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"

using namespace cantus;

namespace {

ChordTimeline progression(const std::vector<std::pair<double, ChordQuality>>& chords) {
  std::vector<ChordSpan> spans;
  for (std::size_t i = 0; i < chords.size(); ++i) {
    ChordSpan span;
    span.rootPc = chords[i].first;
    span.quality = chords[i].second;
    span.startBeat = static_cast<double>(i) * 4;
    spans.push_back(span);
  }
  return chord_timeline_from_chords(spans, static_cast<double>(chords.size()) * 4);
}

}  // namespace

TEST_CASE("an embellishing chord between two steps is passing", "[reduction]") {
  ChordTimeline timeline =
      progression({{0, ChordQuality::kMaj7}, {1, ChordQuality::kDim7}, {2, ChordQuality::kMin7}});
  std::vector<ReducedChord> reduced = reduce_progression(timeline, KeyContext(KeyArg("C major")));
  REQUIRE(reduced.size() == 3);
  CHECK(reduced[0].level == ReductionLevel::kStructural);
  CHECK(reduced[1].level == ReductionLevel::kPassing);
  CHECK(reduced[2].level == ReductionLevel::kStructural);
  CHECK(reduced[1].rationale ==
        "Passing: its root steps in from the previous chord and on to the next in the same "
        "direction");
  CHECK(reduced[1].endBeat == 8);
}

TEST_CASE("the salience reading protects the chord that outlasts the others", "[reduction]") {
  ChordTimeline timeline = progression({{0, ChordQuality::kMaj}, {2, ChordQuality::kMin}});
  timeline.segments[0].endBeat = 6;
  timeline.segments[1].startBeat = 6;
  ReduceProgressionOptions options;
  options.basis = ReductionBasis::kDuration;
  std::vector<ReducedChord> reduced =
      reduce_progression(timeline, KeyContext(KeyArg("C major")), options);
  REQUIRE(reduced.size() == 2);
  CHECK(reduced[0].rationale ==
        "Structural: it holds the harmony longer than the chords around it");
}

TEST_CASE("the names of the levels and bases round-trip", "[reduction]") {
  for (ReductionLevel level : reduction_levels()) {
    CHECK(parse_reduction_level(to_string(level)) == level);
  }
  CHECK(parse_reduction_basis("duration") == ReductionBasis::kDuration);
  CHECK_FALSE(parse_reduction_basis("salience").has_value());
}
