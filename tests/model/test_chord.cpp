#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"

using namespace cantus;

TEST_CASE("ChordValue holds a chord and the spellings it was given", "[model][chord]") {
  ChordValue g7 = ChordValue::parse("G7/D");
  CHECK(g7.root_pc() == 7);
  CHECK(g7.quality() == ChordQuality::kDom7);
  CHECK(g7.intervals() == std::vector<double>{0, 4, 7, 10});
  CHECK(g7.bass_pc() == 2);
  Chord data = g7.data();
  REQUIRE(data.rootSpelling.has_value());
  CHECK(data.rootSpelling->letter == 4);
  REQUIRE(data.bassSpelling.has_value());
  CHECK(data.bassSpelling->letter == 1);
  CHECK(g7.spec().base == ChordBase::kMaj);
  CHECK(g7.pitch_classes() == std::vector<int>{2, 5, 7, 11});
  CHECK(g7.contains(65));
  CHECK(g7.role_of(65) == ChordToneRole::kSeventh);
  CHECK(g7.roman("C major") == "V43");
  CHECK(g7.function("C major") == HarmonicFunction::kDominant);
  CHECK(g7.symbol() == "G7/D");
  CHECK_THROWS_WITH(g7.roman(),
                    "chord has no key context; pass a Key or attach one with withKey()");
}

TEST_CASE("ChordValue derives its spelling from the key it carries", "[model][chord]") {
  ChordValue am = ChordValue::of(9.0, ChordQuality::kMin7).with_key(Key::major("Eb"));
  REQUIRE(am.data().rootSpelling.has_value());
  CHECK(am.data().rootSpelling->letter == 5);
  CHECK_FALSE(am.to_json().rootSpelling.has_value());
  std::vector<Note> tones = am.spell();
  REQUIRE(tones.size() == 4);
  CHECK(tones[1].name() == "C");
  CHECK_THROWS_AS(ChordValue::of(9.0, ChordQuality::kMin7).spell(), InvalidInputError);
}

TEST_CASE("ChordValue moves, inverts and is analyzed", "[model][chord]") {
  CHECK(ChordValue::parse("C/G").transpose(2).symbol() == "D/A");
  CHECK(ChordValue::parse("C").transpose_by("A4").symbol() == "F#");
  CHECK(ChordValue::parse("C").transpose_by("d5").symbol() == "Gb");
  CHECK(ChordValue::parse("Eb").secondary_dominant().symbol() == "Bb7");
  CHECK(ChordValue::parse("Cmaj7").invert(1).symbol() == "Cmaj7/E");
  CHECK(ChordValue::parse("Cmaj7").invert(-1).symbol() == "Cmaj7/B");
  CHECK(ChordValue::parse("Bb").is_borrowed("C major"));
  CHECK(ChordValue::parse("Bb").borrowed_source("C major") == BorrowedSource::kParallelMinor);
  CHECK(ChordValue::parse("G/B").figured_bass("C major") == "6");
  std::vector<Substitution> subs = ChordValue::parse("G7").substitutions("C major");
  REQUIRE_FALSE(subs.empty());
  CHECK(subs[0].type == SubstitutionType::kTritone);
  CHECK(subs[0].roman == "bII7");
  CHECK(ChordValue::parse("Fm").negative_harmony("C major").symbol() == "G");
  ChordSpan span = ChordValue::parse("Cmaj7").span(4);
  CHECK(span.startBeat == 4);
  CHECK_FALSE(span.intervals.has_value());
  CHECK(ChordValue::from_figured_bass("B", "6", "C major").symbol() == "G/B");
  CHECK(ChordValue::parse("C").voice() == std::vector<int>{48, 60, 64, 67});
  CHECK(ChordValue::parse("G7").with_key("C major").voice() == std::vector<int>{55, 62, 65, 71});
  CHECK(ChordValue::of(std::string("C"), ChordQuality::kMaj).equals(ChordValue::parse("C")));
  std::vector<ChordValue> found = ChordValue::detect({0, 4, 7, 10}, [] {
    DetectChordOptions opts;
    opts.input = ChordInputKind::kPitchClass;
    opts.bassPc = 4;
    return opts;
  }());
  REQUIRE(found.size() >= 3);
  CHECK(found[0].symbol() == "C7/E");
  CHECK(found[1].symbol() == "Edim");
  Chord empty;
  empty.quality = ChordQuality::kMaj;
  CHECK_THROWS_WITH(ChordValue(empty).invert(1), "cannot invert a chord with no intervals");
}
