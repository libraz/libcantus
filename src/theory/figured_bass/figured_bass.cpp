// Figured bass: ts/src/theory/figured-bass/index.ts.

#include "cantus/theory/figured_bass.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <string>
#include <utility>

#include "cantus/core/errors.h"
#include "cantus/theory/spelling.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/utf16.h"
#include "theory/chord/chord.h"
#include "theory/chord/spec.h"
#include "theory/figured_bass/limits.gen.h"
#include "theory/spelling/limits.gen.h"

namespace cantus {

namespace {

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

/** A printed accidental: its name, the sign a score prints and the alteration it names. */
struct PrintedAccidental {
  std::string_view accidental;
  std::string_view glyph;
  int alter;
};

/** What a figure set sounds, and where the chord root sits above the bass (`FiguredSonority`). */
struct Sonority {
  std::vector<int> intervals;
  int rootInterval;
};

/** One recognized figure set, keyed by the intervals actually written. */
struct FigureSetRow {
  std::string_view key;
  Sonority sonority;
};

/** The digits a realized sonority is conventionally written with, keyed by its full stack. */
struct FigureAbbreviationRow {
  std::string_view key;
  std::vector<int> digits;
};

constexpr NamedName kDoubleAccidentals[] =
#include "theory/figured_bass/double_accidentals.gen.inc"
    ;

constexpr NamedName kSingleAccidentals[] =
#include "theory/figured_bass/single_accidentals.gen.inc"
    ;

constexpr std::string_view kFigureSeparators[] =
#include "theory/figured_bass/figure_separator_list.gen.inc"
    ;

constexpr std::string_view kMotionMarks[] =
#include "theory/figured_bass/motion_mark_list.gen.inc"
    ;

constexpr PrintedAccidental kPrintedAccidentals[] =
#include "theory/figured_bass/printed_accidentals.gen.inc"
    ;

const std::vector<FigureSetRow>& figure_sets() {
  static const std::vector<FigureSetRow> rows =
#include "theory/figured_bass/figure_set_entries.gen.inc"
      ;
  return rows;
}

const std::vector<FigureAbbreviationRow>& figure_abbreviations() {
  static const std::vector<FigureAbbreviationRow> rows =
#include "theory/figured_bass/figure_abbreviation_entries.gen.inc"
      ;
  return rows;
}

/** The accidental of a figure that writes none, and the one that raises rather than names. */
constexpr std::string_view kNoAccidental = "none";
constexpr std::string_view kRaisedAccidental = "raised";

/** The number a figure names when only an accidental is written: the third above the bass. */
constexpr int kAccidentalOnlyFigure = 3;

/** One written figure: an interval above the bass and the accidental on it (`Figure`). */
struct Figure {
  int number;
  std::string_view accidental;
};

/** A figure that moves to another over the same bass, such as `4-3` (`FigureMotion`). */
struct FigureMotion {
  Figure from;
  Figure to;
};

/** The figures a written string names: the static ones and the moving ones. */
struct ParsedFigures {
  std::vector<Figure> figures;
  std::vector<FigureMotion> motions;
};

using Text = std::u16string;

Text units_of(std::string_view s) { return js::to_utf16(s); }

/** An error naming the figure string that was rejected (`invalidFigures`). */
InvalidInputError invalid_figures(const Text& figures, const std::string& detail) {
  return InvalidInputError("figured bass " +
                           describe_rejected(json::Value(js::from_utf16(figures))) + " " + detail);
}

/** Whether `text` carries the single code unit `unit`'s text at `index`. */
bool unit_is(const Text& text, std::size_t index, std::string_view token) {
  return index < text.size() && units_of(token) == Text(1, text[index]);
}

/** Whether a one-unit token list holds the unit of `text` at `index`. */
template <std::size_t N>
bool unit_in(const Text& text, std::size_t index, const std::string_view (&tokens)[N]) {
  return std::any_of(std::begin(tokens), std::end(tokens),
                     [&](std::string_view token) { return unit_is(text, index, token); });
}

/** The value of the table row whose key is `key`, or nullopt. */
template <std::size_t N>
std::optional<std::string_view> table_value(const NamedName (&table)[N], const Text& key) {
  for (const NamedName& row : table) {
    if (units_of(row.name) == key) {
      return row.value;
    }
  }
  return std::nullopt;
}

/**
 * The alteration a figure's accidental gives the note it stands on (`alteredBy`): a printed
 * accidental names the note outright, the crossed figure raises what the key gives, and no
 * accidental takes what the key gives.
 */
int altered_by(int diatonic_alter, std::string_view accidental) {
  for (const PrintedAccidental& printed : kPrintedAccidentals) {
    if (printed.accidental == accidental) {
      return printed.alter;
    }
  }
  return accidental == kRaisedAccidental ? diatonic_alter + 1 : diatonic_alter;
}

/** The sign a score prints for an alteration (`ACCIDENTAL_GLYPHS`). */
std::optional<std::string_view> glyph_of(int alter) {
  std::optional<std::string_view> glyph;
  for (const PrintedAccidental& printed : kPrintedAccidentals) {
    if (printed.alter == alter) {
      glyph = printed.glyph;
    }
  }
  return glyph;
}

/** A figure and where it ends (`readFigure`'s result). */
struct ReadFigure {
  Figure figure;
  std::size_t index;
};

/**
 * Read one figure, an optional accidental and an optional digit, starting at `start`
 * (`readFigure`).
 */
ReadFigure read_figure(const Text& text, std::size_t start) {
  std::size_t index = start;
  std::string_view accidental = kNoAccidental;
  Text pair = text.substr(std::min<std::size_t>(index, text.size()), 2);
  Text single = index < text.size() ? Text(1, text[index]) : Text();
  std::optional<std::string_view> pair_value = table_value(kDoubleAccidentals, pair);
  std::optional<std::string_view> single_value = table_value(kSingleAccidentals, single);
  if (pair_value) {
    accidental = *pair_value;
    index += 2;
  } else if (single_value) {
    accidental = *single_value;
    index += 1;
  }
  if (index < text.size() && text[index] >= u'0' && text[index] <= u'9') {
    int number = text[index] - u'0';
    if (number < MIN_FIGURE_NUMBER || number > MAX_FIGURE_NUMBER) {
      throw invalid_figures(text, "names the interval " + js::to_string(number) +
                                      ", which is outside " + js::to_string(MIN_FIGURE_NUMBER) +
                                      ".." + js::to_string(MAX_FIGURE_NUMBER));
    }
    return ReadFigure{Figure{number, accidental}, index + 1};
  }
  if (accidental == kNoAccidental) {
    // An empty slice means the string ended where a figure was expected, as in a trailing `4-`.
    if (start >= text.size()) {
      throw invalid_figures(text, "ends where a figure was expected, at position " +
                                      js::to_string(static_cast<double>(start)));
    }
    throw invalid_figures(
        text, "has an unexpected character " + js::quote(js::from_utf16(text.substr(start, 1))));
  }
  return ReadFigure{Figure{kAccidentalOnlyFigure, accidental}, index};
}

/** The figures written together and where they end (`readStack`'s result). */
struct ReadStack {
  std::vector<Figure> figures;
  std::size_t index;
};

/** Read the figures written together from `start`: one figure or a run-together stack
 * (`readStack`). */
ReadStack read_stack(const Text& text, std::size_t start) {
  ReadStack stack{{}, start};
  do {
    ReadFigure read = read_figure(text, stack.index);
    stack.figures.push_back(read.figure);
    stack.index = read.index;
  } while (stack.index < text.size() && !unit_in(text, stack.index, kFigureSeparators) &&
           !unit_in(text, stack.index, kMotionMarks));
  return stack;
}

/** Split a figure string into its static figures and its moving ones (`parseFigures`). */
ParsedFigures parse_figures(const Text& text) {
  ParsedFigures parsed;
  std::size_t index = 0;
  while (index < text.size()) {
    if (unit_in(text, index, kFigureSeparators)) {
      index += 1;
      continue;
    }
    ReadStack first = read_stack(text, index);
    index = first.index;
    if (!unit_in(text, index, kMotionMarks)) {
      parsed.figures.insert(parsed.figures.end(), first.figures.begin(), first.figures.end());
      continue;
    }
    ReadStack second = read_stack(text, index + 1);
    index = second.index;
    if (unit_in(text, index, kMotionMarks)) {
      throw invalid_figures(text, "chains more than one motion onto a single figure");
    }
    if (first.figures.size() != second.figures.size()) {
      throw invalid_figures(text, "moves " +
                                      js::to_string(static_cast<double>(first.figures.size())) +
                                      " run-together figures onto " +
                                      js::to_string(static_cast<double>(second.figures.size())));
    }
    for (std::size_t column = 0; column < first.figures.size(); ++column) {
      const Figure& from = first.figures[column];
      const Figure& to = second.figures[column];
      if (from.number == to.number) {
        throw invalid_figures(text,
                              "moves the interval " + js::to_string(from.number) + " onto itself");
      }
      parsed.motions.push_back(FigureMotion{from, to});
    }
  }
  return parsed;
}

/** `numbers.join(',')`. */
std::string join_numbers(const std::vector<int>& numbers) {
  std::string out;
  for (std::size_t i = 0; i < numbers.size(); ++i) {
    if (i > 0) {
      out += ",";
    }
    out += js::to_string(numbers[i]);
  }
  return out;
}

/** The qualities of the triads and seventh chords a figure can stack (`TERTIAN_QUALITIES`). */
const std::vector<std::pair<std::vector<double>, ChordQuality>>& tertian_qualities() {
  static const std::vector<std::pair<std::vector<double>, ChordQuality>> index = [] {
    std::vector<std::pair<std::vector<double>, ChordQuality>> out;
    for (ChordQuality quality : chord_qualities()) {
      std::vector<double> intervals = make_chord(0, quality).intervals;
      ChordSpec spec = chord_spec_for_quality(quality, 0);
      // Only a major, minor, diminished or augmented base with no added tone is tertian.
      bool tertian = (spec.base == ChordBase::kMaj || spec.base == ChordBase::kMin ||
                      spec.base == ChordBase::kDim || spec.base == ChordBase::kAug) &&
                     spec.additions.empty();
      // Declaration order decides a tie, exactly as it does for chord detection.
      bool known = std::any_of(out.begin(), out.end(),
                               [&](const auto& entry) { return entry.first == intervals; });
      if (intervals.size() >= 3 && intervals.size() <= static_cast<std::size_t>(MAX_STACK_SIZE) &&
          tertian && !known) {
        out.emplace_back(std::move(intervals), quality);
      }
    }
    return out;
  }();
  return index;
}

/** The alteration each diatonic letter carries in a key, indexed by letter (`keyLetterAlters`). */
std::vector<int> key_letter_alters(const ResolvedKey& key) {
  std::size_t size = scale_tones_in_degree_order(key.scale).size();
  if (size != DIATONIC_LETTER_COUNT) {
    throw InvalidInputError("figured bass requires a heptatonic key (received " +
                            js::to_string(static_cast<double>(size)) + " tones)");
  }
  std::vector<int> alters(7, 0);
  // The key's own tonic, so an Ab minor hands back its flats.
  for (const NoteData& note : spell_scale(key.tonic, key.scale)) {
    alters[static_cast<std::size_t>(diatonic_letter_of(note.letter))] = note.alter;
  }
  return alters;
}

/** The note a figure names: its letter from the bass, its accidental from the key (`noteAbove`). */
NoteData note_above(const NoteData& bass, const Figure& figure, const std::vector<int>& alters) {
  int letter = diatonic_letter_of(bass.letter + figure.number - 1);
  return NoteData{
      static_cast<double>(letter),
      static_cast<double>(altered_by(alters[static_cast<std::size_t>(letter)], figure.accidental)),
      std::nullopt};
}

/** A bass note reduced to the letter and accidental the figures are read from (`bareNote`). */
NoteData bare_note(const NoteData& note) {
  return NoteData{static_cast<double>(diatonic_letter_of(note.letter)), note.alter, std::nullopt};
}

std::string joined_names(const std::vector<NoteData>& notes) {
  std::vector<NoteArg> args(notes.begin(), notes.end());
  std::string out;
  for (const std::string& name : note_names(args)) {
    if (!out.empty()) {
      out += " ";
    }
    out += name;
  }
  return out;
}

/** The pitch classes a set of spelled notes sounds, ascending (`pitchClassesOf`). */
std::vector<int> pitch_classes_of(const std::vector<NoteData>& notes) {
  std::vector<int> pcs;
  for (const NoteData& note : notes) {
    int pc = note_to_pitch_class(note);
    if (std::find(pcs.begin(), pcs.end(), pc) == pcs.end()) {
      pcs.push_back(pc);
    }
  }
  std::stable_sort(pcs.begin(), pcs.end());
  return pcs;
}

/** The chord a resolved figure set names over a bass (`realizeSonority`). */
std::pair<Chord, std::vector<NoteData>> realize_sonority(const NoteData& bass,
                                                         const std::vector<Figure>& resolved,
                                                         const Text& text,
                                                         const std::vector<int>& alters) {
  std::vector<int> numbers;
  for (const Figure& figure : resolved) {
    if (std::find(numbers.begin(), numbers.end(), figure.number) == numbers.end()) {
      numbers.push_back(figure.number);
    }
  }
  std::stable_sort(numbers.begin(), numbers.end());
  const FigureSetRow* found = nullptr;
  std::string key = join_numbers(numbers);
  for (const FigureSetRow& row : figure_sets()) {
    if (row.key == key) {
      found = &row;
      break;
    }
  }
  if (found == nullptr) {
    throw invalid_figures(text, "names no chord over the bass");
  }
  const Sonority& sonority = found->sonority;
  std::vector<NoteData> notes;
  for (int number : sonority.intervals) {
    // The accidental written last for an interval is the one that stands.
    std::string_view accidental = kNoAccidental;
    for (const Figure& figure : resolved) {
      if (figure.number == number) {
        accidental = figure.accidental;
      }
    }
    notes.push_back(note_above(bass, Figure{number, accidental}, alters));
  }
  std::vector<NoteData> tones = {bass};
  tones.insert(tones.end(), notes.begin(), notes.end());
  std::vector<int> positions = {1};
  positions.insert(positions.end(), sonority.intervals.begin(), sonority.intervals.end());
  auto root_position = std::find(positions.begin(), positions.end(), sonority.rootInterval);
  const NoteData& root = root_position == positions.end()
                             ? bass
                             : tones[static_cast<std::size_t>(root_position - positions.begin())];
  int root_pc = note_to_pitch_class(root);
  std::vector<double> stack;
  for (std::size_t step = 0; step < tones.size(); ++step) {
    // The chord tones sit two letters apart: root, third, fifth, seventh.
    auto tone = std::find_if(tones.begin(), tones.end(), [&](const NoteData& candidate) {
      return diatonic_letter_of(candidate.letter - root.letter) == static_cast<int>(step) * 2;
    });
    if (tone == tones.end()) {
      throw NoSolutionError("figured bass " + describe_rejected(json::Value(js::from_utf16(text))) +
                            " sounds " + joined_names(tones) + ", which does not stack in thirds");
    }
    stack.push_back(pitch_class_of(note_to_pitch_class(*tone) - root_pc));
  }
  std::optional<ChordQuality> quality;
  for (const auto& entry : tertian_qualities()) {
    if (entry.first == stack) {
      quality = entry.second;
      break;
    }
  }
  if (!quality) {
    throw NoSolutionError("figured bass " + describe_rejected(json::Value(js::from_utf16(text))) +
                          " sounds " + joined_names(tones) + ", which no chord quality names");
  }
  SpelledChordParts parts;
  parts.bassPc = note_to_pitch_class(bass);
  parts.rootSpelling =
      PitchSpelling{static_cast<double>(root.letter), static_cast<double>(root.alter)};
  parts.bassSpelling =
      PitchSpelling{static_cast<double>(bass.letter), static_cast<double>(bass.alter)};
  return {make_spelled_chord(root_pc, *quality, parts), std::move(notes)};
}

FiguredBassRealization realize_in(const NoteArg& bass, std::string_view figures,
                                  const KeyArg& key) {
  NoteData bass_data = to_note_data(bass);
  std::vector<int> alters = key_letter_alters(resolve_key(key));
  // Reading the pitch class validates the note's fields before its letter is used.
  note_to_pitch_class(bass_data);
  NoteData bass_note = bare_note(bass_data);
  Text text = units_of(js::trim(figures));
  ParsedFigures parsed = parse_figures(text);
  FiguredBassRealization out;
  for (const FigureMotion& motion : parsed.motions) {
    out.suspensions.push_back(FiguredBassSuspension{motion.from.number, motion.to.number,
                                                    note_above(bass_note, motion.from, alters),
                                                    note_above(bass_note, motion.to, alters)});
  }
  // A figure resolving onto the octave lands on the bass itself and adds nothing to the stack.
  std::vector<Figure> resolved = parsed.figures;
  for (const FigureMotion& motion : parsed.motions) {
    if (motion.to.number != OCTAVE_FIGURE) {
      resolved.push_back(motion.to);
    }
  }
  auto [chord, notes] = realize_sonority(bass_note, resolved, text, alters);
  out.chord = std::move(chord);
  out.notes = {bass_note};
  out.notes.insert(out.notes.end(), notes.begin(), notes.end());
  return out;
}

/**
 * Require the figures just written to read back as the chord they were written from
 * (`assertRealizesAs`).
 */
void assert_realizes_as(const NoteData& bass, const std::string& figures, const ResolvedKey& key,
                        const std::vector<NoteData>& tones) {
  auto no_figures = [&](const std::string& detail) {
    return NoSolutionError("no figured bass names " + joined_names(tones) + " over " +
                           joined_names({bass}) + ": the figures " +
                           describe_rejected(json::Value(figures)) + " " + detail);
  };
  FiguredBassRealization realized;
  try {
    realized = realize_in(bass, figures, key);
  } catch (const NoSolutionError&) {
    throw no_figures("read back as no chord at all");
  }
  if (pitch_classes_of(realized.notes) != pitch_classes_of(tones)) {
    throw no_figures("sound " + joined_names(realized.notes) + " instead");
  }
}

}  // namespace

FiguredBassRealization figured_bass_realization(const NoteArg& bass, std::string_view figures,
                                                const KeyArg& key) {
  return realize_in(bass, figures, key);
}

Chord realize_figured_bass(const NoteArg& bass, std::string_view figures, const KeyArg& key) {
  return figured_bass_realization(bass, figures, key).chord;
}

std::string figured_bass_of(const ChordArg& chord, const KeyArg& key) {
  Chord data = to_chord_data(chord);
  ResolvedKey resolved = resolve_key(key);
  std::vector<int> alters = key_letter_alters(resolved);
  std::vector<NoteData> tones = spell_chord(data, resolved.tonic, resolved.scale);
  int bass_pc = pitch_class_of(data.bassPc.value_or(data.rootPc));
  auto bass_tone = std::find_if(tones.begin(), tones.end(), [&](const NoteData& tone) {
    return note_to_pitch_class(tone) == bass_pc;
  });
  if (bass_tone == tones.end()) {
    throw NoSolutionError(
        "figured bass measures intervals above a chord tone, and this chord's bass is not one of "
        "its tones");
  }
  NoteData bass = *bass_tone;
  // A Map keyed by interval number: a later tone on the same number replaces the earlier one.
  std::vector<std::pair<int, NoteData>> written;
  for (auto tone = tones.begin(); tone != tones.end(); ++tone) {
    if (tone == bass_tone) {
      continue;
    }
    int number = diatonic_letter_of(tone->letter - bass.letter) + 1;
    auto existing = std::find_if(written.begin(), written.end(),
                                 [&](const auto& entry) { return entry.first == number; });
    if (existing != written.end()) {
      existing->second = *tone;
    } else {
      written.emplace_back(number, *tone);
    }
  }
  std::vector<int> keys;
  for (const auto& entry : written) {
    keys.push_back(entry.first);
  }
  std::stable_sort(keys.begin(), keys.end());
  const FigureAbbreviationRow* digits = nullptr;
  std::string key_text = join_numbers(keys);
  for (const FigureAbbreviationRow& row : figure_abbreviations()) {
    if (row.key == key_text) {
      digits = &row;
      break;
    }
  }
  if (digits == nullptr) {
    throw NoSolutionError("no figured bass names " + joined_names(tones) + " over " +
                          joined_names({bass}));
  }
  std::vector<std::pair<int, std::string_view>> accidentals;
  for (const auto& [number, tone] : written) {
    if (tone.alter == alters[static_cast<std::size_t>(diatonic_letter_of(tone.letter))]) {
      // The signature already writes this note, so the score prints no sign.
      continue;
    }
    std::optional<std::string_view> glyph = glyph_of(tone.alter);
    if (!glyph) {
      throw NoSolutionError("no accidental writes a note altered by " + js::to_string(tone.alter) +
                            " semitones");
    }
    accidentals.emplace_back(number, *glyph);
  }
  // Figures are written from the top down, and an altered interval the abbreviation leaves
  // implied has to be named for its accidental to land on anything.
  std::vector<int> numbers = digits->digits;
  for (const auto& entry : accidentals) {
    if (std::find(numbers.begin(), numbers.end(), entry.first) == numbers.end()) {
      numbers.push_back(entry.first);
    }
  }
  std::stable_sort(numbers.begin(), numbers.end(), [](int a, int b) { return a > b; });
  std::string figures;
  for (int number : numbers) {
    for (const auto& entry : accidentals) {
      if (entry.first == number) {
        figures += std::string(entry.second);
        break;
      }
    }
    figures += js::to_string(number);
  }
  assert_realizes_as(bass, figures, resolved, tones);
  return figures;
}

}  // namespace cantus
