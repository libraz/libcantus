// How a chord's tones are written: ts/src/theory/voicing/tendency.ts.

#include "theory/voicing/tendency.h"

#include "cantus/theory/counterpoint.h"
#include "cantus/theory/spelling.h"
#include "theory/tendency/tendency.h"

namespace cantus {

SpellingTable spelling_table(const KeyArg& key_like, const std::optional<Chord>& chord) {
  // Read whole rather than reduced, so the tonic a key carries is kept.
  ResolvedKey resolved = resolve_key(key_like);
  SpellingTable table;
  for (int pc = 0; pc < 12; ++pc) {
    SpellingContext context;
    context.chord = chord;
    NoteData note = spell_pitch_class(pc, resolved.tonic, resolved.scale, context);
    table.bases.push_back(note_to_midi(NoteData{note.letter, note.alter, 0.0}));
    table.notes.push_back(note);
  }
  return table;
}

NoteData spelled_at(const SpellingTable& table, double pitch) {
  int pc = pitch_class_of(pitch);
  const NoteData& note = table.notes[static_cast<std::size_t>(pc)];
  double base = table.bases[static_cast<std::size_t>(pc)];
  return NoteData{note.letter, note.alter, (pitch - base) / 12};
}

bool moves_by_augmented_interval(const SpellingTable& from, double from_pitch,
                                 const SpellingTable& to, double to_pitch) {
  NoteData earlier = spelled_at(from, from_pitch);
  NoteData later = spelled_at(to, to_pitch);
  return is_augmented_melodic_interval(earlier, later);
}

bool moves_by_descending_step(const SpellingTable& from, double from_pitch, const SpellingTable& to,
                              double to_pitch) {
  NoteData earlier = spelled_at(from, from_pitch);
  NoteData later = spelled_at(to, to_pitch);
  return is_descending_step(spelled_interval(earlier, later));
}

}  // namespace cantus
