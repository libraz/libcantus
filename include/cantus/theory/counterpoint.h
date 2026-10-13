/**
 * @file counterpoint.h
 * @brief Public C++ API of ts/src/theory/counterpoint: predicates that judge one pair of voices
 *        at one moment, and the measure of how independent two lines are.
 *
 * Every predicate takes a voice as a spelled note or as a MIDI number. Spelling decides two of the
 * rules (an augmented second against a minor third, a diminished fourth against a major third),
 * so those answer the spelled question for notes and the sounding one for numbers.
 */
#ifndef CANTUS_THEORY_COUNTERPOINT_H_
#define CANTUS_THEORY_COUNTERPOINT_H_

#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "cantus/core/interval.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** A voice at one moment: a MIDI number (any double) or a spelled note. */
class PitchArg {
 public:
  /** The forms a PitchArg holds. */
  using Value = std::variant<double, NoteData>;

  PitchArg(double midi) : value_(midi) {}                    // NOLINT
  PitchArg(int midi) : value_(static_cast<double>(midi)) {}  // NOLINT
  PitchArg(NoteData note) : value_(std::move(note)) {}       // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/** Which reading of hidden parallels an approach is judged by (`HiddenParallelReading`). */
enum class HiddenParallelReading : std::uint8_t { kFourPart, kTwoVoice };

/** The TS name of a reading ("fourPart" or "twoVoice"). */
std::string_view to_string(HiddenParallelReading reading);

/** The reading named `name`, or nullopt. */
std::optional<HiddenParallelReading> parse_hidden_parallel_reading(std::string_view name);

/** How two lines move against each other (`VoiceIndependenceReport.motion`). */
struct VoiceMotionShares {
  /** The voices move in opposite directions. */
  double contrary = 0;
  /** One voice holds while the other moves. */
  double oblique = 0;
  /** Both rise or both fall, and the interval between them changes. */
  double similar = 0;
  /** Both rise or both fall, keeping the same interval. */
  double parallel = 0;
};

/** The distance between two lines over the slots where both sound. */
struct VoiceSeparation {
  /** Mean distance in semitones; 0 when the two lines never sound together. */
  double mean = 0;
  /** Closest approach in semitones; 0 when the two lines never sound together. */
  double min = 0;
};

/** How independent two lines are (`VoiceIndependenceReport`). */
struct VoiceIndependenceReport {
  VoiceMotionShares motion;
  /** Share of the slots where the lead holds or rests on which the counter attacks. */
  double rhythmicComplementarity = 0;
  VoiceSeparation separation;
  /** Slots at which the two lines sit in the opposite order to the one they keep overall. */
  int crossings = 0;
  /** Longest run of consecutive slots sounding a perfect consonance. */
  int longestPerfectRun = 0;
  /** Slots at which both lines sound. */
  int sounding = 0;
};

/** Options of voice_independence() (`VoiceIndependenceOptions`). */
struct VoiceIndependenceOptions {
  /** Which slots are fresh attacks in the lead; a changed note counts when absent. */
  std::optional<std::vector<bool>> leadAttacks;
  /** Which slots are fresh attacks in the counter; read as `leadAttacks` is. */
  std::optional<std::vector<bool>> counterAttacks;
  /** Count the perfect fourth among the perfect consonances of `longestPerfectRun`. */
  std::optional<bool> countFourths;
};

/**
 * Classify a spelled interval by consonance, the way a counterpoint exercise reads it
 * (`classifySpelledInterval`).
 * @throws InvalidInputError if the number or the quality label is malformed.
 */
ConsonanceClass classify_spelled_interval(const SpelledInterval& interval, bool two_voice = true);

/** Whether an upper voice sits below a lower voice (`createsVoiceCrossing`). */
bool creates_voice_crossing(const PitchArg& upper, const PitchArg& lower);

/** Whether two simultaneous voices form a dissonance (`createsVerticalDissonance`). */
bool creates_vertical_dissonance(const PitchArg& a, const PitchArg& b, bool two_voice);

/** Whether a melodic move is a forbidden leap (`isForbiddenMelodicLeap`). */
bool is_forbidden_melodic_leap(const PitchArg& prev, const PitchArg& cur);

/** Whether a voice moves by an augmented interval; false for numbers
 * (`isAugmentedMelodicInterval`). */
bool is_augmented_melodic_interval(const PitchArg& prev, const PitchArg& cur);

/** Whether two voices move into consecutive perfect intervals of one kind
 * (`createsParallelPerfect`). */
bool creates_parallel_perfect(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                              const PitchArg& b_cur);

/** Whether two voices move in parallel octaves by similar motion (`createsParallelOctave`). */
bool creates_parallel_octave(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                             const PitchArg& b_cur);

/** Whether two voices move in consecutive parallel unisons (`createsParallelUnison`). */
bool creates_parallel_unison(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                             const PitchArg& b_cur);

/**
 * Whether two voices reach a perfect interval by similar motion from an imperfect one
 * (`createsHiddenParallelPerfect`).
 */
bool creates_hidden_parallel_perfect(
    const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev, const PitchArg& b_cur,
    HiddenParallelReading strictness = HiddenParallelReading::kFourPart);

/** Whether two voices reach an octave or unison by contrary motion with a leap down
 * (`createsBattuta`). */
bool creates_battuta(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                     const PitchArg& b_cur);

/** Whether two voices overlap (`createsVoiceOverlap`). */
bool creates_voice_overlap(const PitchArg& upper_prev, const PitchArg& upper_cur,
                           const PitchArg& lower_prev, const PitchArg& lower_cur);

/**
 * Whether two adjacent voices are spaced more than a maximum apart (`exceedsSpacing`).
 * @throws InvalidInputError if `max_semitones` is not finite.
 */
bool exceeds_spacing(const PitchArg& upper, const PitchArg& lower, double max_semitones = 12);

/** Whether a leading tone resolves upward to the tonic (`isLeadingToneResolution`). */
bool is_leading_tone_resolution(const PitchArg& prev, const PitchArg& cur, const KeyArg& key);

/**
 * Measure how independent a counter line is from the lead it accompanies (`voiceIndependence`).
 * Both lines are index-aligned samples with a null for a rest.
 * @throws InvalidInputError if the lines or the attack arrays differ in length, or a note has no
 *   octave.
 */
VoiceIndependenceReport voice_independence(const std::vector<Nullable<NoteData>>& lead,
                                           const std::vector<Nullable<NoteData>>& counter,
                                           const VoiceIndependenceOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_THEORY_COUNTERPOINT_H_
