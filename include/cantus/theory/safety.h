/**
 * @file safety.h
 * @brief Public C++ API of ts/src/theory/safety: judge whether a pitch can be placed in a voice
 *        against the harmony, the key and the other voices, and rank the pitches that can.
 *
 * A profile says two things: how severe each reason is, which decides what is rejected outright,
 * and the weights that rank whatever survives.
 */
#ifndef CANTUS_THEORY_SAFETY_H_
#define CANTUS_THEORY_SAFETY_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/nullable.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Style policy: strict counterpoint or pop voice leading (`SafetyProfile`). */
enum class SafetyProfile : std::uint8_t { kStrict, kPop };

/** The TS name of a profile ("strict" or "pop"). */
std::string_view to_string(SafetyProfile profile);

/** The profile named `name`, or nullopt. */
std::optional<SafetyProfile> parse_safety_profile(std::string_view name);

/** How a profile ranks the candidates its severity table has let through (`ProfileWeights`). */
struct ProfileWeights {
  /** A third or a sixth against the other voice. */
  double imperfectConsonance = 0;
  /** A unison, fifth or octave against the other voice. */
  double perfectConsonance = 0;
  /** A second, seventh or tritone against the other voice. */
  double dissonance = 0;
  /** The candidate belongs to the sounding chord. */
  double chordTone = 0;
  /** The two voices move in opposite directions. */
  double contraryMotion = 0;
  /** One voice holds while the other moves. */
  double obliqueMotion = 0;
  /** Both voices move the same way into a different interval. */
  double similarMotion = 0;
  /** Both voices move the same way, keeping the same imperfect consonance. */
  double parallelImperfect = 0;
  /** The candidate is a step from the previous note of its own line. */
  double stepwise = 0;
  /** Per semitone of melodic movement, so a leap costs more than a step. */
  double melodicDistance = 0;
  /** The move is a leap strict counterpoint forbids outright. */
  double forbiddenLeap = 0;
  /** Per semitone away from the centre of the line's register. */
  double registerDrift = 0;
};

/** Fields of a weight table to replace (`Partial<ProfileWeights>`). */
struct ProfileWeightOverrides {
  std::optional<double> imperfectConsonance;
  std::optional<double> perfectConsonance;
  std::optional<double> dissonance;
  std::optional<double> chordTone;
  std::optional<double> contraryMotion;
  std::optional<double> obliqueMotion;
  std::optional<double> similarMotion;
  std::optional<double> parallelImperfect;
  std::optional<double> stepwise;
  std::optional<double> melodicDistance;
  std::optional<double> forbiddenLeap;
  std::optional<double> registerDrift;
};

/** The weight table of one profile, by its TS name. */
struct NamedProfileWeights {
  std::string_view name;
  ProfileWeights weights;
};

/** The weight table each profile ranks candidates by (`PROFILE_WEIGHTS`). */
extern const std::vector<NamedProfileWeights> PROFILE_WEIGHTS;

/** Overall placeability verdict for a candidate pitch (`NoteSafety`). */
enum class NoteSafety : std::uint8_t { kSafe = 0, kWarning = 1, kDissonant = 2 };

/** Bit flags describing why a pitch received its verdict (`ReasonFlag`). */
enum class ReasonFlag : std::uint32_t {
  /** The candidate is a member of the chord. Informational. */
  kChordTone = 1U << 0,
  /** The candidate is a ninth, eleventh or thirteenth above the root, not a chord tone. */
  kTension = 1U << 1,
  /** The eleventh over a chord with a major third and no fourth, or the major seventh over a
   * dominant. */
  kAvoidNote = 1U << 2,
  /** The candidate is in the key but neither a chord tone nor a tension. */
  kScaleTone = 1U << 3,
  /** The candidate is outside the key and not a chord tone. */
  kNonScale = 1U << 4,
  /** The candidate lies outside `vocalLow`..`vocalHigh`. */
  kOutOfRange = 1U << 5,
  /** The candidate, not itself a chord tone, is a tritone from one. */
  kTritone = 1U << 6,
  /** The move from `prevPitch` is a forbidden melodic leap. */
  kLargeLeap = 1U << 7,
  /** The move from `prevPitch` reduces to a semitone. Informational. */
  kMinorSecond = 1U << 8,
  /** The move from `prevPitch` reduces to a major seventh. Informational. */
  kMajorSeventh = 1U << 9,
  /** On a strong beat, the candidate is dissonant against another voice. */
  kVerticalDissonance = 1U << 10,
  /** The candidate moves in parallel perfect intervals with another voice. */
  kParallelPerfect = 1U << 11,
  /** The two outer voices reach a perfect interval by similar motion with the upper leaping. */
  kHiddenParallel = 1U << 12,
  /** The candidate crosses another voice since the previous step. */
  kVoiceCrossing = 1U << 13,
  /** A held pitch, consonant on the previous step, is now dissonant. */
  kSuspension = 1U << 14,
  /** The candidate should move by step to `resolveTo`. */
  kNeedsResolution = 1U << 15,
  /** The move from `prevPitch` reduces to a tritone. */
  kMelodicTritone = 1U << 16,
};

/** A neighbouring voice's current and previous pitch (`VoiceSnapshot`). */
struct VoiceSnapshot {
  int pitch = 0;
  std::optional<int> prevPitch;
};

/** Everything needed to evaluate a pitch except the pitch itself (`Omit<SafetyQuery,
 * 'candidatePitch'>`). */
struct SafetyContext {
  SafetyProfile profile = SafetyProfile::kStrict;
  std::optional<int> prevPitch;
  Nullable<Chord> chord;
  KeyScale key;
  std::vector<VoiceSnapshot> otherVoices;
  bool strongBeat = false;
  std::optional<int> vocalLow;
  std::optional<int> vocalHigh;
};

/** Everything needed to evaluate one candidate pitch (`SafetyQuery`). */
struct SafetyQuery : SafetyContext {
  int candidatePitch = 0;
};

/** The reasons one of `otherVoices` contributes to a verdict (`SafetyPartner`). */
struct SafetyPartner {
  /** The voice's index in `otherVoices`. */
  int index = 0;
  /** The pairwise flags this voice raises. */
  int reasons = 0;
};

/** The verdict, reason flags, and optional resolution guidance (`SafetyResult`). */
struct SafetyResult {
  NoteSafety safety = NoteSafety::kSafe;
  int reasons = 0;
  std::string rationale;
  std::optional<int> resolveTo;
  std::optional<std::vector<int>> suggestions;
  std::optional<std::vector<SafetyPartner>> partners;
};

/** Options of evaluate_safety() (`EvaluateSafetyOptions`). */
struct EvaluateSafetyOptions {
  /** Whether to search for safe replacement pitches when the verdict is not safe. Defaults to
   * true. */
  std::optional<bool> suggestions;
  /** Whether to report which of `otherVoices` raised each pairwise flag. Defaults to false. */
  std::optional<bool> partners;
};

/**
 * Resolve a profile to the weights that rank its candidates, with per-field overrides applied on
 * top (`profileWeights`).
 * @throws InvalidInputError if an override is not a finite number.
 */
ProfileWeights profile_weights(SafetyProfile profile, const ProfileWeightOverrides& overrides = {});

/**
 * Evaluate the safety of placing a candidate pitch in a voice (`evaluateSafety`).
 * @throws InvalidInputError if a pitch of the query is not a MIDI pitch in 0..127, or the vocal
 *   range is reversed.
 * @throws BudgetExceededError if `otherVoices` exceeds the generation budget.
 */
SafetyResult evaluate_safety(const SafetyQuery& query, const EvaluateSafetyOptions& opts = {});

/**
 * Enumerate placeable pitches in a range, chord tones first, each group descending
 * (`enumerateSafePitches`).
 * @throws InvalidInputError if either bound is not a MIDI pitch in 0..127 or they are reversed.
 * @throws BudgetExceededError if the range exceeds the generation budget.
 */
std::vector<double> enumerate_safe_pitches(const SafetyContext& context, double pitch_low,
                                           double pitch_high);

}  // namespace cantus

#endif  // CANTUS_THEORY_SAFETY_H_
