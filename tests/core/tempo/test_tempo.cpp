#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cmath>

#include "cantus/core/errors.h"
#include "cantus/core/tempo.h"
#include "core/tempo/tempo.h"

using namespace cantus;

namespace {
const TempoMap kMap = {{0, 120}, {4, 60}, {8, 90}};
}

TEST_CASE("tempo maps convert between beats and seconds", "[tempo]") {
  CHECK(beats_to_seconds(10, kMap) == 7.333333333333333);
  CHECK(seconds_to_beats(7, kMap) == 9.5);
  CHECK(duration_to_seconds(2, 8, kMap) == 6.333333333333333);
  CHECK(tempo_at(5, kMap) == 60);
  // The opening tempo reaches back before its own onset.
  CHECK(beats_to_seconds(-2, kMap) == -1);
}

TEST_CASE("TempoReader answers as the free functions do", "[tempo]") {
  TempoReader reader(kMap);
  CHECK(reader.seconds_at(10) == beats_to_seconds(10, kMap));
  CHECK(reader.beat_at(7) == seconds_to_beats(7, kMap));
}

TEST_CASE("tempo maps are validated", "[tempo]") {
  CHECK_THROWS_WITH(beats_to_seconds(1, {}), "tempo map must hold at least one tempo event");
  CHECK_THROWS_WITH(beats_to_seconds(1, {{0, 120}, {0, 90}}),
                    "tempo map must be sorted by startBeat with no repeats; [1].startBeat 0 does "
                    "not follow 0");
  CHECK_THROWS_WITH(beats_to_seconds(1, {{0, 2000}}),
                    "tempo map[0].bpm must be in [0.1, 1000]; received 2000");
}

TEST_CASE("ticks keep a negative zero where TS does", "[tempo]") {
  CHECK(beats_to_ticks(1.2345, 480) == 593);
  CHECK_FALSE(std::signbit(beats_to_ticks(-0.0001, 480)));
  CHECK(std::signbit(ticks_to_beats(-0.0, 480)));
  CHECK(ticks_to_beats(960, 480) == 2);
}

TEST_CASE("ticks past the safe integers are refused", "[tempo]") {
  CHECK_THROWS_AS(beats_to_ticks(1e306, 960), InvalidInputError);
  CHECK_THROWS_AS(beats_to_ticks(1e13, 960), InvalidInputError);
  double largest = std::floor(9007199254740991.0 / 960);
  CHECK(ticks_to_beats(beats_to_ticks(largest, 960), 960) == largest);
}
