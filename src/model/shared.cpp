#include "model/shared.h"

#include "cantus/core/validation.h"

namespace cantus {

NoteData spell_pitch_class_bare(double pc, MidiSpelling spelling) {
  NoteData spelled = midi_to_note(60 + pitch_class_of(pc), spelling);
  return NoteData{spelled.letter, spelled.alter, std::nullopt};
}

NoteEvent copy_note_event(const NoteEvent& note) {
  NoteEvent copy;
  copy.pitch = note.pitch;
  copy.startBeat = without_negative_zero(note.startBeat);
  copy.durationBeat = without_negative_zero(note.durationBeat);
  if (note.velocity) {
    copy.velocity = note.velocity;
  }
  if (note.articulation) {
    copy.articulation = note.articulation;
  }
  return copy;
}

TimeSignature copy_time_signature(const TimeSignature& ts, std::string_view name) {
  assert_time_signature(ts, name);
  TimeSignature copy;
  copy.numerator = ts.numerator;
  copy.denominator = ts.denominator;
  if (ts.grouping) {
    copy.grouping = *ts.grouping;
  }
  return copy;
}

}  // namespace cantus
