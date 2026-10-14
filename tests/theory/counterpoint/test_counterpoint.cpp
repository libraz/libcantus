#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/theory/counterpoint.h"

using namespace cantus;

namespace {

NoteData note(int letter, int alter, int octave) {
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), octave};
}

}  // namespace

TEST_CASE("spelling decides a vertical dissonance", "[counterpoint]") {
  CHECK(creates_vertical_dissonance(note(3, -1, 4), note(0, 0, 4), true));
  CHECK_FALSE(creates_vertical_dissonance(64, 60, true));
}

TEST_CASE("spelling decides a forbidden leap", "[counterpoint]") {
  CHECK(is_forbidden_melodic_leap(note(5, -1, 4), note(6, 0, 4)));
  CHECK_FALSE(is_forbidden_melodic_leap(68, 71));
  CHECK(is_forbidden_melodic_leap(60, 66));
  CHECK(is_augmented_melodic_interval(note(5, -1, 4), note(6, 0, 4)));
  CHECK_FALSE(is_augmented_melodic_interval(68, 71));
}

TEST_CASE("parallel perfect intervals need both voices to move", "[counterpoint]") {
  CHECK(creates_parallel_perfect(60, 62, 67, 69));
  CHECK_FALSE(creates_parallel_perfect(60, 60, 67, 69));
  CHECK(creates_parallel_octave(60, 62, 72, 74));
  CHECK(creates_parallel_unison(60, 62, 60, 62));
}

TEST_CASE("the hidden-parallel reading changes what the upper step excuses", "[counterpoint]") {
  // The upper voice moves by step into an octave from a sixth.
  CHECK_FALSE(
      creates_hidden_parallel_perfect(72, 74, 62, 62 + 12 - 12, HiddenParallelReading::kFourPart));
  CHECK(creates_hidden_parallel_perfect(60, 67, 52, 55, HiddenParallelReading::kFourPart));
  CHECK(parse_hidden_parallel_reading("twoVoice") == HiddenParallelReading::kTwoVoice);
  CHECK_FALSE(parse_hidden_parallel_reading("loose"));
}

TEST_CASE("spacing is measured against a finite limit", "[counterpoint]") {
  CHECK(exceeds_spacing(80, 60));
  CHECK_FALSE(exceeds_spacing(80, 60, 20));
  CHECK_THROWS_AS(exceeds_spacing(80, 60, 0.0 / 0.0), InvalidInputError);
}

TEST_CASE("a leading tone resolves up to the tonic", "[counterpoint]") {
  CHECK(is_leading_tone_resolution(71, 72, KeyArg("C major")));
  CHECK_FALSE(is_leading_tone_resolution(71, 67, KeyArg("C major")));
}

TEST_CASE("a spelled interval is classified by its label", "[counterpoint]") {
  SpelledInterval fourth;
  fourth.number = 4;
  fourth.quality = "d";
  CHECK(classify_spelled_interval(fourth) == ConsonanceClass::kDissonance);
  fourth.quality = "P";
  CHECK(classify_spelled_interval(fourth) == ConsonanceClass::kDissonance);
  CHECK(classify_spelled_interval(fourth, false) == ConsonanceClass::kImperfectConsonance);
  fourth.quality = "x";
  CHECK_THROWS_AS(classify_spelled_interval(fourth), InvalidInputError);
}

TEST_CASE("parallel sixths report as parallel motion", "[counterpoint]") {
  std::vector<Nullable<NoteData>> lead = {note(0, 0, 5), note(1, 0, 5), note(2, 0, 5)};
  std::vector<Nullable<NoteData>> counter = {note(2, 0, 4), note(3, 0, 4), note(4, 0, 4)};
  VoiceIndependenceReport report = voice_independence(lead, counter);
  CHECK(report.motion.parallel == 1);
  CHECK(report.sounding == 3);
  CHECK(report.crossings == 0);
}

TEST_CASE("the two lines must be aligned", "[counterpoint]") {
  std::vector<Nullable<NoteData>> lead = {note(0, 0, 5), note(1, 0, 5)};
  std::vector<Nullable<NoteData>> counter = {note(5, 0, 4)};
  CHECK_THROWS_AS(voice_independence(lead, counter), InvalidInputError);
  std::vector<Nullable<NoteData>> bare = {NoteData{0, 0, std::nullopt}};
  CHECK_THROWS_AS(voice_independence(bare, bare), InvalidInputError);
}
