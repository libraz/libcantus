// The typed humanizer and groove templates against the op layer, whose results the call corpus
// pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/groove.h"
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

std::vector<NoteEvent> played() {
  return {NoteEvent{36, 0.03, 1, 100, std::nullopt}, NoteEvent{38, 1.06, 1, 70, std::nullopt},
          NoteEvent{42, 1.5, 0.5, std::nullopt, std::nullopt},
          NoteEvent{40, 2, 0, 90, std::nullopt}, NoteEvent{36, 2.51, 1, 80, std::nullopt}};
}

const char* kWirePlayed =
    R"([{"pitch":36,"startBeat":0.03,"durationBeat":1,"velocity":100},{"pitch":38,"startBeat":1.06,"durationBeat":1,"velocity":70},)"
    R"({"pitch":42,"startBeat":1.5,"durationBeat":0.5},{"pitch":40,"startBeat":2,"durationBeat":0,"velocity":90},)"
    R"({"pitch":36,"startBeat":2.51,"durationBeat":1,"velocity":80}])";

}  // namespace

TEST_CASE("humanizing matches the op layer and drops silent notes", "[groove]") {
  HumanizeOptions opts;
  opts.ctx = GenerationContextInput(11U);
  opts.timing = 0.03;
  opts.part = "lead";
  std::vector<NoteEvent> out = humanize(played(), opts);
  CHECK(out.size() == 4);
  CHECK(text(out) == call("humanize", std::string("[") + kWirePlayed +
                                          R"(,{"ctx":11,"timing":0.03,"part":"lead"}])"));
  opts.timing = -1;
  CHECK_THROWS_AS(humanize(played(), opts), InvalidInputError);
}

TEST_CASE("a template captured from a performance matches the op layer", "[groove]") {
  GrooveTemplate captured = extract_groove_template(played(), MeterArg("4/4"), 4);
  CHECK(captured.slotsPerBar == 16);
  CHECK(captured.slots.size() == 16);
  CHECK(ops::stringify(ops::to_json(captured)) ==
        call("extractGrooveTemplate", std::string("[") + kWirePlayed + R"(,"4/4",4])"));
  std::vector<NoteEvent> stiff = {NoteEvent{36, 0, 1, 80, std::nullopt},
                                  NoteEvent{38, 1, 1, std::nullopt, std::nullopt}};
  std::string wire_template =
      call("extractGrooveTemplate", std::string("[") + kWirePlayed + R"(,"4/4",4])");
  CHECK(
      text(apply_groove_template(stiff, captured, MeterArg("4/4"))) ==
      call(
          "applyGrooveTemplate",
          R"([[{"pitch":36,"startBeat":0,"durationBeat":1,"velocity":80},{"pitch":38,"startBeat":1,"durationBeat":1}],)" +
              wire_template + R"(,"4/4"])"));
}

TEST_CASE("a template for another meter is refused", "[groove]") {
  GrooveTemplate captured = extract_groove_template(played(), MeterArg("4/4"), 4);
  CHECK_THROWS_AS(apply_groove_template(played(), captured, MeterArg("3/4")), InvalidInputError);
  captured.slotsPerBar = 8;
  CHECK_THROWS_AS(apply_groove_template(played(), captured, MeterArg("4/4")), InvalidInputError);
  captured.slotsPerBar = 16;
  captured.slots[3].timingOffset = std::nan("");
  CHECK_THROWS_AS(apply_groove_template(played(), captured, MeterArg("4/4")), InvalidInputError);
}
