/**
 * @file rhythm.h
 * @brief Internal pieces of ts/src/generate/rhythm/index.ts: generateRhythm once its meter and
 *        context are read.
 */
#ifndef CANTUS_SRC_GENERATE_RHYTHM_RHYTHM_H_
#define CANTUS_SRC_GENERATE_RHYTHM_RHYTHM_H_

#include <vector>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/rhythm.h"

namespace cantus {

/**
 * generateRhythm from the point its context is resolved: the bars and the subdivision are checked
 * here, as TS checks them after the context.
 */
std::vector<RhythmEvent> generate_rhythm_with(const TimeSignature& meter, double bars,
                                              double subdivision, const ResolvedContext& ctx);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_RHYTHM_RHYTHM_H_
