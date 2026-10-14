#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "cantus/core/errors.h"
#include "cantus/model/instrument.h"

using namespace cantus;

TEST_CASE("Instrument wraps built-in and custom profiles", "[model][instrument]") {
  Instrument guitar = Instrument::guitar();
  CHECK(guitar.name() == "guitar");
  CHECK(guitar.kind() == InstrumentKind::kStringed);
  CHECK(guitar.range().low == 40);
  CHECK(guitar.range().high == 88);
  CHECK(guitar.fingerings(64).size() == 6);
  CHECK(Instrument::bass4().fold_into_range(27) == 39);
  CHECK_FALSE(Instrument::bass4().can_sound(27));
  CHECK(Instrument::bass5().range().low == 23);
  CHECK(Instrument::guitar_drop_d().range().low == 38);
  CHECK(Instrument::of(GUITAR_STANDARD).equals(guitar));
  CHECK_FALSE(guitar.equals(Instrument::bass4()));
}

TEST_CASE("Instrument sounds notes at their own pitch", "[model][instrument]") {
  CHECK(Instrument::guitar().sounding_pitch(Note::parse("C4")).name() == "C3");
  CHECK(Instrument::bass4().sounding_pitch(Note::parse("C4"), IntervalArg("-P8")).name() == "C3");
}

TEST_CASE("Instrument refuses what it cannot hold", "[model][instrument]") {
  StringedProfile no_strings = GUITAR_STANDARD;
  no_strings.tuning.clear();
  CHECK_THROWS_AS(Instrument::of(no_strings), InvalidInputError);
  CHECK_THROWS_AS(Instrument::guitar().can_sound(128), InvalidInputError);
  PercussionProfile kit;
  kit.name = "kit";
  kit.limbs = {Limb::kRightHand};
  kit.reach = {{36, {Limb::kRightHand}}};
  kit.articulations = {Articulation::kAccent};
  kit.polyphony = 2;
  Instrument drums = Instrument::of(kit);
  CHECK(drums.kind() == InstrumentKind::kPercussion);
  CHECK_THROWS_WITH(drums.fingerings(36), "kit has no strings to finger");
  CHECK(drums.can_sound(36));
}

TEST_CASE("Instrument playability reports through the profile", "[model][instrument]") {
  std::vector<NoteEvent> notes(1);
  notes[0].pitch = 27;
  notes[0].durationBeat = 1;
  PlayabilityReport report = Instrument::bass4().playability(notes);
  REQUIRE_FALSE(report.issues.empty());
  CHECK(report.issues[0].type == PlayabilityIssueType::kNoteOutOfRange);
}
