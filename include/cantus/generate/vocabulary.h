/**
 * @file vocabulary.h
 * @brief Public C++ API of ts/src/generate/vocabulary: genre vocabulary as data, and the
 *        transformation rules that deform a remembered figure into the one a bar needs.
 *
 * A Vocabulary entry is one figure plus the conditions it fits; choosing one is a lookup, not a
 * branch in a generator. Genre selects the material, the complexity dials deform it (deform()),
 * and the difficulty ceiling rejects it (within_ceiling()). The selection functions are templates
 * over the material, as the TS functions are generic over it; a context carries a mixed list as
 * `Vocabulary<std::any>`, from which vocabulary_of_kind() takes one kind.
 */
#ifndef CANTUS_GENERATE_VOCABULARY_H_
#define CANTUS_GENERATE_VOCABULARY_H_

#include <algorithm>
#include <any>
#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/limits.h"
#include "cantus/core/meter.h"
#include "cantus/core/random.h"
#include "cantus/theory/chord.h"

namespace cantus {

class Draw;
enum class Section : std::uint8_t;

/** Every genre a vocabulary entry may carry, in GENRES order. */
enum class Genre : std::uint8_t {
  kPop,
  kRock,
  kMotown,
  kFunk,
  kSoul,
  kGospel,
  kJazz,
  kBlues,
  kBossa,
  kSamba,
  kReggae,
  kCountry,
  kHiphop,
  kHouse,
  kDnb,
};

/** Every genre, in declaration order (`GENRES`). */
inline constexpr std::array<Genre, 15> GENRES = {
    Genre::kPop,    Genre::kRock,    Genre::kMotown, Genre::kFunk,  Genre::kSoul,
    Genre::kGospel, Genre::kJazz,    Genre::kBlues,  Genre::kBossa, Genre::kSamba,
    Genre::kReggae, Genre::kCountry, Genre::kHiphop, Genre::kHouse, Genre::kDnb,
};

/** The TS name of a genre ("pop", ...). */
std::string_view to_string(Genre genre);

/** The genre named `name`, or nullopt. */
std::optional<Genre> parse_genre(std::string_view name);

/** The grounds on which a figure may enter a dictionary, in PROVENANCE_BASES order. */
enum class ProvenanceBasis : std::uint8_t { kIdiom, kConstruction, kTraditional };

/** Every provenance basis, in declaration order (`PROVENANCE_BASES`). */
inline constexpr std::array<ProvenanceBasis, 3> PROVENANCE_BASES = {
    ProvenanceBasis::kIdiom, ProvenanceBasis::kConstruction, ProvenanceBasis::kTraditional};

/** The TS name of a provenance basis ("idiom", ...). */
std::string_view to_string(ProvenanceBasis basis);

/** The provenance basis named `name`, or nullopt. */
std::optional<ProvenanceBasis> parse_provenance_basis(std::string_view name);

/** Why a figure may be published as vocabulary (`Provenance`). */
struct Provenance {
  ProvenanceBasis basis = ProvenanceBasis::kIdiom;
  /** What the figure is, in a player's terms. */
  std::string note;
};

/** One remembered figure, together with the conditions it fits (`Vocabulary<T>`). */
template <class T>
struct Vocabulary {
  /** Stable identifier; a caller entry with the same id replaces a built-in. */
  std::string id;
  Genre genre = Genre::kPop;
  /** The figure itself. */
  T material{};
  /** Techniques the figure requires of the instrument. */
  std::vector<Articulation> articulations;
  /** Chord qualities the figure works over; absent means any chord. */
  std::optional<std::vector<ChordQuality>> fitsOver;
  /** Sections the figure suits; absent means any section. */
  std::optional<std::vector<Section>> sections;
  /** Inclusive tempo band in BPM; absent means any tempo. */
  std::optional<std::array<double, 2>> tempoRange;
  /** Time signature the figure is written in; absent means any. */
  std::optional<TimeSignature> ts;
  /** How hard the figure is to play, from 1 to 5. */
  double difficulty = 1;
  Provenance provenance;
};

/** What a generator knows about the moment it chooses a figure for (`VocabularyQuery`). */
struct VocabularyQuery {
  std::optional<Genre> genre;
  std::optional<Section> section;
  /** Tempo in BPM, matched against each entry's band. */
  std::optional<double> bpm;
  /** The meter in force, matched against each entry's own signature. */
  std::optional<MeterArg> ts;
  /** The difficulty ceiling: entries above it are rejected. */
  std::optional<double> difficulty;
  /** The chord in force, matched against each entry's `fitsOver`. */
  std::optional<ChordQuality> quality;
  /** Techniques the instrument can produce; an entry asking for another is not offered. */
  std::optional<std::vector<Articulation>> articulations;
};

namespace detail {

/** `sameTs(entry, meterAt(0, toMeterData(query, 'ts')))`. */
bool same_time_signature(const TimeSignature& entry, const MeterArg& query);

/** `candidates[draw.range(0, count - 1, ...path)]`'s index, after the draw and path checks. */
std::size_t pick_index(std::size_t count, const Draw& draw, const SeedPath& path);

/** The draw and path checks pickVocabulary makes before it selects anything. */
void check_pick(const Draw& draw, const SeedPath& path);

/** The field checks of assertVocabulary. */
void assert_vocabulary_fields(const std::optional<TimeSignature>& ts, double difficulty,
                              const std::optional<std::array<double, 2>>& tempo_range,
                              std::string_view label);

}  // namespace detail

/** Whether one entry answers a query (`fitsQuery`). */
template <class T>
bool fits_query(const Vocabulary<T>& entry, const VocabularyQuery& query) {
  if (query.genre && entry.genre != *query.genre) {
    return false;
  }
  if (query.section && entry.sections &&
      std::find(entry.sections->begin(), entry.sections->end(), *query.section) ==
          entry.sections->end()) {
    return false;
  }
  if (query.bpm && entry.tempoRange) {
    if (*query.bpm < (*entry.tempoRange)[0] || *query.bpm > (*entry.tempoRange)[1]) {
      return false;
    }
  }
  if (query.ts && entry.ts && !detail::same_time_signature(*entry.ts, *query.ts)) {
    return false;
  }
  if (query.quality && entry.fitsOver &&
      std::find(entry.fitsOver->begin(), entry.fitsOver->end(), *query.quality) ==
          entry.fitsOver->end()) {
    return false;
  }
  if (query.articulations) {
    for (Articulation articulation : entry.articulations) {
      if (std::find(query.articulations->begin(), query.articulations->end(), articulation) ==
          query.articulations->end()) {
        return false;
      }
    }
  }
  return !query.difficulty || entry.difficulty <= *query.difficulty;
}

/** Every entry of a dictionary that answers a query, in dictionary order (`selectVocabulary`). */
template <class T>
std::vector<Vocabulary<T>> select_vocabulary(const std::vector<Vocabulary<T>>& dictionary,
                                             const VocabularyQuery& query) {
  std::vector<Vocabulary<T>> out;
  for (const Vocabulary<T>& entry : dictionary) {
    if (fits_query(entry, query)) {
      out.push_back(entry);
    }
  }
  return out;
}

/**
 * Choose one entry from a dictionary at a position (`pickVocabulary`); absent when nothing fits.
 * @throws InvalidInputError if a path segment is not finite.
 */
template <class T>
std::optional<Vocabulary<T>> pick_vocabulary(const std::vector<Vocabulary<T>>& dictionary,
                                             const VocabularyQuery& query, const Draw& draw,
                                             const SeedPath& path = {}) {
  detail::check_pick(draw, path);
  std::vector<Vocabulary<T>> candidates = select_vocabulary(dictionary, query);
  if (candidates.empty()) {
    return std::nullopt;
  }
  return candidates[detail::pick_index(candidates.size(), draw, path)];
}

/**
 * Merge a caller's dictionary into a built-in one (`mergeVocabulary`): caller entries are
 * appended, except one carrying a built-in's id, which takes that built-in's place.
 */
template <class T>
std::vector<Vocabulary<T>> merge_vocabulary(
    const std::vector<Vocabulary<T>>& built_in,
    const std::optional<std::vector<Vocabulary<T>>>& supplied = std::nullopt) {
  if (!supplied || supplied->empty()) {
    return built_in;
  }
  // The last caller entry with an id is the one a Map keyed by id keeps.
  auto replacement = [&supplied](const std::string& id) -> const Vocabulary<T>* {
    const Vocabulary<T>* found = nullptr;
    for (const Vocabulary<T>& entry : *supplied) {
      if (entry.id == id) {
        found = &entry;
      }
    }
    return found;
  };
  std::vector<Vocabulary<T>> merged;
  for (const Vocabulary<T>& entry : built_in) {
    const Vocabulary<T>* replaced = replacement(entry.id);
    merged.push_back(replaced != nullptr ? *replaced : entry);
  }
  for (const Vocabulary<T>& entry : *supplied) {
    bool replaces = std::any_of(built_in.begin(), built_in.end(),
                                [&entry](const Vocabulary<T>& own) { return own.id == entry.id; });
    if (!replaces) {
      merged.push_back(entry);
    }
  }
  return merged;
}

/** The entries of a mixed dictionary whose material is a `T` (`vocabularyOfKind`). */
template <class T>
std::vector<Vocabulary<T>> vocabulary_of_kind(const std::vector<Vocabulary<std::any>>& entries) {
  std::vector<Vocabulary<T>> out;
  for (const Vocabulary<std::any>& entry : entries) {
    const T* material = std::any_cast<T>(&entry.material);
    if (material == nullptr) {
      continue;
    }
    out.push_back(Vocabulary<T>{entry.id, entry.genre, *material, entry.articulations,
                                entry.fitsOver, entry.sections, entry.tempoRange, entry.ts,
                                entry.difficulty, entry.provenance});
  }
  return out;
}

/** An entry with its material type-erased, for a context's mixed dictionary. */
template <class T>
Vocabulary<std::any> to_any_vocabulary(const Vocabulary<T>& entry) {
  return Vocabulary<std::any>{
      entry.id,         entry.genre,     std::any(entry.material), entry.articulations,
      entry.fitsOver,   entry.sections,  entry.tempoRange,         entry.ts,
      entry.difficulty, entry.provenance};
}

/**
 * Reject a dictionary entry whose declared fields are outside their domains
 * (`assertVocabulary`).
 * @throws InvalidInputError if the time signature is malformed, the difficulty is outside 1..5 or
 *   the tempo band is inverted or out of range.
 */
template <class T>
const Vocabulary<T>& assert_vocabulary(const Vocabulary<T>& entry,
                                       std::string_view label = "vocabulary entry") {
  detail::assert_vocabulary_fields(entry.ts, entry.difficulty, entry.tempoRange, label);
  return entry;
}

/** An onset on the shared sixteenth grid (`GridEvent`). */
struct GridEvent {
  /** Sixteenth-note index from the start of the figure. */
  double step = 0;
  /** Loudness as a factor of the passage's base velocity. */
  double velocity = 0;
  /** The voice this onset is played on, where the material has more than one. */
  std::optional<std::string> voice;
  /** The limb that plays it, where the material names one. */
  std::optional<std::string> limb;
};

/** The rate a figure is played at: as written, stretched, or compressed. */
enum class FigureRate : std::uint8_t { kStraight, kHalf, kDouble };

/** The TS name of a rate ("straight", "half", "double"). */
std::string_view to_string(FigureRate rate);

/** The rate named `name`, or nullopt. */
std::optional<FigureRate> parse_figure_rate(std::string_view name);

/** How much a figure is syncopated, and the meter it is felt in (`SyncopateOptions`). */
struct SyncopateOptions {
  /** How much syncopation, in [0, 1]. */
  double amount = 0;
  /** The meter the figure is counted in; 4/4 when absent. */
  std::optional<MeterArg> ts;
};

/** The amount alone, or the amount with the meter (`number | SyncopateOptions`). */
using SyncopateAmount = std::variant<double, SyncopateOptions>;

/** Which events of a figure count as decoration. */
using OrnamentTest = std::function<bool(const GridEvent&)>;

/** Everything the complexity dials do to a figure (`DeformOptions`). */
struct DeformOptions {
  /** Below the neutral middle the figure is thinned; above it, syncopated. */
  std::optional<double> rhythmic;
  /** Ghosts and decoration, in [0, 1]; absent keeps every ornament. */
  std::optional<double> ornament;
  /** Which events are decoration, for the ornament dial; empty when absent. */
  OrnamentTest isOrnament;
  /** Stretch or compress the figure before the dials apply; straight when absent. */
  std::optional<FigureRate> rate;
  /** Length of the figure in sixteenths; BAR_STEPS when absent. */
  std::optional<int> spanSteps;
  /** The meter the figure is counted in; 4/4 when absent. */
  std::optional<MeterArg> ts;
};

/**
 * How strongly a position on the sixteenth grid is felt, from 4 (the downbeat) to 0
 * (`gridMetricWeight`).
 * @throws InvalidInputError if the step is not finite or the meter is malformed.
 */
int grid_metric_weight(double step, const MeterArg& ts);

/**
 * Drop the notes carrying the least of the metre (`thin`).
 * @throws InvalidInputError if a step is not finite, the amount is outside [0, 1] or the meter is
 *   malformed.
 */
std::vector<GridEvent> thin(const std::vector<GridEvent>& events, double amount,
                            const MeterArg& ts);

/**
 * Fill in the gaps of a figure, one note per gap (`double`).
 * @throws InvalidInputError if the span is not a positive integer or a step is not finite.
 */
std::vector<GridEvent> double_(const std::vector<GridEvent>& events, int span_steps = BAR_STEPS);

/**
 * Stretch a figure to twice its length (`halfTime`).
 * @throws InvalidInputError if the span is not a positive integer or a step is not finite.
 */
std::vector<GridEvent> half_time(const std::vector<GridEvent>& events, int span_steps = BAR_STEPS);

/**
 * Compress a figure to half its length and play it twice (`doubleTime`).
 * @throws InvalidInputError if the span is not a positive integer or a step is not finite.
 */
std::vector<GridEvent> double_time(const std::vector<GridEvent>& events,
                                   int span_steps = BAR_STEPS);

/**
 * Anticipate beats, one sixteenth early (`syncopate`).
 * @throws InvalidInputError if a step or path segment is not finite, the amount is outside
 *   [0, 1] or the meter is malformed.
 */
std::vector<GridEvent> syncopate(const std::vector<GridEvent>& events,
                                 const SyncopateAmount& amount, const Draw& draw,
                                 const SeedPath& path = {});

/**
 * Keep each decorated note on its own draw (`ornamentBy`).
 * @throws InvalidInputError if a step or path segment is not finite or the amount is outside
 *   [0, 1].
 */
std::vector<GridEvent> ornament_by(const std::vector<GridEvent>& events,
                                   const OrnamentTest& is_ornament, double amount, const Draw& draw,
                                   const SeedPath& path = {});

/**
 * Apply the complexity dials to a figure (`deform`).
 * @throws InvalidInputError if the span, a dial, a step or the meter is malformed.
 */
std::vector<GridEvent> deform(const std::vector<GridEvent>& events, const DeformOptions& opts,
                              const Draw& draw, const SeedPath& path = {});

/**
 * Whether a figure is inside the difficulty ceiling at this tempo (`withinCeiling`). True
 * whenever the ceiling or the tempo is absent.
 * @throws InvalidInputError if a step or the tempo is not finite or the ceiling is outside [1, 5].
 */
bool within_ceiling(const std::vector<GridEvent>& events, std::optional<double> bpm,
                    std::optional<double> difficulty);

}  // namespace cantus

#endif  // CANTUS_GENERATE_VOCABULARY_H_
