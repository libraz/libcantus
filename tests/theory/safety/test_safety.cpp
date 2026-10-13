#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

using namespace cantus;

namespace {

SafetyContext major_context(SafetyProfile profile, bool with_chord) {
  SafetyContext context;
  context.profile = profile;
  context.key = major_key(0).scale();
  context.strongBeat = true;
  if (with_chord) {
    context.chord = make_chord(0, ChordQuality::kMaj);
  }
  return context;
}

}  // namespace

TEST_CASE("the profiles are named by their weight tables", "[safety]") {
  REQUIRE(PROFILE_WEIGHTS.size() == 2);
  CHECK(to_string(SafetyProfile::kStrict) == "strict");
  CHECK(parse_safety_profile("pop") == SafetyProfile::kPop);
  CHECK_FALSE(parse_safety_profile("Strict"));
}

TEST_CASE("overrides replace only the fields they name", "[safety]") {
  ProfileWeightOverrides overrides;
  overrides.parallelImperfect = 4;
  ProfileWeights weights = profile_weights(SafetyProfile::kPop, overrides);
  CHECK(weights.parallelImperfect == 4);
  CHECK(weights.contraryMotion == 1.5);
  overrides.stepwise = std::nan("");
  CHECK_THROWS_AS(profile_weights(SafetyProfile::kPop, overrides), InvalidInputError);
}

TEST_CASE("a chord tone in the key is safe", "[safety]") {
  SafetyQuery query;
  static_cast<SafetyContext&>(query) = major_context(SafetyProfile::kPop, true);
  query.candidatePitch = 60;
  SafetyResult result = evaluate_safety(query);
  CHECK(result.safety == NoteSafety::kSafe);
  CHECK((result.reasons & static_cast<int>(ReasonFlag::kChordTone)) != 0);
  CHECK_FALSE(result.suggestions);
}

TEST_CASE("a pitch outside the key is dissonant and comes with alternatives", "[safety]") {
  SafetyQuery query;
  static_cast<SafetyContext&>(query) = major_context(SafetyProfile::kStrict, true);
  query.candidatePitch = 61;
  SafetyResult result = evaluate_safety(query);
  CHECK(result.safety == NoteSafety::kDissonant);
  CHECK((result.reasons & static_cast<int>(ReasonFlag::kNonScale)) != 0);
  REQUIRE(result.suggestions);
  CHECK(result.suggestions->size() <= 3);
  EvaluateSafetyOptions quiet;
  quiet.suggestions = false;
  CHECK_FALSE(evaluate_safety(query, quiet).suggestions);
}

TEST_CASE("the partners behind a pairwise flag are reported on request", "[safety]") {
  SafetyQuery query;
  static_cast<SafetyContext&>(query) = major_context(SafetyProfile::kStrict, false);
  query.strongBeat = false;
  query.prevPitch = 67;
  query.candidatePitch = 69;
  query.otherVoices = {VoiceSnapshot{62, 60}};
  EvaluateSafetyOptions options;
  options.partners = true;
  SafetyResult result = evaluate_safety(query, options);
  CHECK((result.reasons & static_cast<int>(ReasonFlag::kParallelPerfect)) != 0);
  REQUIRE(result.partners);
  REQUIRE(result.partners->size() == 1);
  CHECK((*result.partners)[0].index == 0);
}

TEST_CASE("the query is validated before it is evaluated", "[safety]") {
  SafetyQuery query;
  static_cast<SafetyContext&>(query) = major_context(SafetyProfile::kPop, true);
  query.candidatePitch = 128;
  CHECK_THROWS_AS(evaluate_safety(query), InvalidInputError);
  query.candidatePitch = 60;
  query.vocalLow = 72;
  query.vocalHigh = 60;
  CHECK_THROWS_AS(evaluate_safety(query), InvalidInputError);
}

TEST_CASE("placeable pitches come chord tones first, each group descending", "[safety]") {
  CHECK(enumerate_safe_pitches(major_context(SafetyProfile::kPop, true), 60, 72) ==
        std::vector<double>{72, 67, 64, 60, 71, 69, 65, 62});
  CHECK_THROWS_AS(enumerate_safe_pitches(major_context(SafetyProfile::kPop, true), 72, 60),
                  InvalidInputError);
  CHECK_THROWS_AS(enumerate_safe_pitches(major_context(SafetyProfile::kPop, true), 60, 128),
                  InvalidInputError);
}
