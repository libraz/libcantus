#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/spelling.h"
#include "cantus/theory/symbol.h"

using namespace cantus;

namespace {

NoteNameOptions german() {
  NoteNameOptions opts;
  opts.system = NoteNameSystem::kGerman;
  return opts;
}

ChordSymbolOptions german_symbol() {
  ChordSymbolOptions opts;
  opts.system = NoteNameSystem::kGerman;
  return opts;
}

}  // namespace

TEST_CASE("a flat spelling survives the round trip", "[symbol]") {
  Chord chord = parse_chord_symbol("Bbmaj7");
  CHECK(chord.rootPc == 10);
  CHECK(chord.quality == ChordQuality::kMaj7);
  CHECK(format_chord_symbol(chord) == "Bbmaj7");
}

TEST_CASE("the system is asked for, never inferred", "[symbol]") {
  CHECK(parse_chord_symbol("H7", german()).rootPc == 11);
  CHECK(parse_chord_symbol("B", german()).rootPc == 10);
  CHECK(format_chord_symbol(parse_chord_symbol("Bb7"), german_symbol()) == "B7");
  CHECK(format_chord_symbol(parse_chord_symbol("B7"), german_symbol()) == "H7");
  CHECK_FALSE(try_parse_chord_symbol("H7").ok());
}

TEST_CASE("a bracketed tension is read structurally", "[symbol]") {
  Chord chord = parse_chord_symbol("C7(b9,#11)");
  CHECK(chord.intervals == std::vector<double>{0, 4, 7, 10, 13, 18});
  CHECK(format_chord_symbol(chord) == "C7(b9,#11)");
}

TEST_CASE("a slash bass is read after the quality", "[symbol]") {
  Chord chord = parse_chord_symbol("C6/9/E");
  CHECK(chord.quality == ChordQuality::k6_9);
  CHECK(chord.bassPc == 4);
}

TEST_CASE("text that is no chord reports why", "[symbol]") {
  ParseResult<Chord> result = try_parse_chord_symbol("Cxyz");
  REQUIRE_FALSE(result.ok());
  CHECK(std::string(result.error().what()) == "Unrecognized chord quality: \"Cxyz\"");
  CHECK_THROWS_AS(parse_chord_symbol(""), InvalidInputError);
}

TEST_CASE("transposing a symbol respells what moving by letter would leave unwritable",
          "[symbol]") {
  CHECK(transpose_chord_symbol("C/G", 2) == "D/A");
  CHECK(transpose_chord_symbol("H7", 1, german_symbol()) == "C7");
  CHECK(transpose_chord_symbol("Bbmaj7", 1) == "Bmaj7");
  CHECK_THROWS_AS(transpose_chord_symbol("C", 1.0 / 0.0), InvalidInputError);
}

TEST_CASE("chord data is validated and reduced to pitch classes", "[symbol]") {
  Chord chord = make_chord(14, ChordQuality::kMin);
  chord.bassPc = 19;
  Chord data = to_chord_data(chord);
  CHECK(data.rootPc == 2);
  CHECK(data.bassPc == 7);
  chord.intervals.push_back(0.0 / 0.0);
  CHECK_THROWS_AS(to_chord_data(chord), InvalidInputError);
}

TEST_CASE("a parsed flat root keeps a bass spelled outside the chord's own tones", "[symbol]") {
  CHECK(format_chord_symbol(parse_chord_symbol("Gb7/Cb")) == "Gb7/Cb");
  CHECK(format_chord_symbol(parse_chord_symbol("Cbmaj7")) == "Cbmaj7");
}

TEST_CASE("a raised ninth over a chord with no third is a ninth", "[symbol]") {
  Chord chord = parse_chord_symbol("C7sus4(#9)");
  std::vector<std::string> names = note_names([&] {
    std::vector<NoteArg> notes;
    for (const NoteData& note : spell_chord_from_root(chord, "C")) {
      notes.emplace_back(note);
    }
    return notes;
  }());
  CHECK(names == std::vector<std::string>{"C", "F", "G", "Bb", "D#"});
}
