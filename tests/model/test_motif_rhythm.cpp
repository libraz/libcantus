#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/motif.h"
#include "cantus/model/rhythm.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent n;
  n.pitch = pitch;
  n.startBeat = start;
  n.durationBeat = duration;
  return n;
}

std::vector<RhythmEvent> onsets(const std::vector<std::pair<double, double>>& pairs) {
  std::vector<RhythmEvent> out;
  for (const auto& [position, duration] : pairs) {
    out.push_back(RhythmEvent{position, duration});
  }
  return out;
}

std::vector<std::pair<double, double>> pairs_of(const Rhythm& rhythm) {
  std::vector<std::pair<double, double>> out;
  for (const RhythmEvent& event : rhythm.events()) {
    out.emplace_back(event.position, event.duration);
  }
  return out;
}

}  // namespace

TEST_CASE("Motif transforms its cell and names the relation", "[model][motif]") {
  Motif subject = Motif::from_notes({note(60, 0, 1), note(62, 1, 1), note(64, 2, 1)});
  CHECK(subject.total_beats() == 3);
  Motif answer = subject.transform(MotifTransform::kInvert);
  std::vector<int> pitches;
  for (const NoteEvent& n : answer.notes()) {
    pitches.push_back(n.pitch);
  }
  CHECK(pitches == std::vector<int>{60, 58, 56});
  Nullable<MotifRelation> relation = answer.relate_to(subject);
  REQUIRE(relation);
  CHECK(relation->kind == MotifRelationKind::kInversion);
  CHECK(subject.equals(Motif::from_data(subject.data())));
  CHECK_FALSE(subject.equals(answer));
  CHECK(subject.to_score().notes().size() == 3);
  CHECK_THROWS_WITH(Motif::from_notes({note(60, 0, 0)}),
                    Catch::Matchers::ContainsSubstring("motif notes[0]"));
}

TEST_CASE("Rhythm reshapes its onsets on the sixteenth grid", "[model][rhythm]") {
  Rhythm rhythm =
      Rhythm::of(onsets({{0, 1}, {1, 1}, {2, 1}, {3, 1}, {4, 0.5}, {4.5, 1.5}, {6, 1}, {7, 1}}),
                 MeterArg("4/4"));
  CHECK(rhythm.total_beats() == 8);
  CHECK(rhythm.density() == 4);
  CHECK(pairs_of(rhythm.half_time()) ==
        std::vector<std::pair<double, double>>{{0, 2}, {2, 2}, {4, 2}, {6, 2}});
  CHECK(rhythm.double_time().events().size() == 16);
  CHECK(rhythm.thin(0).equals(rhythm));
  Rhythm kept = rhythm.ornament_by([](const RhythmEvent& e) { return e.duration < 1; }, 1);
  CHECK(kept.equals(rhythm));
  CHECK(rhythm.within_ceiling());
  CHECK(rhythm.to_score(38).notes().size() == 8);
  Rhythm sorted = Rhythm::of(onsets({{1, 1}, {0, 1}}), MeterArg("4/4"));
  CHECK(pairs_of(sorted) == std::vector<std::pair<double, double>>{{0, 1}, {1, 1}});
  CHECK_THROWS_WITH(rhythm.thin(2), Catch::Matchers::ContainsSubstring("thin amount"));
}
