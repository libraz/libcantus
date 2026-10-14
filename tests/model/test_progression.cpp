#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"
#include "cantus/model/timeline.h"

using namespace cantus;

namespace {

Progression cadence() {
  return Progression({ChordValue::parse("C"), ChordValue::parse("F"), ChordValue::parse("G7"),
                      ChordValue::parse("C")},
                     KeyArg(Key::major("C")));
}

}  // namespace

TEST_CASE("Progression reads its chords in the key it carries", "[model][progression]") {
  Progression p = cadence();
  CHECK(p.roman() == std::vector<std::string>{"I", "IV", "V7", "I"});
  CHECK(p.functions() ==
        std::vector<HarmonicFunction>{HarmonicFunction::kTonic, HarmonicFunction::kSubdominant,
                                      HarmonicFunction::kDominant, HarmonicFunction::kTonic});
  std::vector<CadenceResult> cadences = p.cadences();
  REQUIRE(cadences.size() == 3);
  CHECK_FALSE(cadences[0].type.has_value());
  CHECK(cadences[1].type == CadenceType::kHalf);
  CHECK(cadences[2].type == CadenceType::kAuthentic);
  std::vector<std::vector<double>> voicing;
  for (const std::vector<int>& chord : p.voice()) {
    voicing.emplace_back(chord.begin(), chord.end());
  }
  ProgressionAnalyzeOptions opts;
  opts.voicing = voicing;
  ProgressionAnalysis analysis = p.analyze(std::nullopt, opts);
  REQUIRE(analysis.cadence.has_value());
  CHECK(analysis.cadence->strength == CadenceStrength::kImperfect);
  CHECK_THROWS_WITH(Progression({ChordValue::parse("C")}).roman(),
                    "progression has no key context; pass a Key or attach one with withKey()");
}

TEST_CASE("Progression is cut, joined and moved as a whole", "[model][progression]") {
  Progression p = cadence();
  CHECK(p.slice(1, 3).to_string() == "F G7");
  CHECK(p.at(-1)->symbol() == "C");
  CHECK_FALSE(p.at(4).has_value());
  CHECK(p.index_of(ChordValue::parse("G7")) == 2);
  CHECK(p.substitute(2, SubstitutionType::kTritone).to_string() == "C F Db7 C");
  CHECK(p.transpose_to("Eb major").to_string() == "Eb Ab Bb7 Eb");
  CHECK(p.transpose(2).to_string() == "D G A7 D");
  CHECK(p.transpose_by("A4").to_string() == "F# B C#7 F#");
  CHECK(p.concat({ChordValue::parse("Am")}).length() == 5);
  CHECK(p.to_json().chords.size() == 4);
  CHECK(p.equals(Progression::from_json(p.to_json())));
  CHECK(p.chords()[0].key()->equals(Key::major("C")));
  CHECK_THROWS_WITH(p.substitute(9, SubstitutionType::kTritone),
                    "progression has no chord at index 9; it holds 4");
}

TEST_CASE("Progression lays its chords on a grid", "[model][progression]") {
  Timeline t = cadence().timeline(4);
  CHECK(t.length() == 4);
  CHECK(t.total_beats() == 16);
  CHECK(t.at(5)->symbol() == "F");
  CHECK(t.progression().to_string() == "C F G7 C");
}
