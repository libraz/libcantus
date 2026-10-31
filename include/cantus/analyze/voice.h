/**
 * @file voice.h
 * @brief Public C++ API of ts/src/analyze/voice: label every note of a monophonic voice with its
 *        theory role against the chord sounding at its onset.
 */
#ifndef CANTUS_ANALYZE_VOICE_H_
#define CANTUS_ANALYZE_VOICE_H_

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** A suspension figure, named by the interval above the bass and the one it resolves to. */
enum class SuspensionFigure : std::uint8_t { kSus4_3, kSus6_5, kSus7_6, kSus9_8, kSus2_3 };

/** The TS name of a figure ("sus4-3", "sus6-5", "sus7-6", "sus9-8" or "sus2-3"). */
std::string_view to_string(SuspensionFigure figure);

/** What a theory label says of a note (`TheoryLabel['kind']`). */
enum class TheoryLabelKind : std::uint8_t {
  kChordTone,
  kTension,
  kAvoid,
  kPassing,
  kNeighbor,
  kSuspension,
  kAppoggiatura,
  kAnticipation,
  kEscape,
  kNeedsResolution,
  kLeadingTone,
};

/** The TS name of a kind ("chordTone", ..., "leadingTone"). */
std::string_view to_string(TheoryLabelKind kind);

/** A theory annotation attached to a note (`TheoryLabel`); which fields are set follows `kind`. */
struct TheoryLabel {
  TheoryLabelKind kind = TheoryLabelKind::kAvoid;
  /** The role of a chord tone. */
  std::optional<ChordToneRole> role;
  /** The extension of a tension: 9, 11 or 13. */
  std::optional<int> degree;
  /** The figure of a suspension. */
  std::optional<SuspensionFigure> type;
  /** The pitch a suspension, appoggiatura, unresolved dissonance or leading tone gives way to. */
  std::optional<double> resolveTo;
};

/** A note with its theory labels and a short rationale (`AnalyzedNote`). */
struct AnalyzedNote {
  double noteId = 0;
  /** The note's index in the caller's own array, when the caller supplied one. */
  std::optional<double> originalIndex;
  /** The note's track, set by analyze_arrangement(). */
  std::optional<double> trackIndex;
  int pitch = 0;
  double startBeat = 0;
  double durationBeat = 0;
  std::vector<TheoryLabel> labels;
  std::optional<std::string> rationale;
};

/** A single note in a monophonic voice: a NoteEvent with a stable id (`VoiceNote`). */
struct VoiceNote : NoteEvent {
  std::optional<double> id;
  /** The note's index in the caller's original array. */
  std::optional<double> originalIndex;
};

/** A voice note whose id has been assigned (`IdentifiedVoiceNote`). */
struct IdentifiedVoiceNote : NoteEvent {
  double id = 0;
  double originalIndex = 0;
};

/** The scale in force at a beat. */
using KeyAtBeat = std::function<KeyScale(double)>;

/** A key that applies to the whole voice, or the key in force at a given beat (`KeyContext`). */
class KeyContext {
 public:
  KeyContext(KeyArg key) : value_(std::move(key)) {}             // NOLINT
  KeyContext(KeyAtBeat at_beat) : value_(std::move(at_beat)) {}  // NOLINT

  /** The form this context holds. */
  const std::variant<KeyArg, KeyAtBeat>& value() const noexcept { return value_; }

 private:
  std::variant<KeyArg, KeyAtBeat> value_;
};

/**
 * Give plain note events the ids analyze_voice() reports back (`toVoiceNotes`).
 * @throws InvalidInputError if the events are not valid note events.
 */
std::vector<IdentifiedVoiceNote> to_voice_notes(const std::vector<NoteEvent>& events);

/**
 * Label every note of a voice with its theory roles (`analyzeVoice`). Each note is classified
 * against the chord sounding at its beat; leading-tone resolutions are noted against the key in
 * force at the beat the resolution lands on. A note of zero length gets no melodic labels and is no
 * other note's neighbour.
 * @param voice The monophonic voice, in time order.
 * @param chord_at_beat Chord sounding at a given beat, or null.
 * @param key The key of the whole voice, or the key in force at a given beat.
 * @param other_voices_at_beat Other sounding voices at a given beat; none when empty, and a
 *   suspension's dissonance is then judged against the chord.
 * @throws InvalidInputError if the voice is not valid note events.
 */
std::vector<AnalyzedNote> analyze_voice(
    const std::vector<VoiceNote>& voice,
    const std::function<Nullable<Chord>(double)>& chord_at_beat, const KeyContext& key,
    const std::function<std::vector<VoiceSnapshot>(double)>& other_voices_at_beat = {});

}  // namespace cantus

#endif  // CANTUS_ANALYZE_VOICE_H_
