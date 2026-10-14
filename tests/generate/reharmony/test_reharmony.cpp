// Substitution, borrowing and negative harmony through the typed API and the op layer.

#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/generate/reharmony.h"
#include "cantus/ops.h"
#include "ops/codec_g4.h"

using namespace cantus;

namespace {

std::string call(const std::string& op, const std::string& args) {
  ops::Result result = ops::call(op, args);
  REQUIRE(result.ok());
  return result.json;
}

const char* kWireKey =
    R"({"rootPc":0,"modeMask12":2741,"tonic":{"letter":0,"alter":0},"variant":"major"})";

}  // namespace

TEST_CASE("the tritone substitute of G7 in C major is written Db7", "[reharmony]") {
  std::vector<Substitution> subs = substitute_chord(make_chord(7, ChordQuality::kDom7), "C major");
  auto tritone = std::find_if(subs.begin(), subs.end(), [](const Substitution& sub) {
    return sub.type == SubstitutionType::kTritone;
  });
  REQUIRE(tritone != subs.end());
  CHECK(tritone->chord.rootPc == 1);
  REQUIRE(tritone->chord.rootSpelling.has_value());
  CHECK(tritone->chord.rootSpelling->letter == 1);  // D
  CHECK(tritone->chord.rootSpelling->alter == -1);
  CHECK(tritone->roman == "bII7");
}

TEST_CASE("substitutions match the op layer and honour the melody's pitch classes", "[reharmony]") {
  Chord g7 = make_chord(7, ChordQuality::kDom7);
  std::string wire = std::string("[") + ops::stringify(ops::to_json(g7)) + "," + kWireKey;
  CHECK(ops::stringify(ops::to_json(substitute_chord(g7, "C major"))) ==
        call("substituteChord", wire + "]"));
  SubstituteOptions opts;
  opts.melodyPcs = std::vector<double>{1};
  std::vector<Substitution> kept = substitute_chord(g7, "C major", opts);
  for (const Substitution& sub : kept) {
    std::vector<int> pcs = chord_pitch_classes(sub.chord);
    CHECK(std::find(pcs.begin(), pcs.end(), 1) != pcs.end());
  }
  CHECK(ops::stringify(ops::to_json(kept)) ==
        call("substituteChord", wire + R"(,{"melodyPcs":[1]}])"));
}

TEST_CASE("the palette of C major borrows from C minor and adds the Neapolitan", "[reharmony]") {
  std::vector<BorrowedChord> palette = modal_interchange_palette("C major");
  CHECK(palette.size() == 8);
  CHECK(palette.back().chord.rootPc == 1);
  CHECK(palette.back().source == BorrowedSource::kNeapolitan);
  CHECK(ops::stringify(ops::to_json(palette)) ==
        call("modalInterchangePalette", std::string("[") + kWireKey + "]"));
}

TEST_CASE("negative harmony reflects G major to F minor in C major", "[reharmony]") {
  Chord mirrored = negative_harmony_mirror(make_chord(7, ChordQuality::kMaj), "C major");
  CHECK(mirrored.rootPc == 5);
  CHECK(mirrored.quality == ChordQuality::kMin);
  CHECK(ops::stringify(ops::to_json(mirrored)) ==
        call("negativeHarmonyMirror",
             std::string("[") + ops::stringify(ops::to_json(make_chord(7, ChordQuality::kMaj))) +
                 "," + kWireKey + "]"));
}
