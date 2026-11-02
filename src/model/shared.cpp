#include "model/shared.h"

#include <vector>

#include "cantus/core/validation.h"

namespace cantus {

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

std::vector<NoteEvent> copy_checked_notes(const std::vector<NoteEvent>& notes,
                                          std::string_view name, std::optional<double> budget) {
  NoteEventAssertOptions options;
  options.allowNonPositiveDuration = true;
  options.budget = budget;
  std::vector<NoteEvent> out;
  assert_note_events(notes, name, options);
  for (const NoteEvent& note : notes) {
    out.push_back(copy_note_event(note));
  }
  return out;
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

bool same_time_signature(const TimeSignature& a, const TimeSignature& b) {
  static const std::vector<int> kNoGrouping;
  const std::vector<int>& mine = a.grouping ? *a.grouping : kNoGrouping;
  const std::vector<int>& theirs = b.grouping ? *b.grouping : kNoGrouping;
  return a.numerator == b.numerator && a.denominator == b.denominator && mine == theirs;
}

}  // namespace cantus
