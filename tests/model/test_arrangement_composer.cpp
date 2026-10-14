#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/arrangement.h"
#include "cantus/model/composer.h"

using namespace cantus;

namespace {

NoteEvent note(int pitch, double start, double duration) {
  NoteEvent n;
  n.pitch = pitch;
  n.startBeat = start;
  n.durationBeat = duration;
  return n;
}

ArrangementTrack track(const char* name, TrackRole role, std::vector<NoteEvent> notes) {
  ArrangementTrack t;
  t.name = name;
  t.role = role;
  t.notes = std::move(notes);
  return t;
}

}  // namespace

TEST_CASE("Arrangement reads its tracks and takes edits", "[model][arrangement]") {
  Arrangement arrangement = Arrangement::of(
      {track("lead", TrackRole::kMelody, {note(72, 0, 2), note(76, 2, 2), note(79, 4, 4)}),
       track("bass", TrackRole::kBass, {note(36, 0, 4), note(43, 4, 4)})});
  Timeline timeline = arrangement.timeline();
  REQUIRE(timeline.length() == 2);
  CHECK(timeline.total_beats() == 8);
  CHECK(arrangement.track("lead")->notes().size() == 3);
  CHECK_FALSE(arrangement.track("nope"));
  Arrangement moved = arrangement.update({TrackEdit{0, {note(74, 0, 8)}}});
  CHECK(moved.tracks()[0].notes[0].pitch == 74);
  CHECK(arrangement.tracks()[0].notes[0].pitch == 72);
  CHECK(arrangement.equals(Arrangement::from_data(arrangement.data())));
  CHECK_FALSE(arrangement.equals(moved));
  CHECK_FALSE(arrangement.tension().empty());
}

TEST_CASE("Composer hands its settings to every part", "[model][composer]") {
  ComposerOptions options;
  options.key = KeyArg("C major");
  options.seed = 3;
  Composer composer(options);
  ComposerProgressionOptions progression;
  progression.style = ProgStyle::kDance;
  progression.bars = 2;
  Timeline chords = composer.progression(progression);
  REQUIRE(chords.length() == 2);
  CHECK(chords.total_beats() == 8);
  CHECK(chords.segments()[1].chord.rootPc == 5);
  CHECK(composer.with_seed(9).data().seed == 9);
  CHECK(composer.equals(Composer::from_data(composer.data())));
  CHECK_FALSE(composer.equals(composer.with_seed(9)));
  CHECK_THROWS_WITH(Composer(ComposerOptions{}).progression(progression),
                    Catch::Matchers::ContainsSubstring("needs a key"));
  ComposerOptions held = options;
  held.rng = [](const SeedPath&) { return 0.5; };
  Composer drawing(held);
  CHECK(drawing.equals(drawing.with_seed(3)));
  CHECK_THROWS_WITH(drawing.plan(ReferenceProfile{}),
                    Catch::Matchers::ContainsSubstring("caller-held rng"));
}
