#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/core/interval.h"

using namespace cantus;

TEST_CASE("intervals classify by their simple span", "[interval]") {
  CHECK(classify_interval(7) == ConsonanceClass::kPerfectConsonance);
  CHECK(classify_interval(-16) == ConsonanceClass::kImperfectConsonance);
  CHECK(classify_interval(6) == ConsonanceClass::kDissonance);
  CHECK(classify_interval(5) == ConsonanceClass::kDissonance);
  CHECK(classify_interval(5, false) == ConsonanceClass::kImperfectConsonance);
  CHECK(is_perfect_interval(19));
  CHECK_FALSE(is_perfect_interval(4));
  CHECK_FALSE(is_consonant_interval(5));
  CHECK(is_consonant_interval(5, false));
}

TEST_CASE("a span must be finite", "[interval]") {
  CHECK_THROWS_AS(classify_interval(1.0 / 0.0), InvalidInputError);
}
