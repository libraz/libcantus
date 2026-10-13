// Pitch spelling of ts/src/core/pitch/index.ts: notes, enharmonic-aware conversion and spelled
// intervals.

#include "core/pitch/pitch.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

#include "cantus/core/validation.h"
#include "core/errors/errors.h"
#include "core/pitch/naming.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"

namespace cantus {

namespace {

/** A generated SPELLINGS entry: a letter and an alteration. */
struct SpellingEntry {
  int letter;
  int alter;
};

/** A generated SPELLINGS row: the spelling name and the entry of each pitch class. */
struct SpellingRow {
  std::string_view name;
  SpellingEntry entries[12];
};

constexpr std::array<int, 7> kLetterSemitones = {
#include "core/pitch/letter_semitones.gen.inc"
};
constexpr std::array<SpellingRow, 2> kSpellings = {
#include "core/pitch/spellings.gen.inc"
};
constexpr std::array<int, 12> kLetterStepsBySemitone = {
#include "core/pitch/letter_steps_by_semitone.gen.inc"
};
constexpr std::array<int, 8> kSimpleReference = {
#include "core/pitch/simple_reference.gen.inc"
};

/** Reduce any integer to a pitch class in [0, 11] (`mod12`). */
int mod12(double value) { return pitch_class_of(value); }

/** Reduce any integer to [0, 7) (`mod7`). */
int mod7(double value) { return diatonic_letter_of(value); }

/** The semitone offset of a natural letter. */
int letter_semitones(int letter) { return kLetterSemitones[static_cast<std::size_t>(letter)]; }

/** The note without its octave (`bareOf`). */
NoteData bare_of(const NoteData& note) { return NoteData{note.letter, note.alter, std::nullopt}; }

/** Shortest signed alteration taking a letter's natural pitch class to `pc` (`alterFor`). */
double alter_for(int natural, int pc) {
  int d = mod12(pc - natural);
  return d > 6 ? d - 12 : d;
}

/** Whether a simple diatonic number (1..7 within an octave) is a perfect kind. */
bool is_perfect_number(int simple_number) {
  return simple_number == 1 || simple_number == 4 || simple_number == 5;
}

/** The diatonic octaves and the simple number of a diatonic number. */
struct SimpleNumber {
  int octaves;
  int simple;
  int reference;
};

SimpleNumber split_number(int number) {
  int octaves = (number - 1) / 7;
  int simple = number - 7 * octaves;
  return {octaves, simple, kSimpleReference[static_cast<std::size_t>(simple)] + 12 * octaves};
}

/** `glyph` repeated `count` times, at most MAX_NOTE_ALTER * 2 in all (`repeat`). */
std::string repeat_quality(char glyph, double count) {
  auto length = static_cast<std::size_t>(js::min(count, MAX_NOTE_ALTER * 2));
  return std::string(length, glyph);
}

/** Quality label from a diatonic number and its actual semitone span (`qualityFromSpan`). */
std::string quality_from_span(int number, double semitones) {
  SimpleNumber parts = split_number(number);
  double delta = semitones - parts.reference;
  if (is_perfect_number(parts.simple)) {
    if (delta == 0) {
      return "P";
    }
    return delta > 0 ? repeat_quality('A', delta) : repeat_quality('d', -delta);
  }
  if (delta == 0) {
    return "M";
  }
  if (delta == -1) {
    return "m";
  }
  return delta > 0 ? repeat_quality('A', delta) : repeat_quality('d', -delta - 1);
}

/** Whether the letters of interval data move down (`isDescendingInterval`). */
bool is_descending_interval(const IntervalData& interval) {
  if (interval.descending) {
    return *interval.descending;
  }
  double span = js::round(interval.semitones);
  if (quality_from_span(interval.number, span) == interval.quality) {
    return interval.number == 1 && span < 0;
  }
  return span != 0;
}

/** Validate plain interval data and return it in the canonical shape (`normalizedInterval`). */
SpelledInterval normalized_interval(const IntervalData& data) {
  assert_integer(data.number, "interval.number", 1);
  assert_finite_number(data.semitones, "interval.semitones");
  // A name covers exactly two spans, the ascending one and its negation.
  int expected = interval_semitones(data.number, data.quality);
  if (std::fabs(data.semitones) != std::fabs(static_cast<double>(expected))) {
    throw InvalidInputError(data.quality + js::to_string(data.number) + " spans " +
                            js::to_string(expected) + " semitones; received " +
                            js::to_string(data.semitones));
  }
  return SpelledInterval{data.number, data.quality, data.semitones, is_descending_interval(data)};
}

/** Diatonic ladder index of a note (letter + 7 * octave when octave-bearing). */
double diatonic_index(const NoteData& note) {
  return mod7(note.letter) + 7 * note.octave.value_or(0);
}

/**
 * The note `steps` semitones from `note`, with its letter moved to `absolute_letter`
 * (the tail shared by `transposeNote` and `transposeByInterval`).
 */
NoteData land_on_letter(const NoteData& note, double absolute_letter, double steps) {
  int letter = mod7(absolute_letter);
  int natural = letter_semitones(letter);
  if (!note.octave) {
    return assert_note_values(letter, alter_for(natural, mod12(note_to_pitch_class(note) + steps)),
                              std::nullopt, "transposed note");
  }
  double octave = *note.octave + std::floor(absolute_letter / 7);
  // The same domain this module requires of a note it is given.
  return assert_note_values(letter, note_to_midi(note) + steps - ((octave + 1) * 12 + natural),
                            octave, "transposed note");
}

/** `^\s*` already removed: the interval-name grammar (an optional descent marker, a quality, a
 * number). */
struct IntervalName {
  bool descending;
  std::string quality;
  std::string digits;
};

/** Match an interval name against `^(-?)(P|M|m|A+|d+)(\d+)$`, or nullopt. */
std::optional<IntervalName> match_interval_name(const std::u16string& text) {
  std::size_t i = 0;
  IntervalName out{false, {}, {}};
  if (i < text.size() && text[i] == u'-') {
    out.descending = true;
    ++i;
  }
  if (i >= text.size()) {
    return std::nullopt;
  }
  char16_t first = text[i];
  if (first == u'P' || first == u'M' || first == u'm') {
    out.quality.push_back(static_cast<char>(first));
    ++i;
  } else if (first == u'A' || first == u'd') {
    for (; i < text.size() && text[i] == first; ++i) {
      out.quality.push_back(static_cast<char>(first));
    }
  } else {
    return std::nullopt;
  }
  std::size_t digits = i;
  for (; i < text.size() && text[i] >= u'0' && text[i] <= u'9'; ++i) {
    out.digits.push_back(static_cast<char>(text[i]));
  }
  if (i == digits || i != text.size()) {
    return std::nullopt;
  }
  return out;
}

}  // namespace

NoteData assert_note_values(double letter, double alter, std::optional<double> octave,
                            std::string_view name) {
  NoteData note;
  note.letter = static_cast<int>(assert_integer(letter, join_name(name, ".letter"), 0, 6));
  note.alter = static_cast<int>(
      assert_integer(alter, join_name(name, ".alter"), -MAX_NOTE_ALTER, MAX_NOTE_ALTER));
  if (octave) {
    note.octave = assert_integer(*octave, join_name(name, ".octave"), -MAX_OCTAVE, MAX_OCTAVE);
  }
  return note;
}

const NoteData& assert_note(const NoteData& note, std::string_view name) {
  assert_note_values(note.letter, note.alter, note.octave, name);
  return note;
}

int pitch_class_of(double value) {
  assert_finite_number(value, "pitch");
  return static_cast<int>(std::fmod(std::fmod(js::round(value), 12) + 12, 12));
}

int diatonic_letter_of(double value) {
  assert_finite_number(value, "diatonic letter");
  return static_cast<int>(std::fmod(std::fmod(js::round(value), 7) + 7, 7));
}

int natural_pitch_class_of(double letter) { return letter_semitones(diatonic_letter_of(letter)); }

std::string_view to_string(MidiSpelling spelling) {
  return kSpellings[static_cast<std::size_t>(spelling)].name;
}

std::optional<MidiSpelling> parse_midi_spelling(std::string_view name) {
  for (std::size_t i = 0; i < kSpellings.size(); ++i) {
    if (kSpellings[i].name == name) {
      return static_cast<MidiSpelling>(i);
    }
  }
  return std::nullopt;
}

ParseResult<NoteData> try_parse_note(std::string_view text, const NoteNameOptions& opts) {
  try {
    NoteData note = read_note_name(text, opts);
    assert_note(note, "note " + std::string(text));
    return ParseResult<NoteData>::success(std::move(note));
  } catch (...) {
    return parse_failure<NoteData>();
  }
}

NoteData parse_note(std::string_view text, const NoteNameOptions& opts) {
  return try_parse_note(text, opts).unwrap();
}

std::string format_note(const NoteData& note, const NoteNameOptions& opts) {
  assert_note(note, "note");
  return write_note_name(NoteData{mod7(note.letter), note.alter, note.octave}, opts);
}

ParseResult<KeyName> try_parse_key_name(std::string_view text, const NoteNameOptions& opts) {
  try {
    KeyName key = read_key_name(text, opts);
    assert_note(key.tonic, "key " + std::string(text));
    return ParseResult<KeyName>::success(std::move(key));
  } catch (...) {
    return parse_failure<KeyName>();
  }
}

KeyName parse_key_name(std::string_view text, const NoteNameOptions& opts) {
  return try_parse_key_name(text, opts).unwrap();
}

std::string format_key_name(const KeyName& key, const NoteNameOptions& opts) {
  assert_note(key.tonic, "key.tonic");
  return write_key_name(
      KeyName{NoteData{mod7(key.tonic.letter), key.tonic.alter, std::nullopt}, key.mode}, opts);
}

int note_to_pitch_class(const NoteData& note) {
  assert_note(note, "note");
  int natural = letter_semitones(mod7(note.letter));
  return mod12(natural + note.alter);
}

int note_to_midi(const NoteData& note) {
  assert_note(note, "note");
  if (!note.octave) {
    throw InvalidInputError("noteToMidi requires an octave");
  }
  int natural = letter_semitones(mod7(note.letter));
  return static_cast<int>((*note.octave + 1) * 12 + natural + note.alter);
}

NoteData midi_to_note(double midi, MidiSpelling spelling) {
  assert_finite_number(midi, "midi");
  double rounded = js::round(midi);
  int pc = mod12(rounded);
  double octave = std::floor(rounded / 12) - 1;
  const SpellingEntry& entry = kSpellings[static_cast<std::size_t>(spelling)].entries[pc];
  return NoteData{entry.letter, entry.alter, octave};
}

NoteData transpose_note(const NoteData& note, double semitones, const TransposeNoteOptions& opts) {
  assert_note(note, "note");
  if (!std::isfinite(semitones)) {
    throw InvalidInputError("semitones must be a finite number; received " +
                            js::to_string(semitones));
  }
  double steps = js::round(semitones);
  if (opts.spelling) {
    return note.octave ? midi_to_note(note_to_midi(note) + steps, *opts.spelling)
                       : bare_of(midi_to_note(60 + mod12(note_to_pitch_class(note) + steps),
                                              *opts.spelling));
  }
  double direction = steps < 0 ? -1 : 1;
  double magnitude = std::fabs(steps);
  double octaves = std::floor(magnitude / 12);
  double within_octave = std::fmod(magnitude, 12);
  // Descending motion reverses the conventional ascending letter distance.
  double letter_steps =
      direction * (kLetterStepsBySemitone[static_cast<std::size_t>(within_octave)] + 7 * octaves);
  return land_on_letter(note, mod7(note.letter) + letter_steps, steps);
}

int interval_semitones(int number, std::string_view quality) {
  assert_integer(number, "interval number", 1, MAX_INTERVAL_NUMBER);
  SimpleNumber parts = split_number(number);
  bool perfect = is_perfect_number(parts.simple);
  if (quality == "P" || quality == "M") {
    if (perfect != (quality == "P")) {
      throw InvalidInputError("an interval of " + js::to_string(number) + " cannot be " +
                              (quality == "P" ? "perfect" : "major"));
    }
    return parts.reference;
  }
  if (quality == "m") {
    if (perfect) {
      throw InvalidInputError("a perfect-class interval cannot be minor; received " +
                              js::to_string(number));
    }
    return parts.reference - 1;
  }
  auto all_of = [&quality](char glyph) {
    return !quality.empty() && quality.find_first_not_of(glyph) == std::string_view::npos;
  };
  if (all_of('A')) {
    return parts.reference + static_cast<int>(js::utf16_length(quality));
  }
  if (all_of('d')) {
    if (number == 1) {
      // The letters do not move in a unison, so narrowing one takes it past zero and back up
      // the other side: C down to Cb is a descending augmented unison.
      throw InvalidInputError(
          "a unison cannot be diminished; a unison narrowed by a semitone descends, so name it '-" +
          std::string(js::utf16_length(quality), 'A') + "1'");
    }
    // The span keeps its sign: narrowing a second past zero leaves the letters ascending while
    // the pitch falls.
    return parts.reference - static_cast<int>(js::utf16_length(quality)) - (perfect ? 0 : 1);
  }
  throw InvalidInputError("unknown interval quality " +
                          describe_rejected(json::Value(std::string(quality))));
}

ParseResult<SpelledInterval> try_parse_interval(std::string_view name) {
  try {
    std::u16string units = js::to_utf16(name);
    std::size_t begin = 0;
    std::size_t end = units.size();
    while (begin < end && js::is_space(units[begin])) {
      ++begin;
    }
    while (end > begin && js::is_space(units[end - 1])) {
      --end;
    }
    std::optional<IntervalName> match = match_interval_name(units.substr(begin, end - begin));
    double number = match ? js::number(match->digits) : std::nan("");
    if (!match || !std::isfinite(number)) {
      throw InvalidInputError(
          "interval must be a quality followed by a number, such as 'P5'; received " +
          describe_rejected(json::Value(std::string(name))));
    }
    // A number beyond the interval range is refused before it is narrowed.
    assert_integer(number, "interval number", 1, MAX_INTERVAL_NUMBER);
    int span = interval_semitones(static_cast<int>(number), match->quality);
    if (!match->descending) {
      return ParseResult<SpelledInterval>::success(SpelledInterval{
          static_cast<int>(number), match->quality, static_cast<double>(span), false});
    }
    // Negating a zero span yields -0, which would leak into every equality check downstream.
    return ParseResult<SpelledInterval>::success(
        SpelledInterval{static_cast<int>(number), match->quality,
                        span == 0 ? 0 : -static_cast<double>(span), true});
  } catch (...) {
    return parse_failure<SpelledInterval>();
  }
}

SpelledInterval parse_interval(std::string_view name) { return try_parse_interval(name).unwrap(); }

SpelledInterval to_spelled_interval(const IntervalArg& value) {
  if (const auto* name = std::get_if<std::string>(&value.value())) {
    return parse_interval(*name);
  }
  return normalized_interval(std::get<IntervalData>(value.value()));
}

NoteData to_note_data(const NoteArg& value) {
  if (const auto* name = std::get_if<std::string>(&value.value())) {
    return parse_note(*name);
  }
  if (const auto* midi = std::get_if<double>(&value.value())) {
    // A MIDI note number, and only that: a fractional or off-compass value spells a note outside
    // the domain every other entry point requires.
    return midi_to_note(assert_midi_pitch(*midi, "note"));
  }
  const NoteData& note = assert_note(std::get<NoteData>(value.value()), "note");
  // A fresh object, so a caller's own note cannot become library state.
  return NoteData{note.letter, note.alter, note.octave};
}

NoteData transpose_by_interval(const NoteArg& given, const IntervalArg& named) {
  NoteData note = to_note_data(given);
  SpelledInterval interval = to_spelled_interval(named);
  // The bound `spelled_interval` uses: past it the letter arithmetic answers with a note no other
  // entry point accepts.
  assert_integer(interval.number, "interval.number", 1, MAX_INTERVAL_NUMBER);
  assert_finite_number(interval.semitones, "interval.semitones");
  double letter_steps = (interval.number - 1) * (interval.descending ? -1 : 1);
  double absolute_letter = mod7(note.letter) + letter_steps;
  return land_on_letter(note, absolute_letter, js::round(interval.semitones));
}

SpelledInterval spelled_interval(const NoteData& a, const NoteData& b) {
  assert_note(a, "a");
  assert_note(b, "b");
  // One note with an octave and one without has no defined answer.
  if (a.octave.has_value() != b.octave.has_value()) {
    throw InvalidInputError(
        "spelledInterval needs both notes to carry an octave or neither to; received one of each");
  }
  double letter_steps = 0;
  double semitones = 0;
  if (a.octave && b.octave) {
    letter_steps = diatonic_index(b) - diatonic_index(a);
    // Signed pitch distance from a to b, so a note below a yields a negative span.
    semitones = note_to_midi(b) - note_to_midi(a);
  } else {
    letter_steps = mod7(b.letter - a.letter);
    double raw_semis = mod12(note_to_pitch_class(b) - note_to_pitch_class(a));
    // Lift the chromatic span into the octave nearest the diatonic reference so wraparound
    // intervals stay consistent with the diatonic number instead of collapsing modulo 12.
    int reference = kSimpleReference[static_cast<std::size_t>(letter_steps + 1)];
    if (reference - raw_semis > 6) {
      raw_semis += 12;
    } else if (raw_semis - reference > 6) {
      raw_semis -= 12;
    }
    semitones = raw_semis;
  }
  auto number = static_cast<int>(std::fabs(letter_steps)) + 1;
  // The span is measured in the direction the letters move, not as a magnitude; a unison has no
  // direction, so its quality names the chromatic alteration alone.
  double directed_span = letter_steps == 0  ? std::fabs(semitones)
                         : letter_steps > 0 ? semitones
                                            : -semitones;
  return SpelledInterval{number, quality_from_span(number, directed_span), semitones,
                         letter_steps < 0 || (letter_steps == 0 && semitones < 0)};
}

}  // namespace cantus
