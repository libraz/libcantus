/**
 * @file voice.h
 * @brief Internal entry points of ts/src/analyze/voice/index.ts beside the public API in
 *        cantus/analyze/voice.h: the analysis over a host that supplies the chords, the key and
 *        the other voices, and the key lookup the other analyses share.
 */
#ifndef CANTUS_SRC_ANALYZE_VOICE_VOICE_H_
#define CANTUS_SRC_ANALYZE_VOICE_VOICE_H_

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "cantus/analyze/voice.h"

namespace cantus {

/**
 * A chord the host supplied for a beat. The note-by-note reading of a chord fails on a quality
 * no table knows only where it asks for the chord's interval class, so a chord carrying one is
 * kept apart from the chord itself.
 */
struct VoiceChord {
  Chord chord;
  /** The message TS refuses the chord with where it asserts it, when its quality is unknown. */
  std::optional<std::string> unknown_quality;
};

/**
 * Another sounding voice. `raw_pitch` is what arithmetic reads of its pitch (`NaN` for a pitch
 * that is not a number); `pitch_of` is what the counterpoint rules read, which fails for a pitch
 * that is no pitch. Both read it when asked, as the field is read in TS.
 */
struct OtherVoice {
  std::function<double()> raw_pitch;
  std::function<double()> pitch_of;
};

/** What `analyzeVoice` asks of its caller. */
struct VoiceHost {
  /** The chord sounding at a beat; empty for none. */
  std::function<std::optional<VoiceChord>(double)> chord_at;
  /** The other sounding voices at a beat. */
  std::function<std::vector<OtherVoice>(double)> others_at;
  /** The scale in force at a beat. */
  KeyAtBeat key_at;
};

/** analyze_voice() over a validated voice and a host. */
std::vector<AnalyzedNote> analyze_voice_over(const std::vector<VoiceNote>& voice,
                                             const VoiceHost& host);

/**
 * The scale in force at a beat, whichever form the context was given in (`keyScaleAt`): one key
 * is read once, here.
 * @throws InvalidInputError if a key is not a key.
 */
KeyAtBeat key_scale_at(const KeyContext& key);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_VOICE_VOICE_H_
