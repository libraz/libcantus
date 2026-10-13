/**
 * @file profile.h
 * @brief Internal pieces of ts/src/core/instrument/profile.ts: limb names, limits, and the
 *        readers of an already validated profile.
 */
#ifndef CANTUS_SRC_CORE_INSTRUMENT_PROFILE_H_
#define CANTUS_SRC_CORE_INSTRUMENT_PROFILE_H_

#include <array>
#include <string_view>
#include <vector>

#include "cantus/core/instrument.h"
#include "core/instrument/limits.gen.h"

namespace cantus {

/** LIMBS as names, indexed by Limb. */
inline constexpr std::array<std::string_view, LIMBS.size()> kLimbNames =
#include "core/instrument/limbs.gen.inc"
    ;
static_assert(!kLimbNames.back().empty(), "LIMBS and Limb disagree");

/** The names of LIMBS, for assert_one_of(). */
std::vector<std::string_view> limb_names();

/** Whether the kit plays this voice as an overdub (`isOverdub`). */
bool is_overdub(const PercussionProfile& profile, int pitch);

/** The limbs the player has that can strike a voice, in preference order (`reachOf`). */
std::vector<Limb> reach_of(const PercussionProfile& profile, int pitch);

/** instrument_range() of a validated profile (`rangeIn`). */
InstrumentRange range_in(const InstrumentProfile& profile);

/** can_sound() of a validated profile (`soundsIn`). */
bool sounds_in(const InstrumentProfile& profile, int pitch);

/** fingerings_for() of a validated neck (`fingeringsIn`). */
std::vector<StringFingering> fingerings_in(const StringedProfile& stringed, int pitch);

/** fold_into_range() of a validated profile (`foldIn`). */
int fold_in(int pitch, const InstrumentProfile& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_INSTRUMENT_PROFILE_H_
