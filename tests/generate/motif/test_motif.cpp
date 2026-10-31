// The typed motif functions against the op layer, whose results the call corpus pins to TS.

#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/generate/motif.h"
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

std::string text(const MotifCell& cell) { return ops::stringify(ops::to_json(cell)); }

const char* kWireKey =
    R"({"rootPc":0,"modeMask12":2741,"tonic":{"letter":0,"alter":0},"variant":"major"})";

MotifCell cell() {
  return MotifCell{{NoteEvent{60, 0, 1, 90, std::nullopt},
                    NoteEvent{64, 1, 0.5, std::nullopt, std::nullopt},
                    NoteEvent{62, 2, 1, 70, std::nullopt}}};
}

const char* kWireCell =
    R"({"notes":[{"pitch":60,"startBeat":0,"durationBeat":1,"velocity":90},{"pitch":64,"startBeat":1,"durationBeat":0.5},)"
    R"({"pitch":62,"startBeat":2,"durationBeat":1,"velocity":70}]})";

}  // namespace

TEST_CASE("a generated motif matches the op layer", "[motif]") {
  for (MotifContour contour : {MotifContour::kArch, MotifContour::kAscending,
                               MotifContour::kDescending, MotifContour::kWave}) {
    MotifOptions opts(KeyArg(KeyScale{0, 2741}), 3);
    opts.contour = contour;
    opts.jitter = 0.5;
    opts.chord = ChordArg("Am");
    opts.ctx = GenerationContextInput(3U);
    std::string wire = std::string(R"([{"key":)") + kWireKey + R"(,"bars":3,"contour":")" +
                       std::string(to_string(contour)) + R"(","jitter":0.5,"chord":"Am","ctx":3}])";
    CHECK(text(generate_motif(opts)) == call("generateMotif", wire));
  }
}

TEST_CASE("every transformation matches the op layer", "[motif]") {
  for (MotifTransform transform : MOTIF_TRANSFORMS) {
    for (bool keyed : {false, true}) {
      std::optional<KeyArg> key;
      if (keyed) {
        key = KeyArg(KeyScale{0, 2741});
      }
      std::string wire = std::string("[") + kWireCell + R"(,")" +
                         std::string(to_string(transform)) + R"(",2)" +
                         (keyed ? std::string(",") + kWireKey : std::string()) + "]";
      CHECK(text(transform_motif(cell(), transform, 2, key)) == call("transformMotif", wire));
    }
  }
  CHECK_THROWS_AS(transform_motif(cell(), MotifTransform::kTransposeChromatic, 100),
                  InvalidInputError);
  CHECK_THROWS_AS(transform_motif(cell(), MotifTransform::kAugment, 0), InvalidInputError);
}

TEST_CASE("a developed motif follows the harmony", "[motif]") {
  ChordTimeline timeline{{ChordSegment{0, 4, make_chord(0, ChordQuality::kMaj)},
                          ChordSegment{4, 8, make_chord(7, ChordQuality::kDom7)}}};
  MotifCell developed =
      develop_motif(cell(), timeline, KeyArg(KeyScale{0, 2741}), 2, MeterArg("4/4"));
  std::string wire =
      std::string("[") + kWireCell +
      R"(,{"$hy":"ChordTimeline","segments":[{"startBeat":0,"endBeat":4,"chord":{"rootPc":0,"quality":"maj","intervals":[0,4,7]}},)"
      R"({"startBeat":4,"endBeat":8,"chord":{"rootPc":7,"quality":"dom7","intervals":[0,4,7,10]}}]},)" +
      kWireKey + R"(,2,"4/4"])";
  CHECK(text(developed) == call("developMotif", wire));
  CHECK(motif_to_note_events(cell()).size() == 3);
}

TEST_CASE("a developed motif does not depend on the listing of its cell", "[motif]") {
  ChordTimeline timeline{{ChordSegment{0, 4, make_chord(0, ChordQuality::kMaj)},
                          ChordSegment{4, 8, make_chord(7, ChordQuality::kDom7)}}};
  MotifCell forwards{{NoteEvent{60, 0, 1, std::nullopt, std::nullopt},
                      NoteEvent{61, 1, 2, std::nullopt, std::nullopt},
                      NoteEvent{63, 3, 1, std::nullopt, std::nullopt},
                      NoteEvent{66, 3, 1, std::nullopt, std::nullopt}}};
  MotifCell backwards{{forwards.notes.rbegin(), forwards.notes.rend()}};
  KeyArg key(KeyScale{0, 2741});
  CHECK(text(develop_motif(backwards, timeline, key, 2, MeterArg("4/4"))) ==
        text(develop_motif(forwards, timeline, key, 2, MeterArg("4/4"))));
}
