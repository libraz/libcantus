#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "cantus/core/errors.h"
#include "cantus/core/event_index.h"
#include "core/event_index/event_index.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent event;
  event.pitch = pitch;
  event.startBeat = start;
  event.durationBeat = duration;
  return event;
}

NoteEventIndex make_index(OnsetTieBreak tie_break = OnsetTieBreak::kHighest) {
  NoteEventIndexOptions options;
  options.allowNonPositiveDuration = true;
  options.tieBreak = tie_break;
  return NoteEventIndex({note(60, 0, 2), note(64, 0, 1), note(67, 1, 1), note(50, 1, 0)}, options);
}

}  // namespace

TEST_CASE("the index answers which note sounds at a beat", "[event_index]") {
  NoteEventIndex index = make_index();
  CHECK(index.at(0.5)->note.pitch == 64);
  CHECK(index.at(1.5)->note.pitch == 67);
  CHECK_FALSE(index.at(2.5).has_value());
  CHECK(index.at(0.5)->originalIndex == 1);
  CHECK(index.at(0.5)->endBeat == 1);
}

TEST_CASE("simultaneous onsets resolve by the tie-break", "[event_index]") {
  CHECK(make_index(OnsetTieBreak::kLowest).at(0.5)->note.pitch == 60);
  CHECK(make_index(OnsetTieBreak::kLast).at(0.5)->note.pitch == 64);
}

TEST_CASE("attacks and onsets ignore notes that never sound", "[event_index]") {
  NoteEventIndex index = make_index();
  CHECK(index.attacks_at(1));
  CHECK_FALSE(index.attacks_at(1.5));
  CHECK(index.onsets_between(-1, 5) == std::vector<double>{0, 1});
  CHECK(index.onsets_between(0, 5) == std::vector<double>{1});
}

TEST_CASE("the index validates its events and queries", "[event_index]") {
  CHECK_THROWS_WITH(NoteEventIndex({note(60, 0, 0)}),
                    "note events[0].durationBeat must be positive; received 0");
  CHECK_THROWS_WITH(make_index().at(0.0 / 0.0 + 1.0 / 0.0 - 1.0 / 0.0),
                    "beat must be finite; received NaN");
}

TEST_CASE("sorted_note_events keeps the input order of equal onsets", "[event_index]") {
  std::vector<NoteEvent> sorted =
      sorted_note_events({note(1, 2, 1), note(2, 0, 1), note(3, 2, 1), note(4, 0, 1)});
  REQUIRE(sorted.size() == 4);
  CHECK(sorted[0].pitch == 2);
  CHECK(sorted[1].pitch == 4);
  CHECK(sorted[2].pitch == 1);
  CHECK(sorted[3].pitch == 3);
}
