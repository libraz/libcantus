#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/model/chord.h"
#include "cantus/model/key.h"
#include "cantus/model/progression.h"

using namespace cantus;

namespace {

std::vector<std::string> names_of(const std::vector<Note>& notes) {
  std::vector<std::string> out;
  for (const Note& note : notes) {
    out.push_back(note.name());
  }
  return out;
}

}  // namespace

TEST_CASE("Key holds its tonic, mask and form", "[model][key]") {
  Key eb = Key::major("Eb");
  CHECK(eb.to_string() == "Eb major");
  CHECK(eb.fifths() == -3);
  CHECK(eb.root_pc() == 3);
  CHECK_FALSE(eb.is_minor());
  CHECK(eb.scale_name() == std::optional<std::string_view>("major"));
  CHECK(eb.variant() == KeyVariant::kMajor);
  Key dorian = Key::named("dorian", "D");
  CHECK(dorian.to_string() == "D dorian");
  CHECK(dorian.pitch_classes() == std::vector<int>{2, 4, 5, 7, 9, 11, 0});
  CHECK(dorian.pitch_classes(PitchClassOrder::kAscending) ==
        std::vector<int>{0, 2, 4, 5, 7, 9, 11});
  CHECK(dorian.system() == ScaleSystem::kModal);
  CHECK(dorian.supports_functional_harmony());
  CHECK(Key::of(KeyScale{8, 1453}).to_string() == "G# minor");
  CHECK(Key::parse("gis moll").to_string() == "G# minor");
  CHECK(Key::from_fifths(-2, KeyMode::kMinor).to_string() == "G minor");
  CHECK_THROWS_WITH(Key(KeyScale{0, 2741}, Note::parse("D")),
                    "tonic D does not match the scale root pitch class 0; pass a tonic that "
                    "spells the scale root, or omit it to have one chosen");
  CHECK_THROWS_WITH(Key(KeyScale{0, 2}, Note::parse("C")),
                    "scale.modeMask12 must include the tonic (bit 0)");
}

TEST_CASE("Key walks its relations on the circle of fifths", "[model][key]") {
  Key gs = Key::minor("G#");
  CHECK(gs.fifths() == 5);
  CHECK(gs.relative().to_string() == "B major");
  CHECK(gs.parallel().to_string() == "G# major");
  CHECK(gs.dominant_key().to_string() == "D# minor");
  CHECK(gs.subdominant_key().to_string() == "C# minor");
  CHECK(Key::major("Db").enharmonic()->to_string() == "C# major");
  CHECK_FALSE(Key::major("C").enharmonic().has_value());
  std::vector<RelatedKeyEntry> related = Key::major("C").related_keys();
  REQUIRE(related.size() == 6);
  CHECK(related[0].relation == KeyRelation::kRelative);
  CHECK(related[0].key.to_string() == "A minor");
  CHECK(Key::major("C").relation_to(Key::minor("A")) == KeyRelation::kRelative);
  CHECK_FALSE(Key::major("C").relation_to(Key::minor("Eb")).has_value());
  std::vector<KeyPivot> pivots = Key::major("C").pivots_to("G major");
  REQUIRE(pivots.size() == 4);
  CHECK(pivots[2].romanFrom == "V");
  CHECK(pivots[2].romanTo == "I");
  CHECK(pivots[2].chord.symbol() == "G");
}

TEST_CASE("Key derives keys and spells by degree", "[model][key]") {
  Key a = Key::minor("A");
  CHECK(a.degree(4).name() == "D");
  CHECK(a.key_on_degree(4).to_string() == "D minor");
  CHECK(a.key_on_degree(4, KeyMode::kMajor).to_string() == "D major");
  CHECK(Key::minor("D").key_having_tonic_as_degree(4).to_string() == "A minor");
  CHECK_THROWS_AS(a.degree(8), InvalidInputError);
  CHECK(Key::minor("D").transpose_by("A4").to_string() == "G# minor");
  CHECK(Key::minor("G#").transpose_by("-A4").to_string() == "D minor");
  CHECK(Key::major("C").interval_to(Key::major("F#")).name() == "A4");
  CHECK(Key::major("C").transpose(2).to_string() == "D major");
  CHECK(Key::major("Db").transpose(1).to_string() == "D major");
  CHECK(Key::major("C").for_instrument("clarinetBb").to_string() == "D major");
  CHECK(Key::major("F#").for_instrument("clarinetBb").to_string() == "Ab major");
  CHECK(Key::major("C").note_names() ==
        std::vector<std::string>{"C", "D", "E", "F", "G", "A", "B"});
  NoteNameOptions german;
  german.system = NoteNameSystem::kGerman;
  CHECK(Key::minor("G#").note_names(german)[0] == "gis");
  CHECK(Key::minor("G#").to_string(german) == "gis moll");
  CHECK(names_of(Key::major("F").spell_pitch_classes({10, 11})) ==
        std::vector<std::string>{"Bb", "B"});
}

TEST_CASE("Key builds chords and progressions in itself", "[model][key]") {
  Key c = Key::major("C");
  CHECK(c.chord(5).symbol() == "G");
  CHECK(c.chord(2, ChordQuality::kMin7).symbol() == "Dm7");
  CHECK(c.diatonic_seventh(5).symbol() == "G7");
  CHECK(c.roman("V7/V").symbol() == "D7");
  CHECK(c.augmented_sixth(AugmentedSixthKind::kGerman).root_pc() == 8);
  CHECK(c.progression({"I", "vi", "IV", "V"}).to_string() == "C Am F G");
  CHECK(c.chord(1).key()->equals(c));
  CHECK_FALSE(c.contains(61));
  CHECK(c.nearest_tone(61) == 60);
  CHECK(c.degree_of(64) == 3);
  CHECK_FALSE(c.degree_of(61).has_value());
  Nullable<Key> best = Key::detect_best({0, 2, 4, 5, 7, 9, 11});
  REQUIRE(best.has_value());
  CHECK(best->to_string() == "C major");
}

TEST_CASE("Key spells the chords it builds the way it is written", "[model][key]") {
  Key ab_minor = Key::of("Ab minor");
  CHECK(ab_minor.roman("bII").symbol() == "Bbb");
  CHECK(ab_minor.chord(1).symbol() == "Abm");
  CHECK(Key::major("Eb").diatonic_seventh(5).symbol() == "Bb7");
  CHECK(Key::major("C").roman("viio7/vi").symbol() == "G#dim7");
}
