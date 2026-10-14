#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <cmath>

#include "cantus/core/errors.h"
#include "cantus/model/duration.h"
#include "cantus/model/interval.h"
#include "cantus/model/meter.h"
#include "cantus/model/note.h"
#include "cantus/model/tempo.h"
#include "cantus/model/tuning.h"

using namespace cantus;

TEST_CASE("Note builds from parts, text and MIDI numbers", "[model][note]") {
  CHECK(Note::of(1, -1, 4).name() == "Db4");
  CHECK(Note::of("G").name() == "G");
  CHECK(Note::parse("C#4").midi() == 61);
  CHECK(Note::parse("gis").name() == "G#");
  CHECK(Note::from_midi(61, MidiSpelling::kFlat).name() == "Db4");
  CHECK_FALSE(Note::try_parse("zz").ok());
  CHECK_THROWS_WITH(Note::of(7), "note letter must be an integer in [0, 6]; received 7");
  CHECK_THROWS_AS(Note::of("Bb"), InvalidInputError);
  CHECK_THROWS_WITH(Note::parse("C").midi(), "note C has no octave, so it has no MIDI number");
}

TEST_CASE("Note transforms return new notes", "[model][note]") {
  Note ab4 = Note::parse("Ab4");
  CHECK(ab4.transpose(2).name() == "Bb4");
  CHECK(ab4.transpose(2, TransposeNoteOptions{MidiSpelling::kSharp}).name() == "A#4");
  CHECK(ab4.transpose(0).equals(ab4));
  CHECK(Note::parse("C4").transpose_by("A2").name() == "D#4");
  CHECK(Note::parse("C#").with_octave(4).name() == "C#4");
  CHECK(Note::parse("C4").for_instrument("clarinetBb").name() == "D4");
  CHECK(Note::parse("C#4").enharmonic().size() == 2);
  CHECK(Note::parse("Cb4").enharmonic().size() == 1);
  CHECK(ab4.name() == "Ab4");
}

TEST_CASE("Note reads keys, tunings and order", "[model][note]") {
  CHECK(Note::parse("E4").degree_in("C major").value() == 3);
  CHECK_FALSE(Note::parse("F#4").degree_in("C major").has_value());
  CHECK(Note::parse("A4").frequency() == 440);
  CHECK(Note::parse("A4").frequency(Tuning::edo(19)) == 440);
  CHECK(Note::parse("C#4").compare_to(Note::parse("Db4")) == 0);
  CHECK(Note::parse("C#4").compare_to(Note::parse("G4")) < 0);
  CHECK_FALSE(Note::parse("C#4").equals(Note::parse("Db4")));
}

TEST_CASE("Interval keeps its direction and inverts", "[model][interval]") {
  Interval fifth = Interval::parse("P5");
  CHECK(fifth.name() == "P5");
  CHECK(fifth.negate().name() == "-P5");
  CHECK(Interval::parse("M3").invert().name() == "m6");
  CHECK(Interval::parse("P15").invert().name() == "P1");
  CHECK(Interval::between(Note::parse("C4"), Note::parse("G4")).name() == "P5");
  CHECK_THROWS_AS(Interval::parse("A8").invert(), InvalidInputError);
  CHECK_THROWS_AS(Interval::of(5, "P", 8), InvalidInputError);
  CHECK(Interval::parse("P4").is_consonant(false));
  CHECK_FALSE(Interval::parse("P4").is_consonant());
  CHECK(Interval::parse("-M3").is_descending());
  CHECK_FALSE(Interval::try_parse("M5").ok());
}

TEST_CASE("Duration spells beats", "[model][duration]") {
  CHECK(Duration::of_beats(1.5).to_string() == "quarter.");
  CHECK(Duration::of(NoteValue::kEighth, 0, Tuplet{3, 2}).to_string() == "eighth 3:2");
  CHECK(Duration::of(NoteValue::kQuarter, 1).beats() == 1.5);
  CHECK(Duration::tie_chain(5).size() == 2);
  CHECK_THROWS_AS(Duration::of_beats(5), NoSolutionError);
  CHECK_THROWS_AS(Duration::of(NoteValue::kQuarter, 5), InvalidInputError);
  CHECK_FALSE(Duration::of(NoteValue::kQuarter, 1).equals(Duration::of(NoteValue::kQuarter)));
}

TEST_CASE("Meter answers for its signature", "[model][meter]") {
  Meter six_eight = Meter::parse("6/8");
  CHECK(six_eight.is_compound());
  CHECK(six_eight.pulses_per_bar() == 2);
  CHECK(six_eight.format_position(7.5) == "3.2");
  CHECK(Meter::of(7, 8, std::vector<int>{2, 2, 3}).format({true}) == "2+2+3/8");
  CHECK(Meter::of(7, 8, std::vector<int>{2, 2, 3}).to_string() == "7/8");
  CHECK_FALSE(Meter::of(7, 8).equals(Meter::of(7, 8, std::vector<int>{2, 2, 3})));
  CHECK_THROWS_AS(Meter::of(0, 4), InvalidInputError);
  CHECK_FALSE(Meter::try_parse("x").ok());
}

TEST_CASE("Tempo converts beats and ticks", "[model][tempo]") {
  CHECK(Tempo::of(120).seconds_at(16) == 8);
  CHECK(Tempo::of(90).beat_at_seconds(4) == 6);
  CHECK(Tempo::of(120).to_string() == "120 bpm");
  CHECK_THROWS_AS(Tempo::of(0), InvalidInputError);
  CHECK_THROWS_AS(Tempo::of(1001), InvalidInputError);
  CHECK(Tempo::of(96).equals(Tempo::from_data(TempoData{96})));
}

TEST_CASE("Tuning binds the tuning functions", "[model][tuning]") {
  CHECK(Tuning::twelve_tet().frequency_of("A4") == 440);
  CHECK(Tuning::twelve_tet().nearest_step(442) == 69);
  CHECK(Tuning::edo(19).divisions() == 19);
  CHECK(Tuning::twelve_tet().to_string() == "12-EDO (step 69 = 440 Hz)");
  CHECK(Tuning::ratio_to_cents(2, 1) == 1200);
  CHECK_THROWS_AS(Tuning::of(TuningTable{69, 440, 0}), InvalidInputError);
  CHECK(Tuning::twelve_tet().frequency_of_step(69, TuningTable{69, 432, 12}) == 432);
}
