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

#include "analyze/keys/keys.h"
#include "cantus/analyze/form.h"

namespace cantus {

/**
 * A cadence as the form analyses read it (`CadenceSpan`): the span its arrival chord sounds
 * through, and how strongly it marks the end of a group.
 */
struct CadenceSpan {
  /** The beat the cadence arrives on. */
  double atBeat = 0;
  /** Where the arrival chord stops sounding; `atBeat` when only the arrival is known. */
  double endBeat = 0;
  /** How strongly the cadence marks a boundary, in [0, 1]. */
  double strength = 0;
};

/** A cadence arrival and its strength, as cadence_spans() takes it. */
struct CadenceArrival {
  double atBeat = 0;
  double strength = 0;
};

/**
 * Each cadence as the span its arrival chord sounds through (`cadenceSpans`); with no segments,
 * each span is the arrival beat alone.
 */
std::vector<CadenceSpan> cadence_spans(const std::vector<CadenceArrival>& arrivals,
                                       const std::vector<SegmentSpan>& segments);

/**
 * The bars the cadences fall in, in the meters the search resolved. It is asked for only when
 * the span is long enough to hold a grouping, as TS reads `cadenceBeats` only then.
 */
using CadenceBars = std::function<std::vector<double>(const MeterArg&)>;

/** The cadences as spans, asked for only when the span is long enough to hold a grouping. */
using CadenceSpans = std::function<std::vector<CadenceSpan>()>;

/**
 * hypermeter() with the cadences supplied as bars, each a point arrival of strength 1;
 * `opts.cadenceBeats` is not read.
 * @throws InvalidInputError if a note or an option is invalid.
 */
Hypermeter hypermeter_with(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceBars& cadence_bars);

/**
 * hypermeter() with the cadences supplied as spans (`hypermeterOver`); `opts.cadenceBeats` is not
 * read.
 * @throws InvalidInputError if a note or an option is invalid.
 */
Hypermeter hypermeter_over(const std::vector<NoteEvent>& notes,
                           const std::optional<MeterArg>& meter, const HypermeterOptions& opts,
                           const CadenceSpans& spans);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_FORM_HYPERMETER_H_
