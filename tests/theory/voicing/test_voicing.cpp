#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <limits>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/voicing.h"

using namespace cantus;

namespace {

using Voicing = std::vector<int>;

}  // namespace

TEST_CASE("the default ranges are the four SATB compasses", "[voicing]") {
  REQUIRE(SATB_RANGES.size() == 4);
  CHECK(SATB_RANGES[0].min == 40);
  CHECK(SATB_RANGES[0].max == 60);
  CHECK(SATB_RANGES[3].min == 60);
  CHECK(SATB_RANGES[3].max == 79);
}

TEST_CASE("a chord is voiced once per voice, ascending", "[voicing]") {
  CHECK(voice_chord("Cmaj7") == Voicing{48, 55, 64, 71});
  VoicingOptions three;
  three.voices = 3;
  CHECK(voice_chord("Cmaj7", three) == Voicing{48, 64, 71});
}

TEST_CASE("a progression is voiced with smooth leading", "[voicing]") {
  CHECK(
      voice_progression({"C", "G", "Am", "F"}) ==
      std::vector<Voicing>{{48, 60, 64, 67}, {43, 59, 62, 67}, {45, 57, 60, 64}, {41, 57, 60, 65}});
  VoicingOptions keyed;
  keyed.key = KeyArg("C major");
  CHECK(voice_progression({"Dm7", "G7", "Cmaj7"}, keyed) ==
        std::vector<Voicing>{{50, 60, 65, 69}, {55, 59, 62, 65}, {48, 55, 59, 64}});
  CHECK(voice_progression({}).empty());
}

TEST_CASE("a progression reports the chord that fits no voicing", "[voicing]") {
  VoicingOptions narrow;
  narrow.ranges = std::vector<VoiceRange>{{70, 71}};
  try {
    voice_progression({"C", "G"}, narrow);
    FAIL("expected a NoSolutionError");
  } catch (const NoSolutionError& e) {
    REQUIRE(e.at().has_value());
    CHECK(*e.at() == 0);
  }
}

TEST_CASE("the next voicing follows from the current one", "[voicing]") {
  VoicingOptions options;
  options.key = KeyArg("C major");
  options.previousChord = ChordArg("Dm7");
  CHECK(next_voicing({50, 60, 65, 69}, "G7", options) == Voicing{55, 59, 62, 65});
  CHECK_THROWS_AS(next_voicing({}, "G7"), InvalidInputError);
  CHECK_THROWS_AS(next_voicing({60, std::nan("")}, "G7"), InvalidInputError);
}

TEST_CASE("voice-leading cost is the summed motion", "[voicing]") {
  CHECK(voice_leading_cost({48, 55, 64, 72}, {50, 57, 65, 69}) == 8);
  CHECK(voice_leading_cost({60, 64, 67}, {48, 52, 55}) == 36);
  CHECK(std::isinf(voice_leading_cost({60}, {60, 64})));
  CHECK_THROWS_AS(voice_leading_cost({std::nan("")}, {60}), InvalidInputError);
}

TEST_CASE("a styled voicing drops the voice its style names", "[voicing]") {
  StyledVoicingOptions drop2;
  drop2.style = VoicingStyle::kDrop2;
  CHECK(voice_chord_styled("Dm7", drop2) == Voicing{57, 62, 65, 72});
  StyledVoicingOptions high;
  high.octave = 9;
  CHECK_THROWS_AS(voice_chord_styled("Cmaj7", high), InvalidInputError);
  CHECK(parse_voicing_style("rootless") == VoicingStyle::kRootless);
  CHECK_FALSE(parse_voicing_style("open"));
}

TEST_CASE("the options are validated before the search", "[voicing]") {
  VoicingOptions options;
  options.maxSpacing = -1;
  CHECK_THROWS_AS(voice_chord("C", options), InvalidInputError);
  options.maxSpacing = std::numeric_limits<double>::quiet_NaN();
  CHECK_THROWS_AS(voice_chord("C", options), InvalidInputError);
  VoicingOptions empty;
  empty.ranges = std::vector<VoiceRange>{};
  CHECK_THROWS_AS(voice_chord("C", empty), InvalidInputError);
  VoicingOptions wide;
  wide.voices = 129;
  CHECK_THROWS_AS(voice_chord("C", wide), InvalidInputError);
}
