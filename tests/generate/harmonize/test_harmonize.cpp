// The harmonizer through the typed API and the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/harmonize.h"
#include "cantus/ops.h"
#include "ops/codec_g4.h"

using namespace cantus;
using Catch::Matchers::ContainsSubstring;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

std::vector<NoteEvent> melody_of(const std::vector<int>& pitches, double beats = 1) {
  std::vector<NoteEvent> out;
  double at = 0;
  for (int pitch : pitches) {
    NoteEvent note;
    note.pitch = pitch;
    note.startBeat = at;
    note.durationBeat = beats;
    out.push_back(note);
    at += beats;
  }
  return out;
}

const std::vector<int> kTune = {64, 65, 67, 65, 64, 62, 64, 60, 67, 69, 67, 65, 64, 62, 60, 60};

}  // namespace

TEST_CASE("a stepwise note between two others reads as passing", "[harmonize]") {
  std::vector<ClassifiedMelodyTone> tones =
      classify_melody_tones(melody_of({60, 62, 64, 60}), "4/4");
  REQUIRE(tones.size() == 4);
  CHECK(tones[0].role == MelodyToneRole::kStructural);
  CHECK(tones[1].role == MelodyToneRole::kPassing);
  CHECK(tones[1].ornamental);
  CHECK(tones[3].role == MelodyToneRole::kStructural);
  CHECK(ops::stringify(ops::to_json(tones)) ==
        call("classifyMelodyTones",
             R"([[{"pitch":60,"startBeat":0,"durationBeat":1},{"pitch":62,"startBeat":1,)"
             R"("durationBeat":1},{"pitch":64,"startBeat":2,"durationBeat":1},{"pitch":60,)"
             R"("startBeat":3,"durationBeat":1}],"4/4"])"));
}

TEST_CASE("a melody is harmonized in the key it sits in", "[harmonize]") {
  HarmonizeOptions opts(melody_of(kTune));
  opts.key = KeyArg("C major");
  HarmonizeResult result = harmonize_melody(opts);
  CHECK(result.transposeSemitones == 0);
  CHECK(result.key.scale.rootPc == 0);
  CHECK_FALSE(result.chords.empty());
  CHECK(result.chords.front().startBeat == 0);
  CHECK(result.melodyRoles.size() == kTune.size());
  // The melody closes on the tonic, so the last chord is the tonic.
  CHECK(result.chords.back().rootPc == 0);
}

TEST_CASE("an empty melody has no chords", "[harmonize]") {
  HarmonizeResult result = harmonize_melody(HarmonizeOptions(std::vector<NoteEvent>{}));
  CHECK(result.chords.empty());
  CHECK(result.melodyRoles.empty());
  CHECK(result.transposeSemitones == 0);
}

TEST_CASE("harmonization matches the op layer", "[harmonize]") {
  std::string melody =
      R"([{"pitch":64,"startBeat":0,"durationBeat":1},{"pitch":65,"startBeat":1,"durationBeat":1},)"
      R"({"pitch":67,"startBeat":2,"durationBeat":1},{"pitch":65,"startBeat":3,"durationBeat":1},)"
      R"({"pitch":64,"startBeat":4,"durationBeat":1},{"pitch":62,"startBeat":5,"durationBeat":1},)"
      R"({"pitch":64,"startBeat":6,"durationBeat":1},{"pitch":60,"startBeat":7,"durationBeat":1}])";
  std::vector<NoteEvent> notes = melody_of({64, 65, 67, 65, 64, 62, 64, 60});
  {
    HarmonizeOptions opts(notes);
    CHECK(ops::stringify(ops::to_json(harmonize_melody(opts))) ==
          call("harmonizeMelody", "[{\"melody\":" + melody + "}]"));
  }
  {
    HarmonizeOptions opts(notes);
    opts.key = KeyArg("A minor");
    opts.reharmonize = ReharmonizeStrength::kBorrowed;
    opts.placement = HarmonizePlacement{true, true};
    opts.harmonicRhythm = 1;
    opts.phraseEnds = std::vector<double>{4};
    opts.ctx = GenerationContextInput(5U);
    CHECK(ops::stringify(ops::to_json(harmonize_melody(opts))) ==
          call("harmonizeMelody",
               "[{\"melody\":" + melody +
                   R"(,"key":"A minor","reharmonize":"borrowed","placement":)"
                   R"({"transposeSearch":true,"octaveSearch":true},"harmonicRhythm":1,)"
                   R"("phraseEnds":[4],"ctx":5}])"));
  }
}

TEST_CASE("the key is inferred when none is named", "[harmonize]") {
  HarmonizeResult result = harmonize_melody(HarmonizeOptions(melody_of(kTune)));
  CHECK(result.key.scale.rootPc == 0);
}

TEST_CASE("a chord slot of no length is refused", "[harmonize]") {
  HarmonizeOptions opts(melody_of(kTune));
  opts.harmonicRhythm = 0;
  CHECK_THROWS_WITH(harmonize_melody(opts), ContainsSubstring("harmonic rhythm"));
}

TEST_CASE("a search larger than the budget is refused", "[harmonize]") {
  HarmonizeOptions opts(melody_of(kTune));
  opts.placement = HarmonizePlacement{true, true};
  opts.budget = 10;
  CHECK_THROWS_AS(harmonize_melody(opts), BudgetExceededError);
}
