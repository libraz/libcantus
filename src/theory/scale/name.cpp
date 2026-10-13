// Reading a key from the name it is written under: ts/src/theory/scale/name.ts.

#include "theory/scale/name.h"

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "js/utf16.h"
#include "theory/scale/masks.h"
#include "theory/scale/scales.h"

namespace cantus {

namespace {

/** A scale word with its spacing and case dropped, so two spellings compare (`scaleWordKey`). */
std::string scale_word_key(std::u16string_view text) {
  std::string out;
  for (char16_t unit : text) {
    if (unit >= u'A' && unit <= u'Z') {
      out.push_back(static_cast<char>(unit - u'A' + 'a'));
    } else if ((unit >= u'a' && unit <= u'z') || (unit >= u'0' && unit <= u'9')) {
      out.push_back(static_cast<char>(unit));
    }
  }
  return out;
}

/** The built-in scale each scale word names; a later name with the same word replaces an earlier.
 */
const std::vector<std::pair<std::string, std::string_view>>& scale_by_word() {
  static const std::vector<std::pair<std::string, std::string_view>> table = [] {
    std::vector<std::pair<std::string, std::string_view>> out;
    auto add = [&out](std::string_view name) {
      std::string key = scale_word_key(js::to_utf16(name));
      for (auto& entry : out) {
        if (entry.first == key) {
          entry.second = name;
          return;
        }
      }
      out.emplace_back(std::move(key), name);
    };
    for (const NamedScaleMask& entry : kNamedScales) {
      add(entry.name);
    }
    for (const NamedScaleMask& entry : kWorldScales) {
      add(entry.name);
    }
    for (const ScaleAlias& entry : kScaleAliases) {
      add(entry.alias);
    }
    return out;
  }();
  return table;
}

/** The tonic without its register. */
NoteData bare_tonic(const NoteData& note) {
  return NoteData{note.letter, note.alter, std::nullopt};
}

/** A key named by a tonic and a scale word, or nullopt (`tryNamedScaleKey`). */
std::optional<ResolvedKey> try_named_scale_key(std::string_view text) {
  std::u16string units = js::to_utf16(text);
  std::size_t begin = 0;
  std::size_t end = units.size();
  while (begin < end && js::is_space(units[begin])) {
    ++begin;
  }
  while (end > begin && js::is_space(units[end - 1])) {
    --end;
  }
  std::u16string_view trimmed(units.data() + begin, end - begin);
  std::size_t separator = 0;
  while (separator < trimmed.size() && !js::is_space(trimmed[separator])) {
    ++separator;
  }
  if (separator == trimmed.size()) {
    return std::nullopt;
  }
  std::string word = scale_word_key(trimmed.substr(separator));
  std::optional<std::string_view> name;
  for (const auto& entry : scale_by_word()) {
    if (entry.first == word) {
      name = entry.second;
    }
  }
  if (!name) {
    return std::nullopt;
  }
  ParseResult<NoteData> tonic = try_parse_note(js::from_utf16(trimmed.substr(0, separator)));
  if (!tonic.ok()) {
    return std::nullopt;
  }
  KeyScale scale = named_scale(*name, note_to_pitch_class(tonic.value()));
  return ResolvedKey{scale, bare_tonic(tonic.value()), variant_of_mask(scale.modeMask12)};
}

/** A failed parse of another type, as a failed key resolution. */
template <class T>
ParseResult<ResolvedKey> failure_of(ParseResult<T>&& parsed) {
  try {
    std::move(parsed).unwrap();
  } catch (const InvalidInputError& e) {
    return ParseResult<ResolvedKey>::failure(e);
  } catch (const NoSolutionError& e) {
    return ParseResult<ResolvedKey>::failure(e);
  } catch (const BudgetExceededError& e) {
    return ParseResult<ResolvedKey>::failure(e);
  }
  throw std::logic_error("failure_of: the parse succeeded");
}

}  // namespace

std::optional<std::string_view> scale_name_of_mask(int mask) {
  for (const NamedScaleMask& entry : kNamedScales) {
    if (entry.mask == mask) {
      return entry.name;
    }
  }
  for (const NamedScaleMask& entry : kWorldScales) {
    if (entry.mask == mask) {
      return entry.name;
    }
  }
  return std::nullopt;
}

ParseResult<ResolvedKey> try_resolve_key_name(std::string_view text, const NoteNameOptions& opts) {
  if (!opts.system || *opts.system == NoteNameSystem::kEnglish) {
    if (std::optional<ResolvedKey> named = try_named_scale_key(text)) {
      return ParseResult<ResolvedKey>::success(std::move(*named));
    }
  }
  ParseResult<KeyName> parsed = try_parse_key_name(text, opts);
  if (!parsed.ok()) {
    return failure_of(std::move(parsed));
  }
  NoteData tonic = bare_tonic(parsed.value().tonic);
  int root_pc = note_to_pitch_class(tonic);
  if (parsed.value().mode == KeyNameMode::kMajor) {
    return ParseResult<ResolvedKey>::success(
        ResolvedKey{major_scale(root_pc), tonic, KeyVariant::kMajor});
  }
  return ParseResult<ResolvedKey>::success(
      ResolvedKey{minor_scale(root_pc), tonic, KeyVariant::kNatural});
}

ResolvedKey resolve_key_name(std::string_view text, const NoteNameOptions& opts) {
  return try_resolve_key_name(text, opts).unwrap();
}

}  // namespace cantus
