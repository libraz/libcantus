#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers.hpp>
#include <catch2/matchers/catch_matchers_exception.hpp>
#include <limits>
#include <utility>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/analyze/timeline.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

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

TEST_CASE("segments out of beat order are refused with the TS message", "[timeline]") {
  ChordTimeline timeline = chord_timeline_from_chords(
      {span(0, ChordQuality::kMaj, 0), span(7, ChordQuality::kMaj, 4)}, 8);
  std::swap(timeline.segments[0], timeline.segments[1]);
  CHECK_THROWS_WITH(
      assert_chord_timeline(timeline),
      "timeline.segments[1] must not start before timeline.segments[0] ends; received 0 before 8");
  timeline.segments = {timeline.segments[1]};
  timeline.segments[0].endBeat = -1;
  CHECK_THROWS_WITH(assert_chord_timeline(timeline),
                    "timeline.segments[0] must end after it starts; received [0, -1)");
}

TEST_CASE("a stated key over an empty span yields no region", "[timeline]") {
  ResolvedKey c_major = resolve_key(KeyArg("C major"));
  CHECK(stated_key_regions(c_major, 4, 2).empty());
  CHECK(stated_key_regions(c_major, 0, 0).empty());
  REQUIRE(stated_key_regions(c_major, 0, 4).size() == 1);
  ChordTimelineOptions options;
  options.key = KeyArg("C major");
  options.totalBeats = 2;
  std::vector<NoteEvent> late = {note(60, 4, 4), note(64, 4, 4), note(67, 4, 4)};
  CHECK(chord_timeline_from_notes(late, options).keys.empty());
}

TEST_CASE("a lone pitch class reads as no chord", "[timeline]") {
  CHECK(chord_timeline_from_notes({note(60, 0, 4)}).timeline.segments.empty());
}

TEST_CASE("a diminished seventh is rooted by its resolution, not its bass", "[timeline]") {
  for (int bass : {47, 50, 53, 56}) {
    std::vector<NoteEvent> notes = {note(bass, 0, 4), note(62, 0, 4), note(65, 0, 4),
                                    note(68, 0, 4),   note(71, 0, 4), note(43, 4, 4),
                                    note(59, 4, 4),   note(62, 4, 4), note(67, 4, 4)};
    ChordTimelineOptions options;
    options.key = KeyArg("C minor");
    ChordTimelineResult result = chord_timeline_from_notes(notes, options);
    REQUIRE_FALSE(result.timeline.segments.empty());
    CHECK(result.timeline.segments[0].chord.rootPc == 11);
    CHECK(result.timeline.segments[0].chord.quality == ChordQuality::kDim7);
  }
}

TEST_CASE("an anticipated bass does not invert the chord before it", "[timeline]") {
  std::vector<NoteEvent> notes = {note(48, 0, 3.5),   note(64, 0, 3.5),   note(67, 0, 3.5),
                                  note(72, 0, 3.5),   note(43, 3.5, 4.5), note(59, 3.5, 4.5),
                                  note(62, 3.5, 4.5), note(67, 3.5, 4.5)};
  ChordTimelineOptions options;
  options.key = KeyArg("C major");
  ChordTimelineResult result = chord_timeline_from_notes(notes, options);
  REQUIRE(result.timeline.segments.size() == 2);
  CHECK(result.timeline.segments[0].chord.rootPc == 0);
  CHECK_FALSE(result.timeline.segments[0].chord.bassPc);
}

TEST_CASE("a slash chord its notes spell exactly reads at full confidence", "[timeline]") {
  ChordTimelineResult result =
      chord_timeline_from_notes({note(43, 0, 4), note(65, 0, 4), note(69, 0, 4), note(72, 0, 4)});
  REQUIRE(result.segmentConfidence.size() == 1);
  CHECK(result.segmentConfidence[0] == 1);
  CHECK(result.timeline.segments[0].chord.bassPc == 7);
}
