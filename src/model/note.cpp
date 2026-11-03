#include "cantus/model/note.h"

#include <cstdlib>

#include "cantus/core/validation.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/transposition.h"
#include "core/pitch/limits.gen.h"
#include "core/validation/validation.h"
#include "js/number.h"
#include "model/limits.gen.h"
#include "model/shared.h"

namespace cantus {

namespace {

const SpelledInterval kDiminishedSecondValue =
#include "model/diminished_second.gen.inc"
    ;

const SpelledInterval kDescendingDiminishedSecondValue =
#include "model/descending_diminished_second.gen.inc"
    ;

/**
 * A defensive copy of note data, with the letter checked: `equals` compares the letter directly,
 * so an unreduced one would make two notes that print alike compare unequal.
 */
NoteData copy_note(const NoteData& data) {
  if (data.letter < 0 || data.letter > 6) {
    throw InvalidInputError("note letter must be an integer in [0, 6]; received " +
                            js::to_string(data.letter));
  }
  NoteData copy{data.letter, data.alter, data.octave};
  // The alteration and octave bounds are the core pitch functions' own.
  note_to_pitch_class(copy);
  return copy;
}

/** The number a note is ordered by: the MIDI number with an octave, else the pitch class. */
int sounding_order(const NoteData& note) {
  return note.octave ? note_to_midi(note) : note_to_pitch_class(note);
}

/** Whether a letter name is one bare natural letter 'A'..'G'. */
bool is_natural_letter(std::string_view letter) {
  return letter.size() == 1 && letter[0] >= 'A' && letter[0] <= 'G';
}

}  // namespace

Note::Note(const NoteData& data) : data_(copy_note(data)) {}

Note Note::of(int letter, int alter, std::optional<double> octave) {
  return Note(NoteData{static_cast<double>(letter), static_cast<double>(alter), octave});
}

Note Note::of(std::string_view letter, int alter, std::optional<double> octave) {
  if (!is_natural_letter(letter)) {
    std::string shown = describe_rejected(json::Value(std::string(letter)));
    throw InvalidInputError(
        "Note.of takes a letter number 0..6 or a bare letter name 'C'..'B'; received " + shown +
        ". Use Note.parse(" + shown + ") to read a note name with an accidental or an octave.");
  }
  return of(try_parse_note(letter).unwrap().letter, alter, octave);
}

Note Note::parse(std::string_view text, const NoteNameOptions& opts) {
  return try_parse(text, opts).unwrap();
}

ParseResult<Note> Note::try_parse(std::string_view name, const NoteNameOptions& opts) {
  return map_parse<Note>(try_parse_note(name, opts),
                         [](const NoteData& data) { return Note(data); });
}

Note Note::from_midi(double midi, MidiSpelling spelling) {
  return Note(midi_to_note(midi, spelling));
}

Note Note::from_data(const NoteData& data) { return Note(data); }

Note Note::from_json(const NoteData& data) { return Note(data); }

std::string Note::name() const { return format_note(data_); }

std::string Note::format(const NoteNameOptions& opts) const { return format_note(data_, opts); }

int Note::pitch_class() const { return note_to_pitch_class(data_); }

int Note::midi() const {
  if (!data_.octave) {
    throw InvalidInputError("note " + name() + " has no octave, so it has no MIDI number");
  }
  return note_to_midi(data_);
}

double Note::frequency(const TuningTable& tuning) const { return frequency_of(midi(), tuning); }

double Note::frequency(const Tuning& tuning) const { return frequency(tuning.data()); }

Note Note::transpose(double semitones, const TransposeNoteOptions& opts) const {
  if (semitones == 0 && !opts.spelling) {
    return Note(data_);
  }
  return Note(transpose_note(data_, semitones, opts));
}

Interval Note::interval_to(const Note& other) const {
  return Interval::from_data(spelled_interval(data_, other.data()));
}

Note Note::transpose_by(const IntervalArg& interval) const {
  return Note(transpose_by_interval(data_, to_spelled_interval(interval)));
}

Note Note::with_octave(double octave) const {
  return Note(NoteData{data_.letter, data_.alter, octave});
}

Note Note::for_instrument(const IntervalArg& instrument) const {
  return Note(to_written_pitch(data_, instrument));
}

std::vector<Note> Note::enharmonic() const {
  std::vector<Note> out;
  for (const SpelledInterval* interval :
       {&kDiminishedSecondValue, &kDescendingDiminishedSecondValue}) {
    NoteData moved = transpose_by_interval(data_, *interval);
    if (std::abs(moved.alter) <= MAX_NAME_ACCIDENTALS) {
      out.emplace_back(moved);
    }
  }
  return out;
}

Nullable<int> Note::degree_in(const KeyArg& key) const {
  int degree = pitch_to_scale_degree(pitch_class(), key);
  // The scale function reports -1 for a pitch it does not contain; the class API says null.
  if (degree == -1) {
    return Nullable<int>(std::nullopt);
  }
  return Nullable<int>(degree);
}

int Note::compare_to(const Note& other) const {
  return sounding_order(data_) - sounding_order(other.data_);
}

bool Note::equals(const Note& other) const {
  return data_.letter == other.data_.letter && data_.alter == other.data_.alter &&
         data_.octave == other.data_.octave;
}

}  // namespace cantus
