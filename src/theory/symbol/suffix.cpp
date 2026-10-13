// The suffix a chord symbol writes after its root: ts/src/theory/symbol/suffix.ts.

#include "theory/symbol/suffix.h"

#include <algorithm>
#include <array>
#include <optional>
#include <utility>
#include <vector>

#include "js/number.h"
#include "theory/chord/spec.h"

namespace cantus {

namespace {

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

constexpr std::size_t kQualityCount = static_cast<std::size_t>(ChordQuality::kMin6_9) + 1;
constexpr std::size_t kBaseCount = static_cast<std::size_t>(ChordBase::kPower) + 1;
constexpr std::size_t kSeventhCount = static_cast<std::size_t>(ChordSeventh::kDim7) + 1;

constexpr std::array<NamedName, kQualityCount> kCanonicalSuffix = {
#include "theory/symbol/canonical_suffix.gen.inc"
};

constexpr std::array<NamedName, kBaseCount> kBaseSuffix = {
#include "theory/symbol/base_suffix.gen.inc"
};

constexpr std::array<NamedName, kSeventhCount> kSeventhSuffix = {
#include "theory/symbol/seventh_suffix.gen.inc"
};

static_assert(!kCanonicalSuffix.back().name.empty(), "CANONICAL_SUFFIX and ChordQuality disagree");
static_assert(!kBaseSuffix.back().name.empty(), "BASE_SUFFIX and ChordBase disagree");
static_assert(!kSeventhSuffix.back().name.empty(), "SEVENTH_SUFFIX and ChordSeventh disagree");

/** The major seventh written after a base letter, which has taken the word's place. */
constexpr std::string_view kMajorSeventhAfterBase = "Maj7";

std::string_view lookup(const NamedName* begin, const NamedName* end, std::string_view name) {
  for (const NamedName* row = begin; row != end; ++row) {
    if (row->name == name) {
      return row->value;
    }
  }
  return {};
}

/** A named chord and the spec it stands for. */
struct CoreCandidate {
  ChordQuality quality;
  ChordSpec spec;
};

/** The named chords a symbol can write as its core (`CORE_CANDIDATES`). */
const std::vector<CoreCandidate>& core_candidates() {
  static const std::vector<CoreCandidate> candidates = [] {
    std::vector<CoreCandidate> out;
    for (ChordQuality quality : chord_qualities()) {
      ChordSpec spec = chord_spec_for_quality(quality, 0);
      bool plain = std::all_of(spec.alterations.begin(), spec.alterations.end(),
                               [](const Alteration& a) { return a.degree == 5 || a.alter == 0; });
      if (plain) {
        out.push_back(CoreCandidate{quality, std::move(spec)});
      }
    }
    return out;
  }();
  return candidates;
}

/** Whether `part` is one of the alterations `spec` carries. */
bool carries_alteration(const ChordSpec& spec, const Alteration& part) {
  return std::any_of(spec.alterations.begin(), spec.alterations.end(), [&](const Alteration& a) {
    return a.degree == part.degree && a.alter == part.alter;
  });
}

bool includes(const std::vector<int>& list, int degree) {
  return std::find(list.begin(), list.end(), degree) != list.end();
}

/** The largest named chord a spec can be written as before its figures (`coreQuality`). */
std::optional<const CoreCandidate*> core_quality(const ChordSpec& spec) {
  std::optional<const CoreCandidate*> core;
  double named = -1;
  for (const CoreCandidate& entry : core_candidates()) {
    const ChordSpec& candidate = entry.spec;
    double size = static_cast<double>(candidate.alterations.size() + candidate.additions.size());
    if (size <= named || candidate.base != spec.base || candidate.seventh != spec.seventh ||
        !std::all_of(candidate.alterations.begin(), candidate.alterations.end(),
                     [&](const Alteration& part) { return carries_alteration(spec, part); }) ||
        !std::all_of(candidate.additions.begin(), candidate.additions.end(),
                     [&](int degree) { return includes(spec.additions, degree); }) ||
        !std::all_of(candidate.omissions.begin(), candidate.omissions.end(),
                     [&](int degree) { return includes(spec.omissions, degree); })) {
      continue;
    }
    core = &entry;
    named = size;
  }
  return core;
}

/** A core no quality name covers, written from its parts (`builtCoreSuffix`). */
std::string built_core_suffix(const ChordSpec& spec) {
  std::string_view base =
      lookup(kBaseSuffix.data(), kBaseSuffix.data() + kBaseSuffix.size(), to_string(spec.base));
  if (!spec.seventh) {
    return std::string(base);
  }
  std::string_view seventh =
      lookup(kSeventhSuffix.data(), kSeventhSuffix.data() + kSeventhSuffix.size(),
             to_string(*spec.seventh));
  if (spec.base == ChordBase::kSus2 || spec.base == ChordBase::kSus4) {
    return std::string(seventh) + std::string(base);
  }
  if (spec.base == ChordBase::kMaj) {
    return std::string(seventh);
  }
  return std::string(base) +
         std::string(*spec.seventh == ChordSeventh::kMaj7 ? kMajorSeventhAfterBase : seventh);
}

/** The figures a symbol writes after its core, in degree order (`figureText`). */
std::vector<std::string> figure_text(const ChordSpec& spec, const ChordSpec* core) {
  struct Figure {
    double degree;
    std::string text;
  };
  std::vector<Figure> figures;
  for (const Alteration& alteration : spec.alterations) {
    if (core != nullptr && carries_alteration(*core, alteration)) {
      continue;
    }
    std::string sign = alteration.alter < 0 ? "b" : alteration.alter > 0 ? "#" : "";
    figures.push_back(
        Figure{static_cast<double>(alteration.degree), sign + js::to_string(alteration.degree)});
  }
  for (int degree : spec.additions) {
    if (core == nullptr || !includes(core->additions, degree)) {
      figures.push_back(Figure{static_cast<double>(degree), "add" + js::to_string(degree)});
    }
  }
  std::stable_sort(figures.begin(), figures.end(),
                   [](const Figure& a, const Figure& b) { return a.degree < b.degree; });
  std::vector<std::string> out;
  for (Figure& figure : figures) {
    out.push_back(std::move(figure.text));
  }
  return out;
}

}  // namespace

std::string_view canonical_suffix(ChordQuality quality) {
  return lookup(kCanonicalSuffix.data(), kCanonicalSuffix.data() + kCanonicalSuffix.size(),
                to_string(quality));
}

std::string spec_suffix(const ChordSpec& spec) {
  if (std::optional<ChordQuality> named = exact_chord_spec_quality(spec)) {
    return std::string(canonical_suffix(*named));
  }
  std::optional<const CoreCandidate*> core = core_quality(spec);
  std::string text =
      core ? std::string(canonical_suffix((*core)->quality)) : built_core_suffix(spec);
  std::vector<std::string> figures = figure_text(spec, core ? &(*core)->spec : nullptr);
  if (figures.empty()) {
    return text;
  }
  text += "(";
  for (std::size_t i = 0; i < figures.size(); ++i) {
    if (i > 0) {
      text += ",";
    }
    text += figures[i];
  }
  return text + ")";
}

}  // namespace cantus
