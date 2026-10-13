#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "analyze/arrange/internal.h"
#include "cantus/analyze/arrange.h"
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

std::vector<ArrangementTrack> piece() {
  ArrangementTrack melody;
  melody.name = "lead";
  melody.role = TrackRole::kMelody;
  melody.notes = {note(60, 0, 2), note(64, 2, 2), note(67, 4, 2), note(72, 6, 2)};
  ArrangementTrack harmony;
  harmony.role = TrackRole::kHarmony;
  harmony.notes = {note(48, 0, 4), note(55, 0, 4), note(52, 4, 4), note(59, 4, 4)};
  ArrangementTrack drums;
  drums.role = TrackRole::kDrums;
  drums.notes = {note(36, 0, 1)};
  return {melody, harmony, drums};
}

}  // namespace

TEST_CASE("an arrangement is analysed against the harmony inferred from its pitched tracks",
          "[arrange]") {
  ArrangementAnalysis analysis = analyze_arrangement(piece());
  REQUIRE(analysis.tracks.size() == 3);
  CHECK(analysis.tracks[0].name == "lead");
  CHECK(analysis.tracks[1].name == "track 2");
  CHECK(analysis.tracks[2].role == TrackRole::kDrums);
  // A drum hit has no harmonic reading.
  CHECK(analysis.tracks[2].notes.empty());
  CHECK(analysis.tracks[0].notes.size() == 4);
  CHECK(analysis.segmentConfidence.size() == analysis.timeline.segments.size());
  for (const Conflict& conflict : analysis.conflicts) {
    CHECK(conflict.trackIndex != 2);
  }
}

TEST_CASE("the tracks the harmony is inferred from are checked", "[arrange]") {
  ArrangementOptions options;
  options.harmonyTracks = std::vector<double>{5};
  CHECK_THROWS_AS(analyze_arrangement(piece(), options), InvalidInputError);
  options.harmonyTracks = std::vector<double>{2};
  CHECK_THROWS_AS(analyze_arrangement(piece(), options), InvalidInputError);
  options.harmonyTracks = std::vector<double>{1};
  CHECK_NOTHROW(analyze_arrangement(piece(), options));
  ArrangementOptions bad_severity;
  bad_severity.minSeverity = 3;
  CHECK_THROWS_AS(analyze_arrangement(piece(), bad_severity), InvalidInputError);
}

TEST_CASE("a polyphonic passage is read voice by voice and reported in its own order",
          "[arrange]") {
  std::vector<NoteEvent> passage = {note(60, 0, 1), note(64, 0, 1), note(62, 1, 1), note(0, 5, 0)};
  std::vector<AnalyzedNote> read = analyze_polyphony(
      passage, [](double) -> Nullable<Chord> { return make_chord(0, ChordQuality::kMaj); },
      KeyContext(KeyArg("C major")));
  REQUIRE(read.size() == 4);
  for (std::size_t i = 0; i < read.size(); ++i) {
    CHECK(read[i].noteId == static_cast<double>(i));
    CHECK_FALSE(read[i].originalIndex.has_value());
  }
}

TEST_CASE("tension is sampled once per step and stays in range", "[arrange]") {
  TensionOptions options;
  options.step = 2;
  std::vector<TensionPoint> curve = tension_curve(piece(), options);
  REQUIRE_FALSE(curve.empty());
  CHECK(curve.front().beat == 0);
  for (std::size_t i = 1; i < curve.size(); ++i) {
    CHECK(curve[i].beat - curve[i - 1].beat == 2);
  }
  for (const TensionPoint& point : curve) {
    CHECK(point.tension >= 0);
    CHECK(point.tension <= 1);
  }
  options.step = 0;
  CHECK_THROWS_AS(tension_curve(piece(), options), InvalidInputError);
  ArrangementAnalysis analysis = analyze_arrangement(piece());
  TensionOptions from_options;
  from_options.step = 2;
  std::vector<TensionPoint> reused = tension_curve_from(piece(), analysis, from_options);
  REQUIRE(reused.size() == curve.size());
  for (std::size_t i = 0; i < curve.size(); ++i) {
    CHECK(reused[i].tension == curve[i].tension);
  }
}

TEST_CASE("a session update equals a fresh analysis of the edited tracks", "[arrange]") {
  std::vector<ArrangementTrack> tracks = piece();
  ArrangementSession session = create_arrangement_session(tracks);
  CHECK(session.tracks().size() == 3);
  std::vector<NoteEvent> edited = tracks[0].notes;
  edited[1].pitch = 65;
  TrackEdit edit;
  edit.trackIndex = 0;
  edit.notes = edited;
  ArrangementSession next = session.update({edit});
  tracks[0].notes = edited;
  ArrangementAnalysis fresh = analyze_arrangement(tracks);
  REQUIRE(next.analysis().tracks[0].notes.size() == fresh.tracks[0].notes.size());
  for (std::size_t i = 0; i < fresh.tracks[0].notes.size(); ++i) {
    CHECK(next.analysis().tracks[0].notes[i].rationale == fresh.tracks[0].notes[i].rationale);
  }
  CHECK(next.analysis().conflicts.size() == fresh.conflicts.size());
  // The session before the edit still holds the analysis before it.
  CHECK(session.tracks()[0].notes[1].pitch == 64);
  TrackEdit missing;
  missing.trackIndex = 7;
  CHECK_THROWS_AS(session.update({missing}), InvalidInputError);
}

TEST_CASE("a track is split into the fewest monophonic sub-voices its notes allow", "[arrange]") {
  ArrangementTrack chords;
  chords.notes = {note(60, 0, 4), note(64, 0, 4), note(67, 0, 4), note(62, 4, 4), note(65, 4, 4)};
  std::vector<PreparedTrack> prepared = prepare_tracks({chords});
  REQUIRE(prepared.size() == 1);
  CHECK(prepared[0].voices.size() == 3);
  CHECK(prepared[0].role == TrackRole::kOther);
  CHECK(prepared[0].voices[0].at(1) != nullptr);
  CHECK(prepared[0].voices[0].at(9) == nullptr);
}
