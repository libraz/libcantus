#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cmath>

#include "cantus/core/errors.h"
#include "cantus/model/voicing.h"

using namespace cantus;

namespace {
const std::vector<double> kTonic = {48, 55, 64, 72};
const std::vector<double> kSupertonic = {50, 57, 65, 69};
}  // namespace

TEST_CASE("Voicing keeps the order it was given", "[model][voicing]") {
  Voicing crossed = Voicing::of({67, 60, 64});
  CHECK(crossed.pitches() == std::vector<double>{67, 60, 64});
  CHECK(crossed.range().min == 60);
  CHECK(crossed.range().max == 67);
  CHECK(crossed.invert(0).pitches() == crossed.pitches());
  CHECK(crossed.invert(1).pitches() == std::vector<double>{64, 67, 72});
  CHECK(Voicing::of({60, 64, 67}).to_string() == "60 64 67");
  CHECK_THROWS_WITH(Voicing::of({}), "a voicing must contain at least one pitch");
  CHECK_THROWS_AS(Voicing::of({128}), InvalidInputError);
  CHECK_THROWS_AS(Voicing::of({120}).invert(1), InvalidInputError);
}

TEST_CASE("Voicing realizes chords and follows them", "[model][voicing]") {
  Voicing tonic = Voicing::satb("C");
  CHECK(tonic.pitches().size() == 4);
  StyledVoicingOptions drop2;
  drop2.style = VoicingStyle::kDrop2;
  CHECK(Voicing::for_chord("Dm7", drop2).pitches().size() == 4);
  Voicing dominant = tonic.next("G7");
  CHECK(tonic.cost_to(dominant) < 24);
  CHECK(Voicing::of({48, 55}).cost_to(Voicing::of({48})) == INFINITY);
  CHECK(Voicing::satb_ranges().size() == 4);
  CHECK(Voicing::of(kTonic).equals(Voicing::from_data(kTonic)));
}

TEST_CASE("Voicing spells and checks against the part-writing rules", "[model][voicing]") {
  Voicing from = Voicing::of(kTonic);
  Voicing to = Voicing::of(kSupertonic);
  std::vector<PartWritingViolation> found =
      from.check_to(to, {ChordArg("C"), ChordArg("Dm")}, "C major");
  REQUIRE_FALSE(found.empty());
  CHECK(found[0].kind == PartWritingViolationKind::kParallelFifth);
  std::vector<Note> spelled = Voicing::of({50, 57, 66, 69}).spell("C major", ChordArg("D"));
  REQUIRE(spelled.size() == 4);
  CHECK(spelled[2].name() == "F#4");
  CHECK(Voicing::of({72, 69, 67, 71, 72})
            .species({NoteArg("C4"), NoteArg("D4"), NoteArg("E4"), NoteArg("D4"), NoteArg("C4")}, 1,
                     "C major")
            .empty());
}

TEST_CASE("Voicing judges candidates against its voices", "[model][voicing]") {
  Voicing sounding = Voicing::of({48, 55, 64});
  VoicingSafetyQuery query;
  query.profile = SafetyProfile::kPop;
  query.chord = Nullable<ChordArg>(ChordArg("C"));
  query.key = KeyArg("C major");
  query.strongBeat = true;
  SafetyResult verdict = sounding.safety_of(72, query);
  CHECK(verdict.safety == NoteSafety::kSafe);
  CHECK_FALSE(sounding.safe_pitches(query, 60, 72).empty());
  query.previous = Voicing::of({47, 55, 62});
  CHECK(sounding.safety_of(72, query).safety == NoteSafety::kSafe);
}

TEST_CASE("Voicing measures independence between two lines", "[model][voicing]") {
  Voicing lead = Voicing::of({72, 74, 76});
  Voicing counter = Voicing::of({65, 67, 69});
  VoiceIndependenceReport report = lead.independence(counter);
  CHECK(report.motion.parallel == 1);
  VoicingIndependenceOptions keyed;
  keyed.key = KeyArg("C major");
  CHECK(lead.independence(counter, keyed).sounding == 3);
  CHECK_THROWS_AS(lead.independence(Voicing::of({65, 67})), InvalidInputError);
}
