/**
 * @file pitch.h
 * @brief Public C++ API of ts/src/core/pitch: spelled notes, note-name systems and spelled
 *        intervals.
 *
 * A note is a diatonic letter (0 = C .. 6 = B), a chromatic alteration and an optional octave.
 * `letter` and `alter` are validated integers; `octave` is a `double` because midi_to_note() does
 * not bound it, so a note it returns may lie beyond the range every other entry point accepts.
 */
#ifndef CANTUS_CORE_PITCH_H_
#define CANTUS_CORE_PITCH_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <variant>

#include "cantus/core/errors.h"

namespace cantus {

/** A spelled note: a letter, an alteration and an optional octave (`Note`, exported `NoteData`). */
struct NoteData {
  /** Diatonic letter, 0..6 for C..B; a double so a -0 the caller wrote is kept. */
  double letter = 0;
  /** Semitones of alteration, -2 double flat .. +2 double sharp; a double so -0 is kept. */
  double alter = 0;
  /** Scientific pitch octave (middle C = C4); absent for a bare pitch class. */
  std::optional<double> octave;
};

/** A system of written note names (`NoteNameSystem`). */
enum class NoteNameSystem : std::uint8_t { kEnglish, kGerman, kJapanese, kItalian, kFixedDo };

/** The TS name of a system ("english", ..., "fixedDo"). */
std::string_view to_string(NoteNameSystem system);

/** The system named `name`, or nullopt. */
std::optional<NoteNameSystem> parse_note_name_system(std::string_view name);

/** Which system to read or write a name in (`NoteNameOptions`). */
struct NoteNameOptions {
  /** Detected from the name when parsing; English when formatting. */
  std::optional<NoteNameSystem> system;
};

/** The two modes a key name gives. */
enum class KeyNameMode : std::uint8_t { kMajor, kMinor };

/** The TS name of a mode ("major" or "minor"). */
std::string_view to_string(KeyNameMode mode);

/** The mode named `name`, or nullopt. */
std::optional<KeyNameMode> parse_key_name_mode(std::string_view name);

/** A key named the way a score names it: a spelled tonic and a mode (`KeyName`). */
struct KeyName {
  /** The spelled tonic, without an octave. */
  NoteData tonic;
  KeyNameMode mode = KeyNameMode::kMajor;
};

/** A spelled interval (`SpelledInterval`). */
struct SpelledInterval {
  /** Diatonic size: 1 = unison, 2 = second, 8 = octave, and beyond. */
  int number = 1;
  /** 'P', 'M', 'm', or repeated 'A' / 'd'. */
  std::string quality;
  /** Signed semitone distance from the first note to the second. */
  double semitones = 0;
  /** Whether the diatonic letters move down. */
  bool descending = false;
};

/** Plain interval data (`IntervalData`): a spelled interval whose direction may be left out. */
struct IntervalData {
  int number = 1;
  std::string quality;
  double semitones = 0;
  /** Read from the span and the quality when absent. */
  std::optional<bool> descending;
};

/**
 * Anything that names a note (`NoteLike`): a note name, a MIDI number, spelled note data, or any
 * value whose `data()` returns spelled note data.
 */
class NoteArg {
 public:
  /** The forms a NoteArg holds. */
  using Value = std::variant<std::string, double, NoteData>;

  NoteArg(std::string name) : value_(std::move(name)) {}         // NOLINT
  NoteArg(std::string_view name) : value_(std::string(name)) {}  // NOLINT
  NoteArg(const char* name) : value_(std::string(name)) {}       // NOLINT
  NoteArg(double midi) : value_(midi) {}                         // NOLINT
  NoteArg(int midi) : value_(static_cast<double>(midi)) {}       // NOLINT
  NoteArg(NoteData note) : value_(std::move(note)) {}            // NOLINT
  /** A value whose `data()` returns note data. */
  template <class T, std::enable_if_t<
                         std::is_convertible_v<decltype(std::declval<const T&>().data()), NoteData>,
                         int> = 0>
  NoteArg(const T& value) : value_(NoteData(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/**
 * Anything that names an interval (`IntervalLike`): a name such as "P5", interval data, or any
 * value whose `data()` returns interval data.
 */
class IntervalArg {
 public:
  /** The forms an IntervalArg holds. */
  using Value = std::variant<std::string, IntervalData>;

  IntervalArg(std::string name) : value_(std::move(name)) {}         // NOLINT
  IntervalArg(std::string_view name) : value_(std::string(name)) {}  // NOLINT
  IntervalArg(const char* name) : value_(std::string(name)) {}       // NOLINT
  IntervalArg(IntervalData data) : value_(std::move(data)) {}        // NOLINT
  IntervalArg(const SpelledInterval& interval)                       // NOLINT
      : value_(IntervalData{interval.number, interval.quality, interval.semitones,
                            interval.descending}) {}
  /** A value whose `data()` returns interval data. */
  template <
      class T,
      std::enable_if_t<
          std::is_convertible_v<decltype(std::declval<const T&>().data()), IntervalData>, int> = 0>
  IntervalArg(const T& value) : value_(IntervalData(value.data())) {}  // NOLINT
  /** A value whose `data()` returns a spelled interval (the Interval class). */
  template <
      class T,
      std::enable_if_t<
          !std::is_convertible_v<decltype(std::declval<const T&>().data()), IntervalData> &&
              std::is_convertible_v<decltype(std::declval<const T&>().data()), SpelledInterval>,
          int> = 0>
  IntervalArg(const T& value) : IntervalArg(SpelledInterval(value.data())) {}  // NOLINT

  /** The form this argument holds. */
  const Value& value() const noexcept { return value_; }

 private:
  Value value_;
};

/** The two ways midi_to_note() spells a black key (the TS literals 'sharp' and 'flat'). */
enum class MidiSpelling : std::uint8_t { kSharp, kFlat };

/** The TS name of a spelling ("sharp" or "flat"). */
std::string_view to_string(MidiSpelling spelling);

/** The spelling named `name`, or nullopt. */
std::optional<MidiSpelling> parse_midi_spelling(std::string_view name);

/** Options of transpose_note(). */
struct TransposeNoteOptions {
  /** Spell the result from its MIDI number instead of by letter distance. */
  std::optional<MidiSpelling> spelling;
};

/**
 * Reduce a MIDI pitch, a pitch class or a signed offset to a pitch class in [0, 11]; a fraction
 * is rounded to the nearest semitone first (`pitchClassOf`).
 * @throws InvalidInputError if `value` is not finite.
 */
int pitch_class_of(double value);

/** Reduce a letter number or offset to a diatonic letter in [0, 6] (`diatonicLetterOf`). */
int diatonic_letter_of(double value);

/** The pitch class of a diatonic letter with no accidental (`naturalPitchClassOf`). */
int natural_pitch_class_of(double letter);

/**
 * Parse a note name in any supported system (`parseNote`).
 * @throws InvalidInputError if the text is not a note in the given or detected system.
 */
NoteData parse_note(std::string_view text, const NoteNameOptions& opts = {});

/** parse_note() reporting failure instead of throwing it (`tryParseNote`). */
ParseResult<NoteData> try_parse_note(std::string_view text, const NoteNameOptions& opts = {});

/** Render a note as a name, English by default (`formatNote`). */
std::string format_note(const NoteData& note, const NoteNameOptions& opts = {});

/**
 * Parse a key name such as "C major" or "gis moll" (`parseKeyName`).
 * @throws InvalidInputError if the text is not a key name, mixes systems, or carries an octave.
 */
KeyName parse_key_name(std::string_view text, const NoteNameOptions& opts = {});

/** parse_key_name() reporting failure instead of throwing it (`tryParseKeyName`). */
ParseResult<KeyName> try_parse_key_name(std::string_view text, const NoteNameOptions& opts = {});

/** Render a spelled tonic and a mode as a key name (`formatKeyName`). */
std::string format_key_name(const KeyName& key, const NoteNameOptions& opts = {});

/**
 * The notation system a note name or key name is written in (`detectNoteNameSystem`).
 * @throws InvalidInputError if no system reads the name, or it mixes two.
 */
NoteNameSystem detect_note_name_system(std::string_view text);

/** Pitch class (0..11) of a note, ignoring the octave (`noteToPitchClass`). */
int note_to_pitch_class(const NoteData& note);

/**
 * MIDI number of a note (`noteToMidi`).
 * @throws InvalidInputError if the note has no octave.
 */
int note_to_midi(const NoteData& note);

/** The note spelling a MIDI number; a fraction is rounded (`midiToNote`). */
NoteData midi_to_note(double midi, MidiSpelling spelling = MidiSpelling::kSharp);

/** Move a note by semitones, spelling by letter distance unless asked otherwise (`transposeNote`).
 */
NoteData transpose_note(const NoteData& note, double semitones,
                        const TransposeNoteOptions& opts = {});

/**
 * Semitone span of a diatonic number and a quality (`intervalSemitones`).
 * @throws InvalidInputError if the quality does not fit the number.
 */
int interval_semitones(int number, std::string_view quality);

/**
 * Parse an interval name such as "P5" or "-m3" (`parseInterval`).
 * @throws InvalidInputError if the text is not an interval name.
 */
SpelledInterval parse_interval(std::string_view name);

/** parse_interval() reporting failure instead of throwing it (`tryParseInterval`). */
ParseResult<SpelledInterval> try_parse_interval(std::string_view name);

/** Resolve an interval name or data to a validated spelled interval (`toSpelledInterval`). */
SpelledInterval to_spelled_interval(const IntervalArg& value);

/** Resolve a note name, MIDI number or note data to validated note data (`toNoteData`). */
NoteData to_note_data(const NoteArg& value);

/** Apply a spelled interval to a note, keeping its spelling (`transposeByInterval`). */
NoteData transpose_by_interval(const NoteArg& given, const IntervalArg& named);

/** The spelled interval from `a` to `b` (`spelledInterval`). */
SpelledInterval spelled_interval(const NoteData& a, const NoteData& b);

}  // namespace cantus

#endif  // CANTUS_CORE_PITCH_H_
