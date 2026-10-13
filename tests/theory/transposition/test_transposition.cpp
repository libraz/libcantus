#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/theory/transposition.h"

using namespace cantus;

TEST_CASE("an instrument sounds at its written-to-sounding interval", "[transposition]") {
  SpelledInterval clarinet = instrument_transposition("clarinetA");
  CHECK(clarinet.number == 3);
  CHECK(clarinet.quality == "m");
  CHECK(clarinet.semitones == -3);
  CHECK(clarinet.descending);
  CHECK(instrument_transposition("guitar (drop D)").semitones == -12);
  CHECK(instrument_transposition("-M2").semitones == -2);
}

TEST_CASE("a mistyped instrument says what to pass", "[transposition]") {
  CHECK_THROWS_AS(instrument_transposition("clarinet"), InvalidInputError);
}

TEST_CASE("the letter and the octave survive both conversions", "[transposition]") {
  NoteData c4{0, 0, 4};
  NoteData sounding = to_sounding_pitch(c4, "clarinetA");
  CHECK(sounding.letter == 5);
  CHECK(sounding.alter == 0);
  CHECK(sounding.octave == 3);
  NoteData written = to_written_pitch(sounding, "clarinetA");
  CHECK(written.letter == 0);
  CHECK(written.octave == 4);
  NoteData sharp = to_sounding_pitch(NoteData{1, 1, 4}, "clarinetA");
  CHECK(sharp.letter == 6);
  CHECK(sharp.alter == 1);
}

TEST_CASE("every built-in instrument is listed", "[transposition]") {
  CHECK(TRANSPOSING_INSTRUMENTS.size() == 16);
  CHECK(TRANSPOSING_INSTRUMENTS.front().name == "clarinetBb");
}
