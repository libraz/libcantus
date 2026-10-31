#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "cantus/analyze/spelling.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/theory/spelling.h"

using namespace cantus;

namespace {

std::vector<NoteEvent> line(const std::vector<int>& pitches) {
  std::vector<NoteEvent> out;
  for (std::size_t i = 0; i < pitches.size(); ++i) {
    NoteEvent note;
    note.pitch = pitches[i];
    note.startBeat = static_cast<double>(i);
    note.durationBeat = 1;
    out.push_back(note);
  }
  return out;
}

std::vector<std::string> names(const std::vector<NoteData>& notes) {
  std::vector<NoteArg> args(notes.begin(), notes.end());
  return note_names(args);
}

}  // namespace

TEST_CASE("a chromatic ascent is spelled with sharps", "[spelling]") {
  std::vector<std::string> spelled =
      names(spell_line(line({60, 61, 62, 63, 64}), std::nullopt, KeyArg("C major")));
  CHECK(spelled == std::vector<std::string>{"C4", "C#4", "D4", "D#4", "E4"});
}

TEST_CASE("the chord under a note names its spelling", "[spelling]") {
  ChordSpan span;
  span.rootPc = 1;
  span.quality = ChordQuality::kDom7;
  span.startBeat = 0;
  ChordTimeline timeline = chord_timeline_from_chords({span}, 4);
  std::vector<std::string> spelled =
      names(spell_line(line({61, 65, 68, 71}), timeline, KeyArg("C major")));
  CHECK(spelled == std::vector<std::string>{"Db4", "F4", "Ab4", "Cb5"});
}

TEST_CASE("a tonic that does not sound the key is rejected", "[spelling]") {
  SpellLineOptions options;
  options.tonic = NoteArg("D4");
  CHECK_THROWS_AS(spell_line(line({60}), std::nullopt, KeyArg("C major"), options),
                  InvalidInputError);
  CHECK(spell_line({}, std::nullopt, KeyArg("C major")).empty());
}

TEST_CASE("a minor key spells its raised degrees on their own letters", "[spelling]") {
  CHECK(names(spell_line(line({69, 68, 65, 64}), std::nullopt, KeyArg("A minor"))) ==
        std::vector<std::string>{"A4", "G#4", "F4", "E4"});
  CHECK(names(spell_line(line({75, 74, 71, 70}), std::nullopt, KeyArg("Eb minor"))) ==
        std::vector<std::string>{"Eb5", "D5", "Cb5", "Bb4"});
  CHECK(names(spell_line(line({68, 67, 68}), std::nullopt, KeyArg("G# minor"))) ==
        std::vector<std::string>{"G#4", "F##4", "G#4"});
}
