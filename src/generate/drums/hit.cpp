// Drum voices and hits of ts/src/generate/drums/hit.ts.

#include "generate/drums/hit.h"

#include <cstddef>

#include "cantus/core/validation.h"
#include "core/validation/validation.h"
#include "js/number.h"

namespace cantus {

std::string_view to_string(DrumVoice voice) {
  return kDrumNotes[static_cast<std::size_t>(voice)].voice;
}

std::optional<DrumVoice> parse_drum_voice(std::string_view name) {
  return parse_named<DrumVoice>(kDrumNotes, name, &DrumNoteRow::voice);
}

int drum_note(DrumVoice voice) { return kDrumNotes[static_cast<std::size_t>(voice)].note; }

std::optional<int> drum_note_of(std::string_view voice) {
  std::optional<DrumVoice> named = parse_drum_voice(voice);
  return named ? std::optional<int>(drum_note(*named)) : std::nullopt;
}

std::optional<DrumVoice> drum_voice_of(int pitch) {
  // A value that is no note at all is refused, so it does not read as a note never emitted.
  double note = assert_midi_pitch(pitch);
  std::optional<DrumVoice> found;
  for (std::size_t i = 0; i < kDrumNotes.size(); ++i) {
    if (kDrumNotes[i].note == note) {
      found = static_cast<DrumVoice>(i);
    }
  }
  return found;
}

double beat_slot(double start_beat) { return js::round(start_beat * ONSET_KEY_SCALE); }

std::string onset_key(int pitch, double start_beat) {
  return js::to_string(pitch) + ":" + js::to_string(beat_slot(start_beat));
}

}  // namespace cantus
