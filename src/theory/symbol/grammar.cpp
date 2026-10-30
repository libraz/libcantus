// What a chord symbol may say, and how it is read: ts/src/theory/symbol/grammar.ts.

#include "theory/symbol/grammar.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <utility>

#include "core/pitch/naming.h"
#include "js/number.h"
#include "js/utf16.h"
#include "theory/chord/spec.h"

namespace cantus {

namespace {

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

/** One entry of a table keyed by name, with a number. */
struct NamedInt {
  std::string_view name;
  int value;
};

/** A token and the name it stands for. */
struct TokenName {
  std::string_view token;
  std::string_view value;
};

/** A token and the number it stands for. */
struct TokenInt {
  std::string_view token;
  int value;
};

/** A glyph that names a base and the seventh over it. */
struct CompoundToken {
  std::string_view token;
  struct {
    std::string_view base;
    std::string_view seventh;
  } value;
};

constexpr NamedName kQualityMap[] =
#include "theory/symbol/quality_map.gen.inc"
    ;

constexpr TokenName kBaseTokens[] =
#include "theory/symbol/base_tokens.gen.inc"
    ;

constexpr CompoundToken kCompoundTokens[] =
#include "theory/symbol/compound_tokens.gen.inc"
    ;

constexpr TokenName kMajorMarkers[] =
#include "theory/symbol/major_markers.gen.inc"
    ;

constexpr int kExtensionNumbers[] =
#include "theory/symbol/extension_numbers.gen.inc"
    ;

constexpr NamedInt kAddedDegrees[] =
#include "theory/symbol/added_degrees.gen.inc"
    ;

constexpr NamedInt kAlterable[] =
#include "theory/symbol/alterable.gen.inc"
    ;

constexpr NamedInt kOmittable[] =
#include "theory/symbol/omittable.gen.inc"
    ;

constexpr TokenName kSuspensionTokens[] =
#include "theory/symbol/suspension_tokens.gen.inc"
    ;

constexpr TokenInt kOmissionTokens[] =
#include "theory/symbol/omission_tokens.gen.inc"
    ;

constexpr TokenInt kAccidentalTokens[] =
#include "theory/symbol/accidental_tokens.gen.inc"
    ;

/** The base the table value `major` stands for instead of a base. */
constexpr std::string_view kMajorToken = "major";

/** The marker kind that names the seventh on its own. */
constexpr std::string_view kGlyphMarker = "glyph";

/** The glyphs that open a major-seventh marker; `Maj` and `M` are words. */
constexpr std::string_view kDeltaGlyph = "Δ";
constexpr std::string_view kCaretGlyph = "^";

/** The altered dominant, whichever way it is reached. */
constexpr std::string_view kAltWord = "alt";
constexpr std::string_view kAddWord = "add";

/** A chord read token by token, before it settles into a spec (`SpecDraft`). */
struct SpecDraft {
  ChordBase base = ChordBase::kMaj;
  std::optional<ChordSeventh> seventh;
  /** In insertion order, one per degree and accidental. */
  std::vector<Alteration> alterations;
  std::vector<int> additions;
  std::vector<int> omissions;
  std::optional<ChordSeventh> seventh_over_base;
  /** Degrees the extension number implied, which a written figure replaces. */
  std::vector<int> implied;
  bool major = false;
};

bool is_alteration(const Alteration& a, int degree, double alter) {
  return a.degree == degree && a.alter == alter;
}

void erase_alteration(SpecDraft& draft, int degree, double alter) {
  draft.alterations.erase(
      std::remove_if(draft.alterations.begin(), draft.alterations.end(),
                     [&](const Alteration& a) { return is_alteration(a, degree, alter); }),
      draft.alterations.end());
}

/** `Map.set` on the alteration key: a repeated key keeps its place. */
void set_alteration(SpecDraft& draft, int degree, double alter) {
  for (Alteration& a : draft.alterations) {
    if (is_alteration(a, degree, alter)) {
      a = Alteration{degree, alter};
      return;
    }
  }
  draft.alterations.push_back(Alteration{degree, alter});
}

/** `Set.add`. */
void add_unique(std::vector<int>& set, int value) {
  if (std::find(set.begin(), set.end(), value) == set.end()) {
    set.push_back(value);
  }
}

/** Record an alteration the symbol writes out (`writeAlteration`). */
void write_alteration(SpecDraft& draft, int degree, double alter) {
  auto implied = std::find(draft.implied.begin(), draft.implied.end(), degree);
  if (implied != draft.implied.end()) {
    draft.implied.erase(implied);
    erase_alteration(draft, degree, 0);
  }
  set_alteration(draft, degree, alter);
}

/** Record an unaltered degree the extension number stacks up to (`implyAlteration`). */
void imply_alteration(SpecDraft& draft, int degree) {
  add_unique(draft.implied, degree);
  set_alteration(draft, degree, 0);
}

/** Whether the draft already carries an alteration of `degree` (`altersDegree`). */
bool alters_degree(const SpecDraft& draft, int degree) {
  return std::any_of(draft.alterations.begin(), draft.alterations.end(),
                     [&](const Alteration& a) { return a.degree == degree; });
}

bool starts_with(std::string_view text, std::size_t at, std::string_view token) {
  return at <= text.size() && text.compare(at, token.size(), token) == 0;
}

/** A matched token: the row it came from and where it ends. */
template <class Row>
struct Match {
  const Row* row;
  std::size_t next;
};

/** The longest token in `table` that `text` carries at `at` (`matchToken`). */
template <class Row, std::size_t N>
std::optional<Match<Row>> match_token(std::string_view text, std::size_t at,
                                      const Row (&table)[N]) {
  std::optional<Match<Row>> found;
  for (const Row& row : table) {
    if (starts_with(text, at, row.token) && (!found || at + row.token.size() > found->next)) {
      found = Match<Row>{&row, at + row.token.size()};
    }
  }
  return found;
}

/** `matchToken` over a table of degree numbers keyed by their text (`matchNumberToken`). */
template <std::size_t N>
std::optional<std::pair<int, std::size_t>> match_number_token(std::string_view text, std::size_t at,
                                                              const NamedInt (&table)[N]) {
  std::optional<std::pair<int, std::size_t>> found;
  for (const NamedInt& row : table) {
    if (starts_with(text, at, row.name) && (!found || at + row.name.size() > found->second)) {
      found = std::make_pair(row.value, at + row.name.size());
    }
  }
  return found;
}

/** The number token at `at`, longest first so 11 and 13 are not read as 1 (`matchNumber`). */
std::optional<std::pair<int, std::size_t>> match_number(std::string_view text, std::size_t at) {
  for (int value : kExtensionNumbers) {
    std::string token = js::to_string(value);
    if (starts_with(text, at, token)) {
      return std::make_pair(value, at + token.size());
    }
  }
  return std::nullopt;
}

/** Stack the draft up to an extension number (`stackTo`). */
void stack_to(SpecDraft& draft, int top) {
  if (top == 6) {
    add_unique(draft.additions, 6);
    return;
  }
  draft.seventh = draft.major ? ChordSeventh::kMaj7
                              : draft.seventh_over_base.value_or(draft.base == ChordBase::kDim
                                                                     ? ChordSeventh::kDim7
                                                                     : ChordSeventh::kMin7);
  if (top >= 9) {
    imply_alteration(draft, 9);
  }
  if (top == 11) {
    imply_alteration(draft, 11);
    if (!draft.major && draft.base == ChordBase::kMaj) {
      add_unique(draft.omissions, 3);
    }
  }
  if (top == 13) {
    imply_alteration(draft, 13);
  }
}

/** Whether the draft's fifth has already been written by the symbol (`writesFifth`). */
bool writes_fifth(const SpecDraft& draft) {
  return draft.base == ChordBase::kDim || draft.base == ChordBase::kAug || alters_degree(draft, 5);
}

/** Apply one figure written after the chord's core, or report that it is none (`applyFigure`). */
std::optional<std::size_t> apply_figure(SpecDraft& draft, std::string_view text, std::size_t at) {
  if (auto base = match_token(text, at, kSuspensionTokens)) {
    draft.base = *parse_chord_base(base->row->value);
    return base->next;
  }
  if (starts_with(text, at, kAltWord)) {
    draft.base = ChordBase::kAug;
    draft.seventh = ChordSeventh::kMin7;
    write_alteration(draft, 9, 1);
    return at + kAltWord.size();
  }
  if (starts_with(text, at, kAddWord)) {
    auto degree = match_number_token(text, at + kAddWord.size(), kAddedDegrees);
    if (!degree) {
      return std::nullopt;
    }
    add_unique(draft.additions, degree->first);
    return degree->second;
  }
  if (auto omitted = match_token(text, at, kOmissionTokens)) {
    auto degree = match_number_token(text, omitted->next, kOmittable);
    if (!degree) {
      return std::nullopt;
    }
    add_unique(draft.omissions, degree->first);
    return degree->second;
  }
  auto accidental = match_token(text, at, kAccidentalTokens);
  std::size_t from = accidental ? accidental->next : at;
  auto degree = match_number_token(text, from, kAlterable);
  if (!degree) {
    return std::nullopt;
  }
  // A symbol writes its fifth once; a bare or repeated fifth figure fails the whole symbol.
  if (degree->first == 5 && (!accidental || writes_fifth(draft))) {
    return std::nullopt;
  }
  write_alteration(draft, degree->first, accidental ? accidental->row->value : 0);
  return degree->second;
}

/** One way a suffix's opening characters can be read (`Opening`). */
struct Opening {
  std::size_t length = 0;
  std::optional<ChordBase> base;
  std::optional<ChordSeventh> seventh;
  bool major = false;
  bool glyph = false;
};

/** The ways a suffix can open, in the order they are worth trying (`openings`). */
std::vector<std::optional<Opening>> openings(std::string_view core) {
  std::vector<Opening> found;
  for (const CompoundToken& entry : kCompoundTokens) {
    if (starts_with(core, 0, entry.token)) {
      Opening opening;
      opening.length = entry.token.size();
      opening.base = parse_chord_base(entry.value.base);
      opening.seventh = parse_chord_seventh(entry.value.seventh);
      found.push_back(opening);
    }
  }
  for (const TokenName& entry : kBaseTokens) {
    if (!starts_with(core, 0, entry.token)) {
      continue;
    }
    Opening opening;
    opening.length = entry.token.size();
    if (entry.value == kMajorToken) {
      opening.major = true;
      opening.glyph = entry.token == kDeltaGlyph || entry.token == kCaretGlyph;
    } else {
      opening.base = parse_chord_base(entry.value);
    }
    found.push_back(opening);
  }
  std::stable_sort(found.begin(), found.end(),
                   [](const Opening& a, const Opening& b) { return a.length > b.length; });
  std::vector<std::optional<Opening>> out(found.begin(), found.end());
  // Reading no base at all is the last resort.
  out.push_back(std::nullopt);
  return out;
}

/** Split a bracket group at runs of `,` `/` and white space (`split(/[,/\s]+/)`). */
std::vector<std::string> split_figures(std::string_view group) {
  std::vector<std::string> out;
  std::string current;
  std::size_t i = 0;
  while (i < group.size()) {
    std::size_t start = i;
    std::uint32_t cp = js::detail::decode_wtf8(group, i);
    bool separator =
        cp == ',' || cp == '/' || (cp <= 0xFFFF && js::is_space(static_cast<char16_t>(cp)));
    if (separator) {
      out.push_back(current);
      current.clear();
    } else {
      current.append(group.substr(start, i - start));
    }
  }
  out.push_back(current);
  return out;
}

/**
 * Read a suffix's core and bracketed groups under one reading of its opening, or nullopt when that
 * reading leaves anything unread (`readCore`).
 */
std::optional<ChordSpec> read_core(std::string_view core, const std::vector<std::string>& groups,
                                   const std::optional<Opening>& opening) {
  SpecDraft draft;
  std::size_t at = 0;
  bool marker_glyph = false;
  bool marker_after_base = false;
  if (opening) {
    at = opening->length;
    if (opening->major) {
      draft.major = true;
      marker_glyph = opening->glyph;
    } else if (opening->base) {
      draft.base = *opening->base;
      if (opening->seventh) {
        draft.seventh = opening->seventh;
        draft.seventh_over_base = opening->seventh;
      }
    }
  }
  if (!draft.major) {
    if (auto marker = match_token(core, at, kMajorMarkers)) {
      draft.major = true;
      marker_glyph = marker->row->value == kGlyphMarker;
      marker_after_base = opening.has_value();
      at = marker->next;
    }
  }
  if (auto number = match_number(core, at)) {
    at = number->second;
    stack_to(draft, number->first);
  } else if (draft.major && (marker_glyph || marker_after_base)) {
    // A marker with no number after it names the seventh itself, but not as the whole suffix.
    draft.seventh = ChordSeventh::kMaj7;
  }
  while (at < core.size()) {
    // Between two figures a '/' separates them; a leading or trailing one is a stray character.
    if (core[at] == '/' && at > 0 && at + 1 < core.size()) {
      at += 1;
      continue;
    }
    std::optional<std::size_t> next = apply_figure(draft, core, at);
    if (!next || *next == at) {
      return std::nullopt;
    }
    at = *next;
  }
  for (const std::string& group : groups) {
    for (const std::string& figure : split_figures(group)) {
      if (figure.empty()) {
        continue;
      }
      std::optional<std::size_t> next = apply_figure(draft, figure, 0);
      if (!next || *next != figure.size()) {
        return std::nullopt;
      }
    }
  }
  ChordSpec spec;
  spec.rootPc = 0;
  spec.base = draft.base;
  spec.seventh = draft.seventh;
  spec.alterations = draft.alterations;
  spec.additions = draft.additions;
  spec.omissions = draft.omissions;
  return spec;
}

/** Read a quality suffix as a chord, or nullopt when it is not one (`structuralSpec`). */
std::optional<ChordSpec> structural_spec(std::string_view text) {
  std::string core;
  std::vector<std::string> groups;
  bool inside = false;
  std::string buffer;
  for (char c : text) {
    if (c == '(') {
      if (inside) {
        return std::nullopt;
      }
      inside = true;
      buffer.clear();
    } else if (c == ')') {
      if (!inside) {
        return std::nullopt;
      }
      inside = false;
      groups.push_back(buffer);
    } else if (inside) {
      buffer += c;
    } else {
      core += c;
    }
  }
  if (inside) {
    return std::nullopt;
  }
  for (const std::optional<Opening>& opening : openings(core)) {
    if (std::optional<ChordSpec> spec = read_core(core, groups, opening)) {
      return spec;
    }
  }
  return std::nullopt;
}

/** The quality a suffix names outright (`knownQuality`). */
std::optional<ChordQuality> known_quality(std::string_view suffix) {
  for (const NamedName& row : kQualityMap) {
    if (row.name == suffix) {
      return parse_chord_quality(row.value);
    }
  }
  return std::nullopt;
}

/** The chord a quality suffix names, or nullopt when it names none (`suffixSpec`). */
std::optional<ChordSpec> suffix_spec(std::string_view suffix) {
  if (std::optional<ChordQuality> quality = known_quality(suffix)) {
    return chord_spec_for_quality(*quality, 0);
  }
  return structural_spec(suffix);
}

/** Read `text` as an octave-less note in `system`, or nullopt when it is none (`bareNote`). */
std::optional<NoteData> bare_note(std::string_view text, NoteNameSystem system) {
  NoteNameOptions opts;
  opts.system = system;
  ParseResult<NoteData> read = try_parse_note(text, opts);
  if (!read.ok()) {
    return std::nullopt;
  }
  return read.value().octave ? std::nullopt : std::optional<NoteData>(read.value());
}

bool is_letter(char c) { return (c >= 'A' && c <= 'G') || (c >= 'a' && c <= 'g'); }

/** The length of the match of `^[A-Ga-g](?:#{1,2}|b{1,2}|x)?`, or 0. */
std::size_t english_root_length(std::string_view text) {
  if (text.empty() || !is_letter(text[0])) {
    return 0;
  }
  std::size_t end = 1;
  if (end < text.size() && (text[end] == '#' || text[end] == 'b')) {
    char accidental = text[end];
    end += 1;
    if (end < text.size() && text[end] == accidental) {
      end += 1;
    }
  } else if (end < text.size() && text[end] == 'x') {
    end += 1;
  }
  return end;
}

/** Read a slash-chord bass, which is a bare note in the symbol's own system (`bassNote`). */
std::optional<NoteData> bass_note(std::string_view text, NoteNameSystem system) {
  if (system == NoteNameSystem::kEnglish) {
    if (english_root_length(text) != text.size() || text.empty()) {
      return std::nullopt;
    }
    NoteNameOptions opts;
    opts.system = system;
    return parse_note(text, opts);
  }
  return bare_note(text, system);
}

/** Build a chord and record the parsed spellings as enharmonic hints (`chordFromSymbolParts`). */
Chord chord_from_symbol_parts(const NoteData& root, ChordSpec spec,
                              const std::optional<NoteData>& bass) {
  spec.rootPc = note_to_pitch_class(root);
  if (bass) {
    spec.bassPc = note_to_pitch_class(*bass);
  }
  Chord chord = chord_from_spec(spec);
  chord.rootSpelling =
      PitchSpelling{static_cast<double>(root.letter), static_cast<double>(root.alter)};
  if (bass) {
    chord.bassSpelling =
        PitchSpelling{static_cast<double>(bass->letter), static_cast<double>(bass->alter)};
  }
  return chord;
}

}  // namespace

std::vector<RootSplit> root_splits(std::string_view text, NoteNameSystem system) {
  NoteNameOptions opts;
  opts.system = system;
  if (system == NoteNameSystem::kEnglish) {
    std::size_t length = english_root_length(text);
    if (length == 0) {
      return {};
    }
    return {RootSplit{parse_note(text.substr(0, length), opts), std::string(text.substr(length))}};
  }
  std::vector<RootSplit> splits;
  std::u16string units = js::to_utf16(text);
  std::size_t longest = std::min<std::size_t>(units.size(), max_note_name_length(system));
  for (std::size_t end = longest; end > 0; --end) {
    std::optional<NoteData> root = bare_note(js::from_utf16(units.substr(0, end)), system);
    if (root) {
      splits.push_back(RootSplit{*root, js::from_utf16(std::u16string_view(units).substr(end))});
    }
  }
  return splits;
}

std::optional<Chord> chord_after_root(const NoteData& root, std::string_view rest,
                                      NoteNameSystem system) {
  // Split at the last '/' so the '6/9' quality's own slash never masks a trailing slash bass.
  std::size_t slash = rest.rfind('/');
  if (slash != std::string_view::npos) {
    std::optional<ChordSpec> slash_spec = suffix_spec(rest.substr(0, slash));
    std::optional<NoteData> bass;
    if (slash_spec) {
      bass = bass_note(rest.substr(slash + 1), system);
    }
    if (slash_spec && bass) {
      return chord_from_symbol_parts(root, *slash_spec, bass);
    }
  }
  std::optional<ChordSpec> spec = suffix_spec(rest);
  if (!spec) {
    return std::nullopt;
  }
  return chord_from_symbol_parts(root, *spec, std::nullopt);
}

}  // namespace cantus
