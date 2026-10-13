#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/partwriting.h"
#include "cantus/theory/scale.h"

using namespace cantus;

TEST_CASE("pitches are spelled against the chord under them", "[partwriting]") {
  SpelledVoicing spelled =
      spell_voicing({50, 57, 66, 69}, make_chord(2, ChordQuality::kMaj), major_key(0));
  std::vector<std::string> names;
  for (const NoteData& note : spelled) {
    names.push_back(format_note(note));
  }
  CHECK(names == std::vector<std::string>{"D3", "A3", "F#4", "A4"});
  CHECK(spell_voicing({}, make_chord(2, ChordQuality::kMaj), major_key(0)).empty());
  CHECK_THROWS_AS(spell_voicing({60}, make_chord(2, ChordQuality::kMaj), "not a key"),
                  InvalidInputError);
}

TEST_CASE("a four-part exercise is marked rule by rule", "[partwriting]") {
  KeyArg key = major_key(0);
  std::vector<Chord> chords = {make_chord(0, ChordQuality::kMaj),
                               make_chord(2, ChordQuality::kMin)};
  std::vector<SpelledVoicing> voicings;
  for (const std::vector<double>& pitches :
       std::vector<std::vector<double>>{{48, 55, 64, 72}, {50, 57, 65, 69}}) {
    voicings.push_back(spell_voicing(pitches, chords[voicings.size()], key));
  }
  std::vector<PartWritingViolation> found = check_part_writing(voicings, chords, key);
  REQUIRE(found.size() == 1);
  CHECK(found[0].kind == PartWritingViolationKind::kParallelFifth);
  CHECK(found[0].voices == std::vector<int>{0, 1});
  CHECK(found[0].fromIndex == 0);
  CHECK(found[0].toIndex == 1);
}

TEST_CASE("the exercise is refused before any rule runs when it cannot be read", "[partwriting]") {
  KeyArg key = major_key(0);
  std::vector<Chord> chords = {make_chord(0, ChordQuality::kMaj)};
  CHECK_THROWS_AS(check_part_writing({}, chords, key), InvalidInputError);
  CHECK_THROWS_AS(check_part_writing({{NoteData{0, 0, std::nullopt}}}, chords, key),
                  InvalidInputError);
  PartWritingOptions options;
  options.maxSpacing = -1;
  CHECK_THROWS_AS(check_part_writing({{NoteData{0, 0, 4.0}}}, chords, key, options),
                  InvalidInputError);
}

TEST_CASE("a clean first-species exercise has no violation", "[partwriting]") {
  std::vector<NoteData> cantus_firmus;
  std::vector<NoteData> counterpoint;
  for (const char* name : {"C4", "D4", "E4", "D4", "C4"}) {
    cantus_firmus.push_back(parse_note(name));
  }
  for (const char* name : {"C5", "A4", "G4", "B4", "C5"}) {
    counterpoint.push_back(parse_note(name));
  }
  CHECK(check_species(cantus_firmus, counterpoint, 1, major_key(0)).empty());
}

TEST_CASE("species are refused when they are not one of the five", "[partwriting]") {
  std::vector<NoteData> line = {parse_note("C4")};
  CHECK_THROWS_AS(check_species(line, line, 6, major_key(0)), InvalidInputError);
  CHECK_THROWS_AS(check_species(line, line, 5, major_key(0)), InvalidInputError);
  CHECK_THROWS_AS(check_species({}, line, 1, major_key(0)), InvalidInputError);
}

TEST_CASE("a rhythm the species cannot read is reported as a violation", "[partwriting]") {
  std::vector<NoteData> cantus_firmus = {parse_note("C4"), parse_note("D4")};
  std::vector<NoteData> counterpoint = {parse_note("C5")};
  std::vector<PartWritingViolation> found =
      check_species(cantus_firmus, counterpoint, 2, major_key(0));
  REQUIRE(found.size() == 1);
  CHECK(found[0].kind == PartWritingViolationKind::kWrongRhythmicRatio);
  CHECK(parse_part_writing_violation_kind("battuta") == PartWritingViolationKind::kBattuta);
  CHECK_FALSE(parse_part_writing_violation_kind("parallelThird"));
}
