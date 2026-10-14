// The typed counter-melody generators against the op layer, whose results the call corpus pins to
// TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/countermelody.h"
#include "cantus/ops.h"
#include "ops/codec_c1.h"
#include "ops/codec_t4.h"

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

const char* kWireKey =
    R"({"rootPc":0,"modeMask12":2741,"tonic":{"letter":0,"alter":0},"variant":"major"})";

std::vector<NoteEvent> melody() {
  return {NoteEvent{72, 0, 1, 90, std::nullopt}, NoteEvent{74, 1, 1, std::nullopt, std::nullopt},
          NoteEvent{71, 3, 2, 100, std::nullopt}, NoteEvent{67, 6, 1, 80, std::nullopt},
          NoteEvent{69, 7.5, 0.5, 80, std::nullopt}};
}

const char* kWireMelody =
    R"([{"pitch":72,"startBeat":0,"durationBeat":1,"velocity":90},{"pitch":74,"startBeat":1,"durationBeat":1},)"
    R"({"pitch":71,"startBeat":3,"durationBeat":2,"velocity":100},{"pitch":67,"startBeat":6,"durationBeat":1,"velocity":80},)"
    R"({"pitch":69,"startBeat":7.5,"durationBeat":0.5,"velocity":80}])";

ChordTimeline timeline() {
  return ChordTimeline{{ChordSegment{0, 4, make_chord(0, ChordQuality::kMaj)},
                        ChordSegment{4, 8, make_chord(7, ChordQuality::kDom7)}}};
}

const char* kWireTimeline =
    R"({"$hy":"ChordTimeline","segments":[{"startBeat":0,"endBeat":4,"chord":{"rootPc":0,"quality":"maj","intervals":[0,4,7]}},)"
    R"({"startBeat":4,"endBeat":8,"chord":{"rootPc":7,"quality":"dom7","intervals":[0,4,7,10]}}]})";

}  // namespace

TEST_CASE("counter melodies match the op layer", "[countermelody]") {
  for (CounterRegister side : {CounterRegister::kAbove, CounterRegister::kBelow}) {
    for (CounterRhythm rhythm : {CounterRhythm::kComplement, CounterRhythm::kFollow}) {
      for (SafetyProfile profile : {SafetyProfile::kStrict, SafetyProfile::kPop}) {
        CounterMelodyOptions opts(melody(), KeyArg(KeyScale{0, 2741}));
        opts.timeline = timeline();
        opts.register_ = side;
        opts.rhythm = rhythm;
        opts.profile = profile;
        opts.ctx = GenerationContextInput(5U);
        std::string wire = std::string(R"([{"melody":)") + kWireMelody + R"(,"timeline":)" +
                           kWireTimeline + R"(,"key":)" + kWireKey + R"(,"register":")" +
                           std::string(to_string(side)) + R"(","rhythm":")" +
                           std::string(to_string(rhythm)) + R"(","profile":")" +
                           std::string(to_string(profile)) + R"(","ctx":5}])";
        CHECK(text(generate_counter_melody(opts)) == call("generateCounterMelody", wire));
      }
    }
  }
}

TEST_CASE("a counter melody needs a chord source and a register that fits", "[countermelody]") {
  CounterMelodyOptions opts(melody(), KeyArg(KeyScale{0, 2741}));
  CHECK_THROWS_AS(generate_counter_melody(opts), InvalidInputError);
  opts.chordAt = [](double) { return Nullable<Chord>(make_chord(0, ChordQuality::kMaj)); };
  CHECK_FALSE(generate_counter_melody(opts).empty());
  opts.pitchLow = 90;
  opts.pitchHigh = 80;
  CHECK_THROWS_AS(generate_counter_melody(opts), InvalidInputError);
  opts.melody.clear();
  CHECK(generate_counter_melody(opts).empty());
}

TEST_CASE("imitations match the op layer", "[countermelody]") {
  for (ImitationAnswer answer : IMITATION_ANSWERS) {
    for (bool invert : {false, true}) {
      ImitationOptions opts(2, IntervalArg("P5"), KeyArg(KeyScale{0, 2741}));
      opts.answer = answer;
      opts.invert = invert;
      opts.velocityScale = 0.9;
      std::string wire = std::string("[") + kWireMelody + R"(,{"atBeat":2,"interval":"P5","key":)" +
                         kWireKey + R"(,"answer":")" + std::string(to_string(answer)) +
                         R"(","invert":)" + (invert ? "true" : "false") +
                         R"(,"velocityScale":0.9}])";
      CHECK(text(imitate(melody(), opts)) == call("imitate", wire));
    }
  }
  ImitationOptions off(0, IntervalArg("P5"), KeyArg(KeyScale{0, 2741}));
  std::vector<NoteEvent> high = {NoteEvent{122, 0, 1, std::nullopt, std::nullopt}};
  CHECK_THROWS_AS(imitate(high, off), InvalidInputError);
  off.from = 4;
  off.to = 1;
  CHECK_THROWS_AS(imitate(melody(), off), InvalidInputError);
}
