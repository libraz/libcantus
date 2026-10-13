#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "analyze/form/internal.h"
#include "analyze/form/phrase.h"
#include "cantus/analyze/form.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent out;
  out.pitch = pitch;
  out.startBeat = start;
  out.durationBeat = duration;
  return out;
}

/** One triad per bar of 4/4, from the roots given. */
std::vector<NoteEvent> bars_of_triads(const std::vector<int>& roots) {
  std::vector<NoteEvent> out;
  for (std::size_t bar = 0; bar < roots.size(); ++bar) {
    for (int interval : {0, 4, 7}) {
      out.push_back(note(roots[bar] + interval, static_cast<double>(bar) * 4, 4));
    }
  }
  return out;
}

}  // namespace

TEST_CASE("a span too short to hold two groups reads as one", "[form]") {
  Hypermeter grouping = hypermeter(bars_of_triads({60, 65}));
  CHECK(grouping.groupBars == 2);
  CHECK(grouping.confidence == 0);
  REQUIRE(grouping.downbeats.size() == 1);
  CHECK(grouping.downbeats[0] == 0);
}

TEST_CASE("bars that change harmony every other bar group in twos", "[form]") {
  std::vector<NoteEvent> notes = bars_of_triads({60, 65, 67, 60, 62, 65, 67, 60});
  Hypermeter grouping = hypermeter(notes);
  CHECK(grouping.groupBars == 2);
  CHECK(grouping.downbeats == std::vector<double>{0, 8, 16, 24});
  CHECK(grouping.rationale ==
        "2-bar groups from bar 0: harmonic change 33% stronger on group heads, no cadences given");
}

TEST_CASE("neighbouring units that agree merge into one section", "[form]") {
  std::vector<NoteEvent> notes = bars_of_triads({60, 65, 60, 65, 62, 67});
  FormSectionOptions options;
  options.unitBars = 2;
  std::vector<FormSection> sections = sections_from_notes(notes, options);
  REQUIRE(sections.size() == 2);
  CHECK(sections[0].label == "A");
  CHECK(sections[0].endBeat == 16);
  CHECK(sections[1].label == "B");
  CHECK(sections[1].firstOccurrence == 1);
  CHECK(sections_from_notes({}).empty());
}

TEST_CASE("phrases cover the span and an empty one has none", "[form]") {
  std::vector<NoteEvent> notes = bars_of_triads({60, 65, 67, 60});
  ChordTimeline timeline = chord_timeline_from_notes(notes).timeline;
  std::vector<Phrase> phrases = phrases_from_timeline(timeline, notes);
  REQUIRE_FALSE(phrases.empty());
  CHECK(phrases.front().startBeat == 0);
  CHECK(phrases.back().endBeat == 16);
  CHECK(phrases_from_timeline(ChordTimeline{}, {}).empty());
  std::vector<StructuralCadence> ranked = structural_cadences(phrases);
  for (std::size_t i = 1; i < ranked.size(); ++i) {
    CHECK(ranked[i - 1].weight >= ranked[i].weight);
  }
}

TEST_CASE("the phrase path keeps the earlier predecessor on a tie", "[form]") {
  // Three stops one phrase apart: cutting in the middle only pays with evidence behind it.
  CHECK(choose_phrase_path({0, 4, 8}, {0, 0, 0.5}, 4, 8) == std::vector<std::size_t>{2});
  CHECK(choose_phrase_path({0, 4, 8}, {0, 2, 0.5}, 4, 4) == std::vector<std::size_t>{1, 2});
}

TEST_CASE("bar evidence helpers", "[form]") {
  CHECK(clamp01(-1) == 0);
  CHECK(clamp01(2) == 1);
  CHECK(floor_mod(-1, 4) == 3);
  CHECK(combine_evidence({0.5, 0.5}) == 0.75);
  CHECK(bar_span_of(0, 6, MeterArg("4/4")) == 1.5);
  CHECK(last_bar_of(MeterArg("4/4"), 0, 8) == 1);
}
