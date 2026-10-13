/**
 * @file articulation.h
 * @brief The articulation names of ts/src/core/instrument/articulation.ts.
 */
#ifndef CANTUS_SRC_CORE_INSTRUMENT_ARTICULATION_H_
#define CANTUS_SRC_CORE_INSTRUMENT_ARTICULATION_H_

#include <array>
#include <string_view>
#include <vector>

#include "cantus/core/instrument.h"

namespace cantus {

/** ARTICULATIONS as names, indexed by Articulation. */
inline constexpr std::array<std::string_view, ARTICULATIONS.size()> kArticulationNames =
#include "core/instrument/articulations.gen.inc"
    ;
static_assert(!kArticulationNames.back().empty(), "ARTICULATIONS and Articulation disagree");

/** The names of ARTICULATIONS, for assert_one_of(). */
std::vector<std::string_view> articulation_names();

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_INSTRUMENT_ARTICULATION_H_
