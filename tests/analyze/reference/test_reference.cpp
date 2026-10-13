#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"

using namespace cantus;

namespace {

std::vector<NoteEvent> triad(const std::vector<int>& pitches, double start_beat) {
  std::vector<NoteEvent> out;
  for (int pitch : pitches) {
    NoteEvent note;
    note.pitch = pitch;
    note.startBeat = start_beat;
    note.durationBeat = 4;
    out.push_back(note);
  }
  return out;
}

std::vector<NoteEvent> cadence_piece() {
  std::vector<NoteEvent> notes;
  const std::vector<std::vector<int>> chords = {
      {60, 64, 67}, {65, 69, 72}, {67, 71, 74}, {60, 64, 67}};
  for (std::size_t i = 0; i < chords.size(); ++i) {
    for (const NoteEvent& note : triad(chords[i], static_cast<double>(i) * 4)) {
      notes.push_back(note);
    }
  }
  return notes;
}

ReferenceProfile profile_of_piece() {
  ReferenceProfileOptions options;
  options.key = KeyArg("C major");
  return analyze_reference(cadence_piece(), options);
}

}  // namespace

TEST_CASE("a I-IV-V-I piece reads as four bars of structural numerals", "[reference]") {
  ReferenceProfile profile = profile_of_piece();
  CHECK(profile.profileVersion == REFERENCE_PROFILE_VERSION);
  CHECK(profile.span.bars == 4);
  std::vector<std::string> romans;
  for (const ReferenceChord& chord : profile.harmony.chords) {
    romans.push_back(chord.roman);
  }
  CHECK(romans == std::vector<std::string>{"I", "IV", "V", "I"});
}

TEST_CASE("a produced profile passes its own validation", "[reference]") {
  ReferenceProfile profile = profile_of_piece();
  CHECK_NOTHROW(assert_reference_profile(profile));
}

TEST_CASE("a distribution that no longer sums to 1 is named by its path", "[reference]") {
  ReferenceProfile profile = profile_of_piece();
  profile.harmony.rhythm.onsetLevels[0] += 0.5;
  CHECK_THROWS_WITH(assert_reference_profile(profile),
                    Catch::Matchers::StartsWith("reference profile.harmony.rhythm.onsetLevels"));
}

TEST_CASE("a numeral no reader can parse is rejected", "[reference]") {
  ReferenceProfile profile = profile_of_piece();
  profile.harmony.chords[0].roman = "not a numeral";
  CHECK_THROWS_AS(assert_reference_profile(profile), InvalidInputError);
}

TEST_CASE("a piece compared with itself is alike on every measured field", "[reference]") {
  ReferenceProfile profile = profile_of_piece();
  ReferenceComparison comparison = compare_references(profile, profile);
  CHECK(comparison.harmony.progressionSimilarity == 1.0);
  CHECK(comparison.harmony.functionSimilarity == 1.0);
  CHECK(comparison.melody.contourSimilarity == 1.0);
  CHECK_FALSE(comparison.melody.surfaceSimilarity.has_value());
  CHECK(comparison.rhythm.onsetSimilarity == 1.0);
}

TEST_CASE("an empty piece has nothing to compare", "[reference]") {
  ReferenceProfile empty = analyze_reference({});
  ReferenceComparison comparison = compare_references(empty, empty);
  CHECK(comparison.rationale == "Nothing to compare: neither profile has material for any field");
}
