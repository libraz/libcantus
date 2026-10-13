#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "cantus/core/duration.h"
#include "cantus/core/errors.h"

using namespace cantus;

TEST_CASE("durations convert to beats", "[duration]") {
  CHECK(duration_to_beats(NoteValue::kHalf) == 2);
  DurationData triplet_eighth;
  triplet_eighth.base = NoteValue::kEighth;
  triplet_eighth.tuplet = Tuplet{3, 2};
  CHECK(duration_to_beats(triplet_eighth) == 0.3333333333333333);
  DurationOptions in_eighths;
  in_eighths.beatUnit = NoteValue::kEighth;
  CHECK(duration_to_beats(NoteValue::kQuarter, in_eighths) == 2);
}

TEST_CASE("beats spell as a note value or a tie chain", "[duration]") {
  SpelledDuration dotted = beats_to_duration(0.75);
  CHECK(dotted.base == NoteValue::kEighth);
  CHECK(dotted.dots == 1);
  std::vector<SpelledDuration> chain = beats_to_tied_durations(5.5);
  REQUIRE(chain.size() == 2);
  CHECK(chain[0].base == NoteValue::kWhole);
  CHECK(chain[1].base == NoteValue::kQuarter);
  CHECK(chain[1].dots == 1);
}

TEST_CASE("durations report what they cannot spell", "[duration]") {
  CHECK_THROWS_AS(beats_to_duration(0.31), NoSolutionError);
  CHECK_THROWS_WITH(beats_to_duration(0), "beats must be positive; received 0");
  CHECK_THROWS_AS(beats_to_tied_durations(8000000), BudgetExceededError);
  DurationData too_dotted;
  too_dotted.dots = 5;
  CHECK_THROWS_WITH(duration_to_beats(too_dotted),
                    "duration.dots must be an integer in [0, 4]; received 5");
}

TEST_CASE("note value names round-trip", "[duration]") {
  for (NoteValue value : NOTE_VALUES) {
    CHECK(parse_note_value(to_string(value)) == value);
  }
  CHECK_FALSE(parse_note_value("breve").has_value());
}
