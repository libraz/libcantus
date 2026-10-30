/**
 * @file countermelody.h
 * @brief Internal pieces of ts/src/generate/countermelody/index.ts: generateCounterMelody once
 *        its options are read.
 *
 * TS reads some options only once the melody is known to sound, and checks them there: a bad
 * `pitchLow` or chord-change beat is refused for a melody with notes and passes for one without.
 * The request therefore carries those checks as callbacks that the generator makes at the same
 * point.
 */
#ifndef CANTUS_SRC_GENERATE_COUNTERMELODY_COUNTERMELODY_H_
#define CANTUS_SRC_GENERATE_COUNTERMELODY_COUNTERMELODY_H_

#include <functional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/countermelody.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/safety.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Which side of the melody the counter line keeps to (`register`). */
enum class CounterSide : std::uint8_t { kBelow, kAbove };

/** The options of generateCounterMelody after the checks that precede the melody's span. */
struct CounterRequest {
  /** The melody, as `assertNoteEvents` accepted it. */
  std::vector<NoteEvent> melody;
  CounterSide side = CounterSide::kBelow;
  /** The chord sounding at a beat; called once per boundary a counter note spans. */
  std::function<Nullable<Chord>(double)> chord_at;
  /** The chord-change beats as read; NaN where the value was not a number. */
  std::vector<double> change_beats;
  /** The budget and range checks TS makes of the chord-change beats once a melody sounds. */
  std::function<void()> assert_change_beats;
  TimeSignature ts;
  CounterRhythm rhythm = CounterRhythm::kComplement;
  SafetyProfile profile = SafetyProfile::kPop;
  ProfileWeights weights;
  KeyScale key;
  /** `clampToMidi(opts.pitchLow ?? fallback, 'countermelody pitchLow')`, given the fallback. */
  std::function<double(double)> pitch_low;
  /** `clampToMidi(opts.pitchHigh ?? fallback, 'countermelody pitchHigh')`, given the fallback. */
  std::function<double(double)> pitch_high;
};

/** What imitate copies and how it transposes, once its options are checked. */
struct ImitationPlan {
  double atBeat = 0;
  SpelledInterval interval;
  KeyScale key;
  double from = 0;
  double to = 0;
  double velocityScale = 1;
  bool tonal = false;
  bool invert = false;
};

/** The sounding notes a plan copies, as indices into `sounding`, in the order they answer. */
std::vector<std::size_t> imitation_subject(const std::vector<NoteEvent>& sounding, double from,
                                           double to);

/**
 * The answer to each note of the subject: its pitch, onset and velocity.
 * @throws InvalidInputError if a transposed pitch leaves the MIDI range.
 */
std::vector<NoteEvent> imitation_answers(const std::vector<NoteEvent>& sounding,
                                         const std::vector<std::size_t>& subject,
                                         const ImitationPlan& plan);

/** The meter assumed when none is supplied (`DEFAULT_TS`). */
extern const TimeSignature kCounterDefaultTs;

/** The names of the rhythms, for assert_one_of(). */
std::vector<std::string_view> counter_rhythm_names();

/** The names of the registers, for assert_one_of(). */
std::vector<std::string_view> counter_register_names();

/** The names of IMITATION_ANSWERS, for assert_one_of(). */
std::vector<std::string_view> imitation_answer_names();

/** The weight overrides' own check (`assertWeightOverrides`), for each override a caller named. */
void assert_weight_override(std::string_view field, double value);

/** generateCounterMelody from the point its context is resolved. */
std::vector<NoteEvent> generate_counter_melody_with(const CounterRequest& request,
                                                    const ResolvedContext& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_COUNTERMELODY_COUNTERMELODY_H_
