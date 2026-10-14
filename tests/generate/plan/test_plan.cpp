// Composition plans: derivation, validation and evaluation through the typed API and the op layer.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"
#include "cantus/generate/plan.h"
#include "cantus/ops.h"
#include "ops/codec_a5.h"
#include "ops/codec_g3.h"

using namespace cantus;
using Catch::Matchers::ContainsSubstring;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

NoteEvent note(int pitch, double start_beat, double duration_beat) {
  NoteEvent out;
  out.pitch = pitch;
  out.startBeat = start_beat;
  out.durationBeat = duration_beat;
  return out;
}

std::vector<NoteEvent> melody_of_piece() {
  std::vector<NoteEvent> notes;
  const int line[] = {60, 62, 64, 65, 67, 65, 64, 62, 64, 67, 69, 67, 65, 64, 62, 60};
  for (int index = 0; index < 16; ++index) {
    notes.push_back(note(line[index], index, 1));
  }
  return notes;
}

ReferenceProfile reference_with_melody() {
  std::vector<NoteEvent> chords;
  const std::vector<std::vector<int>> triads = {
      {48, 52, 55}, {53, 57, 60}, {55, 59, 62}, {48, 52, 55}};
  for (std::size_t bar = 0; bar < triads.size(); ++bar) {
    for (int pitch : triads[bar]) {
      chords.push_back(note(pitch, static_cast<double>(bar) * 4, 4));
    }
  }
  ReferenceProfileOptions options;
  options.key = KeyArg("C major");
  options.melody = melody_of_piece();
  return analyze_reference(chords, options);
}

CompositionPlan derived_plan() {
  CompositionPlanOptions opts;
  opts.ctx = GenerationContextInput(7U);
  return derive_composition_plan(reference_with_melody(), opts);
}

}  // namespace

TEST_CASE("a derived plan passes its own validation and records the seed", "[plan]") {
  CompositionPlan plan = derived_plan();
  CHECK(plan.planVersion == COMPOSITION_PLAN_VERSION);
  CHECK(plan.seed == 7U);
  CHECK(plan.span.bars == 4);
  CHECK_FALSE(plan.phrases.empty());
  CHECK_FALSE(plan.harmony.empty());
  CHECK_NOTHROW(assert_composition_plan(plan));
}

TEST_CASE("a derived plan matches the op layer", "[plan]") {
  ReferenceProfile profile = reference_with_melody();
  CompositionPlanOptions opts;
  opts.ctx = GenerationContextInput(7U);
  opts.preserve = PreserveWeights{};
  opts.preserve->form = 0.5;
  opts.preserve->phraseLengths = 0.4;
  opts.preserve->harmonicFunction = 0.3;
  opts.preserve->harmonicRhythm = 0.2;
  opts.preserve->motifRelations = 0.6;
  opts.preserve->registerShape = 0.7;
  opts.preserve->rhythm = 0.8;
  opts.register_ = PlanRegisterRange{55, 79};
  std::string wire = "[" + ops::stringify(ops::to_json(profile)) +
                     R"(,{"ctx":7,"register":{"low":55,"high":79},"preserve":{"form":0.5,)"
                     R"("phraseLengths":0.4,"harmonicFunction":0.3,"harmonicRhythm":0.2,)"
                     R"("motifRelations":0.6,"registerShape":0.7,"rhythm":0.8}}])";
  CHECK(ops::stringify(ops::to_json(derive_composition_plan(profile, opts))) ==
        call("deriveCompositionPlan", wire));
}

TEST_CASE("a plan written to the wire is read back whole", "[plan]") {
  CompositionPlan plan = derived_plan();
  std::string wire = ops::stringify(ops::to_json(plan));
  CHECK(call("assertCompositionPlan", "[" + wire + "]") == wire);
  CHECK(ops::stringify(ops::to_json(plan_timeline(plan))) ==
        call("planTimeline", "[" + wire + "]"));
}

TEST_CASE("a reference with no melody cannot seed a plan", "[plan]") {
  ReferenceProfileOptions options;
  options.key = KeyArg("C major");
  options.melody = std::vector<NoteEvent>{};
  std::vector<NoteEvent> chords = {note(48, 0, 4), note(52, 0, 4), note(55, 0, 4)};
  ReferenceProfile profile = analyze_reference(chords, options);
  CHECK_THROWS_WITH(derive_composition_plan(profile),
                    ContainsSubstring("reference must carry melody onsets to derive a plan from"));
}

TEST_CASE("derivation rejects out-of-range options", "[plan]") {
  ReferenceProfile profile = reference_with_melody();
  CompositionPlanOptions weights;
  weights.preserve = PreserveWeights{};
  weights.preserve->form = 2;
  CHECK_THROWS_WITH(derive_composition_plan(profile, weights),
                    ContainsSubstring("opts.preserve.form"));
  CompositionPlanOptions range;
  range.register_ = PlanRegisterRange{80, 60};
  CHECK_THROWS_WITH(derive_composition_plan(profile, range),
                    ContainsSubstring("opts.register.low must not exceed opts.register.high"));
}

TEST_CASE("validation names the field that is wrong", "[plan]") {
  CompositionPlan plan = derived_plan();
  plan.rhythm.syncopation = 2;
  CHECK_THROWS_WITH(assert_composition_plan(plan, "plan"),
                    ContainsSubstring("plan.rhythm.syncopation"));
  plan = derived_plan();
  plan.keys.clear();
  CHECK_THROWS_WITH(assert_composition_plan(plan, "plan"),
                    ContainsSubstring("plan.keys must hold at least one key"));
}

TEST_CASE("evaluation flags a melody running past the span and matches the op layer", "[plan]") {
  CompositionPlan plan = derived_plan();
  std::vector<NoteEvent> melody = melody_of_piece();
  melody.push_back(note(60, 15, 10));
  CompositionEvaluation evaluation = evaluate_composition(melody, plan);
  bool spanned = false;
  for (const CompositionViolation& violation : evaluation.violations) {
    spanned = spanned || violation.kind == ViolationKind::kSpan;
  }
  CHECK(spanned);
  std::string wire =
      "[" + ops::stringify(ops::to_json(melody)) + "," + ops::stringify(ops::to_json(plan)) + "]";
  CHECK(ops::stringify(ops::to_json(evaluation)) == call("evaluateComposition", wire));
}
