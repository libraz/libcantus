// How a chord symbol writes a pitch: ts/src/theory/symbol/spelling.ts.

#include "theory/symbol/spelling.h"

#include <cmath>
#include <utility>

#include "core/pitch/limits.gen.h"
#include "core/validation/validation.h"
#include "js/math.h"

namespace cantus {

namespace {

/** The two sides a black key is named from. */
MidiSpelling side_of(bool as_flat) { return as_flat ? MidiSpelling::kFlat : MidiSpelling::kSharp; }

}  // namespace

NoteData spelling_note(const PitchSpelling& spelling) {
  double letter = assert_integer(spelling.letter, "note.letter", 0, 6);
  double alter = assert_integer(spelling.alter, "note.alter", -MAX_NOTE_ALTER, MAX_NOTE_ALTER);
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), std::nullopt};
}

PitchSpelling bare_spelling(const NoteData& note) {
  return PitchSpelling{static_cast<double>(note.letter), static_cast<double>(note.alter)};
}

NoteData plain_spelling(int pc, bool as_flat) {
  NoteData note = midi_to_note(60 + pc, side_of(as_flat));
  return NoteData{note.letter, note.alter, std::nullopt};
}

std::string symbol_name(const NoteData& note, NoteNameSystem system) {
  NoteNameOptions opts;
  opts.system = system;
  std::string name = format_note(note, opts);
  // A German chord symbol capitalizes its root, whatever case the note name is written in.
  if (system == NoteNameSystem::kGerman && !name.empty() && name[0] >= 'a' && name[0] <= 'z') {
    name[0] = static_cast<char>(name[0] - 'a' + 'A');
  }
  return name;
}

bool is_written_spelling(const NoteData& spelling) {
  NoteData written = midi_to_note(60 + note_to_pitch_class(spelling), side_of(spelling.alter < 0));
  return written.letter == spelling.letter && written.alter == spelling.alter;
}

std::string pitch_class_name(int pc, const std::optional<NoteData>& hint, NoteNameSystem system,
                             std::optional<bool> flats, std::optional<bool> inherit_flats) {
  if (!flats && hint && note_to_pitch_class(*hint) == pc) {
    return symbol_name(*hint, system);
  }
  return symbol_name(plain_spelling(pc, flats.value_or(inherit_flats.value_or(false))), system);
}

bool on_accidental_side(const NoteData& spelling, std::optional<bool> flats) {
  return !flats || spelling.alter == 0 || (spelling.alter < 0) == *flats;
}

NoteData by_same_step(const NoteData& spelling, const NoteData& from, const NoteData& to) {
  NoteData moved = transpose_by_interval(spelling, spelled_interval(from, to));
  return NoteData{moved.letter, moved.alter, std::nullopt};
}

NoteData spelling_above(const NoteData& root, double letters, int pc) {
  int letter = static_cast<int>(js::floor_mod(root.letter + letters, 7));
  int natural = note_to_pitch_class(NoteData{static_cast<double>(letter), 0, std::nullopt});
  int alter = static_cast<int>(std::fmod(std::fmod(pc - natural, 12) + 18, 12)) - 6;
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), std::nullopt};
}

NoteData carried_bass(const NoteData& spelling, const NoteData& from, const NoteData& to,
                      bool as_flat, const std::function<bool(const NoteData&)>& is_own_spelling) {
  NoteData carried = by_same_step(spelling, from, to);
  return is_own_spelling(carried) || is_written_spelling(carried)
             ? carried
             : plain_spelling(note_to_pitch_class(carried), as_flat);
}

std::optional<NoteData> hint_for(const std::optional<PitchSpelling>& hint, int pc) {
  if (!hint) {
    return std::nullopt;
  }
  NoteData note = spelling_note(*hint);
  return note_to_pitch_class(note) == pc ? std::optional<NoteData>(note) : std::nullopt;
}

NoteData root_spelling_for(int pc, const std::optional<NoteData>& hint, std::optional<bool> flats) {
  return hint && on_accidental_side(*hint, flats) ? *hint
                                                  : plain_spelling(pc, flats.value_or(false));
}

}  // namespace cantus
