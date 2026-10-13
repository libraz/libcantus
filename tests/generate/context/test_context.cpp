// The typed context API against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/generate/context.h"
#include "cantus/ops.h"
#include "js/number.h"
#include "ops/codec.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

std::string number(double x) { return ops::stringify(json::Value(x)); }

}  // namespace

TEST_CASE("a resolved context carries the dials and the version it was asked for", "[context]") {
  GenerationContext ctx;
  ctx.seed = 42;
  ctx.complexity = Complexity{0.8, std::nullopt, 0.25, 2};
  ctx.bpm = 96;
  ResolvedContext resolved = resolve_context(GenerationContextInput(ctx));
  CHECK(resolved.seed == 42);
  CHECK(resolved.rhythmic == 0.8);
  CHECK_FALSE(resolved.harmonic);
  CHECK(resolved.ornament == 0.25);
  CHECK(resolved.difficulty == 2);
  CHECK(resolved.bpm == 96);
  CHECK(resolved.algorithmVersion == ALGORITHM_VERSION);
  CHECK(
      call(
          "resolveContext",
          R"([{"seed":42,"complexity":{"rhythmic":0.8,"ornament":0.25,"difficulty":2},"bpm":96}])") ==
      R"({"$hy":"ResolvedContext","seed":42,"rhythmic":0.8,"ornament":0.25,"difficulty":2,"bpm":96,"algorithmVersion":1,"vocabulary":[]})");
}

TEST_CASE("a part draws what the op layer draws for the same context", "[context]") {
  Draw draw = resolve_context(GenerationContextInput(7u)).part("drums");
  std::string part =
      call("ResolvedContext#part", "[" + call("resolveContext", "[7]") + R"(,"drums"])");
  CHECK(number(draw.at({"ghost", 1.0, 2.0})) == call("Draw#at", "[" + part + R"(,"ghost",1,2])"));
  CHECK((draw.prob(0.4, {"kick", 3.0}) ? "true" : "false") ==
        call("Draw#prob", "[" + part + R"(,0.4,"kick",3])"));
  CHECK(number(static_cast<double>(draw.range(-3, 9, {"r"}))) ==
        call("Draw#range", "[" + part + R"(,-3,9,"r"])"));
  CHECK(number(draw.float_(0.9, 1.1, {"f", 0.0})) ==
        call("Draw#float", "[" + part + R"(,0.9,1.1,"f",0])"));
}

TEST_CASE("a supplied source is addressed under the part's own namespace", "[context]") {
  GenerationContext ctx;
  PositionalRng rng(123);
  ctx.rng = [rng](const SeedPath& path) { return rng.at(path); };
  Draw drums = resolve_context(GenerationContextInput(ctx)).part("drums");
  Draw bass = resolve_context(GenerationContextInput(ctx)).part("bass");
  CHECK(drums.at({"x", 1.0}) == rng.at({"drums", "v", 1.0, "x", 1.0}));
  CHECK(drums.at({"x", 1.0}) != bass.at({"x", 1.0}));
}

TEST_CASE("the samplers refuse what TS refuses", "[context]") {
  Draw draw = resolve_context().part("drums");
  CHECK_THROWS_AS(draw.prob(1.5), InvalidInputError);
  CHECK_THROWS_AS(draw.range(5, 1), InvalidInputError);
  CHECK_THROWS_AS(draw.float_(2, 1), InvalidInputError);
  Draw broken([](const SeedPath&) { return 1.0; });
  try {
    broken.at({"x"});
    FAIL("a draw of 1 must be refused");
  } catch (const InvalidInputError& error) {
    CHECK(std::string(error.what()) == "positional draw must be in [0, 1); received 1");
  }
  GenerationContext bad;
  bad.complexity = Complexity{2, std::nullopt, std::nullopt, std::nullopt};
  CHECK_THROWS_AS(resolve_context(GenerationContextInput(bad)), InvalidInputError);
}

TEST_CASE("the ceiling judges a stream of strokes at a tempo", "[context]") {
  CHECK(sustains_strokes(0.25, std::nullopt, 1));
  CHECK(sustains_strokes(0.25, 200, std::nullopt));
  CHECK_FALSE(sustains_strokes(0.25, 200, 1));
  CHECK(sustains_strokes(0.25, 60, 5));
  CHECK((sustains_strokes(0.125, 140, 3.5) ? "true" : "false") ==
        call("sustainsStrokes", "[0.125,140,3.5]"));
  CHECK((sustains_shift(7, 0.5, 120, 2) ? "true" : "false") ==
        call("sustainsShift", "[7,0.5,120,2]"));
  CHECK_THROWS_AS(sustains_strokes(0.25, 120, 6), InvalidInputError);
}
