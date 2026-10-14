// Melodies written from a composition plan, through the typed API and the op layer.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"
#include "cantus/generate/melody.h"
#include "cantus/generate/plan.h"
#include "cantus/ops.h"
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

CompositionPlan plan_of_piece(std::uint32_t seed) {
  std::vector<NoteEvent> chords;
  const std::vector<std::vector<int>> triads = {
      {48, 52, 55}, {53, 57, 60}, {55, 59, 62}, {48, 52, 55}};
  for (std::size_t bar = 0; bar < triads.size(); ++bar) {
    for (int pitch : triads[bar]) {
      chords.push_back(note(pitch, static_cast<double>(bar) * 4, 4));
    }
  }
  std::vector<NoteEvent> melody;
  const int line[] = {60, 62, 64, 65, 67, 65, 64, 62, 64, 67, 69, 67, 65, 64, 62, 60};
  for (int index = 0; index < 16; ++index) {
    melody.push_back(note(line[index], index, 1));
  }
  ReferenceProfileOptions options;
  options.key = KeyArg("C major");
  options.melody = melody;
  CompositionPlanOptions opts;
  opts.ctx = GenerationContextInput(seed);
  return derive_composition_plan(analyze_reference(chords, options), opts);
}

}  // namespace

TEST_CASE("a melody stays inside its phrases' registers and is reproducible", "[melody]") {
  CompositionPlan plan = plan_of_piece(3U);
  std::vector<NoteEvent> first = generate_melody(plan);
  std::vector<NoteEvent> second = generate_melody(plan);
  REQUIRE_FALSE(first.empty());
  REQUIRE(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index) {
    CHECK(first[index].pitch == second[index].pitch);
    CHECK(first[index].startBeat == second[index].startBeat);
    CHECK(first[index].startBeat >= plan.span.startBeat);
    if (index > 0) {
      CHECK(first[index].startBeat >= first[index - 1].startBeat);
    }
  }
}

TEST_CASE("a melody matches the op layer", "[melody]") {
  CompositionPlan plan = plan_of_piece(3U);
  std::string wire = ops::stringify(ops::to_json(plan));
  CHECK(ops::stringify(ops::to_json(generate_melody(plan))) ==
        call("generateMelody", "[" + wire + "]"));
  MelodyOptions opts;
  opts.ctx = GenerationContextInput(11U);
  CHECK(ops::stringify(ops::to_json(generate_melody(plan, opts))) ==
        call("generateMelody", "[" + wire + R"(,{"ctx":11}])"));
}

TEST_CASE("the seed given to the melody overrides the plan's", "[melody]") {
  CompositionPlan plan = plan_of_piece(3U);
  MelodyOptions same;
  same.ctx = GenerationContextInput(3U);
  std::vector<NoteEvent> from_plan = generate_melody(plan);
  std::vector<NoteEvent> from_ctx = generate_melody(plan, same);
  REQUIRE(from_plan.size() == from_ctx.size());
  for (std::size_t index = 0; index < from_plan.size(); ++index) {
    CHECK(from_plan[index].pitch == from_ctx[index].pitch);
  }
}

TEST_CASE("a melody refuses a supplied source and a bad budget", "[melody]") {
  CompositionPlan plan = plan_of_piece(3U);
  GenerationContext with_source;
  with_source.rng = PositionalDraw([](const SeedPath&) { return 0.5; });
  MelodyOptions opts;
  opts.ctx = GenerationContextInput(with_source);
  CHECK_THROWS_WITH(generate_melody(plan, opts),
                    ContainsSubstring("ctx.rng cannot drive a melody"));
  MelodyOptions budget;
  budget.budget = 0;
  CHECK_THROWS_WITH(generate_melody(plan, budget), ContainsSubstring("budget"));
}

TEST_CASE("a phrase naming a motif the plan lacks is searched as free", "[melody]") {
  std::string wire =
      R"([{"planVersion":1,"seed":11,"algorithmVersion":1,"keys":[{"scale":{"rootPc":0,"modeMask12":2741},"tonic":{"letter":0,"alter":0},"variant":"major"},{"scale":{"rootPc":7,"modeMask12":2741},"tonic":{"letter":4,"alter":0},"variant":"major"}],"meters":[{"startBeat":0,"ts":{"numerator":4,"denominator":4}}],"span":{"startBeat":0,"endBeat":8,"bars":2},"sections":[{"label":"A","startBeat":0,"endBeat":8}],"harmony":[{"startBeat":0,"endBeat":4,"key":0,"roman":"IV"},{"startBeat":4,"endBeat":8,"key":0,"roman":"I"}],"motifs":[],"rhythm":{"onsetLevels":[0,0,0,0.5,0.25,0.25],"interOnsetShares":[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"syncopation":0},"phrases":[{"section":0,"cadence":"modal","shape":"arch","peakPosition":0.6,"register":{"low":61,"high":62,"mean":61.5},"onsetDensity":4,"motifs":[0],"startBeat":0,"endBeat":8}]}])";
  ops::Result result = ops::call("generateMelody", wire);
  REQUIRE_FALSE(result.ok());
  CHECK_THAT(result.json, ContainsSubstring("no strong pitch at beat 0 fits the register 61..62"));
}
