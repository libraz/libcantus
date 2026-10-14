/**
 * @file bass.h
 * @brief Internal pieces of ts/src/generate/bass/index.ts: generateBassLine once its options are
 *        checked and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_BASS_BASS_H_
#define CANTUS_SRC_GENERATE_BASS_BASS_H_

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/bass.h"
#include "cantus/generate/context.h"

namespace cantus {

/** The options of generateBassLine after their checks, in the form the builders read them. */
struct BassLineRequest {
  /** The placement, sorted by onset and checked. */
  std::vector<BassSegment> segments;
  TimeSignature ts;
  BassStyle style = BassStyle::kRoot;
  /** The floor of the register band. */
  double low = 0;
  KeyScale key;
  std::optional<StringedProfile> instrument;
};

/** The names of BASS_STYLES, for assert_one_of(). */
std::vector<std::string_view> bass_style_names();

/** The estimate `generateBassLine` charges against the budget before it builds anything. */
double estimated_bass_notes(const std::vector<BassSegment>& segments);

/** generateBassLine from the point its context is resolved. */
std::vector<NoteEvent> generate_bass_line_with(const BassLineRequest& request,
                                               const ResolvedContext& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_BASS_BASS_H_
