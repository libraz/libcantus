/**
 * @file countermelody.h
 * @brief Public C++ API of ts/src/generate/countermelody: a counter line written against a lead,
 *        and imitative entries restating what a voice has just sung.
 *
 * generate_counter_melody() picks onsets from the lead's rests and sustains, then ranks the safe
 * pitches of the counter register by the style profile's weights; ties are broken by a seeded
 * perturbation far below any real score difference. imitate() copies a span of a lead so that its
 * first note falls on a stated beat, transposed by an interval literally or by scale degree.
 */
#ifndef CANTUS_GENERATE_COUNTERMELODY_H_
#define CANTUS_GENERATE_COUNTERMELODY_H_

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/analyze/timeline.h"
#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Which side of the melody the counter line occupies. */
enum class CounterRegister : std::uint8_t { kAbove, kBelow };

/** The TS name of a register ("above" or "below"). */
std::string_view to_string(CounterRegister side);

/** The register named `name`, or nullopt. */
std::optional<CounterRegister> parse_counter_register(std::string_view name);

/** The onset strategy: complement the melody's rests and sustains, or mirror its onsets. */
enum class CounterRhythm : std::uint8_t { kComplement, kFollow };

/** The TS name of a rhythm ("complement" or "follow"). */
std::string_view to_string(CounterRhythm rhythm);

/** The rhythm named `name`, or nullopt. */
std::optional<CounterRhythm> parse_counter_rhythm(std::string_view name);

/** Options of generate_counter_melody() (`CounterMelodyOptions`). */
struct CounterMelodyOptions {
  CounterMelodyOptions(std::vector<NoteEvent> melody_, KeyArg key_)
      : melody(std::move(melody_)), key(std::move(key_)) {}

  /** The lead line to write against, in ascending onset order. */
  std::vector<NoteEvent> melody;
  /** The harmony to write against; wins over `chordAt` when both are given. */
  std::optional<ChordTimeline> timeline;
  /** The chord sounding at an absolute beat, or null; empty when absent. */
  std::function<Nullable<Chord>(double)> chordAt;
  /** Exact chord-change beats `chordAt` does not expose; ignored when `timeline` is given. */
  std::optional<std::vector<double>> chordChangeBeats;
  /** Key/scale context for scale-tone decisions. */
  KeyArg key;
  /** Meter used for strong-beat decisions; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** Which side of the melody the counter line occupies; below when absent. */
  std::optional<CounterRegister> register_;
  /** Onset strategy; complement when absent. */
  std::optional<CounterRhythm> rhythm;
  /** Style profile applied to candidate pitches; pop when absent. */
  std::optional<SafetyProfile> profile;
  /** Per-field overrides of the profile's ranking weights. */
  std::optional<ProfileWeightOverrides> weights;
  /** Lowest MIDI pitch the counter line may use; derived from the register when absent. */
  std::optional<double> pitchLow;
  /** Highest MIDI pitch the counter line may use; derived from the register when absent. */
  std::optional<double> pitchHigh;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
};

/**
 * Generate a counter melody against a lead line (`generateCounterMelody`).
 * @returns The counter line sorted by onset; empty for a melody that never sounds.
 * @throws InvalidInputError if an option is outside its range, or neither a timeline nor a
 *   chordAt callback is given.
 * @throws BudgetExceededError if the melody's span or the search is larger than the budget allows.
 */
std::vector<NoteEvent> generate_counter_melody(const CounterMelodyOptions& opts);

/** How an imitation answers the voice it follows (`ImitationAnswer`). */
enum class ImitationAnswer : std::uint8_t { kReal, kTonal };

/** Every way an imitation can answer, in declaration order (`IMITATION_ANSWERS`). */
inline constexpr std::array<ImitationAnswer, 2> IMITATION_ANSWERS = {ImitationAnswer::kReal,
                                                                     ImitationAnswer::kTonal};

/** The TS name of an answer ("real" or "tonal"). */
std::string_view to_string(ImitationAnswer answer);

/** The answer named `name`, or nullopt. */
std::optional<ImitationAnswer> parse_imitation_answer(std::string_view name);

/** Options of imitate() (`ImitationOptions`). */
struct ImitationOptions {
  ImitationOptions(double at_beat, IntervalArg interval_, KeyArg key_)
      : atBeat(at_beat), interval(std::move(interval_)), key(std::move(key_)) {}

  /** Beat at which the imitation enters; the copied material starts here. */
  double atBeat = 0;
  /** Interval to imitate at, spelled: "P5" above, "-P4" below. */
  IntervalArg interval;
  /** The key the answer is measured in. */
  KeyArg key;
  /** Whether the answer transposes literally or by scale degree; real when absent. */
  std::optional<ImitationAnswer> answer;
  /** Turn the subject upside down before transposing it; false when absent. */
  std::optional<bool> invert;
  /** First beat of the lead to imitate; the start of the line when absent. */
  std::optional<double> from;
  /** Beat to imitate up to, exclusive; the end of the line when absent. */
  std::optional<double> to;
  /** Factor applied to the copied velocities; 1 when absent. */
  std::optional<double> velocityScale;
};

/**
 * Answer a leading voice with an imitation of it (`imitate`).
 * @returns The imitation sorted by onset; empty when the chosen span holds no sounding notes.
 * @throws InvalidInputError if the span is reversed or a transposed pitch leaves the MIDI range.
 */
std::vector<NoteEvent> imitate(const std::vector<NoteEvent>& lead, const ImitationOptions& opts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_COUNTERMELODY_H_
