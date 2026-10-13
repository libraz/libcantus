#include <catch2/catch_test_macros.hpp>
#include <string>

#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

using namespace cantus;

TEST_CASE("a chord's function follows its degree, and its sonority where that decides",
          "[functional]") {
  KeyArg c_major(major_key(0).scale());
  CHECK(function_of(make_chord(7, ChordQuality::kMaj), c_major) == HarmonicFunction::kDominant);
  CHECK(function_of(make_chord(5, ChordQuality::kMaj), c_major) == HarmonicFunction::kSubdominant);
  CHECK(function_of(make_chord(9, ChordQuality::kDom7), c_major) == HarmonicFunction::kDominant);
  CHECK(function_of("Bb", "C major") == HarmonicFunction::kSubdominant);
  CHECK(is_minor_key("A minor"));
  CHECK_FALSE(is_minor_key("C major"));
  CHECK(is_diatonic("Am", "C major"));
  CHECK_FALSE(is_diatonic("A", "C major"));
}

TEST_CASE("a chord is borrowed when it is diatonic to the parallel mode", "[functional]") {
  CHECK(is_borrowed_chord("Fm", "C major"));
  CHECK_FALSE(is_borrowed_chord("G", "C minor"));
  CHECK(borrowed_source("Fm", "C major") == BorrowedSource::kParallelMinor);
  CHECK(borrowed_source("Db", "C major") == BorrowedSource::kNeapolitan);
  CHECK_FALSE(borrowed_source("F", "C major"));
}

TEST_CASE("numerals render and parse as each other's inverse", "[functional]") {
  CHECK(chord_to_roman("G7", "C major") == "V7");
  CHECK(chord_to_roman("D7", "C major", ChordToRomanOptions{true, std::nullopt}) == "V7/V");
  CHECK(chord_to_roman("C/E", "C major") == "I6");
  Chord parsed = roman_to_chord("V65", "C major");
  CHECK(parsed.rootPc == 7);
  CHECK(parsed.bassPc == 11);
  CHECK(roman_to_chord("N6", "C major").rootPc == 1);
  CHECK_THROWS_AS(roman_to_chord("Vfoo", "C major"), InvalidInputError);
  CHECK_THROWS_AS(roman_to_chord("V\n7", "C major"), InvalidInputError);
  RomanExplanation explanation = explain_roman("G7", "C major");
  CHECK(explanation.roman == "V7");
  CHECK(explanation.rationale ==
        "V7: the root is the fifth degree of the key, the case and suffix come from the dom7 "
        "quality, and the chord stands on its own root");
}

TEST_CASE("analyze_chord names the rule that settled the function", "[functional]") {
  ChordAnalysis analysis = analyze_chord("D7", "C major", AnalyzeChordOptions{});
  CHECK(analysis.function == HarmonicFunction::kDominant);
  CHECK(analysis.roman == "II7");
  CHECK(analysis.alternatives.empty());
  AnalyzeChordOptions ask;
  ask.alternatives = true;
  CHECK_FALSE(analyze_chord("D7", "C major", ask).alternatives.empty());
}

TEST_CASE("the secondary dominant is a seventh a fifth above its target", "[functional]") {
  Chord of_v = secondary_dominant(5, "C major");
  CHECK(of_v.rootPc == 2);
  CHECK(of_v.quality == ChordQuality::kDom7);
  CHECK_THROWS_AS(secondary_dominant(8, "C major"), InvalidInputError);
  CHECK_THROWS_AS(secondary_dominant(1.5, "C major"), InvalidInputError);
  Chord flat = secondary_dominant_of(parse_chord_symbol("Eb"));
  CHECK(flat.rootPc == 10);
  REQUIRE(flat.rootSpelling);
  CHECK(flat.rootSpelling->letter == 6);
}

TEST_CASE("pivot chords are the triads two keys share", "[functional]") {
  std::vector<PivotChord> pivots = pivot_chords("C major", "G major");
  REQUIRE(pivots.size() == 4);
  CHECK(pivots[0].romanFrom == "I");
  CHECK(pivots[0].romanTo == "IV");
  CHECK(pivot_chords("C major", "F# major").empty());
}

TEST_CASE("cadences are told apart by the motion and the voicing", "[functional]") {
  CadenceResult authentic = detect_cadence("G", "C", "C major");
  CHECK(authentic.type == CadenceType::kAuthentic);
  CHECK_FALSE(authentic.strength);
  DetectCadenceOptions voiced;
  voiced.voicing = std::array<std::vector<double>, 2>{std::vector<double>{55, 62, 71},
                                                      std::vector<double>{48, 64, 72}};
  CadenceResult perfect = detect_cadence("G", "C", "C major", voiced);
  CHECK(perfect.strength == CadenceStrength::kPerfect);
  CHECK(perfect.soprano == ChordToneRole::kRoot);
  CHECK(detect_cadence("F", "C", "C major").type == CadenceType::kPlagal);
  CHECK(detect_cadence("Bb", "C", "C major").type == CadenceType::kModal);
  CHECK(detect_cadence("G", "Am", "C major").type == CadenceType::kDeceptive);
  CHECK(detect_cadence("Dm", "G", "C major").type == CadenceType::kHalf);
  CHECK_FALSE(detect_cadence("C", "D", "C major").type);
  CHECK(to_string(CadenceType::kPhrygian) == "phrygian");
}

TEST_CASE("the augmented sixths are built, spelled and recognised", "[functional]") {
  Chord german = augmented_sixth_chord(AugmentedSixthKind::kGerman, "C major");
  CHECK(german.rootPc == 8);
  CHECK(german.bassPc == 8);
  REQUIRE(german.toneSpellings);
  CHECK(augmented_sixth_kind(german, "C major") == AugmentedSixthKind::kGerman);
  CHECK(chord_to_roman(german, "C major") == "Ger6");
  std::vector<NoteData> spelled = spell_augmented_sixth(AugmentedSixthKind::kItalian, "E");
  REQUIRE(spelled.size() == 3);
  CHECK(spelled[0].letter == 0);
  Nullable<Chord> found = augmented_sixth_from_pitch_classes({8, 0, 3, 6}, 8, "C major");
  REQUIRE(found);
  CHECK(found->quality == ChordQuality::kDom7);
  CHECK_FALSE(augmented_sixth_from_pitch_classes({8, 0, 3, 6}, 0, "C major"));
  CHECK_FALSE(augmented_sixth_kind(make_chord(8, ChordQuality::kDom7), "C major"));
}
