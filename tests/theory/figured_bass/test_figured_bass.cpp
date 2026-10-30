#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/theory/figured_bass.h"
#include "cantus/theory/spelling.h"

using namespace cantus;

TEST_CASE("a suspension resolves into the chord", "[figured_bass]") {
  FiguredBassRealization realized = figured_bass_realization("G", "4-3", "C major");
  CHECK(note_names({realized.notes.begin(), realized.notes.end()}) ==
        std::vector<std::string>{"G", "B", "D"});
  REQUIRE(realized.suspensions.size() == 1);
  CHECK(realized.suspensions[0].from == 4);
  CHECK(realized.suspensions[0].to == 3);
  CHECK(realized.chord.rootPc == 7);
}

TEST_CASE("a first inversion carries its bass", "[figured_bass]") {
  Chord chord = realize_figured_bass("B", "6", "C major");
  CHECK(chord.rootPc == 7);
  CHECK(chord.quality == ChordQuality::kMaj);
  CHECK(chord.bassPc == 11);
}

TEST_CASE("a printed accidental names its note", "[figured_bass]") {
  Chord chord = realize_figured_bass("G", "n", "C minor");
  CHECK(chord.quality == ChordQuality::kMaj);
}

TEST_CASE("bad figures are refused with the string quoted", "[figured_bass]") {
  CHECK_THROWS_AS(realize_figured_bass("G", "1", "C major"), InvalidInputError);
  CHECK_THROWS_AS(realize_figured_bass("G", "4-", "C major"), InvalidInputError);
  CHECK_THROWS_AS(realize_figured_bass("G", "9", "C major"), InvalidInputError);
}

TEST_CASE("a chord is written as the figures that read back as it", "[figured_bass]") {
  CHECK(figured_bass_of(make_chord(7, ChordQuality::kMaj, 11), "C major") == "6");
  CHECK(figured_bass_of(make_chord(7, ChordQuality::kDom7, 2), "C major") == "43");
  CHECK(figured_bass_of(make_chord(0, ChordQuality::kMaj), "C major").empty());
}

TEST_CASE("a bass outside the chord has no figures", "[figured_bass]") {
  CHECK(figured_bass_of(make_chord(0, ChordQuality::kMaj, 7), "C major") == "64");
  CHECK_THROWS_AS(figured_bass_of(make_chord(0, ChordQuality::kMaj, 1), "C major"),
                  NoSolutionError);
}

TEST_CASE("a motion between run-together stacks moves them column by column", "[figured_bass]") {
  FiguredBassRealization realized = figured_bass_realization("G", "64-53", "C major");
  CHECK(realized.chord.rootPc == 7);
  CHECK(realized.chord.quality == ChordQuality::kMaj);
  REQUIRE(realized.suspensions.size() == 2);
  CHECK(realized.suspensions[0].from == 6);
  CHECK(realized.suspensions[0].to == 5);
  CHECK(realized.suspensions[1].from == 4);
  CHECK(realized.suspensions[1].to == 3);
  CHECK_THROWS_AS(realize_figured_bass("G", "64-3", "C major"), InvalidInputError);
  CHECK_THROWS_AS(realize_figured_bass("G", "4-53", "C major"), InvalidInputError);
}

TEST_CASE("an altered stack of thirds is not rounded to a suspended or added-tone chord",
          "[figured_bass]") {
  CHECK_THROWS_AS(realize_figured_bass("A", "b3", "C major"), NoSolutionError);
  CHECK_THROWS_AS(realize_figured_bass("G", "#", "A minor"), NoSolutionError);
  CHECK_THROWS_AS(realize_figured_bass("C", "bb7", "C major"), NoSolutionError);
  CHECK_THROWS_AS(realize_figured_bass("C", "b3bb7", "C major"), NoSolutionError);
}
