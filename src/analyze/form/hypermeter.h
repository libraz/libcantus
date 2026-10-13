/**
 * @file hypermeter.h
 * @brief Internal entry point of ts/src/analyze/form/hypermeter.ts beside the public
 *        hypermeter() in cantus/analyze/form.h: the search over cadence bars a host reads on
 *        demand.
 */
#ifndef CANTUS_SRC_ANALYZE_FORM_HYPERMETER_H_
#define CANTUS_SRC_ANALYZE_FORM_HYPERMETER_H_

#include <functional>
#include <optional>
#include <vector>

#include "cantus/analyze/form.h"

namespace cantus {

/**
 * The bars the cadences fall in, in the meters the search resolved. It is asked for only when
 * the span is long enough to hold a grouping, as TS reads `cadenceBeats` only then.
 */
using CadenceBars = std::function<std::vector<double>(const MeterArg&)>;

/**
 * hypermeter() with the cadences supplied as bars; `opts.cadenceBeats` is not read.
 * @throws InvalidInputError if a note or an option is invalid.
 */
Hypermeter hypermeter_with(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceBars& cadence_bars);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FORM_HYPERMETER_H_
