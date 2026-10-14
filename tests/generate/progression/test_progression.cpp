// The typed progression generator against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/progression.h"
#include "cantus/ops.h"
#include "ops/codec_c1.h"
#include "ops/codec_g2b.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

const char* kWireKey =
    R"({"rootPc":0,"modeMask12":2741,"tonic":{"letter":0,"alter":0},"variant":"major"})";

}  // namespace

TEST_CASE("the preset tables match the op layer", "[progression]") {
  CHECK(ops::stringify(ops::to_json(progressions())) == call("progressions", "[]"));
  for (ProgStyle style : PROG_STYLES) {
    CHECK(ops::stringify(ops::to_json(progressions_by_style(style))) ==
          call("progressionsByStyle", std::string("[\"") + std::string(to_string(style)) + "\"]"));
  }
  CHECK(BORROWED_DEGREES.bVII == 10);
  CHECK(ops::stringify(ops::to_json(pick_progression_preset(ProgStyle::kDance, 3U))) ==
        call("pickProgressionPreset", R"(["dance",3])"));
}

TEST_CASE("generated progressions match the op layer", "[progression]") {
  for (ProgStyle style : PROG_STYLES) {
    for (std::uint32_t seed : {0U, 5U}) {
      ProgressionOptions opts(KeyArg(KeyScale{0, 2741}), style, 8);
      opts.ctx = GenerationContextInput(
          GenerationContext{seed, Complexity{std::nullopt, 0.7, std::nullopt, std::nullopt},
                            std::nullopt, std::nullopt, std::nullopt, std::nullopt, std::nullopt});
      std::string wire = std::string(R"([{"key":)") + kWireKey + R"(,"style":")" +
                         std::string(to_string(style)) + R"(","bars":8,"ctx":{"seed":)" +
                         std::to_string(seed) + R"(,"complexity":{"harmonic":0.7}}}])";
      CHECK(ops::stringify(ops::to_json(generate_progression(opts))) ==
            call("generateProgression", wire));
    }
  }
}

TEST_CASE("a preset of the caller's own is laid out per bar", "[progression]") {
  ProgressionOptions opts(KeyArg(KeyScale{0, 2741}), ProgStyle::kRock, 5);
  opts.preset = ProgressionPresetInput({1, BORROWED_DEGREES.bVII, 4});
  opts.ts = MeterArg("3/4");
  std::vector<ChordSpan> chords = generate_progression(opts);
  REQUIRE(chords.size() == 5);
  CHECK(chords[1].rootPc == 10);
  CHECK(chords[4].startBeat == 12);
  opts.preset = ProgressionPresetInput({9});
  CHECK_THROWS_AS(generate_progression(opts), InvalidInputError);
  opts.preset = ProgressionPresetInput({});
  CHECK_THROWS_AS(generate_progression(opts), InvalidInputError);
  opts.preset.reset();
  opts.presetId = "nothing";
  CHECK_THROWS_AS(generate_progression(opts), InvalidInputError);
}
