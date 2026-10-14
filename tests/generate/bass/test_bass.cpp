// The typed bass generators against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/bass.h"
#include "cantus/ops.h"
#include "ops/codec_c1.h"
#include "ops/codec_g2a.h"
#include "theory/chord/chord.h"

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

std::vector<BassSegmentArg> placement() {
  return {BassSegmentArg{4, 8, make_chord(7, ChordQuality::kDom7)},
          BassSegmentArg{0, 4, make_chord(0, ChordQuality::kMaj7)},
          BassSegmentArg{8, 12, make_chord(9, ChordQuality::kMin7, 4)}};
}

const char* kWirePlacement =
    R"([{"startBeat":4,"endBeat":8,"chord":{"rootPc":7,"quality":"dom7","intervals":[0,4,7,10]}},)"
    R"({"startBeat":0,"endBeat":4,"chord":{"rootPc":0,"quality":"maj7","intervals":[0,4,7,11]}},)"
    R"({"startBeat":8,"endBeat":12,"chord":{"rootPc":9,"quality":"min7","intervals":[0,3,7,10],"bassPc":4}}])";

const char* kWireKey =
    R"({"rootPc":0,"modeMask12":2741,"tonic":{"letter":0,"alter":0},"variant":"major"})";

}  // namespace

TEST_CASE("bass lines match the op layer in every style", "[bass]") {
  for (BassStyle style : BASS_STYLES) {
    for (std::uint32_t seed : {0U, 3U}) {
      BassLineOptions opts(placement(), KeyArg(KeyScale{0, 2741}));
      opts.style = style;
      opts.ctx = GenerationContextInput(seed);
      std::string wire = std::string(R"([{"segments":)") + kWirePlacement + R"(,"key":)" +
                         kWireKey + R"(,"style":")" + std::string(to_string(style)) +
                         R"(","ctx":)" + std::to_string(seed) + "}]";
      CHECK(text(generate_bass_line(opts)) == call("generateBassLine", wire));
    }
  }
}

TEST_CASE("a bass line refuses a placement that overlaps", "[bass]") {
  BassLineOptions opts({BassSegmentArg{0, 4, make_chord(0, ChordQuality::kMaj)},
                        BassSegmentArg{3, 6, make_chord(5, ChordQuality::kMaj)}},
                       KeyArg(KeyScale{0, 2741}));
  CHECK_THROWS_AS(generate_bass_line(opts), InvalidInputError);
  opts.segments = {};
  CHECK(generate_bass_line(opts).empty());
}

TEST_CASE("licks match the op layer, built in and brought by the caller", "[bass]") {
  PlaceLicksOptions opts;
  opts.genre = Genre::kMotown;
  opts.ctx = GenerationContextInput(
      GenerationContext{7, Complexity{1, std::nullopt, std::nullopt, 5}, std::nullopt, std::nullopt,
                        100, std::nullopt, std::nullopt});
  std::string wire =
      std::string("[") + kWirePlacement + "," + kWireKey +
      R"(,{"genre":"motown","ctx":{"seed":7,"bpm":100,"complexity":{"rhythmic":1,"difficulty":5}}}])";
  CHECK(text(place_licks(placement(), KeyArg(KeyScale{0, 2741}), opts)) ==
        call("placeLicks", wire));

  BassLick own;
  own.id = "own";
  own.genre = Genre::kHiphop;
  own.difficulty = 1;
  own.provenance = Provenance{ProvenanceBasis::kConstruction, "a test figure"};
  own.material.lengthSteps = 16;
  own.material.notes = {
      LickNote{{0, 1, std::nullopt, std::nullopt}, 1, std::nullopt, std::nullopt, std::nullopt},
      LickNote{{8, 0.8, std::nullopt, std::nullopt}, 5, std::nullopt, 4, std::nullopt}};
  GenerationContext ctx;
  ctx.seed = 1;
  ctx.bpm = 90;
  ctx.complexity = Complexity{1, std::nullopt, std::nullopt, std::nullopt};
  ctx.vocabulary = std::vector<Vocabulary<std::any>>{to_any_vocabulary(own)};
  PlaceLicksOptions custom;
  custom.genre = Genre::kHiphop;
  custom.ctx = GenerationContextInput(ctx);
  std::string entry = ops::stringify(ops::to_json(own));
  std::string custom_wire =
      std::string("[") + kWirePlacement + "," + kWireKey +
      R"(,{"genre":"hiphop","ctx":{"seed":1,"bpm":90,"complexity":{"rhythmic":1},"vocabulary":[)" +
      entry + "]}}]";
  CHECK(text(place_licks(placement(), KeyArg(KeyScale{0, 2741}), custom)) ==
        call("placeLicks", custom_wire));
}

TEST_CASE("a caller's lick is checked note by note", "[bass]") {
  LickMaterial material;
  material.lengthSteps = 16;
  material.notes = {
      LickNote{{0, 1, std::nullopt, std::nullopt}, 0, std::nullopt, std::nullopt, std::nullopt}};
  BassLick own;
  own.id = "bad";
  own.genre = Genre::kHiphop;
  own.material = material;
  GenerationContext ctx;
  ctx.vocabulary = std::vector<Vocabulary<std::any>>{to_any_vocabulary(own)};
  PlaceLicksOptions opts;
  opts.genre = Genre::kHiphop;
  opts.ctx = GenerationContextInput(ctx);
  CHECK_THROWS_AS(place_licks(placement(), KeyArg(KeyScale{0, 2741}), opts), InvalidInputError);
}

TEST_CASE("the dictionary and the styles are the TS tables", "[bass]") {
  CHECK(BASS_LICKS.front().id == "motownWalkDown");
  CHECK(BASS_LICKS.front().material.notes.size() == 6);
  CHECK(to_string(BASS_STYLES.back()) == "arpeggio");
  CHECK(parse_bass_style("walking") == BassStyle::kWalking);
  CHECK_FALSE(parse_bass_style("slap"));
  CHECK(is_lick_material(std::any(LickMaterial{})));
  CHECK_FALSE(is_lick_material(std::any(1)));
}
