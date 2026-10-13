// The typed drum generators against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "cantus/ops.h"
#include "ops/codec_g1.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

std::string text(const std::vector<DrumHit>& hits) { return ops::stringify(ops::to_json(hits)); }

GenerationContext context(std::uint32_t seed, double bpm, std::optional<double> rhythmic,
                          std::optional<double> difficulty) {
  GenerationContext ctx;
  ctx.seed = seed;
  ctx.bpm = bpm;
  ctx.complexity = Complexity{rhythmic, std::nullopt, rhythmic, difficulty};
  return ctx;
}

std::string context_text(std::uint32_t seed, double bpm, std::optional<double> rhythmic,
                         std::optional<double> difficulty) {
  json::Object complexity;
  if (rhythmic) {
    complexity.set("rhythmic", *rhythmic);
    complexity.set("ornament", *rhythmic);
  }
  if (difficulty) {
    complexity.set("difficulty", *difficulty);
  }
  json::Object ctx;
  ctx.set("seed", static_cast<double>(seed));
  ctx.set("bpm", bpm);
  ctx.set("complexity", json::Value(std::move(complexity)));
  return ops::stringify(json::Value(std::move(ctx)));
}

}  // namespace

TEST_CASE("placing patterns matches the op layer", "[drums]") {
  for (Genre genre : {Genre::kMotown, Genre::kFunk, Genre::kBlues, Genre::kBossa, Genre::kSamba,
                      Genre::kGospel, Genre::kDnb}) {
    for (std::uint32_t seed : {0U, 5U}) {
      for (FigureRate rate : {FigureRate::kStraight, FigureRate::kHalf, FigureRate::kDouble}) {
        DrumPatternOptions opts;
        opts.bars = 3;
        opts.genre = genre;
        opts.rate = rate;
        opts.feel = seed == 0 ? GrooveFeel::kStraight : GrooveFeel::kShuffle;
        std::optional<double> difficulty = seed == 0 ? std::nullopt : std::optional<double>(4);
        opts.ctx = GenerationContextInput(context(seed, 110, 0.8, difficulty));
        std::string wire = std::string(R"([{"bars":3,"genre":")") + std::string(to_string(genre)) +
                           R"(","rate":")" + std::string(to_string(rate)) + R"(","feel":")" +
                           std::string(to_string(*opts.feel)) + R"(","ctx":)" +
                           context_text(seed, 110, 0.8, difficulty) + "}]";
        CHECK(text(place_drum_pattern(opts)) == call("placeDrumPattern", wire));
      }
    }
  }
}

TEST_CASE("a caller's pattern is placed as the op layer places it", "[drums]") {
  DrumVocabulary clave;
  clave.id = "clave";
  clave.genre = Genre::kReggae;
  clave.difficulty = 1;
  clave.provenance = Provenance{ProvenanceBasis::kIdiom, "a clave"};
  clave.material.steps = 16;
  clave.material.strokes = {
      DrumStroke{DrumVoice::kSideStick, 0, 0.8, std::nullopt, std::nullopt, std::nullopt},
      DrumStroke{DrumVoice::kSideStick, 3, 0.8, 0.5, std::nullopt, std::nullopt},
      DrumStroke{DrumVoice::kSnare, 6, 0.4, std::nullopt, Articulation::kGhost, Limb::kLeftHand}};
  GenerationContext ctx = context(2, 80, 0.7, std::nullopt);
  ctx.vocabulary = std::vector<Vocabulary<std::any>>{to_any_vocabulary(clave)};
  DrumPatternOptions opts;
  opts.bars = 2;
  opts.genre = Genre::kReggae;
  opts.ctx = GenerationContextInput(ctx);
  std::string entry = ops::stringify(ops::to_json(clave));
  std::string wire =
      R"([{"bars":2,"genre":"reggae","ctx":{"seed":2,"bpm":80,"complexity":{"rhythmic":0.7,"ornament":0.7},"vocabulary":[)" +
      entry + "]}}]";
  CHECK(text(place_drum_pattern(opts)) == call("placeDrumPattern", wire));
  // A figure stating no signature fits any meter; the built-in dictionary is all in 4/4.
  opts.ts = MeterArg("7/8");
  CHECK_NOTHROW(place_drum_pattern(opts));
  opts.ctx = std::nullopt;
  CHECK_THROWS_AS(place_drum_pattern(opts), InvalidInputError);
}

TEST_CASE("generating drums matches the op layer", "[drums]") {
  const char* styles[] = {"standard", "funk",      "shuffle", "bossa",   "trap",
                          "halftime", "breakbeat", "house",   "synthpop"};
  const char* sections[] = {"intro", "verse", "prechorus", "chorus", "bridge", "outro"};
  const char* roles[] = {"full", "ambient", "minimal", "fxOnly"};
  for (const char* style : styles) {
    for (const char* section : sections) {
      for (const char* role : roles) {
        DrumsOptions opts;
        opts.bars = 4;
        opts.style = *parse_groove_style(style);
        opts.section = *parse_section(section);
        opts.role = parse_drum_role(role);
        opts.fills = true;
        opts.nextSection = Section::kChorus;
        opts.ctx = GenerationContextInput(context(9, 128, 0.6, 3));
        std::string wire = std::string(R"([{"bars":4,"style":")") + style + R"(","section":")" +
                           section + R"(","role":")" + role +
                           R"(","fills":true,"nextSection":"chorus","ctx":)" +
                           context_text(9, 128, 0.6, 3) + "}]";
        CHECK(text(generate_drums(opts)) == call("generateDrums", wire));
      }
    }
  }
  DrumsOptions euclid;
  euclid.bars = 2;
  euclid.style = GrooveStyle::kHouse;
  euclid.section = Section::kChorus;
  euclid.euclideanKick = EuclideanKick{5, 13, -3};
  euclid.feel = GrooveFeel::kSwing;
  euclid.ctx = GenerationContextInput(context(1, 170, std::nullopt, 1));
  CHECK(
      text(generate_drums(euclid)) ==
      call(
          "generateDrums",
          R"([{"bars":2,"style":"house","section":"chorus","feel":"swing","euclideanKick":{"pulses":5,"steps":13,"rotation":-3},"ctx":)" +
              context_text(1, 170, std::nullopt, 1) + "}]"));
  euclid.ts = MeterArg("3/4");
  CHECK_THROWS_AS(generate_drums(euclid), InvalidInputError);
}

TEST_CASE("the kit and the voice table cover every voice the generators emit", "[drums]") {
  for (DrumVoice voice : DRUM_VOICES) {
    CHECK(drum_voice_of(drum_note(voice)) == voice);
    CHECK(can_sound(DRUM_KIT, drum_note(voice)));
  }
  CHECK_FALSE(drum_voice_of(60));
  CHECK_THROWS_AS(drum_voice_of(128), InvalidInputError);
  CHECK(FILL_ARCHETYPES[static_cast<std::size_t>(FillType::kHalfTimeFill)].boundToBar == true);
  CHECK(KICK_FIGURES.front().first == DrumStyle::kSparse);
}
