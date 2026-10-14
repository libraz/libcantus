// The typed rhythm generator against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/rhythm.h"
#include "cantus/ops.h"
#include "ops/codec_g2b.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

}  // namespace

TEST_CASE("a rhythm matches the op layer", "[rhythm]") {
  for (const char* ts : {"4/4", "3/4", "6/8", "7/8"}) {
    for (std::uint32_t seed : {0U, 7U}) {
      RhythmOptions opts;
      opts.bars = 3;
      opts.subdivision = 4;
      opts.ctx = GenerationContextInput(seed);
      std::string wire = std::string("[\"") + ts + R"(",{"bars":3,"subdivision":4,"ctx":)" +
                         std::to_string(seed) + "}]";
      CHECK(ops::stringify(ops::to_json(generate_rhythm(MeterArg(ts), opts))) ==
            call("generateRhythm", wire));
    }
  }
}

TEST_CASE("every bar opens on an onset and the events tile the span", "[rhythm]") {
  RhythmOptions opts;
  opts.bars = 4;
  std::vector<RhythmEvent> events = generate_rhythm(MeterArg("4/4"), opts);
  REQUIRE_FALSE(events.empty());
  CHECK(events.front().position == 0);
  double end = 0;
  for (const RhythmEvent& event : events) {
    CHECK(event.position == end);
    end = event.position + event.duration;
  }
  CHECK(end == 16);
  CHECK(rhythm_density(events, MeterArg("4/4")) > 0);
  CHECK(rhythm_density({}, MeterArg("4/4")) == 0);
}

TEST_CASE("rhythm events become notes the guard accepts", "[rhythm]") {
  std::vector<RhythmEvent> events = {{0, 1}, {1, 2}};
  std::vector<NoteEvent> notes = rhythm_to_note_events(events, 38);
  CHECK(notes.size() == 2);
  CHECK(notes[1].velocity == 96);
  CHECK_THROWS_AS(rhythm_to_note_events(events, 128), InvalidInputError);
  CHECK_THROWS_AS(rhythm_to_note_events({{std::nan(""), 1}}, 38), InvalidInputError);
  CHECK(onset_weight_curve(3) == 1);
  CHECK_THROWS_AS(onset_weight_curve(4), InvalidInputError);
}
