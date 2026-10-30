#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "analyze/keys/keys.h"
#include "cantus/analyze/keys.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent event;
  event.pitch = pitch;
  event.startBeat = start;
  event.durationBeat = duration;
  return event;
}

/** A bar of the tonic triad's notes, repeated. */
void bars(std::vector<NoteEvent>& notes, int root, double from, int count) {
  for (int bar = 0; bar < count; ++bar) {
    double start = from + 4.0 * bar;
    notes.push_back(note(48 + root, start, 4));
    notes.push_back(note(60 + root + 4, start, 2));
    notes.push_back(note(60 + root + 7, start + 2, 2));
  }
}

}  // namespace

TEST_CASE("a piece that stays in one key is one region", "[keys]") {
  std::vector<NoteEvent> notes;
  bars(notes, 0, 0, 8);
  std::vector<KeyRegion> regions = key_timeline_from_notes(notes);
  REQUIRE(regions.size() == 1);
  CHECK(regions[0].startBeat == 0);
  CHECK(regions[0].endBeat == 32);
  CHECK(regions[0].key.scale.rootPc == 0);
  CHECK_FALSE(regions[0].modulation);
  CHECK(regions[0].confidence > 0.5);
}

TEST_CASE("a modulation splits the regions and names the relation", "[keys]") {
  std::vector<NoteEvent> notes;
  bars(notes, 0, 0, 8);
  bars(notes, 7, 32, 8);
  std::vector<KeyRegion> regions = key_timeline_from_notes(notes);
  REQUIRE(regions.size() >= 2);
  CHECK(regions.front().key.scale.rootPc == 0);
  CHECK(regions.back().key.scale.rootPc == 7);
  CHECK(regions.back().modulation == KeyRelation::kDominant);
  Nullable<ResolvedKey> prevailing = prevailing_key_of(regions);
  REQUIRE(prevailing);
  CHECK(prevailing->scale.rootPc == regions.front().key.scale.rootPc);
}

TEST_CASE("nothing sounding gives no regions, and a bad option is refused", "[keys]") {
  CHECK(key_timeline_from_notes({}).empty());
  CHECK(key_timeline_from_notes({note(60, 0, 0)}).empty());
  KeyTimelineOptions bad;
  bad.expectedKeyBeats = 0;
  CHECK_THROWS_AS(key_timeline_from_notes({note(60, 0, 1)}, bad), InvalidInputError);
  KeyTimelineOptions both;
  both.ts = MeterArg("3/4");
  both.meters = MeterArg("4/4");
  CHECK_THROWS_AS(key_timeline_from_notes({note(60, 0, 1)}, both), InvalidInputError);
}

TEST_CASE("chords modulate through a pivot", "[keys]") {
  const char* symbols[] = {"C", "F", "G7", "C", "Am", "G", "C", "D7", "G", "Em", "Am", "D7", "G"};
  std::vector<ChordSegment> segments;
  double beat = 0;
  for (const char* symbol : symbols) {
    segments.push_back(ChordSegment{beat, beat + 4, to_chord_data(symbol)});
    beat += 4;
  }
  std::vector<KeyRegion> regions = detect_modulations(segments);
  REQUIRE(regions.size() >= 2);
  CHECK(regions.front().key.scale.rootPc == 0);
  CHECK(regions.back().key.scale.rootPc == 7);
  CHECK(regions.back().endBeat == beat);
  CHECK(detect_modulations({}).empty());
  // A segment with no length is dropped before its chord is read.
  CHECK(detect_modulations({ChordSegment{4, 2, to_chord_data("C")}}).empty());
}

TEST_CASE("the key at a beat is the covering region's, else the fallback", "[keys]") {
  std::vector<NoteEvent> notes;
  bars(notes, 0, 8, 4);
  std::vector<KeyRegion> regions = key_timeline_from_notes(notes);
  REQUIRE_FALSE(regions.empty());
  ResolvedKey fallback = resolve_key("F major");
  KeyLookup at(regions, fallback);
  CHECK(at(10).scale.rootPc == 0);
  CHECK(at(0).scale.rootPc == 5);
  CHECK(at(regions.back().endBeat).scale.rootPc == 5);
}

TEST_CASE("chords wholly before beat 0 end their region at the last chord", "[keys]") {
  std::vector<KeyRegion> regions = detect_modulations({ChordSegment{-2, -1, to_chord_data("C")}});
  REQUIRE(!regions.empty());
  CHECK(regions.back().endBeat == -1);
}
