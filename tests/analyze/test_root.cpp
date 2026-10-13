#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>

#include "analyze/adjacency.h"
#include "analyze/grid.h"
#include "analyze/histogram.h"
#include "analyze/sequence.h"
#include "cantus/core/errors.h"
#include "cantus/core/meter.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent event;
  event.pitch = pitch;
  event.startBeat = start;
  event.durationBeat = duration;
  return event;
}

}  // namespace

TEST_CASE(
    "two beats are one instant within float residue, a note follows within the humanize bound",
    "[analyze][adjacency]") {
  CHECK(same_instant(4, 4 + BEAT_EPS / 2));
  CHECK_FALSE(same_instant(4, 4.001));
  CHECK(adjacent(4, 4.05));
  CHECK(adjacent(4, 3.95));
  CHECK_FALSE(adjacent(4, 4.06));
  CHECK(has_ended(4.04, 4));
  CHECK_FALSE(has_ended(4.06, 4));
}

TEST_CASE("the grid starts where the music does, a whole number of slots from beat 0",
          "[analyze][grid]") {
  GridOrigin pickup = grid_origin_of(-1, 4);
  CHECK(pickup.origin == -4);
  CHECK(pickup.startBeat == -1);
  GridOrigin excerpt = grid_origin_of(36, 4);
  CHECK(excerpt.origin == 36);
  // A note a millibeat before the downbeat is playing it.
  GridOrigin early = grid_origin_of(-0.001, 4);
  CHECK(early.startBeat == 0);
  CHECK(early.origin == 0);
  CHECK(grid_for_notes({note(60, 9.5, 1), note(62, 11, 1)}, 4).origin == 8);
  CHECK(grid_for_notes({}, 4).startBeat == 0);
  CHECK(bar_grid_start(-0.0004, MeterArg("4/4")) == 0);
}

TEST_CASE("the first sounding beat is the earliest onset, or the fallback for an empty span",
          "[analyze][grid]") {
  CHECK(first_sounding_beat({note(60, 3, 1), note(62, 1.5, 1)}) == 1.5);
  CHECK(first_sounding_beat({}) == 0);
  CHECK(first_sounding_beat({}, 7) == 7);
}

TEST_CASE("a note counts for its beats scaled by velocity and the accent of its beat",
          "[analyze][histogram]") {
  NoteEvent quiet = note(60, 0, 2);
  quiet.velocity = 0;
  CHECK(note_weight(note(60, 0, 2), 2) == 2);
  CHECK(note_weight(quiet, 2) == 0);
  MeterArg meter("4/4");
  CHECK(note_weight(note(60, 0, 1), 1, &meter) > note_weight(note(60, 1, 1), 1, &meter));
}

TEST_CASE("notes are bucketed once into the slots they overlap", "[analyze][histogram]") {
  std::vector<NoteEvent> notes = {note(60, 0, 6), note(62, 5, 1)};
  auto buckets =
      bucket_notes_by_slot(notes, SlotGrid{0, 4}, 2, BucketOptions{"slots", std::nullopt});
  REQUIRE(buckets.size() == 2);
  CHECK(buckets[0] == std::vector<std::size_t>{0});
  CHECK(buckets[1] == std::vector<std::size_t>{0, 1});
  CHECK_THROWS_AS(bucket_notes_by_slot(notes, SlotGrid{0, 4}, 2, BucketOptions{"slots", 1.0}),
                  BudgetExceededError);
}

TEST_CASE("a window weighs the overlap of each note, and finds the lowest counted pitch",
          "[analyze][histogram]") {
  std::vector<NoteEvent> notes = {note(60, 0, 2), note(64, 1, 3), note(48, 5, 1)};
  MeterArg meter("4/4");
  WindowWeights weights = window_weights(notes, nullptr, 0, 4, meter);
  CHECK(weights.weights[0] > 0);
  CHECK(weights.weights[4] > 0);
  CHECK(weights.weights[11] == 0);
  CHECK(weights.lowestPitch == 60);
  CHECK(weights.totalWeight == weights.weights[0] + weights.weights[4]);
  WindowWeights empty = window_weights(notes, nullptr, 20, 24, meter);
  CHECK(empty.totalWeight == 0);
  CHECK(std::isinf(empty.lowestPitch));
}

TEST_CASE("the graded edit distance charges a substitution by its cost and a gap by its price",
          "[analyze][sequence]") {
  auto flat = [](double x, double y) { return x == y ? 0.0 : 1.0; };
  CHECK(graded_edit_distance<double>({1, 2, 3}, {1, 2, 3}, flat) == 0);
  CHECK(graded_edit_distance<double>({1, 2, 3}, {1, 3}, flat) == 1);
  CHECK(graded_edit_distance<double>({1, 2, 3}, {1, 3}, flat, 0.25) == 0.25);
  CHECK(graded_edit_distance<double>({}, {1, 2}, flat, 2) == 4);
  CHECK(distance_to_similarity(0, 0, 0) == 1);
  CHECK(distance_to_similarity(1, 2, 4) == 0.75);
  CHECK(distance_to_similarity(9, 2, 4) == 0);
}
