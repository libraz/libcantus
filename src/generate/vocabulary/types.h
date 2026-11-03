/**
 * @file types.h
 * @brief Internal pieces of ts/src/generate/vocabulary/types.ts: the genre and provenance names.
 */
#ifndef CANTUS_SRC_GENERATE_VOCABULARY_TYPES_H_
#define CANTUS_SRC_GENERATE_VOCABULARY_TYPES_H_

#include <array>
#include <cstddef>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/generate/vocabulary.h"
#include "generate/context/context.h"

namespace cantus {

/** GENRES as names, indexed by Genre. */
inline constexpr std::array<std::string_view, GENRES.size()> kGenreNames =
#include "generate/vocabulary/genres.gen.inc"
    ;
static_assert(!kGenreNames.back().empty(), "GENRES and Genre disagree");

/** PROVENANCE_BASES as names, indexed by ProvenanceBasis. */
inline constexpr std::array<std::string_view, PROVENANCE_BASES.size()> kProvenanceBasisNames =
#include "generate/vocabulary/provenance_bases.gen.inc"
    ;
static_assert(!kProvenanceBasisNames.back().empty(),
              "PROVENANCE_BASES and ProvenanceBasis disagree");

/** The names of GENRES, for assert_one_of(). */
std::vector<std::string_view> genre_names();

/** The names of PROVENANCE_BASES, for assert_one_of(). */
std::vector<std::string_view> provenance_basis_names();

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_VOCABULARY_TYPES_H_
