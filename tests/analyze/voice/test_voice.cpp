#include <catch2/catch_test_macros.hpp>
#include <vector>

#include "analyze/voice/voice.h"
#include "cantus/analyze/voice.h"
#include "cantus/core/errors.h"
#include "cantus/theory/chord.h"

using namespace cantus;

namespace {

VoiceNote voice_note(int pitch, double start, double duration) {
  VoiceNote note;
  note.pitch = pitch;
  note.startBeat = start;
  note.durationBeat = duration;
  return note;
}

std::vector<AnalyzedNote> analyze(const std::vector<VoiceNote>& voice, const Chord& chord) {
  return analyze_voice(
      voice, [&](double) -> Nullable<Chord> { return chord; }, KeyContext(KeyArg("C major")));
}

}  // namespace

TEST_CASE("notes are labelled against the chord at their onset", "[voice]") {
  Chord c_major = make_chord(0, ChordQuality::kMaj);
  std::vector<AnalyzedNote> notes =
      analyze({voice_note(60, 0, 1), voice_note(62, 1, 1), voice_note(64, 2, 1)}, c_major);
  REQUIRE(notes.size() == 3);
  CHECK(notes[0].labels[0].kind == TheoryLabelKind::kChordTone);
  CHECK(notes[0].labels[0].role == ChordToneRole::kRoot);
  CHECK(notes[0].rationale == "Chord root");
  // The D between two chord tones, stepping the same way, is a passing tone.
  CHECK(notes[1].labels[0].kind == TheoryLabelKind::kPassing);
  CHECK(notes[1].rationale == "Passing tone between chord tones");
  CHECK(notes[2].labels[0].role == ChordToneRole::kThird);
}

TEST_CASE("a dissonance with no stepwise exit still says where it wants to go", "[voice]") {
  Chord c_major = make_chord(0, ChordQuality::kMaj);
  std::vector<AnalyzedNote> notes = analyze({voice_note(66, 0, 1)}, c_major);
  REQUIRE(notes[0].labels.size() == 1);
  CHECK(notes[0].labels[0].kind == TheoryLabelKind::kNeedsResolution);
  CHECK(notes[0].labels[0].resolveTo == 67);
  // The fourth over a major triad is an avoid note.
  std::vector<AnalyzedNote> avoid = analyze({voice_note(65, 0, 1)}, c_major);
  CHECK(avoid[0].labels[0].kind == TheoryLabelKind::kAvoid);
  CHECK(avoid[0].labels[1].kind == TheoryLabelKind::kNeedsResolution);
}

TEST_CASE("a leading tone is noted against the key of the beat it resolves on", "[voice]") {
  Chord g7 = make_chord(7, ChordQuality::kDom7);
  std::vector<AnalyzedNote> notes = analyze({voice_note(71, 0, 1), voice_note(72, 1, 1)}, g7);
  bool noted = false;
  for (const TheoryLabel& label : notes[0].labels) {
    noted = noted || label.kind == TheoryLabelKind::kLeadingTone;
  }
  CHECK(noted);
  std::vector<AnalyzedNote> modulated = analyze_voice(
      {voice_note(71, 0, 1), voice_note(72, 1, 1)}, [&](double) -> Nullable<Chord> { return g7; },
      KeyContext(KeyAtBeat([](double beat) { return major_key(beat < 1 ? 7 : 0).scale(); })));
  noted = false;
  for (const TheoryLabel& label : modulated[0].labels) {
    noted = noted || label.kind == TheoryLabelKind::kLeadingTone;
  }
  CHECK(noted);
}

TEST_CASE("a note with no chord is unclassified, and ids default to the position", "[voice]") {
  std::vector<AnalyzedNote> notes = analyze_voice(
      {voice_note(60, 0, 1)}, [](double) -> Nullable<Chord> { return std::nullopt; },
      KeyContext(KeyArg("C major")));
  CHECK(notes[0].labels.empty());
  CHECK(notes[0].rationale == "Unclassified note");
  CHECK(notes[0].noteId == 0);
  VoiceNote named = voice_note(60, 0, 1);
  named.id = 42;
  named.originalIndex = 7;
  std::vector<AnalyzedNote> identified = analyze_voice(
      {named}, [](double) -> Nullable<Chord> { return std::nullopt; },
      KeyContext(KeyArg("C major")));
  CHECK(identified[0].noteId == 42);
  CHECK(identified[0].originalIndex == 7);
}

TEST_CASE("voice notes get their position as id", "[voice]") {
  NoteEvent first;
  first.pitch = 60;
  first.durationBeat = 1;
  std::vector<IdentifiedVoiceNote> notes = to_voice_notes({first, first});
  REQUIRE(notes.size() == 2);
  CHECK(notes[1].id == 1);
  CHECK(notes[1].originalIndex == 1);
  first.pitch = 200;
  CHECK_THROWS_AS(to_voice_notes({first}), InvalidInputError);
  CHECK(to_string(SuspensionFigure::kSus4_3) == "sus4-3");
}

TEST_CASE("a solo line's suspension is judged against the chord", "[voice]") {
  Chord f_major = make_chord(5, ChordQuality::kMaj);
  Chord c_major = make_chord(0, ChordQuality::kMaj);
  std::vector<VoiceNote> voice = {voice_note(65, 0, 1), voice_note(65, 1, 1), voice_note(64, 2, 1)};
  std::vector<AnalyzedNote> notes = analyze_voice(
      voice, [&](double beat) -> Nullable<Chord> { return beat < 1 ? f_major : c_major; },
      KeyContext(KeyArg("C major")));
  REQUIRE(notes.size() == 3);
  REQUIRE_FALSE(notes[1].labels.empty());
  CHECK(notes[1].labels[0].kind == TheoryLabelKind::kSuspension);
  CHECK(notes[1].labels[0].type == SuspensionFigure::kSus4_3);
  CHECK(notes[1].labels[0].resolveTo == 64);
}

TEST_CASE("a suspension resolving onto another interval names no figure", "[voice]") {
  // B over C falling to B flat over C7 is a seventh going to a seventh.
  Chord b_major = make_chord(11, ChordQuality::kMaj);
  Chord c_seventh = make_chord(0, ChordQuality::kDom7);
  std::vector<VoiceNote> voice = {voice_note(71, 0, 1), voice_note(71, 1, 1), voice_note(70, 2, 1)};
  std::vector<AnalyzedNote> notes = analyze_voice(
      voice, [&](double beat) -> Nullable<Chord> { return beat < 1 ? b_major : c_seventh; },
      KeyContext(KeyArg("C major")),
      [](double) { return std::vector<VoiceSnapshot>{VoiceSnapshot{36, std::nullopt}}; });
  REQUIRE(notes.size() == 3);
  for (const TheoryLabel& label : notes[1].labels) {
    CHECK(label.kind != TheoryLabelKind::kSuspension);
  }
}

TEST_CASE("a zero-length note is no one's neighbour", "[voice]") {
  Chord c_major = make_chord(0, ChordQuality::kMaj);
  Chord d_minor = make_chord(2, ChordQuality::kMin);
  std::vector<VoiceNote> voice = {voice_note(60, 0, 0), voice_note(62, 0, 1), voice_note(64, 1, 1)};
  std::vector<AnalyzedNote> notes = analyze_voice(
      voice, [&](double beat) -> Nullable<Chord> { return beat < 1 ? c_major : d_minor; },
      KeyContext(KeyArg("C major")));
  REQUIRE(notes.size() == 3);
  for (const TheoryLabel& label : notes[1].labels) {
    CHECK(label.kind != TheoryLabelKind::kPassing);
  }
}
