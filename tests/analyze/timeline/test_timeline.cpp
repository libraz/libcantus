#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers.hpp>
#include <catch2/matchers/catch_matchers_exception.hpp>
#include <limits>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"

using namespace cantus;

namespace {

ChordSpan span(double root, ChordQuality quality, double start) {
  ChordSpan out;
  out.rootPc = root;
  out.quality = quality;
  out.startBeat = start;
  return out;
}

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent out;
  out.pitch = pitch;
  out.startBeat = start;
  out.durationBeat = duration;
  return out;
}

}  // namespace

TEST_CASE("a timeline from placed chords spans each chord to the next", "[timeline]") {
  ChordTimeline timeline = chord_timeline_from_chords(
      {span(7, ChordQuality::kDom7, 4), span(0, ChordQuality::kMaj, 0)}, 8);
  REQUIRE(timeline.segments.size() == 2);
  CHECK(timeline.segments[0].startBeat == 0);
  CHECK(timeline.segments[0].endBeat == 4);
  CHECK(timeline.segments[1].endBeat == 8);
  CHECK(timeline.at(3.9)->rootPc == 0);
  // The beat a chord gives way on answers with the chord arriving.
  CHECK(timeline.at(4)->rootPc == 7);
  CHECK_FALSE(timeline.at(8).has_value());
  CHECK_THROWS_AS(timeline.at(std::numeric_limits<double>::quiet_NaN()), InvalidInputError);
}

TEST_CASE("chords with no length are dropped", "[timeline]") {
  ChordTimeline timeline =
      chord_timeline_from_chords({span(0, ChordQuality::kMaj, 0), span(5, ChordQuality::kMaj, 0),
                                  span(7, ChordQuality::kMaj, 9)},
                                 8);
  REQUIRE(timeline.segments.size() == 1);
  CHECK(timeline.segments[0].chord.rootPc == 5);
  CHECK_THROWS_AS(chord_timeline_from_chords({}, -1), InvalidInputError);
}

TEST_CASE("a segment with a bound that is not finite is rejected", "[timeline]") {
  ChordTimeline timeline;
  ChordSegment segment;
  segment.startBeat = 0;
  segment.endBeat = std::numeric_limits<double>::infinity();
  timeline.segments.push_back(segment);
  CHECK_THROWS_WITH(assert_chord_timeline(timeline),
                    "timeline.segments[0].endBeat must be finite; received Infinity");
}

TEST_CASE("a bar holding two chords yields two segments", "[timeline]") {
  std::vector<NoteEvent> notes = {note(60, 0, 2), note(64, 0, 2), note(67, 0, 2), note(55, 2, 2),
                                  note(59, 2, 2), note(62, 2, 2), note(65, 2, 2)};
  ChordTimelineOptions options;
  options.key = KeyArg("C major");
  ChordTimelineResult result = chord_timeline_from_notes(notes, options);
  REQUIRE(result.timeline.segments.size() == 2);
  CHECK(result.timeline.segments[0].chord.quality == ChordQuality::kMaj);
  CHECK(result.timeline.segments[1].chord.quality == ChordQuality::kDom7);
  CHECK(result.segmentConfidence.size() == 2);
  REQUIRE(result.keys.size() == 1);
  CHECK(result.keys[0].confidence == 1);
}

TEST_CASE("grid segmentation cuts every harmonic rhythm", "[timeline]") {
  std::vector<NoteEvent> notes = {note(60, 0, 2), note(64, 0, 2), note(67, 0, 2),
                                  note(55, 2, 2), note(59, 2, 2), note(62, 2, 2)};
  ChordTimelineOptions options;
  options.key = KeyArg("C major");
  options.segmentation = ChordSegmentation::kGrid;
  options.harmonicRhythm = 2;
  ChordTimelineResult result = chord_timeline_from_notes(notes, options);
  REQUIRE(result.timeline.segments.size() == 2);
  CHECK(result.timeline.segments[1].startBeat == 2);
}

TEST_CASE("the evidence of one analysis serves the next", "[timeline]") {
  std::vector<NoteEvent> notes = {note(60, 0, 2), note(64, 0, 2), note(67, 0, 2),
                                  note(55, 2, 2), note(59, 2, 2), note(62, 2, 2)};
  ChordTimelineOptions options;
  options.key = KeyArg("C major");
  TimelineAnalysis first = analyze_timeline(notes, options);
  DirtySlots dirty = dirty_slots_for(first.evidence, 2, 4);
  TimelineAnalysis second = analyze_timeline(notes, options, &first.evidence, &dirty);
  CHECK(first.evidence.tables == nullptr);
  REQUIRE(second.result.timeline.segments.size() == first.result.timeline.segments.size());
  for (std::size_t i = 0; i < second.result.timeline.segments.size(); ++i) {
    CHECK(second.result.timeline.segments[i].chord.rootPc ==
          first.result.timeline.segments[i].chord.rootPc);
  }
}

TEST_CASE("cadences are found between touching segments only", "[timeline]") {
  ChordTimeline timeline =
      chord_timeline_from_chords({span(0, ChordQuality::kMaj, 0), span(7, ChordQuality::kDom7, 4),
                                  span(0, ChordQuality::kMaj, 8)},
                                 12);
  std::vector<CadenceHit> hits = detect_cadences(timeline, KeyContext(KeyArg("C major")));
  bool authentic = false;
  for (const CadenceHit& hit : hits) {
    authentic = authentic || (hit.cadence.type == CadenceType::kAuthentic && hit.atBeat == 8);
  }
  CHECK(authentic);
  // A rest between the chords leaves no cadential motion across it.
  timeline.segments[1].startBeat = 5;
  hits = detect_cadences(timeline, KeyContext(KeyArg("C major")));
  for (const CadenceHit& hit : hits) {
    CHECK(hit.atBeat != 4);
  }
}
