// The typed ornament pass against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/instrument.h"
#include "cantus/generate/ornament.h"
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

std::string text(const std::vector<NoteEvent>& notes) {
  return ops::stringify(ops::to_json(notes));
}

std::vector<NoteEvent> line() {
  return {NoteEvent{60, 0, 0.5, 90, std::nullopt},        NoteEvent{62, 0.5, 0.5, 90, std::nullopt},
          NoteEvent{64, 1, 0.5, 80, std::nullopt},        NoteEvent{62, 1.5, 0.5, 90, std::nullopt},
          NoteEvent{60, 2, 0.5, 90, Articulation::kMute}, NoteEvent{65, 2.5, 0.5, 90, std::nullopt},
          NoteEvent{64, 3, 0.5, 70, std::nullopt},        NoteEvent{60, 3.5, 0, 70, std::nullopt}};
}

const char* kWireLine =
    R"([{"pitch":60,"startBeat":0,"durationBeat":0.5,"velocity":90},{"pitch":62,"startBeat":0.5,"durationBeat":0.5,"velocity":90},)"
    R"({"pitch":64,"startBeat":1,"durationBeat":0.5,"velocity":80},{"pitch":62,"startBeat":1.5,"durationBeat":0.5,"velocity":90},)"
    R"({"pitch":60,"startBeat":2,"durationBeat":0.5,"velocity":90,"articulation":"mute"},{"pitch":65,"startBeat":2.5,"durationBeat":0.5,"velocity":90},)"
    R"({"pitch":64,"startBeat":3,"durationBeat":0.5,"velocity":70},{"pitch":60,"startBeat":3.5,"durationBeat":0,"velocity":70}])";

}  // namespace

TEST_CASE("ornaments match the op layer in every style", "[ornament]") {
  for (OrnamentStyle style : ORNAMENT_STYLES) {
    OrnamentOptions opts;
    opts.style = style;
    opts.amount = 0.8;
    opts.ctx = GenerationContextInput(4U);
    std::string wire = std::string("[") + kWireLine + R"(,{"style":")" +
                       std::string(to_string(style)) + R"(","amount":0.8,"ctx":4}])";
    CHECK(text(ornament(line(), opts)) == call("ornament", wire));
  }
}

TEST_CASE("an ornament pass leaves an articulated note and drops a silent one", "[ornament]") {
  OrnamentOptions opts;
  opts.style = OrnamentStyle::kAccent;
  opts.amount = 1;
  std::vector<NoteEvent> out = ornament(line(), opts);
  CHECK(out.size() == 7);
  CHECK(out[4].articulation == Articulation::kMute);
  CHECK(out[0].articulation == Articulation::kAccent);
  opts.amount = 2;
  CHECK_THROWS_AS(ornament(line(), opts), InvalidInputError);
}
