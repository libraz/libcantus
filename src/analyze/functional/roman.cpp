// Roman-numeral parsing and formatting: ts/src/analyze/functional/roman.ts.

#include "analyze/functional/roman.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <string_view>
#include <utility>

#include "analyze/functional/augmented_sixth.h"
#include "analyze/functional/internal.h"
#include "analyze/functional/tonicization.h"
#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/spelling.h"
#include "js/number.h"
#include "js/utf16.h"
#include "theory/chord/chord.h"
#include "theory/chord/spec.h"
#include "theory/symbol/spelling.h"
#include "theory/tendency/tendency.h"

namespace cantus {

namespace {

/** A name and the text it stands for. */
struct NamedText {
  std::string_view name;
  std::string_view text;
};

/** A name and the number it stands for. */
struct NamedInt {
  std::string_view name;
  int value;
};

/** Major-key Roman spelling of one semitone offset above the tonic (`OFFSET_SPELLING`). */
struct OffsetSpelling {
  int degreeNumber;
  std::string_view accidental;
};

/** Case and suffix of a chord quality as a numeral (`ROMAN_STYLE`). */
struct RomanStyle {
  bool lower;
  std::string_view suffix;
};

/** A quality name and its numeral style. */
struct NamedRomanStyle {
  std::string_view name;
  RomanStyle style;
};

constexpr std::size_t kDegreeCount = 7;
constexpr std::size_t kQualityCount = static_cast<std::size_t>(ChordQuality::kMin6_9) + 1;

/** Roman numeral glyphs indexed by degree number - 1 (`ROMAN`). */
constexpr std::array<std::string_view, kDegreeCount> kRoman = {
#include "analyze/functional/roman.gen.inc"
};
static_assert(!kRoman.back().empty(), "ROMAN has fewer glyphs than degrees");

/** Roman glyph to degree number (`ROMAN_TO_DEGREE`). */
constexpr std::array<NamedInt, kDegreeCount> kRomanToDegree = {
#include "analyze/functional/roman_to_degree.gen.inc"
};
static_assert(!kRomanToDegree.back().name.empty(), "ROMAN_TO_DEGREE has fewer glyphs than degrees");

/** Major-key Roman spelling for each semitone offset above the tonic. */
constexpr std::array<OffsetSpelling, 12> kOffsetSpelling = {
#include "analyze/functional/offset_spelling.gen.inc"
};

/** Figure strings that denote a recognized figured-bass inversion (`INVERSION_FIGURE_LIST`). */
constexpr std::string_view kInversionFigures[] =
#include "analyze/functional/inversion_figure_list.gen.inc"
    ;

/** Canonical numeral rendering for every supported chord quality (`ROMAN_STYLE`). */
constexpr std::array<NamedRomanStyle, kQualityCount> kRomanStyle = {
#include "analyze/functional/roman_style.gen.inc"
};
static_assert(!kRomanStyle.back().name.empty(),
              "ROMAN_STYLE has fewer qualities than ChordQuality");

/** Figures of the inversions of a triad (`TRIAD_FIGURES`). */
constexpr NamedText kTriadFigures[] =
#include "analyze/functional/triad_figures.gen.inc"
    ;

/** Figures of the inversions of a seventh chord (`SEVENTH_FIGURES`). */
constexpr NamedText kSeventhFigures[] =
#include "analyze/functional/seventh_figures.gen.inc"
    ;

/** Qualities whose inversions render as lossless triad figures. */
constexpr std::string_view kTriadFigureQualities[] =
#include "analyze/functional/triad_figure_quality_names.gen.inc"
    ;

/** Qualities carrying a chordal seventh, whose inversions render as seventh figures. */
constexpr std::string_view kSeventhFigureQualities[] =
#include "analyze/functional/seventh_figure_quality_names.gen.inc"
    ;

/** Ordinal names of the seven scale degrees, indexed by degree number - 1 (`DEGREE_NAMES`). */
constexpr std::array<std::string_view, kDegreeCount> kDegreeNames = {
#include "analyze/functional/degree_names.gen.inc"
};
static_assert(!kDegreeNames.back().empty(), "DEGREE_NAMES has fewer names than degrees");

/** The conventional figured name for the Neapolitan in first inversion. */
constexpr std::string_view kNeapolitanSixth = "N6";

/** The note a tonic six-four carries, which the numeral alone cannot give. */
constexpr std::string_view kSixFourNote =
    "; on the dominant bass this chord is heard as a double appoggiatura over the dominant "
    "rather than as a tonic of its own, which only the chords around it settle";

/** Qualities of a numeral glyph that sit on the leading tone (`LEADING_TONE_QUALITIES.has`). */
bool is_leading_tone_quality(ChordQuality quality) {
  return std::find(LEADING_TONE_QUALITIES.begin(), LEADING_TONE_QUALITIES.end(), quality) !=
         LEADING_TONE_QUALITIES.end();
}

const RomanStyle& roman_style(ChordQuality quality) {
  static const std::array<RomanStyle, kQualityCount> table = [] {
    std::array<RomanStyle, kQualityCount> out{};
    for (const NamedRomanStyle& row : kRomanStyle) {
      out[static_cast<std::size_t>(*parse_chord_quality(row.name))] = row.style;
    }
    return out;
  }();
  return table[static_cast<std::size_t>(quality)];
}

/** `table[key]` of a numeric-key text table, or nullopt where the key is absent. */
template <std::size_t N>
std::optional<std::string_view> text_at(const NamedText (&table)[N], int key) {
  std::string name = js::to_string(key);
  for (const NamedText& row : table) {
    if (row.name == name) {
      return row.text;
    }
  }
  return std::nullopt;
}

template <std::size_t N>
bool names_quality(const std::string_view (&names)[N], ChordQuality quality) {
  return std::find(std::begin(names), std::end(names), to_string(quality)) != std::end(names);
}

/** Choose a seventh-chord quality from a triad label and the numeral case (`seventhQuality`). */
ChordQuality seventh_quality(ChordBase base, bool half_dim) {
  if (half_dim) {
    return ChordQuality::kM7b5;
  }
  if (base == ChordBase::kDim) {
    return ChordQuality::kDim7;
  }
  if (base == ChordBase::kAug) {
    return ChordQuality::kAug7;
  }
  return base == ChordBase::kMaj ? ChordQuality::kDom7 : ChordQuality::kMin7;
}

/** The quality `(case, exact suffix)` names; the last of the table wins (`SUFFIX_QUALITY`). */
std::optional<ChordQuality> quality_of_suffix(bool lower, std::string_view suffix) {
  std::optional<ChordQuality> found;
  for (const NamedRomanStyle& row : kRomanStyle) {
    if (row.style.lower == lower && row.style.suffix == suffix) {
      found = parse_chord_quality(row.name);
    }
  }
  return found;
}

/** A figured-bass inversion and whether a seventh is implied (`parseInversion`). */
struct Inversion {
  int inversion;
  bool seventh;
};

Inversion parse_inversion(std::string_view figures) {
  if (figures == "65") {
    return {1, true};
  }
  if (figures == "43") {
    return {2, true};
  }
  if (figures == "42" || figures == "2") {
    return {3, true};
  }
  if (figures == "7") {
    return {0, true};
  }
  if (figures == "64") {
    return {2, false};
  }
  if (figures == "6") {
    return {1, false};
  }
  return {0, false};
}

/** A parsed numeral without a slash: the root and how it is written, the quality, the inversion. */
struct ParsedRoman {
  int rootPc;
  std::optional<PitchSpelling> rootSpelling;
  ChordQuality quality;
  int inversion;
};

/**
 * The root a numeral writes, on the letter of its degree counted from the tonic
 * (`numeralRootSpelling`); a root that would need more than a double accidental is left unspelled.
 */
std::optional<PitchSpelling> numeral_root_spelling(const NoteData& tonic, int degree_number,
                                                   int root_pc) {
  NoteData spelling = spelling_above(tonic, degree_number - 1, root_pc);
  if (std::abs(spelling.alter) > 2) {
    return std::nullopt;
  }
  return PitchSpelling{spelling.letter, spelling.alter};
}

/** Whether a UTF-8 text holds a character `.` does not match (a line terminator). */
bool has_line_terminator(std::string_view text) {
  for (std::size_t i = 0; i < text.size(); ++i) {
    char c = text[i];
    if (c == '\n' || c == '\r') {
      return true;
    }
    // U+2028 and U+2029 are E2 80 A8 and E2 80 A9.
    if (static_cast<unsigned char>(c) == 0xE2 && i + 2 < text.size() &&
        static_cast<unsigned char>(text[i + 1]) == 0x80 &&
        (static_cast<unsigned char>(text[i + 2]) == 0xA8 ||
         static_cast<unsigned char>(text[i + 2]) == 0xA9)) {
      return true;
    }
  }
  return false;
}

bool starts_with(std::string_view text, std::string_view prefix) {
  return text.substr(0, prefix.size()) == prefix;
}

/**
 * The suffix grammar `/^(o|°|dim|ø|\+|aug)?(maj7|M7)?(65|64|43|42|7|6|2)?$/`: the three optional
 * parts, each empty when it did not take part.
 */
struct SuffixParts {
  std::string_view marker;
  bool hasMaj7 = false;
  std::string_view figures;
};

std::optional<SuffixParts> parse_suffix(std::string_view suffix) {
  constexpr std::string_view kMarkers[] = {"o", "\xC2\xB0", "dim", "\xC3\xB8", "+", "aug"};
  constexpr std::string_view kMaj7s[] = {"maj7", "M7"};
  constexpr std::string_view kFigures[] = {"65", "64", "43", "42", "7", "6", "2"};
  // Each part is greedy and gives way to its absence, as the regex backtracks.
  std::vector<std::string_view> marker_choices;
  for (std::string_view marker : kMarkers) {
    if (starts_with(suffix, marker)) {
      marker_choices.push_back(marker);
    }
  }
  marker_choices.push_back({});
  for (std::string_view marker : marker_choices) {
    std::string_view after_marker = suffix.substr(marker.size());
    std::vector<std::string_view> maj_choices;
    for (std::string_view maj : kMaj7s) {
      if (starts_with(after_marker, maj)) {
        maj_choices.push_back(maj);
      }
    }
    maj_choices.push_back({});
    for (std::string_view maj : maj_choices) {
      std::string_view rest = after_marker.substr(maj.size());
      if (rest.empty()) {
        return SuffixParts{marker, !maj.empty(), {}};
      }
      for (std::string_view figures : kFigures) {
        if (rest == figures) {
          return SuffixParts{marker, !maj.empty(), figures};
        }
      }
    }
  }
  return std::nullopt;
}

/** Parse a Roman numeral (no secondary '/') into a root, quality and inversion. */
ParsedRoman parse_simple_roman(std::string_view text, const ResolvedKey& resolved) {
  const KeyScale& key = resolved.scale;
  std::string trimmed = js::trim(text);
  std::string_view view = trimmed;
  // /^([b#]?)([iIvV]+)(.*)$/
  std::size_t at = 0;
  int accidental = 0;
  if (!view.empty() && (view[0] == 'b' || view[0] == '#')) {
    accidental = view[0] == 'b' ? -1 : 1;
    at = 1;
  }
  std::size_t glyph_end = at;
  while (glyph_end < view.size() && (view[glyph_end] == 'i' || view[glyph_end] == 'I' ||
                                     view[glyph_end] == 'v' || view[glyph_end] == 'V')) {
    ++glyph_end;
  }
  if (glyph_end == at || has_line_terminator(view.substr(glyph_end))) {
    throw InvalidInputError("Invalid Roman numeral: " + std::string(text));
  }
  std::string glyph_text(view.substr(at, glyph_end - at));
  std::string_view suffix = view.substr(glyph_end);
  std::string upper = glyph_text;
  std::string lower = glyph_text;
  for (char& c : upper) {
    c = static_cast<char>(c >= 'a' && c <= 'z' ? c - 'a' + 'A' : c);
  }
  for (char& c : lower) {
    c = static_cast<char>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
  }
  if (glyph_text != upper && glyph_text != lower) {
    throw InvalidInputError("Roman numeral must use one case: " + std::string(text));
  }
  std::optional<int> degree_number;
  for (const NamedInt& row : kRomanToDegree) {
    if (row.name == upper) {
      degree_number = row.value;
    }
  }
  if (!degree_number) {
    throw InvalidInputError("Invalid Roman numeral: " + std::string(text));
  }
  bool is_upper = glyph_text[0] == upper[0];
  // Degrees are read in the key's heptatonic frame, so a numeral means the same root in both
  // directions even when the key itself is not heptatonic.
  KeyScale frame = roman_reference(key);
  std::vector<int> lowered = lowered_degrees(frame);
  auto is_lowered = [&](int degree) {
    return std::find(lowered.begin(), lowered.end(), degree) != lowered.end();
  };
  // A flat on a degree the mode already lowers is that degree, not a further lowering.
  bool redundant_flat = accidental == -1 && is_lowered(*degree_number);
  int diatonic_root_pc =
      pitch_class_of(degree_root_pc(*degree_number, frame) + (redundant_flat ? 0 : accidental));

  // In a minor key, an unaltered diminished-family seventh-degree numeral conventionally denotes
  // the harmonic-minor leading tone.
  auto root_for_quality = [&](ChordQuality quality) {
    return accidental == 0 && *degree_number == 7 && is_lowered(7) &&
                   is_leading_tone_quality(quality)
               ? pitch_class_of(diatonic_root_pc + 1)
               : diatonic_root_pc;
  };

  auto parsed_as = [&](ChordQuality quality, int inversion) {
    int root_pc = root_for_quality(quality);
    return ParsedRoman{root_pc, numeral_root_spelling(resolved.tonic, *degree_number, root_pc),
                       quality, inversion};
  };

  // Canonical quality suffixes come first so every chord_to_roman rendering re-parses to the same
  // quality.
  if (std::optional<ChordQuality> canonical = quality_of_suffix(!is_upper, suffix)) {
    return parsed_as(*canonical, 0);
  }

  // Non-canonical spellings are a complete quality marker, an optional major-seventh marker and a
  // recognized figured bass; unknown trailing text is rejected in full.
  std::optional<SuffixParts> parsed = parse_suffix(suffix);
  if (!parsed) {
    throw InvalidInputError("Unsupported suffix \"" + std::string(suffix) +
                            "\" in Roman numeral: " + std::string(text));
  }
  bool is_dim = parsed->marker == "o" || parsed->marker == "\xC2\xB0" || parsed->marker == "dim";
  bool is_aug = parsed->marker == "+" || parsed->marker == "aug";
  bool is_half_dim = parsed->marker == "\xC3\xB8";
  bool explicit_maj7 = parsed->hasMaj7;
  std::string_view figures = parsed->figures;

  // Reject figure strings that are neither a known inversion nor a canonical suffix.
  if (!figures.empty() && std::find(std::begin(kInversionFigures), std::end(kInversionFigures),
                                    figures) == std::end(kInversionFigures)) {
    throw InvalidInputError("Unsupported figured-bass or extension \"" + std::string(figures) +
                            "\" in Roman numeral: " + std::string(text));
  }

  Inversion inversion = parse_inversion(figures);
  // The half-diminished glyph is a seventh by definition.
  bool has_seventh = explicit_maj7 || inversion.seventh || is_half_dim;

  ChordBase base;
  if (is_dim || is_half_dim) {
    base = ChordBase::kDim;
  } else if (is_aug) {
    base = ChordBase::kAug;
  } else {
    base = is_upper ? ChordBase::kMaj : ChordBase::kMin;
  }

  ChordQuality quality;
  if (explicit_maj7) {
    quality = base == ChordBase::kMin   ? ChordQuality::kMinMaj7
              : base == ChordBase::kAug ? ChordQuality::kAugMaj7
                                        : ChordQuality::kMaj7;
  } else if (has_seventh) {
    quality = seventh_quality(base, is_half_dim);
  } else if (base == ChordBase::kDim) {
    quality = ChordQuality::kDim;
  } else if (base == ChordBase::kAug) {
    quality = ChordQuality::kAug;
  } else {
    quality = base == ChordBase::kMaj ? ChordQuality::kMaj : ChordQuality::kMin;
  }
  return parsed_as(quality, inversion.inversion);
}

/**
 * The chord a whole-token chromatic symbol names, or null when the text is an ordinary numeral
 * (`chromaticSymbolChord`).
 */
Nullable<Chord> chromatic_symbol_chord(std::string_view text, const ResolvedKey& key) {
  if (text == kNeapolitanSixth) {
    // Exactly the chord `bII6` builds: the major triad on b2, third in the bass.
    int root_pc = pitch_class_of(key.scale.rootPc + 1);
    SpelledChordParts parts;
    parts.bassPc = pitch_class_of(root_pc + 4);
    parts.rootSpelling = numeral_root_spelling(key.tonic, 2, root_pc);
    return make_spelled_chord(root_pc, ChordQuality::kMaj, parts);
  }
  return augmented_sixth_from_symbol(text, key);
}

/** The local major key an applied numeral is read in (`tonicizedKey`). */
ResolvedKey tonicized_key(double target_root, const ResolvedKey& key,
                          const std::optional<PitchSpelling>& written = std::nullopt) {
  NoteData tonic = written ? NoteData{written->letter, written->alter, std::nullopt}
                           : spell_pitch_class(target_root, key.tonic, key.scale);
  return resolve_key(KeyData{major_key(target_root).scale(), tonic, std::nullopt});
}

/** The degree an augmented sixth is applied to, or null (`augmentedSixthTarget`). */
Nullable<TonicizableDegree> augmented_sixth_target(const Chord& chord, const ResolvedKey& key) {
  if (!chord_tone_spellings(chord)) {
    return std::nullopt;
  }
  for (const TonicizableDegree& degree : tonicizable_degrees(key.scale)) {
    if (degree.degreeNumber == 1) {
      continue;
    }
    if (augmented_sixth_symbol(chord, tonicized_key(degree.rootPc, key))) {
      return degree;
    }
  }
  return std::nullopt;
}

/** Build a chord from a parsed Roman numeral, attaching a bass for inversions (`chordFromParsed`).
 */
Chord chord_from_parsed(const ParsedRoman& parsed) {
  const std::vector<double>& intervals = quality_intervals(parsed.quality);
  SpelledChordParts parts;
  parts.rootSpelling = parsed.rootSpelling;
  if (parsed.inversion > 0 && static_cast<std::size_t>(parsed.inversion) < intervals.size()) {
    parts.bassPc =
        pitch_class_of(parsed.rootPc + intervals[static_cast<std::size_t>(parsed.inversion)]);
  }
  return make_spelled_chord(parsed.rootPc, parsed.quality, parts);
}

/** Choose the degree number and accidental to spell a root as a numeral (`romanSpelling`). */
std::pair<int, std::string> roman_spelling(double root_pc, const KeyScale& key,
                                           ChordQuality quality) {
  std::vector<int> tones = scale_tones_in_degree_order(roman_reference(key));
  int target = pitch_class_of(root_pc);
  auto diatonic = std::find(tones.begin(), tones.end(), target);
  if (diatonic != tones.end()) {
    return {static_cast<int>(diatonic - tones.begin()) + 1, ""};
  }
  // A chromatic root a semitone above a degree the mode already lowers is that degree raised.
  std::vector<int> lowered = lowered_degrees(roman_reference(key));
  for (std::size_t i = 0; i < tones.size(); ++i) {
    int degree = static_cast<int>(i) + 1;
    if (std::find(lowered.begin(), lowered.end(), degree) != lowered.end() &&
        pitch_class_of(tones[i] + 1) == target) {
      return {degree, "#"};
    }
  }
  // Otherwise prefer a flat of the diatonic degree a semitone above it, then a sharp of the degree
  // a semitone below. Degree 1 and degree 5 are skipped in the flat pass, and a leading-tone
  // quality goes straight to the sharp pass.
  for (std::size_t i = 0; i < tones.size() && !is_leading_tone_quality(quality); ++i) {
    int degree = static_cast<int>(i) + 1;
    if (degree == 1 || degree == 5) {
      continue;
    }
    if (pitch_class_of(tones[i] - 1) == target) {
      return {degree, "b"};
    }
  }
  for (std::size_t i = 0; i < tones.size(); ++i) {
    if (pitch_class_of(tones[i] + 1) == target) {
      return {static_cast<int>(i) + 1, "#"};
    }
  }
  const OffsetSpelling& row =
      kOffsetSpelling[static_cast<std::size_t>(pitch_class_of(root_pc - key.rootPc))];
  return {row.degreeNumber, std::string(row.accidental)};
}

/** The accidental a seventh-degree numeral is written with (`seventhDegreeAccidental`). */
std::string seventh_degree_accidental(const std::string& accidental, int degree_number,
                                      ChordQuality quality, const KeyScale& key) {
  std::vector<int> lowered = lowered_degrees(roman_reference(key));
  if (degree_number != 7 || !is_leading_tone_quality(quality) ||
      std::find(lowered.begin(), lowered.end(), 7) == lowered.end()) {
    return accidental;
  }
  if (accidental == "#") {
    return "";
  }
  return accidental.empty() ? "b" : accidental;
}

/** Quality marker, without the seventh digit, used when a figure carries the 7 (`baseMarker`). */
std::string_view base_marker(ChordQuality quality) {
  if (quality == ChordQuality::kDim || quality == ChordQuality::kDim7) {
    return "o";
  }
  if (quality == ChordQuality::kM7b5) {
    return "\xC3\xB8";
  }
  if (quality == ChordQuality::kAug || quality == ChordQuality::kAug7) {
    return "+";
  }
  if (quality == ChordQuality::kAugMaj7) {
    return "+maj7";
  }
  if (quality == ChordQuality::kMaj7 || quality == ChordQuality::kMinMaj7) {
    return "maj7";
  }
  return "";
}

/** The numeral glyph for a degree number, cased for the chord quality (`numeralFor`). */
std::string numeral_for(int degree_number, bool lower) {
  if (degree_number < 1 || static_cast<std::size_t>(degree_number) > kRoman.size()) {
    throw InvalidInputError("no Roman numeral for scale degree " + js::to_string(degree_number));
  }
  std::string glyph(kRoman[static_cast<std::size_t>(degree_number) - 1]);
  if (lower) {
    for (char& c : glyph) {
      c = static_cast<char>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
    }
  }
  return glyph;
}

/** The phrase naming where a numeral's root came from (`describeDegree`). */
std::string describe_degree(int degree_number, const std::string& accidental,
                            const std::string& literal) {
  std::string name =
      degree_number >= 1 && static_cast<std::size_t>(degree_number) <= kDegreeNames.size()
          ? std::string(kDegreeNames[static_cast<std::size_t>(degree_number) - 1])
          : js::to_string(degree_number) + "th";
  if (accidental != literal) {
    return literal.empty()
               ? "the root is the " + name +
                     " degree of the key, written with a flat because the bare numeral is "
                     "reserved by convention for the raised leading tone above it"
               : "the root is the raised leading tone, a semitone above the " + name +
                     " degree of the key, which the bare numeral denotes by convention";
  }
  if (literal.empty()) {
    return "the root is the " + name + " degree of the key";
  }
  std::string direction = literal == "b" ? "lowered" : "raised";
  return "the root is chromatic, spelled as the " + name + " degree " + direction + " a semitone";
}

/** The phrase naming what became of the chord's bass (`describeBass`). */
std::string describe_bass(RomanBass bass, const std::optional<std::string>& figure) {
  switch (bass) {
    case RomanBass::kRoot:
      return "and the chord stands on its own root";
    case RomanBass::kFigured:
      return figure ? "and the bass is an inversion, figured " + *figure
                    : "and the bass is an inversion";
    case RomanBass::kUnfigurable:
      return "and the bass names no lossless figure for this quality, so the numeral is written "
             "in root position";
    case RomanBass::kForeign:
      return "and the bass is not a chord tone, so the numeral names the upper chord alone";
  }
  return {};
}

/** How a chord is numbered: against a local tonic it tonicizes, or by its own root. */
struct NumeralReading {
  Nullable<TonicizableDegree> target;
  int degreeNumber = 1;
  std::string accidental;
};

/**
 * The root a chord writes, when its spelling hint is usable: a letter and an alteration that still
 * sound the chord's root (`writtenRoot`).
 */
std::optional<PitchSpelling> written_root(const Chord& chord) {
  const std::optional<PitchSpelling>& hint = chord.rootSpelling;
  if (!hint || std::floor(hint->letter) != hint->letter || hint->letter < 0 || hint->letter > 6 ||
      std::floor(hint->alter) != hint->alter ||
      pitch_class_of(natural_pitch_class_of(hint->letter) + hint->alter) !=
          pitch_class_of(chord.rootPc)) {
    return std::nullopt;
  }
  return hint;
}

/**
 * The numeral a written root denotes: the degree on its letter, with the alteration it stands at
 * above that degree of the key (`writtenSpelling`); nullopt when the root is a degree of the key,
 * which takes its own numeral however it is spelled, or when no single accidental names it.
 */
std::optional<std::pair<int, std::string>> written_spelling(
    double root_pc, const std::optional<PitchSpelling>& written, const ResolvedKey& resolved) {
  std::vector<int> tones = scale_tones_in_degree_order(roman_reference(resolved.scale));
  if (!written || std::find(tones.begin(), tones.end(), pitch_class_of(root_pc)) != tones.end()) {
    return std::nullopt;
  }
  int degree_number = diatonic_letter_of(written->letter - resolved.tonic.letter) + 1;
  if (degree_number < 1 || static_cast<std::size_t>(degree_number) > tones.size()) {
    return std::nullopt;
  }
  int offset = pitch_class_of(root_pc - tones[static_cast<std::size_t>(degree_number) - 1] + 6) - 6;
  if (std::abs(offset) > 1) {
    return std::nullopt;
  }
  return std::make_pair(degree_number, std::string(offset < 0 ? "b" : offset > 0 ? "#" : ""));
}

/**
 * Whether a leading-tone chord's written root leads to the target: a semitone below it and on the
 * letter just below it (`leadsByLetter`).
 */
bool leads_by_letter(const Chord& chord, const std::optional<PitchSpelling>& written,
                     const TonicizableDegree& target, const ResolvedKey& resolved) {
  if (!written || !is_leading_tone_quality(chord.quality)) {
    return true;
  }
  double target_letter = spell_pitch_class(target.rootPc, resolved.tonic, resolved.scale).letter;
  return diatonic_letter_of(target_letter - written->letter) == 1;
}

/**
 * The one reading that decides how a chord is numbered (`readNumeral`): applied when asked for and
 * the function layer accepts the chord as tonicizing, otherwise by its root.
 */
NumeralReading read_numeral(const Chord& chord, const ResolvedKey& resolved, bool applied) {
  const KeyScale& key = resolved.scale;
  std::optional<PitchSpelling> written = written_root(chord);
  if (applied) {
    // The augmented sixth of a degree is asked for first, and is not held to the chromatic test
    // the ordinary reading is.
    Nullable<TonicizableDegree> target = augmented_sixth_target(chord, resolved);
    if (!target) {
      target = is_applied_dominant(chord, key) ? applied_target(chord, key)
                                               : Nullable<TonicizableDegree>();
    }
    if (target && leads_by_letter(chord, written, *target, resolved)) {
      NumeralReading reading;
      reading.target = target;
      return reading;
    }
  }
  std::pair<int, std::string> spelled =
      written_spelling(chord.rootPc, written, resolved)
          .value_or(roman_spelling(chord.rootPc, key, chord.quality));
  NumeralReading reading;
  reading.degreeNumber = spelled.first;
  reading.accidental = spelled.second;
  return reading;
}

}  // namespace

RomanRendering render_roman(const Chord& chord, const KeyArg& key_like,
                            const ChordToRomanOptions& opts, const InheritedQuality* inherited) {
  // The key is resolved once and kept whole for the reading that needs its letters.
  ResolvedKey resolved = resolve_key(key_like);
  const KeyScale& key = resolved.scale;
  // The augmented sixths come first and unconditionally.
  if (Nullable<std::string_view> augmented = augmented_sixth_symbol(chord, resolved)) {
    RomanRendering out;
    out.roman = std::string(*augmented);
    out.derivation.kind = RomanDerivation::Kind::kAugmentedSixth;
    return out;
  }
  NumeralReading reading = read_numeral(chord, resolved, opts.applied == true);
  if (reading.target) {
    const TonicizableDegree& target = *reading.target;
    std::string local = render_roman(chord, tonicized_key(target.rootPc, resolved),
                                     ChordToRomanOptions{}, inherited)
                            .roman;
    std::string numeral = numeral_for(target.degreeNumber, target.lower);
    RomanRendering out;
    out.roman = local + "/" + numeral;
    out.derivation.kind = RomanDerivation::Kind::kApplied;
    out.derivation.target = numeral;
    return out;
  }
  int degree_number = reading.degreeNumber;
  const std::string& spelled_accidental = reading.accidental;
  const RomanStyle style =
      inherited != nullptr ? RomanStyle{false, "undefined"} : roman_style(chord.quality);
  std::string cased = numeral_for(degree_number, style.lower);
  // Render the conventional unaltered `viio`/`viio7` for the raised leading tone in a minor key.
  std::string accidental =
      seventh_degree_accidental(spelled_accidental, degree_number, chord.quality, key);

  int inversion = 0;
  RomanBass bass = RomanBass::kRoot;
  if (chord.bassPc) {
    std::ptrdiff_t index = -1;
    for (std::size_t i = 0; i < chord.intervals.size(); ++i) {
      if (pitch_class_of(chord.rootPc + chord.intervals[i]) == *chord.bassPc) {
        index = static_cast<std::ptrdiff_t>(i);
        break;
      }
    }
    if (index > 0) {
      inversion = static_cast<int>(index);
    } else if (index < 0) {
      bass = RomanBass::kForeign;
    }
  }
  if (opts.neapolitan == true && inversion == 1 && is_neapolitan_chord_of(chord, key)) {
    RomanRendering out;
    out.roman = std::string(kNeapolitanSixth);
    out.derivation.kind = RomanDerivation::Kind::kNeapolitan;
    return out;
  }
  RomanDerivation derivation;
  derivation.kind = RomanDerivation::Kind::kDegree;
  derivation.degreeNumber = degree_number;
  derivation.accidental = accidental;
  derivation.literalAccidental = spelled_accidental;
  derivation.quality =
      inherited != nullptr ? inherited->name : std::string(to_string(chord.quality));
  if (inversion > 0) {
    std::optional<std::string_view> figure;
    if (names_quality(kSeventhFigureQualities, chord.quality)) {
      figure = text_at(kSeventhFigures, inversion);
    } else if (names_quality(kTriadFigureQualities, chord.quality)) {
      figure = text_at(kTriadFigures, inversion);
    }
    if (figure) {
      derivation.bass = RomanBass::kFigured;
      derivation.figure = std::string(*figure);
      RomanRendering out;
      out.roman =
          accidental + cased + std::string(base_marker(chord.quality)) + std::string(*figure);
      out.derivation = std::move(derivation);
      return out;
    }
    // No lossless figured-bass symbol exists, so fall back to root-position rendering with the
    // quality suffix rather than emitting a figure that would re-parse as a different chord.
    bass = RomanBass::kUnfigurable;
  }
  derivation.bass = bass;
  RomanRendering out;
  out.roman = accidental + cased + std::string(style.suffix);
  out.derivation = std::move(derivation);
  return out;
}

std::string describe_roman(const std::string& roman, const RomanDerivation& derivation) {
  switch (derivation.kind) {
    case RomanDerivation::Kind::kAugmentedSixth:
      return roman +
             ": an augmented sixth, which no numeral spells, standing on the lowered submediant";
    case RomanDerivation::Kind::kApplied:
      return roman + ": an applied chord, named in the local key its target degree " +
             derivation.target + " makes a tonic";
    case RomanDerivation::Kind::kNeapolitan:
      return roman +
             ": the first-inversion Neapolitan under its figured name, the chord bII6 also spells";
    case RomanDerivation::Kind::kDegree: {
      std::string text = roman + ": " +
                         describe_degree(derivation.degreeNumber, derivation.accidental,
                                         derivation.literalAccidental) +
                         ", the case and suffix come from the " + derivation.quality +
                         " quality, " + describe_bass(derivation.bass, derivation.figure);
      bool tonic_six_four = derivation.degreeNumber == 1 && derivation.accidental.empty() &&
                            derivation.figure && *derivation.figure == "64";
      return tonic_six_four ? text + std::string(kSixFourNote) : text;
    }
  }
  return {};
}

std::vector<RejectedCandidate> roman_alternatives(const Chord& chord, const KeyArg& key,
                                                  const ChordToRomanOptions& opts,
                                                  const InheritedQuality* inherited) {
  std::string emitted = render_roman(chord, key, opts, inherited).roman;
  std::vector<RejectedCandidate> out;
  ChordToRomanOptions flipped_applied = opts;
  flipped_applied.applied = opts.applied != true;
  std::string flipped_applied_roman = render_roman(chord, key, flipped_applied, inherited).roman;
  if (flipped_applied_roman != emitted) {
    out.push_back(RejectedCandidate{
        flipped_applied_roman,
        opts.applied == true
            ? "Naming the root against the home key is always a correct spelling; `applied` asked "
              "for the tonicizing reading instead"
            : "Whether a chromatic dominant is genuinely applied is a reading only the caller can "
              "make, so the root is named against the home key unless `applied` asks otherwise"});
  }
  ChordToRomanOptions flipped_neapolitan = opts;
  flipped_neapolitan.neapolitan = opts.neapolitan != true;
  std::string flipped_neapolitan_roman =
      render_roman(chord, key, flipped_neapolitan, inherited).roman;
  if (flipped_neapolitan_roman != emitted) {
    out.push_back(RejectedCandidate{
        flipped_neapolitan_roman,
        "Both spellings name the same chord, so which one to write is a house-style choice "
        "`neapolitan` settles"});
  }
  return out;
}

std::string chord_to_roman(const ChordArg& chord, const KeyArg& key,
                           const ChordToRomanOptions& opts) {
  Chord data = to_chord_data(chord);
  return render_roman(data, key, opts).roman;
}

RomanExplanation explain_roman(const ChordArg& chord, const KeyArg& key,
                               const ExplainRomanOptions& opts) {
  Chord data = to_chord_data(chord);
  RomanRendering rendering = render_roman(data, key, opts);
  RomanExplanation out;
  out.rationale = describe_roman(rendering.roman, rendering.derivation);
  out.roman = std::move(rendering.roman);
  if (opts.alternatives == true) {
    out.alternatives = roman_alternatives(data, key, opts);
  }
  return out;
}

Chord roman_to_chord(std::string_view text, const KeyArg& key) {
  // The key is kept whole: the chromatic chords named as whole symbols are spelled from its tonic.
  ResolvedKey resolved = resolve_key(key);
  // Accept the conventional slashes in figured bass (`V6/4`, `V6/5`) while retaining `/` as the
  // separator for applied dominants (`V7/V`).
  std::string stripped = js::trim(text);
  std::string trimmed;
  for (std::size_t i = 0; i < stripped.size(); ++i) {
    char c = stripped[i];
    bool digit = c >= '0' && c <= '9';
    if (digit && i + 2 < stripped.size() && stripped[i + 1] == '/' && stripped[i + 2] >= '0' &&
        stripped[i + 2] <= '9') {
      trimmed += c;
      ++i;
      continue;
    }
    trimmed += c;
  }
  std::size_t slash = trimmed.find('/');
  if (slash != std::string::npos) {
    std::string applied = trimmed.substr(0, slash);
    std::string target = trimmed.substr(slash + 1);
    ParsedRoman target_numeral = parse_simple_roman(target, resolved);
    ResolvedKey local = tonicized_key(target_numeral.rootPc, resolved, target_numeral.rootSpelling);
    if (Nullable<Chord> chromatic = chromatic_symbol_chord(applied, local)) {
      return *chromatic;
    }
    return chord_from_parsed(parse_simple_roman(applied, local));
  }
  if (Nullable<Chord> chromatic = chromatic_symbol_chord(trimmed, resolved)) {
    return *chromatic;
  }
  return chord_from_parsed(parse_simple_roman(trimmed, resolved));
}

}  // namespace cantus
