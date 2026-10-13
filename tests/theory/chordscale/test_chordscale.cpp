#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/theory/chordscale.h"

using namespace cantus;

TEST_CASE("the best fit leads the scales over a chord", "[chordscale]") {
  std::vector<ChordScaleMatch> scales = chord_scales(make_chord(0, ChordQuality::kMaj7));
  REQUIRE_FALSE(scales.empty());
  CHECK(scales.front().name == "ionian");
  CHECK(scales.front().rootPc == 0);
  CHECK(chord_scales("Cm7b5").front().name == "locrian");
}

TEST_CASE("avoid notes are the semitones above chord tones", "[chordscale]") {
  Chord cmaj7 = make_chord(0, ChordQuality::kMaj7);
  CHECK(avoid_notes(cmaj7, "ionian") == std::vector<int>{5});
  AvoidNotesOptions melodic;
  melodic.use = AvoidNoteUse::kMelodic;
  CHECK(avoid_notes(cmaj7, "ionian", melodic).empty());
  CHECK(available_tensions(cmaj7, "ionian") == std::vector<int>{2, 9});
}

TEST_CASE("a resolution to a minor tonic frees the dominant's tensions", "[chordscale]") {
  AvailableTensionsOptions opts;
  opts.resolvesTo = ChordArg(make_chord(0, ChordQuality::kMin));
  CHECK(available_tensions(make_chord(7, ChordQuality::kDom7), "phrygianDominant", opts) ==
        std::vector<int>{3, 8});
}

TEST_CASE("a world scale is no chord scale", "[chordscale]") {
  CHECK_THROWS_AS(avoid_notes("C", "todi"), InvalidInputError);
  CHECK_THROWS_AS(avoid_notes("C", "nonsense"), InvalidInputError);
}

TEST_CASE("the report splits the avoid notes by use", "[chordscale]") {
  std::vector<ChordScaleReportEntry> report = chord_scale_report("Cmaj7", 1);
  REQUIRE(report.size() == 1);
  CHECK(report[0].name == chord_scales("Cmaj7").front().name);
  CHECK_THROWS_AS(chord_scale_report("Cmaj7", 0), InvalidInputError);
}

TEST_CASE("a scale is chosen for each chord of a progression", "[chordscale]") {
  std::vector<Chord> changes = {to_chord_data("Dm7"), to_chord_data("G7"), to_chord_data("Cmaj7")};
  std::vector<ScaleChoice> choices = scales_for_changes(changes);
  REQUIRE(choices.size() == 3);
  CHECK(choices[1].chord.rootPc == 7);
  CHECK(scales_for_changes({}).empty());
}

TEST_CASE("scale membership validates its arguments", "[chordscale]") {
  CHECK(scale_matches_chord({0, 4, 7}, 0xAB5, 0));
  CHECK_FALSE(scale_matches_chord({0, 3, 7}, 0xAB5, 0));
  CHECK_THROWS_AS(scale_matches_chord({12}, 0xAB5, 0), InvalidInputError);
  CHECK_THROWS_AS(scale_matches_chord({0}, 0, 0), InvalidInputError);
}
