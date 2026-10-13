/**
 * @file interval.h
 * @brief Public C++ API of ts/src/core/interval: how an interval sounds against another voice.
 */
#ifndef CANTUS_CORE_INTERVAL_H_
#define CANTUS_CORE_INTERVAL_H_

#include <cstdint>

namespace cantus {

/** How an interval sounds (`ConsonanceClass`); the values equal the TS enum's. */
enum class ConsonanceClass : std::uint8_t {
  kPerfectConsonance = 0,
  kImperfectConsonance = 1,
  kDissonance = 2,
};

/**
 * Classify a simple interval by its semitone span (`classifyInterval`). A fourth is dissonant
 * against the bass of a two-voice texture and imperfectly consonant otherwise.
 * @throws InvalidInputError if `semitones` is not finite.
 */
ConsonanceClass classify_interval(double semitones, bool two_voice = true);

/** Whether the span is a perfect consonance, a unison or fifth class (`isPerfectInterval`). */
bool is_perfect_interval(double semitones);

/** Whether the span is consonant under the same two-voice rule (`isConsonantInterval`). */
bool is_consonant_interval(double semitones, bool two_voice = true);

}  // namespace cantus

#endif  // CANTUS_CORE_INTERVAL_H_
