// The structured reading of a chord: ts/src/theory/chord/spec.ts.

#include "theory/chord/spec.h"

#include <algorithm>
#include <utility>

#include "cantus/core/validation.h"

namespace cantus {

namespace {

struct Tone {
  int degree;
  int semitones;
};

/** One entry of BASE_TONES: a base and its tones, as `[chord degree, semitones]`. */
struct BaseTonesRow {
  std::string_view name;
  std::vector<Tone> tones;
};

/** One entry of a table keyed by name, with a number. */
struct NamedInt {
  std::string_view name;
  int value;
};

/** One entry of a table keyed by name, with a name. */
struct NamedName {
  std::string_view name;
  std::string_view value;
};

struct AlterationRecord {
  int degree;
  int alter;
};

/** A spec as QUALITY_SPECS writes it, with its parts still by name. */
struct SpecRecord {
  int rootPc;
  std::string_view base;
  std::optional<std::string_view> seventh;
  std::vector<AlterationRecord> alterations;
  std::vector<int> additions;
  std::vector<int> omissions;
  std::optional<int> bassPc;
};

struct QualitySpecRow {
  std::string_view name;
  SpecRecord spec;
};

/** One entry of EXTENSION_ENTRIES: a compound offset and the alteration it names. */
struct ExtensionRow {
  int semitones;
  AlterationRecord alteration;
};

constexpr std::size_t kBaseCount = static_cast<std::size_t>(ChordBase::kPower) + 1;
constexpr std::size_t kSeventhCount = static_cast<std::size_t>(ChordSeventh::kDim7) + 1;
constexpr std::size_t kQualityCount = static_cast<std::size_t>(ChordQuality::kMin6_9) + 1;

const std::array<BaseTonesRow, kBaseCount>& base_tones() {
  static const std::array<BaseTonesRow, kBaseCount> rows = {
#include "theory/chord/base_tones.gen.inc"
  };
  return rows;
}

constexpr std::array<NamedInt, kSeventhCount> kSeventhSemitones = {
#include "theory/chord/seventh_semitones.gen.inc"
};
static_assert(!kSeventhSemitones.back().name.empty(),
              "SEVENTH_SEMITONES and ChordSeventh disagree");

constexpr std::array<NamedInt, 4> kDegreeSemitones = {
#include "theory/chord/degree_semitones.gen.inc"
};

constexpr std::array<NamedName, kBaseCount> kBaseQuality = {
#include "theory/chord/base_quality.gen.inc"
};
static_assert(!kBaseQuality.back().name.empty(), "BASE_QUALITY and ChordBase disagree");

const std::array<QualitySpecRow, kQualityCount>& quality_specs() {
  static const std::array<QualitySpecRow, kQualityCount> rows = {
#include "theory/chord/quality_specs.gen.inc"
  };
  return rows;
}

const std::array<ExtensionRow, 9>& extensions() {
  static const std::array<ExtensionRow, 9> rows = {
#include "theory/chord/extension_entries.gen.inc"
  };
  return rows;
}

/** `DEGREE_SEMITONES[degree] ?? 0`: a property lookup by `String(degree)`. */
double degree_semitones(double degree) {
  std::string key = js::to_string(degree);
  for (const NamedInt& row : kDegreeSemitones) {
    if (row.name == key) {
      return row.value;
    }
  }
  return 0;
}

int seventh_semitones(ChordSeventh seventh) {
  return kSeventhSemitones[static_cast<std::size_t>(seventh)].value;
}

ChordSpec spec_of_record(const SpecRecord& record) {
  ChordSpec spec;
  spec.rootPc = record.rootPc;
  spec.base = *parse_chord_base(record.base);
  if (record.seventh) {
    spec.seventh = parse_chord_seventh(*record.seventh);
  }
  for (const AlterationRecord& a : record.alterations) {
    spec.alterations.push_back(Alteration{a.degree, static_cast<double>(a.alter)});
  }
  spec.additions = record.additions;
  spec.omissions = record.omissions;
  if (record.bassPc) {
    spec.bassPc = *record.bassPc;
  }
  return spec;
}

/** Push `value` unless an equal one is there (a Set's insertion; -0 joins as 0). */
template <class T>
void add_unique(std::vector<T>& set, T value) {
  if (std::find(set.begin(), set.end(), value) == set.end()) {
    set.push_back(value == 0 ? T(0) : value);
  }
}

/** An insertion-ordered map of alterations, keyed the way normalizeChordSpec keys them. */
class AlterationMap {
 public:
  const Alteration* get(const std::string& key) const {
    for (const auto& entry : entries_) {
      if (entry.first == key) {
        return &entry.second;
      }
    }
    return nullptr;
  }

  void set(const std::string& key, Alteration value) {
    for (auto& entry : entries_) {
      if (entry.first == key) {
        entry.second = value;
        return;
      }
    }
    entries_.emplace_back(key, value);
  }

  void erase(const std::string& key) {
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
                                  [&key](const auto& entry) { return entry.first == key; }),
                   entries_.end());
  }

  std::vector<std::pair<std::string, Alteration>> entries() const { return entries_; }

 private:
  std::vector<std::pair<std::string, Alteration>> entries_;
};

/** The identity every alteration of the fifth shares (`FIFTH_KEY`). */
const char* const kFifthKey = "5";

/** A spec's identity as text, so two readings of one chord compare equal (`specKey`). */
std::string spec_key(const ChordSpec& spec) {
  ChordSpec normalized = normalize_chord_spec(spec);
  std::string out(to_string(normalized.base));
  out += '|';
  if (normalized.seventh) {
    out += to_string(*normalized.seventh);
  }
  out += '|';
  for (std::size_t i = 0; i < normalized.alterations.size(); ++i) {
    if (i > 0) {
      out += '.';
    }
    out += js::to_string(normalized.alterations[i].alter) + ":" +
           js::to_string(normalized.alterations[i].degree);
  }
  out += '|';
  out += js::join(normalized.additions, ".");
  out += '|';
  out += js::join(normalized.omissions, ".");
  return out;
}

/** The quality naming each spec exactly; a later quality with the same key wins (`QUALITY_BY_KEY`).
 */
const std::vector<std::pair<std::string, ChordQuality>>& quality_by_key() {
  static const std::vector<std::pair<std::string, ChordQuality>> table = [] {
    std::vector<std::pair<std::string, ChordQuality>> out;
    for (std::size_t i = 0; i < kQualityCount; ++i) {
      out.emplace_back(spec_key(spec_of_record(quality_specs()[i].spec)),
                       static_cast<ChordQuality>(i));
    }
    return out;
  }();
  return table;
}

/** Reject a degree a spec cannot alter, add, or omit (`assertDegreeIn`). */
template <std::size_t N>
void assert_degree_in(double value, const std::array<int, N>& allowed, std::string_view name) {
  if (!includes_degree(allowed, value)) {
    throw InvalidInputError(std::string(name) + " must be one of " + join_degrees(allowed) +
                            "; received " + js::to_string(value));
  }
}

}  // namespace

std::string_view to_string(ChordQuality quality) {
  return quality_specs()[static_cast<std::size_t>(quality)].name;
}

std::optional<ChordQuality> parse_chord_quality(std::string_view name) {
  for (std::size_t i = 0; i < kQualityCount; ++i) {
    if (quality_specs()[i].name == name) {
      return static_cast<ChordQuality>(i);
    }
  }
  return std::nullopt;
}

std::string_view to_string(ChordBase base) {
  return base_tones()[static_cast<std::size_t>(base)].name;
}

std::optional<ChordBase> parse_chord_base(std::string_view name) {
  for (std::size_t i = 0; i < kBaseCount; ++i) {
    if (base_tones()[i].name == name) {
      return static_cast<ChordBase>(i);
    }
  }
  return std::nullopt;
}

std::string_view to_string(ChordSeventh seventh) {
  return kSeventhSemitones[static_cast<std::size_t>(seventh)].name;
}

std::optional<ChordSeventh> parse_chord_seventh(std::string_view name) {
  for (std::size_t i = 0; i < kSeventhCount; ++i) {
    if (kSeventhSemitones[i].name == name) {
      return static_cast<ChordSeventh>(i);
    }
  }
  return std::nullopt;
}

std::vector<std::string_view> chord_base_names() {
  std::vector<std::string_view> names;
  for (const BaseTonesRow& row : base_tones()) {
    names.push_back(row.name);
  }
  return names;
}

std::vector<std::string_view> chord_seventh_names() {
  std::vector<std::string_view> names;
  for (const NamedInt& row : kSeventhSemitones) {
    names.push_back(row.name);
  }
  return names;
}

const std::vector<ChordQuality>& quality_order() {
  static const std::vector<ChordQuality> order = [] {
    std::vector<ChordQuality> out;
    for (std::size_t i = 0; i < kQualityCount; ++i) {
      out.push_back(static_cast<ChordQuality>(i));
    }
    return out;
  }();
  return order;
}

const std::vector<double>& quality_intervals(ChordQuality quality) {
  static const std::vector<std::vector<double>> table = [] {
    std::vector<std::vector<double>> out;
    for (const QualitySpecRow& row : quality_specs()) {
      out.push_back(spec_intervals(normalize_chord_spec(spec_of_record(row.spec))));
    }
    return out;
  }();
  return table[static_cast<std::size_t>(quality)];
}

ChordSpec normalize_chord_spec(const ChordSpec& spec) {
  ChordBase base = spec.base;
  // Keyed by degree and accidental: a flat and a raised ninth are two tones. Only the fifth is
  // single-valued; contradictory fifths settle on the lowest.
  AlterationMap alterations;
  for (const Alteration& alteration : spec.alterations) {
    if (alteration.degree == 5) {
      const Alteration* current = alterations.get(kFifthKey);
      if (current != nullptr && current->alter <= alteration.alter) {
        continue;
      }
      alterations.set(kFifthKey, alteration);
      continue;
    }
    alterations.set(js::to_string(alteration.degree) + ":" + js::to_string(alteration.alter),
                    alteration);
  }
  std::vector<int> additions;
  for (int degree : spec.additions) {
    add_unique(additions, degree);
  }
  std::vector<int> omissions;
  for (int degree : spec.omissions) {
    add_unique(omissions, degree);
  }
  if (const Alteration* fifth_alteration = alterations.get(kFifthKey)) {
    double fifth = fifth_alteration->alter;
    // The alteration is the statement about the fifth, so an altering base steps back first.
    if (base == ChordBase::kAug) {
      base = ChordBase::kMaj;
    } else if (base == ChordBase::kDim) {
      base = ChordBase::kMin;
    }
    if (fifth == 0) {
      alterations.erase(kFifthKey);
    } else if (base == ChordBase::kMaj && fifth == 1) {
      base = ChordBase::kAug;
      alterations.erase(kFifthKey);
    } else if (base == ChordBase::kMin && fifth == -1) {
      base = ChordBase::kDim;
      alterations.erase(kFifthKey);
    }
  }
  if (!spec.seventh) {
    // Without a seventh, an unaltered upper degree is an added tone rather than a tension.
    for (const auto& [key, alteration] : alterations.entries()) {
      if (alteration.degree != 5 && alteration.alter == 0) {
        alterations.erase(key);
        add_unique(additions, alteration.degree);
      }
    }
  }
  ChordSpec normalized;
  normalized.rootPc = spec.rootPc;
  normalized.base = base;
  for (const auto& entry : alterations.entries()) {
    normalized.alterations.push_back(entry.second);
  }
  std::stable_sort(normalized.alterations.begin(), normalized.alterations.end(),
                   [](const Alteration& a, const Alteration& b) {
                     return a.degree != b.degree ? a.degree < b.degree : a.alter < b.alter;
                   });
  std::stable_sort(additions.begin(), additions.end());
  std::stable_sort(omissions.begin(), omissions.end());
  normalized.additions = std::move(additions);
  normalized.omissions = std::move(omissions);
  normalized.seventh = spec.seventh;
  normalized.bassPc = spec.bassPc;
  return normalized;
}

std::vector<double> spec_intervals(const ChordSpec& normalized) {
  std::vector<std::pair<int, double>> tones;
  for (const Tone& tone : base_tones()[static_cast<std::size_t>(normalized.base)].tones) {
    tones.emplace_back(tone.degree, tone.semitones);
  }
  auto has_fifth = [&tones] {
    return std::any_of(tones.begin(), tones.end(), [](const auto& t) { return t.first == 5; });
  };
  for (const Alteration& alteration : normalized.alterations) {
    if (alteration.degree == 5 && has_fifth()) {
      for (auto& tone : tones) {
        if (tone.first == 5) {
          tone.second = PERFECT_FIFTH + alteration.alter;
        }
      }
    }
  }
  for (int degree : normalized.omissions) {
    tones.erase(std::remove_if(tones.begin(), tones.end(),
                               [degree](const auto& t) { return t.first == degree; }),
                tones.end());
  }
  std::vector<double> offsets;
  for (const auto& tone : tones) {
    add_unique(offsets, tone.second);
  }
  if (normalized.seventh) {
    add_unique(offsets, static_cast<double>(seventh_semitones(*normalized.seventh)));
  }
  for (const Alteration& alteration : normalized.alterations) {
    if (alteration.degree != 5) {
      add_unique(offsets, degree_semitones(alteration.degree) + alteration.alter);
    }
  }
  for (int degree : normalized.additions) {
    add_unique(offsets, degree_semitones(degree));
  }
  std::stable_sort(offsets.begin(), offsets.end());
  return offsets;
}

std::vector<double> chord_spec_intervals(const ChordSpec& spec) {
  return spec_intervals(assert_chord_spec(spec));
}

ChordSpec assert_chord_spec(const ChordSpec& spec) {
  assert_finite_number(spec.rootPc, "chord spec rootPc");
  if (spec.bassPc) {
    assert_finite_number(*spec.bassPc, "chord spec bassPc");
  }
  for (const Alteration& alteration : spec.alterations) {
    assert_degree_in(alteration.degree, kAlterableDegrees, "chord spec alteration degree");
    assert_degree_in(alteration.alter, kAlterationSteps, "chord spec alteration");
  }
  for (int degree : spec.additions) {
    assert_degree_in(degree, kAddableDegrees, "chord spec additions");
  }
  for (int degree : spec.omissions) {
    assert_degree_in(degree, kOmittableDegrees, "chord spec omissions");
  }
  return normalize_chord_spec(spec);
}

ChordSpec chord_spec_for_quality(ChordQuality quality, double root_pc,
                                 std::optional<double> bass_pc) {
  ChordSpec spec =
      normalize_chord_spec(spec_of_record(quality_specs()[static_cast<std::size_t>(quality)].spec));
  spec.rootPc = root_pc;
  if (bass_pc) {
    spec.bassPc = bass_pc;
  }
  return spec;
}

std::optional<ChordQuality> exact_chord_spec_quality(const ChordSpec& spec) {
  std::string key = spec_key(spec);
  std::optional<ChordQuality> found;
  for (const auto& [known, quality] : quality_by_key()) {
    if (known == key) {
      found = quality;
    }
  }
  return found;
}

ChordQuality chord_spec_quality(const ChordSpec& spec) {
  ChordSpec checked = assert_chord_spec(spec);
  if (std::optional<ChordQuality> exact = exact_chord_spec_quality(checked)) {
    return *exact;
  }
  // An omitted degree is a tone the chord does not sound, not evidence against a name, so the
  // omitted degrees are put back on both sides of the comparison.
  ChordSpec whole = checked;
  whole.omissions.clear();
  std::vector<double> offsets = spec_intervals(whole);
  std::optional<ChordQuality> nearest;
  std::size_t size = 0;
  for (ChordQuality quality : quality_order()) {
    const std::vector<double>& tmpl = quality_intervals(quality);
    bool inside = std::all_of(tmpl.begin(), tmpl.end(), [&offsets](double offset) {
      return std::find(offsets.begin(), offsets.end(), offset) != offsets.end();
    });
    if (tmpl.size() > size && inside) {
      nearest = quality;
      size = tmpl.size();
    }
  }
  if (nearest) {
    return *nearest;
  }
  return *parse_chord_quality(kBaseQuality[static_cast<std::size_t>(checked.base)].value);
}

std::optional<ChordSpec> chord_spec_from_intervals(const std::vector<double>& intervals) {
  std::vector<double> offsets;
  for (double interval : intervals) {
    add_unique(offsets, interval);
  }
  std::stable_sort(offsets.begin(), offsets.end());
  auto has = [&offsets](double offset) {
    return std::find(offsets.begin(), offsets.end(), offset) != offsets.end();
  };
  ChordSpec spec;
  spec.rootPc = 0;
  if (!has(0)) {
    spec.omissions.push_back(1);
  }
  std::optional<int> third;
  for (int candidate : {4, 3, 5, 2}) {
    if (!third && has(candidate)) {
      third = candidate;
    }
  }
  std::optional<int> fifth;
  for (int candidate : {7, 6, 8}) {
    if (!fifth && has(candidate)) {
      fifth = candidate;
    }
  }
  ChordBase base = ChordBase::kMaj;
  if (third == 3) {
    base = ChordBase::kMin;
  } else if (third == 5) {
    base = ChordBase::kSus4;
  } else if (third == 2) {
    base = ChordBase::kSus2;
  } else if (!third) {
    // A bare root and fifth is the power chord itself; anything more left its third out.
    if (fifth == 7 && offsets.size() == 2 && has(0)) {
      base = ChordBase::kPower;
    } else {
      spec.omissions.push_back(3);
    }
  }
  if (!fifth) {
    spec.omissions.push_back(5);
  } else if (*fifth != PERFECT_FIFTH) {
    if (base == ChordBase::kMaj && *fifth == 8) {
      base = ChordBase::kAug;
    } else if (base == ChordBase::kMin && *fifth == 6) {
      base = ChordBase::kDim;
    } else {
      spec.alterations.push_back(Alteration{5, *fifth == 6 ? -1.0 : 1.0});
    }
  }
  std::optional<ChordSeventh> seventh;
  if (has(11)) {
    seventh = ChordSeventh::kMaj7;
  } else if (has(10)) {
    seventh = ChordSeventh::kMin7;
  }
  if (has(9)) {
    // Nine semitones is the diminished seventh only over a diminished triad with no seventh.
    if (!seventh && base == ChordBase::kDim) {
      seventh = ChordSeventh::kDim7;
    } else {
      spec.additions.push_back(6);
    }
  }
  for (double offset : offsets) {
    if (offset <= 12) {
      continue;
    }
    const ExtensionRow* extension = nullptr;
    for (const ExtensionRow& row : extensions()) {
      if (row.semitones == offset) {
        extension = &row;
      }
    }
    if (extension == nullptr) {
      return std::nullopt;
    }
    spec.alterations.push_back(
        Alteration{extension->alteration.degree, static_cast<double>(extension->alteration.alter)});
  }
  spec.base = base;
  spec.seventh = seventh;
  ChordSpec normalized = normalize_chord_spec(spec);
  if (spec_intervals(normalized) != offsets) {
    return std::nullopt;
  }
  return normalized;
}

}  // namespace cantus
