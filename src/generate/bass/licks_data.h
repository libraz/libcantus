/**
 * @file licks_data.h
 * @brief Internal pieces of ts/src/generate/bass/licks-data.ts: the check a caller's lick passes.
 */
#ifndef CANTUS_SRC_GENERATE_BASS_LICKS_DATA_H_
#define CANTUS_SRC_GENERATE_BASS_LICKS_DATA_H_

#include <string_view>

#include "cantus/generate/bass.h"

namespace cantus {

/**
 * Check every note of a lick a caller brought, field by field (`assertLickMaterial`).
 * @throws InvalidInputError naming the first field outside its domain.
 */
void assert_lick_material(const LickMaterial& material, std::string_view label);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_BASS_LICKS_DATA_H_
