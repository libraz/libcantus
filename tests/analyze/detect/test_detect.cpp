#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>

#include "cantus/analyze/detect.h"
#include "cantus/core/errors.h"

using namespace cantus;

TEST_CASE("chords are ranked by fewest extras, fewest missing, root position, then size",
          "[detect]") {
  std::vector<ChordMatch> triad = detect_chord({60, 64, 67});
  REQUIRE_FALSE(triad.empty());
  CHECK(triad[0].rootPc == 0);
  CHECK(triad[0].quality == ChordQuality::kMaj);
  CHECK(triad[0].exact);
  CHECK(triad[0].inversion == 0);
  CHECK_FALSE(triad[0].bassPc);
  // G is in the bass, so G6 outranks Em7.
  std::vector<ChordMatch> six = detect_chord({55, 59, 62, 64});
  CHECK(six[0].rootPc == 7);
  std::vector<ChordMatch> inverted = detect_chord({64, 67, 72});
  CHECK(inverted[0].inversion == 1);
  CHECK(inverted[0].bassPc == 4);
  CHECK(detect_chord({}).empty());
  CHECK_FALSE(detect_chord_best({}));
}

TEST_CASE("a single pitch class matches no chord", "[detect]") {
  CHECK(detect_chord({60}).empty());
  CHECK(detect_chord({60, 72, 48}).empty());
  CHECK_FALSE(detect_chord_best({0}));
  std::vector<ChordMatch> power = detect_chord({60, 67});
  REQUIRE_FALSE(power.empty());
  CHECK(power[0].quality == ChordQuality::k5);
}

TEST_CASE("a bass that is no chord tone names no inversion", "[detect]") {
  DetectChordOptions options;
  options.bassPc = 2;
  std::vector<ChordMatch> matches = detect_chord({0, 4, 7}, options);
  REQUIRE_FALSE(matches.empty());
  CHECK_FALSE(matches[0].inversion);
  CHECK(matches[0].bassPc == 2);
  options.bassPc = std::nan("");
  CHECK_THROWS_AS(detect_chord({0, 4, 7}, options), InvalidInputError);
  CHECK_THROWS_AS(detect_chord({60, 200}), InvalidInputError);
}

TEST_CASE("keys are ranked by correlation with a profile, and the modes join on request",
          "[detect]") {
  std::vector<KeyMatch> keys = detect_key({60, 62, 64, 65, 67, 69, 71});
  REQUIRE(keys.size() == 24);
  CHECK(keys[0].key.rootPc == 0);
  CHECK(keys[0].mode == KeyNameMode::kMajor);
  CHECK(keys[0].scaleName == "major");
  CHECK(keys[1].key.rootPc == 9);
  CHECK(keys[0].score >= keys[1].score);
  CHECK_FALSE(keys[0].rationale);
  DetectKeyOptions with_modes;
  with_modes.modes = true;
  with_modes.explain = true;
  std::vector<KeyMatch> modal = detect_key({62, 64, 65, 67, 69, 71, 62, 69, 62}, with_modes);
  REQUIRE(modal.size() == 24 + 5 * 12);
  CHECK(modal[0].scaleName == "dorian");
  CHECK(modal[0].variant == KeyVariant::kModal);
  REQUIRE(modal[0].rationale);
  REQUIRE(modal[0].alternatives);
  CHECK(modal[0].alternatives->size() == 3);
  CHECK_FALSE(modal[1].alternatives);
}

TEST_CASE("the weights, the profile and the modes are checked", "[detect]") {
  DetectKeyOptions weights;
  weights.weights = std::vector<double>{1, 2};
  CHECK_THROWS_AS(detect_key({60, 64, 67}, weights), InvalidInputError);
  weights.weights = std::vector<double>{1, std::nan(""), 1};
  CHECK_THROWS_AS(detect_key({60, 64, 67}, weights), InvalidInputError);
  weights.weights = std::vector<double>{0, 0, 0};
  CHECK(detect_key({60, 64, 67}, weights).empty());
  CHECK_FALSE(detect_key_best({}));
  DetectKeyOptions custom;
  KeyProfilePair pair;
  pair.major[3] = std::nan("");
  custom.profile = pair;
  CHECK_THROWS_AS(detect_key({60, 64, 67}, custom), InvalidInputError);
  CHECK(to_string(KeyProfileName::kFlat) == "flat");
  CHECK(parse_modal_scale_name("lydian") == ModalScaleName::kLydian);
  CHECK(modal_scale_names().size() == 5);
}

TEST_CASE("keys read from notes weigh each note by the music it occupies", "[detect]") {
  NoteEvent long_c;
  long_c.pitch = 60;
  long_c.durationBeat = 8;
  NoteEvent grace;
  grace.pitch = 61;
  grace.startBeat = 1;
  grace.durationBeat = 0.05;
  std::vector<KeyMatch> keys = detect_key_from_notes({long_c, grace});
  REQUIRE_FALSE(keys.empty());
  CHECK(keys[0].key.rootPc == 0);
  NoteEvent silent = long_c;
  silent.durationBeat = 0;
  CHECK(detect_key_from_notes({silent}).empty());
}
