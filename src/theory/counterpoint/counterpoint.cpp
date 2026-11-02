// Counterpoint predicates, each judging one pair of voices at one moment:
// ts/src/theory/counterpoint/index.ts.

#include "cantus/theory/counterpoint.h"

#include <array>
#include <cmath>
#include <optional>
#include <string_view>

#include "core/validation/validation.h"
#include "js/math.h"
#include "theory/counterpoint/internal.h"

namespace cantus {

namespace {

constexpr std::string_view kHiddenParallelReadings[] =
#include "theory/counterpoint/hidden_parallel_readings.gen.inc"
    ;

/** The notes of a pair of arguments, when both are spelled notes. */
const NoteData* note_of(const PitchArg& value) { return std::get_if<NoteData>(&value.value()); }

bool both_notes(const PitchArg& a, const PitchArg& b) {
  return note_of(a) != nullptr && note_of(b) != nullptr;
}

/** Whether a spelled interval is augmented or diminished rather than plain (`isAlteredInterval`).
 */
bool is_altered_interval(const SpelledInterval& interval) {
  // The altered unison is left out: a chromatic inflection of the held note is not a leap.
  return interval.number >= 2 && (interval.quality.rfind('A', 0) == 0 ||
                                  (!interval.quality.empty() && interval.quality[0] == 'd'));
}

/** Reduce an interval to its simple class in [0, 11] (`simpleClass`). */
int simple_class(double semitones) { return pitch_class_of(std::fabs(semitones)); }

/** Whether a simple interval class is a perfect kind, unison/octave or fifth. */
bool is_perfect_class(int cls) { return cls == 0 || cls == 7; }

/** Whether two voices move in the same direction (`similarMotion`). */
bool similar_motion(double a_move, double b_move) {
  return a_move != 0 && b_move != 0 && (a_move > 0) == (b_move > 0);
}

/** Whether both voices actually move (`bothVoicesMove`). */
bool both_voices_move(double a_move, double b_move) { return a_move != 0 && b_move != 0; }

}  // namespace

std::string_view to_string(HiddenParallelReading reading) {
  return kHiddenParallelReadings[static_cast<std::size_t>(reading)];
}

std::optional<HiddenParallelReading> parse_hidden_parallel_reading(std::string_view name) {
  for (std::size_t i = 0; i < std::size(kHiddenParallelReadings); ++i) {
    if (kHiddenParallelReadings[i] == name) {
      return static_cast<HiddenParallelReading>(i);
    }
  }
  return std::nullopt;
}

bool creates_voice_crossing(const PitchArg& upper, const PitchArg& lower) {
  double u = pitch_of(upper);
  return u < pitch_of(lower);
}

bool creates_vertical_dissonance(const PitchArg& a, const PitchArg& b, bool two_voice) {
  if (both_notes(a, b)) {
    // The number and quality read the same either way round; the order decides only a sign.
    return classify_spelled_interval(spelled_interval(*note_of(a), *note_of(b)), two_voice) ==
           ConsonanceClass::kDissonance;
  }
  double first = pitch_of(a);
  return !is_consonant_interval(first - pitch_of(b), two_voice);
}

bool is_forbidden_melodic_leap(const PitchArg& prev, const PitchArg& cur) {
  if (both_notes(prev, cur)) {
    SpelledInterval interval = spelled_interval(*note_of(prev), *note_of(cur));
    if (std::fabs(interval.semitones) > 12 || interval.number > 8) {
      return true;
    }
    if (simple_interval_number(interval.number) == 7) {
      return true;
    }
    return is_altered_interval(interval);
  }
  double to = pitch_of(cur);
  double semis = std::fabs(to - pitch_of(prev));
  return semis == 6 || semis == 10 || semis == 11 || semis > 12;
}

bool is_augmented_melodic_interval(const PitchArg& prev, const PitchArg& cur) {
  if (!both_notes(prev, cur)) {
    return false;
  }
  return is_augmented_spelled_interval(spelled_interval(*note_of(prev), *note_of(cur)));
}

bool creates_parallel_perfect(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                              const PitchArg& b_cur) {
  double a0 = pitch_of(a_prev);
  double a1 = pitch_of(a_cur);
  double b0 = pitch_of(b_prev);
  double b1 = pitch_of(b_cur);
  if (!both_voices_move(a1 - a0, b1 - b0)) {
    return false;
  }
  int now_class = simple_class(a1 - b1);
  int prev_class = simple_class(a0 - b0);
  return is_perfect_class(now_class) && now_class == prev_class;
}

bool creates_parallel_octave(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                             const PitchArg& b_cur) {
  double a0 = pitch_of(a_prev);
  double a1 = pitch_of(a_cur);
  double b0 = pitch_of(b_prev);
  double b1 = pitch_of(b_cur);
  if (!similar_motion(a1 - a0, b1 - b0)) {
    return false;
  }
  return simple_class(a1 - b1) == 0 && simple_class(a0 - b0) == 0;
}

bool creates_parallel_unison(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                             const PitchArg& b_cur) {
  double a0 = pitch_of(a_prev);
  double a1 = pitch_of(a_cur);
  double b0 = pitch_of(b_prev);
  double b1 = pitch_of(b_cur);
  if (a1 == a0 || b1 == b0) {
    return false;
  }
  return a1 == b1 && a0 == b0;
}

bool creates_hidden_parallel_perfect(const PitchArg& a_prev, const PitchArg& a_cur,
                                     const PitchArg& b_prev, const PitchArg& b_cur,
                                     HiddenParallelReading strictness) {
  double a0 = pitch_of(a_prev);
  double a1 = pitch_of(a_cur);
  double b0 = pitch_of(b_prev);
  double b1 = pitch_of(b_cur);
  double a_move = a1 - a0;
  double b_move = b1 - b0;
  if (!similar_motion(a_move, b_move)) {
    return false;
  }
  int now_class = simple_class(a1 - b1);
  int prev_class = simple_class(a0 - b0);
  // Reaching the same perfect class is a true parallel; a different one is the hidden case.
  if (!is_perfect_class(now_class) || prev_class == now_class) {
    return false;
  }
  double upper_move = a1 >= b1 ? a_move : b_move;
  if (strictness == HiddenParallelReading::kFourPart && std::fabs(upper_move) <= 2) {
    return false;  // upper voice moves by step: the direct interval is acceptable
  }
  return true;
}

bool creates_battuta(const PitchArg& a_prev, const PitchArg& a_cur, const PitchArg& b_prev,
                     const PitchArg& b_cur) {
  double a0 = pitch_of(a_prev);
  double a1 = pitch_of(a_cur);
  double b0 = pitch_of(b_prev);
  double b1 = pitch_of(b_cur);
  double a_move = a1 - a0;
  double b_move = b1 - b0;
  if (!both_voices_move(a_move, b_move) || similar_motion(a_move, b_move)) {
    return false;
  }
  int now_class = simple_class(a1 - b1);
  if (now_class != 0) {
    return false;
  }
  int prev_class = simple_class(a0 - b0);
  if (prev_class == now_class) {
    return false;  // anti-parallel octave
  }
  double upper_move = a1 >= b1 ? a_move : b_move;
  return upper_move < -2;
}

bool creates_voice_overlap(const PitchArg& upper_prev, const PitchArg& upper_cur,
                           const PitchArg& lower_prev, const PitchArg& lower_cur) {
  double u0 = pitch_of(upper_prev);
  double u1 = pitch_of(upper_cur);
  double l0 = pitch_of(lower_prev);
  double l1 = pitch_of(lower_cur);
  return u1 < l0 || l1 > u0;
}

bool exceeds_spacing(const PitchArg& upper, const PitchArg& lower, double max_semitones) {
  // A limit that is not a number compares false against every distance.
  assert_finite_number(max_semitones, "maxSemitones");
  double first = pitch_of(upper);
  return std::fabs(first - pitch_of(lower)) > max_semitones;
}

bool is_leading_tone_resolution(const PitchArg& prev, const PitchArg& cur, const KeyArg& key) {
  double prev_pitch = pitch_of(prev);
  double cur_pitch = pitch_of(cur);
  int tonic = pitch_class_of(to_key_scale(key).rootPc);
  int leading = (tonic + 11) % 12;
  if (pitch_class_of(prev_pitch) != leading || pitch_class_of(cur_pitch) != tonic) {
    return false;
  }
  return cur_pitch > prev_pitch && cur_pitch - prev_pitch <= 2;
}

}  // namespace cantus
