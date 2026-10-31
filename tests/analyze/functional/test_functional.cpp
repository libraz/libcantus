#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/analyze/functional.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/symbol.h"

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

TEST_CASE("a chord built from a numeral or a key carries the spelling it denotes", "[functional]") {
  CHECK(format_chord_symbol(roman_to_chord("bII", "Ab minor")) == "Bbb");
  CHECK(format_chord_symbol(roman_to_chord("N6", "Ab minor")) == "Bbb/Db");
  CHECK(format_chord_symbol(roman_to_chord("viio7/vi", "C major")) == "G#dim7");
  CHECK(format_chord_symbol(roman_to_chord("V7/bVI", "C major")) == "Eb7");
  CHECK(format_chord_symbol(roman_to_chord("V43", "Ab major")) == "Eb7/Bb");
  CHECK(format_chord_symbol(roman_to_chord("viio42", "Ab major")) == "Gdim7/Fb");
  CHECK(format_chord_symbol(diatonic_seventh(5, major_key(8))) == "Eb7");
  CHECK(format_chord_symbol(secondary_dominant(4, major_key(3))) == "Eb7");
  CHECK(format_chord_symbol(chord_from_degree(1, ChordQuality::kMaj7, "Eb major")) == "Ebmaj7");
  CHECK(format_chord_symbol(diatonic_triad(1, "Ab minor")) == "Abm");
  CHECK(format_chord_symbol(diatonic_triad(1, "G# minor")) == "G#m");
}

TEST_CASE("a chromatic chord is numbered by one reading", "[functional]") {
  CHECK(chord_to_roman(make_chord(8, ChordQuality::kDim7), "C major") == "#vo7");
  CHECK(chord_to_roman(make_chord(1, ChordQuality::kDim7), "C major") == "#io7");
  CHECK(chord_to_roman(make_chord(3, ChordQuality::kDim7), "C major") == "#iio7");
  CHECK(chord_to_roman(make_chord(1, ChordQuality::kM7b5), "C major") ==
        "#i\xC3\xB8"
        "7");
  ChordToRomanOptions applied{true, std::nullopt};
  CHECK(chord_to_roman(make_chord(8, ChordQuality::kDim7), "C major", applied) == "viio7/vi");
  // The borrowed tonic and subdominant of a minor key sound their own degrees.
  CHECK(chord_to_roman(make_chord(0, ChordQuality::kMaj), "C minor", applied) == "I");
  CHECK(chord_to_roman(make_chord(5, ChordQuality::kMaj), "C minor", applied) == "IV");
  CHECK(chord_to_roman(make_chord(9, ChordQuality::kMaj), "A minor", applied) == "I");
  CHECK(chord_to_roman(make_chord(2, ChordQuality::kMaj), "A minor", applied) == "IV");
  CHECK(chord_to_roman(make_chord(4, ChordQuality::kMaj), "E phrygian", applied) == "I");
  CHECK(chord_to_roman(make_chord(2, ChordQuality::kDom7), "C major", applied) == "V7/V");
}

TEST_CASE("a diminished seventh is numbered by the letter it is written on", "[functional]") {
  ChordToRomanOptions applied{true, std::nullopt};
  struct Row {
    const char* symbol;
    const char* plain;
    const char* with_applied;
  };
  for (const Row& row : {Row{"Bbdim7", "bviio7", "bviio7"}, Row{"Abdim7", "bvio7", "bvio7"},
                         Row{"Ebdim7", "biiio7", "biiio7"}, Row{"A#dim7", "#vio7", "#vio7"},
                         Row{"G#dim7", "#vo7", "viio7/vi"}, Row{"D#dim7", "#iio7", "viio7/iii"}}) {
    Chord chord = parse_chord_symbol(row.symbol);
    CHECK(chord_to_roman(chord, "C major") == row.plain);
    CHECK(chord_to_roman(chord, "C major", applied) == row.with_applied);
  }
}

TEST_CASE("function, numbering and pivots read a respelled key as written", "[functional]") {
  Chord german = roman_to_chord("Ger6", "Ab minor");
  CHECK(function_of(german, "Ab minor") == HarmonicFunction::kSubdominant);
  ChordAnalysis analysis = analyze_chord(german, "Ab minor");
  CHECK(analysis.roman == "Ger6");
  CHECK(analysis.roman == chord_to_roman(german, "Ab minor"));
  bool found = false;
  for (const PivotChord& pivot : pivot_chords("Cb major", "Ab minor")) {
    CHECK(pivot.romanTo == chord_to_roman(pivot.chord, "Ab minor"));
    found = found || (pivot.romanFrom == "viio" && pivot.romanTo == "iio");
  }
  CHECK(found);
}

TEST_CASE("a diatonic root keeps its degree numeral however it is spelled", "[functional]") {
  CHECK(chord_to_roman("Abm", "E major") == "iii");
  CHECK(chord_to_roman("Ab7", "E major") == "III7");
  CHECK(chord_to_roman("F#", "Db major") == "IV");
  std::vector<std::string> pivots;
  for (const PivotChord& pivot : pivot_chords("F# major", "Db major")) {
    pivots.push_back(pivot.romanFrom + "=" + pivot.romanTo);
  }
  CHECK(pivots == std::vector<std::string>{"I=IV", "iii=vi", "V=I", "vi=ii"});
}
