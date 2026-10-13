#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "cantus/core/errors.h"
#include "cantus/core/tuning.h"

using namespace cantus;

TEST_CASE("twelve-tone equal temperament anchors on A4", "[tuning]") {
  CHECK(TWELVE_TET.refStep == 69);
  CHECK(TWELVE_TET.refFreq == 440);
  CHECK(TWELVE_TET.divisions == 12);
  CHECK(frequency_of(60) == 261.6255653005986);
  CHECK(nearest_step(450) == 69);
  CHECK(cents_from_nearest_step(450) == 38.90577323085296);
  CHECK(cents_to_ratio(700) == 1.4983070768766815);
}

TEST_CASE("just ratios deviate from equal temperament", "[tuning]") {
  CHECK(just_deviation_cents(4) == -13.686286135165403);
  CHECK(just_ratio(7).numerator == 3);
  CHECK(just_ratio(7).denominator == 2);
  CHECK_THROWS_WITH(just_deviation_cents(13),
                    "semitone class must be an integer in [0, 12]; received 13");
}

TEST_CASE("edo builds a tuning table", "[tuning]") {
  TuningTable table = edo(19);
  CHECK(table.refStep == 69);
  CHECK(table.refFreq == 440);
  CHECK(table.divisions == 19);
  CHECK_THROWS_WITH(edo(0), "EDO divisions must be an integer in [1, 1000000]; received 0");
}
