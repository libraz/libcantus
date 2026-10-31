/**
 * @file ornament.h
 * @brief Internal pieces of ts/src/generate/ornament/index.ts: ornament once its options are
 *        checked and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_ORNAMENT_ORNAMENT_H_
#define CANTUS_SRC_GENERATE_ORNAMENT_ORNAMENT_H_

#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/ornament.h"

namespace cantus {

/** The meter ornament reads strong positions against when the caller names none (`DEFAULT_TS`). */
extern const TimeSignature kOrnamentDefaultTs;

/** The names of ORNAMENT_STYLES, for assert_one_of(). */
std::vector<std::string_view> ornament_style_names();

/**
 * ornament over the sounding notes, from the point its context is resolved; each note is weighed
 * in the signature `meter` has in force where it sounds.
 */
std::vector<NoteEvent> ornament_with(const std::vector<NoteEvent>& sounding, OrnamentStyle style,
                                     const MeterData& meter, const ResolvedContext& ctx);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_ORNAMENT_ORNAMENT_H_
