// The typed vocabulary and transform API against the op layer, whose results the call corpus
// pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <optional>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "cantus/generate/vocabulary.h"
#include "cantus/ops.h"
#include "ops/codec_g1.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

GridEvent event(double step, double velocity, std::optional<std::string> voice,
                std::optional<std::string> limb) {
  return GridEvent{step, velocity, std::move(voice), std::move(limb)};
}

std::vector<GridEvent> figure() {
  return {event(0, 1, std::nullopt, "kick"),   event(4, 0.9, "snare", std::nullopt),
          event(8, 1, std::nullopt, "kick"),   event(12, 0.9, "snare", std::nullopt),
          event(3, 0.5, std::nullopt, "kick"), event(14, 0.4, "hat", std::nullopt),
          event(5, 0.3, "hat", std::nullopt),  event(6, 0.6, std::nullopt, "kick")};
}

/** The events as the wire writes them: step, velocity, then the stream fields given. */
std::string text(const std::vector<GridEvent>& events) {
  json::Array out;
  for (const GridEvent& e : events) {
    json::Object o;
    o.set("step", e.step);
    o.set("velocity", e.velocity);
    if (e.voice) {
      o.set("voice", *e.voice);
    }
    if (e.limb) {
      o.set("limb", *e.limb);
    }
    out.push_back(json::Value(std::move(o)));
  }
  return ops::stringify(json::Value(std::move(out)));
}

std::string draw_text(unsigned seed) {
  return call("ResolvedContext#part",
              "[" + call("resolveContext", "[" + std::to_string(seed) + "]") + R"(,"drums"])");
}

}  // namespace

TEST_CASE("the figure transforms match the op layer", "[vocabulary]") {
  std::vector<GridEvent> f = figure();
  std::string wire = text(f);
  for (double amount : {0.0, 0.3, 0.6, 1.0}) {
    CHECK(text(thin(f, amount, "4/4")) ==
          call("thin", "[" + wire + "," + ops::stringify(json::Value(amount)) + R"(,"4/4"])"));
    CHECK(text(thin(f, amount, "6/8")) ==
          call("thin", "[" + wire + "," + ops::stringify(json::Value(amount)) + R"(,"6/8"])"));
  }
  CHECK(text(double_(f)) == call("double", "[" + wire + "]"));
  CHECK(text(half_time(f, 32)) == call("halfTime", "[" + wire + ",32]"));
  CHECK(text(double_time(f)) == call("doubleTime", "[" + wire + "]"));
  for (unsigned seed : {1U, 7U, 9U}) {
    Draw draw = resolve_context(GenerationContextInput(seed)).part("drums");
    std::string wire_draw = draw_text(seed);
    CHECK(text(syncopate(f, 0.7, draw, {"bar", 2.0})) ==
          call("syncopate", "[" + wire + ",0.7," + wire_draw + R"(,"bar",2])"));
    CHECK(text(syncopate(f, SyncopateOptions{0.9, MeterArg("3/4")}, draw)) ==
          call("syncopate", "[" + wire + R"(,{"amount":0.9,"ts":"3/4"},)" + wire_draw + "]"));
    for (double rhythmic : {0.1, 0.5, 0.95}) {
      for (FigureRate rate : {FigureRate::kStraight, FigureRate::kHalf, FigureRate::kDouble}) {
        DeformOptions opts;
        opts.rhythmic = rhythmic;
        opts.rate = rate;
        std::string wire_opts = R"({"rhythmic":)" + ops::stringify(json::Value(rhythmic)) +
                                R"(,"rate":")" + std::string(to_string(rate)) + R"("})";
        CHECK(text(deform(f, opts, draw, {"p", 1.0})) ==
              call("deform", "[" + wire + "," + wire_opts + "," + wire_draw + R"(,"p",1])"));
      }
    }
  }
  for (double difficulty : {1.0, 2.5, 5.0}) {
    CHECK((within_ceiling(f, 180, difficulty) ? "true" : "false") ==
          call("withinCeiling",
               "[" + wire + ",180," + ops::stringify(json::Value(difficulty)) + "]"));
  }
  for (double step : {0.0, 2.0, 3.0, 4.0, 6.0, 8.0, 9.0, 12.0}) {
    for (const char* ts : {"4/4", "6/8", "7/8", "3+2+2/8"}) {
      CHECK(ops::stringify(json::Value(grid_metric_weight(step, ts))) ==
            call("gridMetricWeight",
                 "[" + ops::stringify(json::Value(step)) + R"(,")" + std::string(ts) + R"("])"));
    }
  }
}

TEST_CASE("the ornament dial keeps decoration on its own draw", "[vocabulary]") {
  Draw draw = resolve_context(GenerationContextInput(3U)).part("drums");
  OrnamentTest soft = [](const GridEvent& e) { return e.velocity < 0.6; };
  std::vector<GridEvent> f = figure();
  CHECK(ornament_by(f, soft, 1, draw).size() == f.size());
  CHECK(ornament_by(f, soft, 0, draw).size() == 5);
  // Raising the dial only brings more back.
  CHECK(ornament_by(f, soft, 0.3, draw).size() <= ornament_by(f, soft, 0.7, draw).size());
  CHECK_THROWS_AS(ornament_by(f, OrnamentTest(), 0.5, draw), InvalidInputError);
}

TEST_CASE("doubling and drawing keep each stream to itself", "[vocabulary]") {
  std::vector<GridEvent> backbeat;
  for (double step = 0; step < 16; step += 2) {
    backbeat.push_back(event(step, 0.7, std::nullopt, "hat"));
  }
  backbeat.push_back(event(0, 1, std::nullopt, "kick"));
  backbeat.push_back(event(4, 1, std::nullopt, "snare"));
  backbeat.push_back(event(8, 1, std::nullopt, "kick"));
  backbeat.push_back(event(12, 1, std::nullopt, "snare"));
  auto steps_of = [](const std::vector<GridEvent>& events, const std::string& limb) {
    std::vector<double> out;
    for (const GridEvent& e : events) {
      if (e.limb == limb) {
        out.push_back(e.step);
      }
    }
    return out;
  };
  std::vector<GridEvent> doubled = double_(backbeat);
  CHECK(steps_of(doubled, "hat").size() == 16);
  CHECK(steps_of(doubled, "kick") == std::vector<double>{0, 4, 8, 12});
  CHECK(steps_of(doubled, "snare") == std::vector<double>{4, 8, 12, 14});

  std::vector<GridEvent> ghosts = {event(6, 0.3, std::nullopt, "snare"),
                                   event(6, 0.3, std::nullopt, "hat")};
  OrnamentTest all = [](const GridEvent&) { return true; };
  bool apart = false;
  for (unsigned seed = 0; seed < 40 && !apart; ++seed) {
    Draw draw = resolve_context(GenerationContextInput(seed)).part("test");
    apart = ornament_by(ghosts, all, 0.5, draw).size() == 1;
  }
  CHECK(apart);
}

TEST_CASE("deform reads every dial it is given", "[vocabulary]") {
  Draw draw = resolve_context(GenerationContextInput(7U)).part("test");
  std::vector<GridEvent> one = {event(0, 1, std::nullopt, std::nullopt)};
  DeformOptions ornament;
  ornament.ornament = 7;
  CHECK_THROWS_AS(deform(one, ornament, draw), InvalidInputError);
  DeformOptions meter;
  meter.ts = MeterArg("banana");
  CHECK_THROWS_AS(deform(one, meter, draw), InvalidInputError);
}

TEST_CASE("a query matches the grouping of a meter", "[vocabulary]") {
  Vocabulary<int> written;
  written.ts = TimeSignature{7, 8, std::vector<int>{3, 2, 2}};
  VocabularyQuery same;
  same.ts = MeterArg("3+2+2/8");
  VocabularyQuery other;
  other.ts = MeterArg("2+2+3/8");
  VocabularyQuery plain;
  plain.ts = MeterArg(TimeSignature{7, 8, std::nullopt});
  CHECK(fits_query(written, same));
  CHECK_FALSE(fits_query(written, other));
  CHECK_FALSE(fits_query(written, plain));
}

TEST_CASE("selection and merging match the op layer", "[vocabulary]") {
  std::string patterns = call("$const:DRUM_PATTERNS", "[]");
  for (const char* genre : {"funk", "samba", "jazz"}) {
    VocabularyQuery query;
    query.genre = parse_genre(genre);
    query.bpm = 100;
    std::vector<DrumVocabulary> chosen = select_vocabulary(DRUM_PATTERNS, query);
    std::string wire_query = std::string(R"({"genre":")") + genre + R"(","bpm":100})";
    CHECK(ops::stringify(ops::to_json(chosen)) ==
          call("selectVocabulary", "[" + patterns + "," + wire_query + "]"));
    for (unsigned seed : {0U, 4U}) {
      std::optional<DrumVocabulary> picked =
          pick_vocabulary(DRUM_PATTERNS, VocabularyQuery{},
                          resolve_context(GenerationContextInput(seed)).part("drums"), {"x"});
      REQUIRE(picked);
      CHECK(ops::stringify(ops::to_json(*picked)) ==
            call("pickVocabulary", "[" + patterns + ",{}," + draw_text(seed) + R"(,"x"])"));
    }
  }
  DrumVocabulary replacement = DRUM_PATTERNS[1];
  replacement.difficulty = 1;
  DrumVocabulary added = DRUM_PATTERNS[0];
  added.id = "mine";
  std::vector<DrumVocabulary> merged = merge_vocabulary(
      DRUM_PATTERNS, std::optional<std::vector<DrumVocabulary>>({replacement, added}));
  REQUIRE(merged.size() == DRUM_PATTERNS.size() + 1);
  CHECK(merged[1].difficulty == 1);
  CHECK(merged.back().id == "mine");
  DrumVocabulary bad = DRUM_PATTERNS[0];
  bad.difficulty = 40;
  CHECK_THROWS_AS(assert_vocabulary(bad), InvalidInputError);
  bad.difficulty = 2;
  bad.tempoRange = std::array<double, 2>{140, 100};
  CHECK_THROWS_AS(assert_vocabulary(bad), InvalidInputError);
  std::vector<Vocabulary<std::any>> mixed{to_any_vocabulary(DRUM_PATTERNS[0])};
  CHECK(vocabulary_of_kind<DrumPattern>(mixed).size() == 1);
  CHECK(vocabulary_of_kind<FillArchetype>(mixed).empty());
}
