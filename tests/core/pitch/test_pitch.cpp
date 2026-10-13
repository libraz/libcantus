#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cmath>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "core/pitch/naming.h"

using namespace cantus;

namespace {

NoteNameOptions in(NoteNameSystem system) {
  NoteNameOptions options;
  options.system = system;
  return options;
}

}  // namespace

TEST_CASE("note names parse and format in every system", "[pitch]") {
  NoteData gis = parse_note("gis4", in(NoteNameSystem::kGerman));
  CHECK(gis.letter == 4);
  CHECK(gis.alter == 1);
  CHECK(gis.octave == 4);
  CHECK(format_note({1, -1, 3.0}, in(NoteNameSystem::kJapanese)) ==
        "\xE5\xA4\x89\xE3\x83\x8B"
        "3");
  CHECK(format_note(parse_note("C#4")) == "C#4");
  CHECK(format_note(parse_note("G#"), in(NoteNameSystem::kGerman)) == "gis");
  CHECK(format_note(parse_note("G#"), in(NoteNameSystem::kItalian)) == "sol diesis");
  CHECK(parse_note("B").letter == 6);
  CHECK(parse_note("B").alter == 0);
  CHECK(parse_note("B", in(NoteNameSystem::kGerman)).alter == -1);
  CHECK(std::signbit(*parse_note("C-0").octave));
}

TEST_CASE("a failed parse is a value", "[pitch]") {
  ParseResult<NoteData> result = try_parse_note("H#b");
  REQUIRE_FALSE(result.ok());
  CHECK(std::string(result.error().what()) == "Invalid note: \"H#b\"");
  CHECK_THROWS_WITH(parse_note("C#######"),
                    "note C#######.alter must be an integer in [-6, 6]; received 7");
}

TEST_CASE("key names read the mode word and the system", "[pitch]") {
  KeyName b_flat = parse_key_name("B dur");
  CHECK(b_flat.tonic.letter == 6);
  CHECK(b_flat.tonic.alter == -1);
  CHECK(b_flat.mode == KeyNameMode::kMajor);
  CHECK(parse_key_name("gis").mode == KeyNameMode::kMinor);
  CHECK(parse_key_name("C moll").mode == KeyNameMode::kMinor);
  CHECK(format_key_name({{3, 1, std::nullopt}, KeyNameMode::kMinor}, in(NoteNameSystem::kGerman)) ==
        "fis moll");
  CHECK(detect_note_name_system("sol diesis") == NoteNameSystem::kItalian);
  CHECK_THROWS_AS(detect_note_name_system("???"), InvalidInputError);
  CHECK(max_note_name_length(NoteNameSystem::kItalian) == 3 + 2 * 8);
}

TEST_CASE("notes transpose keeping their spelling", "[pitch]") {
  NoteData fifth = transpose_note({0, 0, 4.0}, 7);
  CHECK(fifth.letter == 4);
  CHECK(fifth.alter == 0);
  CHECK(fifth.octave == 4);
  NoteData flat = midi_to_note(61, MidiSpelling::kFlat);
  CHECK(flat.letter == 1);
  CHECK(flat.alter == -1);
  CHECK(flat.octave == 4);
  CHECK(note_to_midi({0, 0, 4.0}) == 60);
  CHECK(note_to_pitch_class({1, -1, std::nullopt}) == 1);
  CHECK_THROWS_WITH(note_to_midi({0, 0, std::nullopt}), "noteToMidi requires an octave");
}

TEST_CASE("intervals are spelled from their notes and names", "[pitch]") {
  SpelledInterval doubly_diminished = spelled_interval({0, 1, 4.0}, {1, -2, 4.0});
  CHECK(doubly_diminished.number == 2);
  CHECK(doubly_diminished.quality == "dd");
  CHECK(doubly_diminished.semitones == -1);
  CHECK_FALSE(doubly_diminished.descending);
  SpelledInterval descending = parse_interval("-m3");
  CHECK(descending.semitones == -3);
  CHECK(descending.descending);
  CHECK(interval_semitones(8, "d") == 11);
  CHECK_THROWS_WITH(interval_semitones(5, "M"), "an interval of 5 cannot be major");
  CHECK(std::string(try_parse_interval("x").error().what()) ==
        "interval must be a quality followed by a number, such as 'P5'; received \"x\"");
}

TEST_CASE("pitch classes round half-way cases as JavaScript does", "[pitch]") {
  CHECK(pitch_class_of(-1.5) == 11);
  CHECK(pitch_class_of(60.6) == 1);
  CHECK(diatonic_letter_of(-1) == 6);
  CHECK(natural_pitch_class_of(8) == 2);
  CHECK_THROWS_AS(pitch_class_of(std::nan("")), InvalidInputError);
}
