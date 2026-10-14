/**
 * @file note.h
 * @brief Public C++ API of ts/src/model/note.ts: an immutable spelled note.
 */
#ifndef CANTUS_MODEL_NOTE_H_
#define CANTUS_MODEL_NOTE_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/nullable.h"
#include "cantus/core/pitch.h"
#include "cantus/core/tuning.h"
#include "cantus/model/interval.h"
#include "cantus/model/tuning.h"
#include "cantus/theory/scale.h"

namespace cantus {

/**
 * An immutable spelled note: a diatonic letter, a chromatic alteration and an optional octave
 * (`Note`). Every transformation returns a new instance.
 */
class Note {
 public:
  /**
   * Wrap note data (`new Note`); the data is copied.
   * @throws InvalidInputError if the letter is not in 0..6 or the alteration or octave is out of
   *   range.
   */
  explicit Note(const NoteData& data);

  /**
   * Build a note from its parts, reading no text (`Note.of`).
   * @param letter The diatonic letter, 0..6 for C..B.
   * @param alter The alteration in semitones.
   * @param octave The octave; absent for a bare pitch class.
   */
  static Note of(int letter, int alter = 0, std::optional<double> octave = std::nullopt);

  /**
   * As above with a bare natural letter name 'C'..'B'.
   * @throws InvalidInputError if the name carries an accidental or an octave.
   */
  static Note of(std::string_view letter, int alter = 0,
                 std::optional<double> octave = std::nullopt);

  /**
   * Parse a note name in any supported system (`Note.parse`).
   * @throws InvalidInputError if the text is not a note.
   */
  static Note parse(std::string_view text, const NoteNameOptions& opts = {});

  /** parse() reporting failure instead of throwing it (`Note.tryParse`). */
  static ParseResult<Note> try_parse(std::string_view name, const NoteNameOptions& opts = {});

  /** Name a MIDI number (middle C = C4 = 60) as a note (`Note.fromMidi`). */
  static Note from_midi(double midi, MidiSpelling spelling = MidiSpelling::kSharp);

  /** Wrap note data (`Note.fromData`). */
  static Note from_data(const NoteData& data);

  /** Rebuild a note from its `data()` (`Note.fromJSON`). */
  static Note from_json(const NoteData& data);

  /** The name in scientific pitch notation, English (`name`). */
  std::string name() const;

  /** The name written in a notation system (`format`). */
  std::string format(const NoteNameOptions& opts = {}) const;

  /** The pitch class, 0..11 (`pitchClass`). */
  int pitch_class() const;

  /**
   * The MIDI number (`midi`).
   * @throws InvalidInputError if the note has no octave.
   */
  int midi() const;

  /** The diatonic letter, 0..6. */
  int letter() const noexcept { return data_.letter; }

  /** The chromatic alteration in semitones. */
  int alter() const noexcept { return data_.alter; }

  /** The octave, or absent for a bare pitch class. */
  std::optional<double> octave() const noexcept { return data_.octave; }

  /** A copy of the underlying note data. */
  NoteData data() const { return data_; }

  /**
   * The frequency in Hz, the MIDI number read as a step of the tuning (`frequency`).
   * @throws InvalidInputError if the note has no octave or the frequency leaves the range of a
   *   number.
   */
  double frequency(const TuningTable& tuning = TWELVE_TET) const;

  /** frequency() under a Tuning. */
  double frequency(const Tuning& tuning) const;

  /** Transpose by semitones, keeping the spelling unless asked otherwise (`transpose`). */
  Note transpose(double semitones, const TransposeNoteOptions& opts = {}) const;

  /** The spelled interval from this note to another (`intervalTo`). */
  Interval interval_to(const Note& other) const;

  /** Transpose by a spelled interval, keeping the spelling it names (`transposeBy`). */
  Note transpose_by(const IntervalArg& interval) const;

  /**
   * The same spelled note in another octave (`withOctave`).
   * @throws InvalidInputError if the octave is out of range.
   */
  Note with_octave(double octave) const;

  /**
   * The note a transposing instrument must read to sound this one (`forInstrument`).
   * @param instrument A built-in instrument name, or an interval.
   * @throws InvalidInputError if the instrument is neither.
   */
  Note for_instrument(const IntervalArg& instrument) const;

  /** The same sounding pitch written on the letter above and below, within a double accidental. */
  std::vector<Note> enharmonic() const;

  /** The 1-based scale degree in a key, or null when the note is not in the scale (`degreeIn`). */
  Nullable<int> degree_in(const KeyArg& key) const;

  /** Order by sounding pitch, for sorting: negative, zero or positive (`compareTo`). */
  int compare_to(const Note& other) const;

  /** Whether another note has the same letter, alteration and octave. */
  bool equals(const Note& other) const;

  /** The name written in a notation system (`toString`). */
  std::string to_string(const NoteNameOptions& opts = {}) const { return format(opts); }

 private:
  NoteData data_;
};

}  // namespace cantus

#endif  // CANTUS_MODEL_NOTE_H_
