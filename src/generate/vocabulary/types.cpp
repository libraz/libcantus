// The shared vocabulary model of ts/src/generate/vocabulary/types.ts.

#include "generate/vocabulary/types.h"

#include <limits>
#include <string>

#include "cantus/core/validation.h"
#include "cantus/generate/context.h"
#include "core/validation/validation.h"
#include "generate/context/draw.h"

namespace cantus {

namespace {

template <class Enum, std::size_t N>
std::optional<Enum> parse_named(const std::array<std::string_view, N>& names,
                                std::string_view name) {
  for (std::size_t i = 0; i < N; ++i) {
    if (names[i] == name) {
      return static_cast<Enum>(i);
    }
  }
  return std::nullopt;
}

}  // namespace

std::string_view to_string(Genre genre) { return kGenreNames[static_cast<std::size_t>(genre)]; }

std::optional<Genre> parse_genre(std::string_view name) {
  return parse_named<Genre>(kGenreNames, name);
}

std::string_view to_string(ProvenanceBasis basis) {
  return kProvenanceBasisNames[static_cast<std::size_t>(basis)];
}

std::optional<ProvenanceBasis> parse_provenance_basis(std::string_view name) {
  return parse_named<ProvenanceBasis>(kProvenanceBasisNames, name);
}

std::vector<std::string_view> genre_names() { return {kGenreNames.begin(), kGenreNames.end()}; }

std::vector<std::string_view> provenance_basis_names() {
  return {kProvenanceBasisNames.begin(), kProvenanceBasisNames.end()};
}

namespace detail {

bool same_time_signature(const TimeSignature& entry, const MeterArg& query) {
  TimeSignature asked = meter_at(0, to_meter_data(query, "ts"));
  // A grouping stated on one side only is a different reading as well.
  return entry.numerator == asked.numerator && entry.denominator == asked.denominator &&
         entry.grouping == asked.grouping;
}

void check_pick(const Draw&, const SeedPath& path) { assert_seed_path(path); }

std::size_t pick_index(std::size_t count, const Draw& draw, const SeedPath& path) {
  return static_cast<std::size_t>(draw.range(0, static_cast<std::int64_t>(count) - 1, path));
}

void assert_vocabulary_fields(const std::optional<TimeSignature>& ts, double difficulty,
                              const std::optional<std::array<double, 2>>& tempo_range,
                              std::string_view label) {
  std::string name(label);
  if (ts) {
    assert_time_signature(*ts, name + " ts");
  }
  assert_range(difficulty, 1, 5, name + " difficulty");
  if (tempo_range) {
    double low = assert_range((*tempo_range)[0], kMinValue, 1000, name + " tempoRange low");
    assert_range((*tempo_range)[1], low, 1000, name + " tempoRange high");
  }
}

}  // namespace detail

}  // namespace cantus
