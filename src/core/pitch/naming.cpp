// Note-name notation systems of ts/src/core/pitch/naming.ts.
//
// Names are read as UTF-16 code units, as TS reads them. Lower-casing is ASCII only: a character
// that lower-cases to something else matches no letter, affix or mode word of any table, and the
// only one that lower-cases into ASCII (the Kelvin sign) lands on a letter no table uses.

#include "core/pitch/naming.h"

#include <array>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/validation/validation.h"
#include "js/number.h"
#include "js/utf16.h"

namespace cantus {

namespace {

using Text = std::u16string;
using View = std::u16string_view;

/** A generated MAX_LETTER_LENGTH / MAX_ACCIDENTAL_LENGTH row. */
struct NamedLength {
  std::string_view table;
  int length;
};

/** The mode words of one table. */
struct ModeWords {
  std::string_view major;
  std::string_view minor;
};

/** A generated MODE_WORDS row. */
struct ModeWordsRow {
  std::string_view table;
  ModeWords words;
};

/** The accidental marks or words of one table. */
struct MarkWords {
  std::string_view sharp;
  std::string_view flat;
  std::string_view doubled;
};

/** The generated ACCIDENTAL_WORDS record. */
struct AccidentalWords {
  MarkWords japanese;
  MarkWords italian;
};

constexpr std::size_t kLetterCount = 7;

constexpr std::array<std::string_view, 5> kNoteNameSystemNames = {
#include "core/pitch/note_name_systems.gen.inc"
};
static_assert(!kNoteNameSystemNames.back().empty() &&
                  kNoteNameSystemNames.size() ==
                      static_cast<std::size_t>(NoteNameSystem::kFixedDo) + 1,
              "NOTE_NAME_SYSTEMS and NoteNameSystem disagree");

constexpr std::array<std::string_view, 4> kDetectionOrderNames = {
#include "core/pitch/detection_order.gen.inc"
};
constexpr std::array<std::string_view, kLetterCount> kEnglishLetters = {
#include "core/pitch/english_letters.gen.inc"
};
constexpr std::array<std::string_view, kLetterCount> kGermanLetters = {
#include "core/pitch/german_letters.gen.inc"
};
constexpr std::array<std::string_view, kLetterCount> kJapaneseLetters = {
#include "core/pitch/japanese_letters.gen.inc"
};
constexpr std::array<std::string_view, kLetterCount> kItalianLetters = {
#include "core/pitch/italian_letters.gen.inc"
};
constexpr std::array<int, 2> kGermanElidingLetters = {
#include "core/pitch/german_eliding_letters.gen.inc"
};
constexpr std::array<ModeWordsRow, 4> kModeWords = {
#include "core/pitch/mode_words.gen.inc"
};
constexpr std::array<NamedLength, 4> kMaxLetterLength = {
#include "core/pitch/max_letter_length.gen.inc"
};
constexpr std::array<NamedLength, 4> kMaxAccidentalLength = {
#include "core/pitch/max_accidental_length.gen.inc"
};
constexpr AccidentalWords kAccidentalWords =
#include "core/pitch/accidental_words.gen.inc"
    ;

/** The table a system reads from: fixed-do names are the Italian syllables (`tableOf`). */
NoteNameSystem table_of(NoteNameSystem system) {
  return system == NoteNameSystem::kFixedDo ? NoteNameSystem::kItalian : system;
}

/** The systems auto-detection chooses between, in precedence order (`DETECTION_ORDER`). */
const std::vector<NoteNameSystem>& detection_order() {
  static const std::vector<NoteNameSystem> order = [] {
    std::vector<NoteNameSystem> out;
    for (std::string_view name : kDetectionOrderNames) {
      out.push_back(*parse_note_name_system(name));
    }
    return out;
  }();
  return order;
}

Text utf16(std::string_view s) { return js::to_utf16(s); }

/** The mode word a table writes for a mode (`MODE_WORDS[table][mode]`). */
std::string_view mode_word(NoteNameSystem table, KeyNameMode mode) {
  std::string_view name = to_string(table);
  for (const ModeWordsRow& row : kModeWords) {
    if (row.table == name) {
      return mode == KeyNameMode::kMajor ? row.words.major : row.words.minor;
    }
  }
  return {};
}

/** The value a NamedLength table gives for a table. */
int named_length(const std::array<NamedLength, 4>& rows, NoteNameSystem table) {
  std::string_view name = to_string(table);
  for (const NamedLength& row : rows) {
    if (row.table == name) {
      return row.length;
    }
  }
  return 0;
}

const MarkWords& marks_of(NoteNameSystem table) {
  return table == NoteNameSystem::kJapanese ? kAccidentalWords.japanese : kAccidentalWords.italian;
}

/** The letter number of a glyph in a letter table, or -1. */
int letter_index(const std::array<std::string_view, kLetterCount>& letters, View glyph) {
  Text target(glyph);
  for (std::size_t i = 0; i < letters.size(); ++i) {
    if (utf16(letters[i]) == target) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

/** Trim and collapse internal white space, so "do  diesis" reads as one name (`normalize`). */
Text normalize(std::string_view text) {
  Text units = js::to_utf16(text);
  std::size_t begin = 0;
  std::size_t end = units.size();
  while (begin < end && js::is_space(units[begin])) {
    ++begin;
  }
  while (end > begin && js::is_space(units[end - 1])) {
    --end;
  }
  Text out;
  for (std::size_t i = begin; i < end; ++i) {
    if (js::is_space(units[i])) {
      out.push_back(u' ');
      while (i + 1 < end && js::is_space(units[i + 1])) {
        ++i;
      }
    } else {
      out.push_back(units[i]);
    }
  }
  return out;
}

/** ASCII lower-casing; see the note at the top of the file. */
Text ascii_lower(View text) {
  Text out(text);
  for (char16_t& unit : out) {
    if (unit >= u'A' && unit <= u'Z') {
      unit = static_cast<char16_t>(unit - u'A' + u'a');
    }
  }
  return out;
}

bool is_digit(char16_t unit) { return unit >= u'0' && unit <= u'9'; }

bool starts_with(View text, View prefix) { return text.substr(0, prefix.size()) == prefix; }

bool ends_with(View text, View suffix) {
  return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
}

/** `Number.parseInt` of a run of units read as an octave, `-0` read as 0 (`octaveOf`). */
double octave_of(View digits) {
  double octave = js::parse_int(js::from_utf16(digits), 10);
  return octave == 0 ? 0 : octave;
}

/** Read an English name, or nullopt when the text is not one (`parseEnglish`). */
std::optional<NoteData> parse_english(View text) {
  if (text.empty()) {
    return std::nullopt;
  }
  char16_t first = text[0];
  bool upper = first >= u'A' && first <= u'G';
  bool lower = first >= u'a' && first <= u'g';
  if (!upper && !lower) {
    return std::nullopt;
  }
  char16_t glyph = lower ? static_cast<char16_t>(first - u'a' + u'A') : first;
  std::size_t i = 1;
  int alter = 0;
  // The accidentals are a run of sharps (# or x) or a run of flats, never a mix.
  if (i < text.size() && (text[i] == u'#' || text[i] == u'x')) {
    for (; i < text.size() && (text[i] == u'#' || text[i] == u'x'); ++i) {
      alter += text[i] == u'#' ? 1 : 2;
    }
  } else {
    for (; i < text.size() && text[i] == u'b'; ++i) {
      alter -= 1;
    }
  }
  std::optional<double> octave;
  if (i < text.size()) {
    std::size_t digits = i + (text[i] == u'-' ? 1 : 0);
    std::size_t end = digits;
    while (end < text.size() && is_digit(text[end])) {
      ++end;
    }
    if (end == digits || end != text.size()) {
      return std::nullopt;
    }
    octave = octave_of(text.substr(i));
  }
  int letter = letter_index(kEnglishLetters, View(&glyph, 1));
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), octave};
}

/** Write an English name, without its octave (`formatEnglish`). */
std::string format_english(const NoteData& note) {
  std::string glyph(kEnglishLetters[static_cast<std::size_t>(note.letter)]);
  if (note.alter > 0) {
    return glyph + std::string(static_cast<std::size_t>(note.alter), '#');
  }
  return note.alter < 0 ? glyph + std::string(static_cast<std::size_t>(-note.alter), 'b') : glyph;
}

bool is_eliding_letter(int letter) {
  for (int eliding : kGermanElidingLetters) {
    if (eliding == letter) {
      return true;
    }
  }
  return false;
}

/** How many flats a German flat suffix carries, or nullopt when it is not one (`germanFlats`). */
std::optional<int> german_flats(int letter, View suffix) {
  View rest = suffix;
  if (is_eliding_letter(letter) && starts_with(rest, u"s")) {
    rest.remove_prefix(1);
  } else if (starts_with(rest, u"es")) {
    rest.remove_prefix(2);
  } else {
    return std::nullopt;
  }
  int flats = 1;
  while (!rest.empty()) {
    if (starts_with(rest, u"es") || (letter == A_LETTER && starts_with(rest, u"as"))) {
      rest.remove_prefix(2);
      flats += 1;
    } else {
      return std::nullopt;
    }
  }
  return flats;
}

/** Whether `text` is one or more "is" (`/^(?:is)+$/`). */
bool is_sharp_suffix(View text) {
  if (text.empty() || text.size() % 2 != 0) {
    return false;
  }
  for (std::size_t i = 0; i < text.size(); i += 2) {
    if (text[i] != u'i' || text[i + 1] != u's') {
      return false;
    }
  }
  return true;
}

/** Read a German name, or nullopt when the text is not one (`parseGerman`). */
std::optional<NoteData> parse_german(View text) {
  Text lower = ascii_lower(text);
  // B alone is the B flat; every other name on that letter is written on H.
  if (lower == u"b") {
    return NoteData{B_LETTER, -1, std::nullopt};
  }
  int letter = letter_index(kGermanLetters, View(lower).substr(0, 1));
  if (letter < 0) {
    return std::nullopt;
  }
  View suffix = View(lower).substr(1);
  if (suffix.empty()) {
    return NoteData{static_cast<double>(letter), 0, std::nullopt};
  }
  if (is_sharp_suffix(suffix)) {
    // Each sharp is two letters ("is").
    const std::size_t sharps = suffix.size() / 2;
    return NoteData{static_cast<double>(letter), static_cast<double>(sharps), std::nullopt};
  }
  std::optional<int> flats = german_flats(letter, suffix);
  if (!flats) {
    return std::nullopt;
  }
  return NoteData{static_cast<double>(letter), static_cast<double>(-*flats), std::nullopt};
}

/** Write a German name, without its octave (`formatGerman`). */
std::string format_german(const NoteData& note) {
  std::string glyph(kGermanLetters[static_cast<std::size_t>(note.letter)]);
  auto repeat = [](std::string_view unit, int count) {
    std::string out;
    for (int i = 0; i < count; ++i) {
      out += unit;
    }
    return out;
  };
  if (note.alter >= 0) {
    return glyph + repeat("is", note.alter);
  }
  int flats = -note.alter;
  if (note.letter == B_LETTER) {
    // The B flat is B; anything flatter is written on H, as heses.
    return flats == 1 ? "b" : "h" + repeat("es", flats);
  }
  std::string first = is_eliding_letter(note.letter) ? glyph + "s" : glyph + "es";
  return first + repeat("es", flats - 1);
}

/** Read a Japanese name, or nullopt when the text is not one (`parseJapanese`). */
std::optional<NoteData> parse_japanese(View text) {
  const MarkWords& marks = marks_of(NoteNameSystem::kJapanese);
  Text sharp = utf16(marks.sharp);
  Text flat = utf16(marks.flat);
  Text doubled_mark = utf16(marks.doubled);
  View rest = text;
  int alter = 0;
  int direction = 0;
  while (!rest.empty()) {
    bool doubled = starts_with(rest, doubled_mark);
    View mark = doubled ? rest.substr(doubled_mark.size(), 1) : rest.substr(0, 1);
    int step = mark == sharp ? 1 : mark == flat ? -1 : 0;
    if (step == 0) {
      break;
    }
    // A sharp and a flat cancelling each other out is not a spelling anyone writes.
    if (direction != 0 && direction != step) {
      return std::nullopt;
    }
    direction = step;
    alter += doubled ? step * 2 : step;
    rest.remove_prefix(doubled ? doubled_mark.size() + 1 : 1);
  }
  int letter = letter_index(kJapaneseLetters, rest);
  if (letter < 0) {
    return std::nullopt;
  }
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), std::nullopt};
}

/** Write a Japanese name, without its octave (`formatJapanese`). */
std::string format_japanese(const NoteData& note) {
  const MarkWords& marks = marks_of(NoteNameSystem::kJapanese);
  std::string glyph(kJapaneseLetters[static_cast<std::size_t>(note.letter)]);
  int count = note.alter < 0 ? -note.alter : note.alter;
  if (count == 0) {
    return glyph;
  }
  std::string mark(note.alter > 0 ? marks.sharp : marks.flat);
  // The doubling mark is the written form of a double accidental; past that the mark repeats.
  std::string out;
  if (count == 2) {
    out = std::string(marks.doubled) + mark;
  } else {
    for (int i = 0; i < count; ++i) {
      out += mark;
    }
  }
  return out + glyph;
}

/** Split `text` at every single space, keeping empty pieces (`split(' ')`). */
std::vector<Text> split_spaces(View text) {
  std::vector<Text> words;
  std::size_t from = 0;
  while (true) {
    std::size_t space = text.find(u' ', from);
    if (space == View::npos) {
      words.emplace_back(text.substr(from));
      return words;
    }
    words.emplace_back(text.substr(from, space - from));
    from = space + 1;
  }
}

/** Read an Italian (fixed-do) name, or nullopt when the text is not one (`parseItalian`). */
std::optional<NoteData> parse_italian(View text) {
  const MarkWords& marks = marks_of(NoteNameSystem::kItalian);
  Text sharp = utf16(marks.sharp);
  Text flat = utf16(marks.flat);
  Text doubled_word = utf16(marks.doubled);
  std::vector<Text> words = split_spaces(ascii_lower(text));
  int letter = letter_index(kItalianLetters, words[0]);
  if (letter < 0) {
    return std::nullopt;
  }
  int alter = 0;
  int direction = 0;
  bool doubled = false;
  for (std::size_t i = 1; i < words.size(); ++i) {
    const Text& word = words[i];
    if (word == doubled_word) {
      if (doubled) {
        return std::nullopt;
      }
      doubled = true;
      continue;
    }
    int step = word == sharp ? 1 : word == flat ? -1 : 0;
    if (step == 0 || (direction != 0 && direction != step)) {
      return std::nullopt;
    }
    direction = step;
    alter += doubled ? step * 2 : step;
    doubled = false;
  }
  if (doubled) {
    return std::nullopt;
  }
  return NoteData{static_cast<double>(letter), static_cast<double>(alter), std::nullopt};
}

/** Write an Italian (fixed-do) name, without its octave (`formatItalian`). */
std::string format_italian(const NoteData& note) {
  const MarkWords& marks = marks_of(NoteNameSystem::kItalian);
  std::string glyph(kItalianLetters[static_cast<std::size_t>(note.letter)]);
  int count = note.alter < 0 ? -note.alter : note.alter;
  if (count == 0) {
    return glyph;
  }
  std::string word(note.alter > 0 ? marks.sharp : marks.flat);
  std::string accidental;
  if (count == 2) {
    accidental = std::string(marks.doubled) + " " + word;
  } else {
    for (int i = 0; i < count; ++i) {
      accidental += (i > 0 ? " " : "") + word;
    }
  }
  return glyph + " " + accidental;
}

/** A name split from its trailing scientific octave. */
struct OctaveSplit {
  Text name;
  std::optional<double> octave;
};

/** Split a trailing scientific octave off a name written in words or glyphs (`splitOctave`). */
OctaveSplit split_octave(View text) {
  std::size_t start = text.size();
  while (start > 0 && is_digit(text[start - 1])) {
    start -= 1;
  }
  if (start == text.size()) {
    return {Text(text), std::nullopt};
  }
  std::size_t signed_start = start > 0 && text[start - 1] == u'-' ? start - 1 : start;
  return {Text(text.substr(0, signed_start)), octave_of(text.substr(signed_start))};
}

/** Read a name in one system, or nullopt when that system does not accept it (`parseIn`). */
std::optional<NoteData> parse_in(View text, NoteNameSystem system) {
  NoteNameSystem table = table_of(system);
  if (table == NoteNameSystem::kEnglish) {
    return parse_english(text);
  }
  OctaveSplit split = split_octave(text);
  std::optional<NoteData> note = table == NoteNameSystem::kGerman     ? parse_german(split.name)
                                 : table == NoteNameSystem::kJapanese ? parse_japanese(split.name)
                                                                      : parse_italian(split.name);
  if (!note) {
    return std::nullopt;
  }
  note->octave = split.octave;
  return note;
}

/** Drop the separators a mode word is written against the tonic with (`trimSeparators`). */
Text trim_separators(View text) {
  std::size_t end = text.size();
  while (end > 0 && (js::is_space(text[end - 1]) || text[end - 1] == u'-')) {
    end -= 1;
  }
  return Text(text.substr(0, end));
}

/** A key name split into its tonic text and the mode its mode word gives (`ModeSplit`). */
struct ModeSplit {
  Text tonic;
  std::optional<KeyNameMode> mode;
  std::optional<NoteNameSystem> system;
};

/** Split a trailing mode word off a key name; the longest match wins (`splitModeWord`). */
ModeSplit split_mode_word(View text) {
  Text lower = ascii_lower(text);
  std::optional<std::size_t> best_length;
  ModeSplit best;
  for (NoteNameSystem system : detection_order()) {
    for (KeyNameMode mode : {KeyNameMode::kMajor, KeyNameMode::kMinor}) {
      Text word = utf16(mode_word(system, mode));
      if (ends_with(lower, word) && (!best_length || word.size() > *best_length)) {
        best_length = word.size();
        best.mode = mode;
        best.system = system;
      }
    }
  }
  if (!best_length) {
    return {Text(text), std::nullopt, std::nullopt};
  }
  best.tonic = trim_separators(text.substr(0, text.size() - *best_length));
  return best;
}

std::string quoted(View text) { return describe_rejected(json::Value(js::from_utf16(text))); }

/** Which system a name is written in, or nullopt when none reads it (`resolveSystem`). */
std::optional<NoteNameSystem> resolve_system(View text) {
  ModeSplit split = split_mode_word(text);
  // Each system is asked only until one answers; the whole list is needed only to name the
  // systems in the message a mixed name is rejected with.
  if (!split.system) {
    for (NoteNameSystem system : detection_order()) {
      if (parse_in(split.tonic, system)) {
        return system;
      }
    }
    return std::nullopt;
  }
  if (parse_in(split.tonic, *split.system)) {
    return split.system;
  }
  std::string accepted;
  for (NoteNameSystem system : detection_order()) {
    if (parse_in(split.tonic, system)) {
      accepted += (accepted.empty() ? "" : " or ") + std::string(to_string(system));
    }
  }
  if (accepted.empty()) {
    return std::nullopt;
  }
  throw InvalidInputError(quoted(text) + " mixes note-name systems: " + quoted(split.tonic) +
                          " is " + accepted + " but its mode word is " +
                          std::string(to_string(*split.system)));
}

/** The mode a key name with no mode word carries (`impliedMode`). */
KeyNameMode implied_mode(NoteNameSystem system, View tonic) {
  return table_of(system) == NoteNameSystem::kGerman && !tonic.empty() && tonic[0] >= u'a' &&
                 tonic[0] <= u'h'
             ? KeyNameMode::kMinor
             : KeyNameMode::kMajor;
}

}  // namespace

std::string_view to_string(NoteNameSystem system) {
  return kNoteNameSystemNames[static_cast<std::size_t>(system)];
}

std::optional<NoteNameSystem> parse_note_name_system(std::string_view name) {
  for (std::size_t i = 0; i < kNoteNameSystemNames.size(); ++i) {
    if (kNoteNameSystemNames[i] == name) {
      return static_cast<NoteNameSystem>(i);
    }
  }
  return std::nullopt;
}

std::string_view to_string(KeyNameMode mode) {
  return mode == KeyNameMode::kMajor ? "major" : "minor";
}

std::optional<KeyNameMode> parse_key_name_mode(std::string_view name) {
  for (KeyNameMode mode : {KeyNameMode::kMajor, KeyNameMode::kMinor}) {
    if (to_string(mode) == name) {
      return mode;
    }
  }
  return std::nullopt;
}

int max_note_name_length(NoteNameSystem system) {
  NoteNameSystem table = table_of(system);
  return named_length(kMaxLetterLength, table) +
         MAX_NAME_ACCIDENTALS * named_length(kMaxAccidentalLength, table);
}

NoteNameSystem detect_note_name_system(std::string_view text) {
  std::optional<NoteNameSystem> system = resolve_system(normalize(text));
  if (!system) {
    throw InvalidInputError("no note-name system reads " +
                            describe_rejected(json::Value(std::string(text))));
  }
  return *system;
}

NoteData read_note_name(std::string_view text, const NoteNameOptions& opts) {
  Text name = normalize(text);
  std::optional<NoteNameSystem> system = opts.system ? opts.system : resolve_system(name);
  std::optional<NoteData> note;
  if (system) {
    note = parse_in(name, *system);
  }
  if (!note) {
    throw InvalidInputError("Invalid note: " + describe_rejected(json::Value(std::string(text))));
  }
  return *note;
}

std::string write_note_name(const NoteData& note, const NoteNameOptions& opts) {
  NoteNameSystem table = table_of(opts.system.value_or(NoteNameSystem::kEnglish));
  std::string name = table == NoteNameSystem::kGerman     ? format_german(note)
                     : table == NoteNameSystem::kJapanese ? format_japanese(note)
                     : table == NoteNameSystem::kItalian  ? format_italian(note)
                                                          : format_english(note);
  return note.octave ? name + js::to_string(*note.octave) : name;
}

KeyName read_key_name(std::string_view text, const NoteNameOptions& opts) {
  Text name = normalize(text);
  ModeSplit split = split_mode_word(name);
  std::optional<NoteNameSystem> system = opts.system ? opts.system : resolve_system(name);
  std::string original = describe_rejected(json::Value(std::string(text)));
  if (system && split.system && *split.system != table_of(*system)) {
    throw InvalidInputError(original + " is not a " + std::string(to_string(*system)) +
                            " key name: its mode word is " + std::string(to_string(*split.system)));
  }
  std::optional<NoteData> tonic;
  if (system) {
    tonic = parse_in(split.tonic, *system);
  }
  if (!tonic || !system) {
    throw InvalidInputError("Invalid key name: " + original);
  }
  if (tonic->octave) {
    throw InvalidInputError("a key name carries no octave; received " + original);
  }
  // An explicit mode word outranks the German case convention, so "C moll" is C minor.
  return KeyName{*tonic, split.mode ? *split.mode : implied_mode(*system, split.tonic)};
}

std::string write_key_name(const KeyName& key, const NoteNameOptions& opts) {
  NoteNameSystem system = opts.system.value_or(NoteNameSystem::kEnglish);
  NoteNameSystem table = table_of(system);
  std::string word(mode_word(table, key.mode));
  std::string tonic = write_note_name(key.tonic, NoteNameOptions{system});
  if (table == NoteNameSystem::kJapanese) {
    return tonic + word;
  }
  if (table == NoteNameSystem::kGerman) {
    // German carries the mode in the case of the tonic as well as in the word.
    std::string cased = tonic;
    if (key.mode == KeyNameMode::kMajor && !cased.empty() && cased[0] >= 'a' && cased[0] <= 'z') {
      cased[0] = static_cast<char>(cased[0] - 'a' + 'A');
    }
    return cased + " " + word;
  }
  return tonic + " " + word;
}

}  // namespace cantus
