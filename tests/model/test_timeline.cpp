#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"
#include "cantus/model/timeline.h"

using namespace cantus;

namespace {

Timeline cadence() {
  return Progression({ChordValue::parse("C"), ChordValue::parse("F"), ChordValue::parse("G7"),
                      ChordValue::parse("C")},
                     KeyArg(Key::major("C")))
      .timeline(4);
}

}  // namespace

TEST_CASE("Timeline reads its chords in the key in force", "[model][timeline]") {
  Timeline t = cadence();
  std::vector<std::string> numerals;
  for (const TimelineRoman& entry : t.roman()) {
    numerals.push_back(entry.roman);
  }
  CHECK(numerals == std::vector<std::string>{"I", "IV", "V7", "I"});
  std::vector<double> arrivals;
  for (const CadenceHit& hit : t.cadences()) {
    arrivals.push_back(hit.atBeat);
  }
  CHECK(arrivals == std::vector<double>{8, 12});
  for (const ReducedChord& reduced : t.reduce()) {
    CHECK(reduced.level == ReductionLevel::kStructural);
  }
  CHECK(t.modulations().size() == 1);
  CHECK(t.key()->to_string() == "C major");
  CHECK(t.transpose(1).key()->to_string() == "Db major");
}

TEST_CASE("Timeline is clipped and refused like the data it holds", "[model][timeline]") {
  Timeline sliced = cadence().slice(2, 10);
  REQUIRE(sliced.length() == 3);
  CHECK(sliced.segments()[0].startBeat == 2);
  CHECK(sliced.segments()[2].endBeat == 10);
  CHECK(sliced.total_beats() == 10);
  REQUIRE(sliced.keys().size() == 1);
  CHECK(sliced.keys()[0].startBeat == 2);
  CHECK(sliced.equals(Timeline::from_data(sliced.data())));
  CHECK_THROWS_WITH(cadence().slice(4, 2),
                    "timeline slice toBeat must not precede fromBeat; received [4, 2)");
  TimelineData data{{}, 4, std::nullopt, std::vector<double>{1}};
  CHECK_THROWS_WITH(Timeline(data),
                    "timeline segmentConfidence must hold one value per segment; received 1 for 0");
  CHECK_THROWS_WITH(Timeline(TimelineData{}).roman(),
                    "timeline carries no key; build it from notes, or pass a key to "
                    "Timeline.fromChords");
}
