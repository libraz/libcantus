#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "cantus/analyze/melody.h"
#include "cantus/core/errors.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration = 1) {
  NoteEvent event;
  event.pitch = pitch;
  event.startBeat = start;
  event.durationBeat = duration;
  return event;
}

std::vector<NoteEvent> run(int from, double start, std::initializer_list<int> steps) {
  std::vector<NoteEvent> out = {note(from, start)};
  int pitch = from;
  double beat = start;
  for (int step : steps) {
    pitch += step;
    beat += 1;
    out.push_back(note(pitch, beat));
  }
  return out;
}

}  // namespace

TEST_CASE("a line's shape is what its steps add up to", "[melody]") {
  CHECK(melodic_contour(run(60, 0, {4, -4})).shape == MelodicContourShape::kArch);
  CHECK(melodic_contour(run(60, 0, {2, 2, 1})).shape == MelodicContourShape::kAscending);
  CHECK(melodic_contour(run(60, 0, {-2, -2})).shape == MelodicContourShape::kDescending);
  CHECK(melodic_contour(run(60, 0, {3, -3, 3, -3})).shape == MelodicContourShape::kWave);
  MelodicContour still = melodic_contour(run(60, 0, {0, 0}));
  CHECK(still.shape == MelodicContourShape::kStatic);
  CHECK(still.rationale == "Every note at the same pitch, so the line is static");
  MelodicContour none = melodic_contour(std::vector<NoteEvent>{});
  CHECK(none.peakIndex == -1);
  CHECK(none.troughIndex == -1);
  MelodicContour arch = melodic_contour(run(60, 0, {4, -4}));
  CHECK(arch.peakIndex == 1);
  CHECK(arch.range == 4);
  CHECK(arch.directions ==
        std::vector<ContourDirection>{ContourDirection::kUp, ContourDirection::kDown});
}

TEST_CASE("notes struck together are one event, the highest standing for it", "[melody]") {
  std::vector<NoteEvent> chord_then_note = {note(60, 0), note(64, 0), note(67, 0), note(72, 1)};
  MelodicContour contour = melodic_contour(chord_then_note);
  CHECK(contour.directions.size() == 1);
  CHECK(contour.range == 5);
  CHECK_THROWS_AS(melodic_contour(std::vector<NoteEvent>{note(200, 0)}), InvalidInputError);
}

TEST_CASE("a restated cell is found once, wherever it sits", "[melody]") {
  std::vector<NoteEvent> melody = run(60, 0, {2, 2});
  std::vector<NoteEvent> second = run(67, 4, {2, 2});
  melody.insert(melody.end(), second.begin(), second.end());
  std::vector<MotifData> motifs = extract_motifs(melody);
  REQUIRE(motifs.size() == 1);
  CHECK(motifs[0].notes.size() == 3);
  CHECK(motifs[0].intervals == std::vector<double>{2, 2});
  CHECK(motifs[0].rhythm == std::vector<double>{1, 1});
  REQUIRE(motifs[0].occurrences.size() == 2);
  CHECK(motifs[0].occurrences[1].transpose == 7);
  CHECK(motifs[0].occurrences[1].startBeat == 4);
  CHECK(motifs[0].rationale ==
        "3-note ascending cell stated 2 times (beats 0, 4), at more than one pitch level");
  ExtractMotifsOptions strict;
  strict.minOccurrences = 3;
  CHECK(extract_motifs(melody, strict).empty());
  ExtractMotifsOptions bad;
  bad.minNotes = 5;
  bad.maxNotes = 4;
  CHECK_THROWS_AS(extract_motifs(melody, bad), InvalidInputError);
}

TEST_CASE("two statements are related by the device that made one from the other", "[melody]") {
  MotifData subject = motif_from_notes(run(60, 0, {2, 2, 1}));
  Nullable<MotifRelation> transposed =
      relate_motifs(subject, motif_from_notes(run(67, 8, {2, 2, 1})));
  REQUIRE(transposed);
  CHECK(transposed->kind == MotifRelationKind::kTransposition);
  CHECK(transposed->semitones == 7);
  CHECK_FALSE(transposed->sequence);
  Nullable<MotifRelation> inverted =
      relate_motifs(subject, motif_from_notes(run(60, 8, {-2, -2, -1})));
  REQUIRE(inverted);
  CHECK(inverted->kind == MotifRelationKind::kInversion);
  Nullable<MotifRelation> same = relate_motifs(subject, subject);
  REQUIRE(same);
  CHECK(same->kind == MotifRelationKind::kRepetition);
  CHECK(same->sequence == false);
  std::vector<NoteEvent> slower;
  for (const NoteEvent& source : run(60, 8, {2, 2, 1})) {
    NoteEvent copy = source;
    copy.startBeat = 8 + (source.startBeat - 8) * 2;
    copy.durationBeat = 2;
    slower.push_back(copy);
  }
  Nullable<MotifRelation> augmented = relate_motifs(subject, motif_from_notes(slower));
  REQUIRE(augmented);
  CHECK(augmented->kind == MotifRelationKind::kAugmentation);
  CHECK(augmented->timeRatio == 2);
  CHECK_FALSE(relate_motifs(subject, motif_from_notes(run(60, 8, {5, -1, 3}))));
}

TEST_CASE("a key lets a degree-wise restatement read as tonal", "[melody]") {
  MotifData model = motif_from_notes(run(60, 0, {2, 2}));
  MotifData answer = motif_from_notes(run(62, 3, {2, 1}));
  Nullable<MotifRelation> tonal = relate_motifs(model, answer, KeyArg("C major"));
  REQUIRE(tonal);
  CHECK(tonal->kind == MotifRelationKind::kTonalTransposition);
  CHECK(tonal->degrees == 1);
  CHECK_THROWS_AS(relate_motifs(model, answer, KeyArg("nonsense")), InvalidInputError);
}

TEST_CASE("likeness is an edit distance over intervals and rhythm", "[melody]") {
  std::vector<NoteEvent> line = run(60, 0, {2, 2});
  CHECK(melodic_similarity(line, line) == 1);
  CHECK(melodic_similarity(line, run(65, 0, {2, 2})) == 1);
  MelodicComparison apart = compare_melodies(run(60, 0, {2, 2, 2}), run(60, 0, {-6, 7, -9}));
  CHECK(apart.similarity < 0.5);
  CHECK(apart.rationale.rfind("Interval shapes", 0) == 0);
}

TEST_CASE("the graph draws each statement from the best earlier one", "[melody]") {
  std::vector<NoteEvent> melody = run(60, 0, {2, 2});
  std::vector<NoteEvent> second = run(67, 4, {2, 2});
  melody.insert(melody.end(), second.begin(), second.end());
  MotifGraph graph = motif_graph(melody, extract_motifs(melody));
  REQUIRE(graph.nodes.size() == 2);
  REQUIRE(graph.edges.size() == 1);
  CHECK(graph.edges[0].from == 0);
  CHECK(graph.edges[0].to == 1);
  REQUIRE(graph.edges[0].relation);
  CHECK(graph.edges[0].relation->kind == MotifRelationKind::kTransposition);
  CHECK(graph.edges[0].similarity == 1);
  std::vector<MotifData> off_line = extract_motifs(melody);
  off_line[0].occurrences[0].startBeat = 99;
  CHECK_THROWS_AS(motif_graph(melody, off_line), InvalidInputError);
  MotifGraphOptions bad;
  bad.variationThreshold = 2;
  CHECK_THROWS_AS(motif_graph(melody, {}, bad), InvalidInputError);
}
