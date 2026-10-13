#include <catch2/catch_test_macros.hpp>

#include "cantus/core/errors.h"
#include "cantus/theory/harmony.h"

using namespace cantus;

TEST_CASE("the third locks the quality", "[harmony]") {
  VoicedRole role = role_of(64, make_chord(0, ChordQuality::kMaj));
  CHECK(role.role == HarmonyRole::kThird);
  CHECK(role.lock == LockLevel::kQuality);
  CHECK(role.belongsToChordId == 0);
}

TEST_CASE("the root locks the identity and a tension is free", "[harmony]") {
  CHECK(role_of(60, "C").lock == LockLevel::kIdentity);
  VoicedRole tension = role_of(62, "C", 3);
  CHECK(tension.role == HarmonyRole::kTension);
  CHECK(tension.lock == LockLevel::kVoicing);
  CHECK(tension.belongsToChordId == 3);
}

TEST_CASE("a suspended tone stands in the third's slot", "[harmony]") {
  VoicedRole role = role_of(65, "Csus4");
  CHECK(role.role == HarmonyRole::kThird);
  CHECK(role.lock == LockLevel::kQuality);
}

TEST_CASE("the id and the pitch must be finite", "[harmony]") {
  CHECK_THROWS_AS(role_of(60, "C", 0.0 / 0.0), InvalidInputError);
  CHECK_THROWS_AS(role_of(1.0 / 0.0, "C"), InvalidInputError);
}

TEST_CASE("role names round-trip", "[harmony]") {
  CHECK(to_string(HarmonyRole::kDoubling) == "doubling");
  CHECK(parse_harmony_role("seventh") == HarmonyRole::kSeventh);
  CHECK(parse_lock_level("voicing") == LockLevel::kVoicing);
  CHECK_FALSE(parse_harmony_role("ninth"));
}
