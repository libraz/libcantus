/**
 * @file hit.h
 * @brief Internal pieces of ts/src/generate/drums/hit.ts: the voice table and the hit
 *        accumulator every drum voice writes into.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_HIT_H_
#define CANTUS_SRC_GENERATE_DRUMS_HIT_H_

#include <array>
#include <cmath>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/generate/drums.h"
#include "generate/drums/internal.h"
#include "generate/drums/limits.gen.h"
#include "js/math.h"

namespace cantus {

/** One DRUM_NOTES entry: a voice name and its General MIDI note. */
struct DrumNoteRow {
  std::string_view voice;
  int note;
};

/** `DRUM_NOTES`, indexed by DrumVoice. */
inline constexpr std::array<DrumNoteRow, DRUM_VOICES.size()> kDrumNotes = {
#include "generate/drums/drum_notes.gen.inc"
};
static_assert(!kDrumNotes.back().voice.empty(), "DRUM_NOTES and DrumVoice disagree");

/**
 * The note number a voice name stands for (`drumNoteOf`), read as an own key of DRUM_NOTES:
 * absent for a name this generator has no voice for.
 */
std::optional<int> drum_note_of(std::string_view voice);

/** The quantized instant an onset belongs to (`beatSlot`). */
double beat_slot(double start_beat);

/** Key an onset by pitch and quantized beat (`onsetKey`). */
std::string onset_key(int pitch, double start_beat);

/**
 * Accumulator for drum onsets with velocity clamping and onset lookups (`HitList`), over the hit
 * type it writes: DrumHit, or the op layer's record of a caller's stroke.
 */
template <class Hit>
class HitList {
 public:
  using Duration = decltype(std::declval<Hit>().durationBeat);
  using Mark = decltype(std::declval<Hit>().articulation);

  /** The hits written so far, in the order they were added. */
  const std::vector<Hit>& hits() const noexcept { return hits_; }

  /**
   * Append a hit, clamping velocity and moving a negative position to 0; a voice already struck
   * at this instant is left as it stands.
   */
  void add(int pitch, double start_beat, Duration duration, double velocity,
           Mark articulation = Mark()) {
    double beat = js::max(0, start_beat);
    if (has_onset(pitch, beat)) {
      return;
    }
    Hit hit{};
    hit.pitch = pitch;
    hit.startBeat = beat;
    hit.durationBeat = std::move(duration);
    hit.velocity = clamp_vel(velocity);
    hit.articulation = std::move(articulation);
    hits_.push_back(std::move(hit));
    onsets_[beat_slot(beat)].insert(pitch);
  }

  /** Whether a hit of this pitch already starts exactly at `start_beat`. */
  bool has_onset(int pitch, double start_beat) const {
    auto struck = onsets_.find(beat_slot(start_beat));
    return struck != onsets_.end() && struck->second.count(pitch) > 0;
  }

  /** Whether a crash already sits less than a sixteenth from `start_beat`, on either side. */
  bool has_crash_near(double start_beat) const {
    double steps = js::round(0.25 * ONSET_KEY_SCALE);
    for (double step = -steps + 1; step < steps; step += 1) {
      if (has_onset(kGm.CRASH, start_beat + step / ONSET_KEY_SCALE)) {
        return true;
      }
    }
    return false;
  }

 private:
  std::vector<Hit> hits_;
  /** Voices already struck at each quantized beat. */
  std::map<double, std::set<int>> onsets_;
};

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_HIT_H_
