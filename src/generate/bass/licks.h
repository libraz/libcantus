/**
 * @file licks.h
 * @brief Internal pieces of ts/src/generate/bass/licks.ts: placeLicks once its options are checked
 *        and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_BASS_LICKS_H_
#define CANTUS_SRC_GENERATE_BASS_LICKS_H_

#include <optional>
#include <string>
#include <vector>

#include "cantus/core/instrument.h"
#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/bass.h"
#include "cantus/generate/context.h"

namespace cantus {

/**
 * How TS reads a chord's `quality` field when the caller's data holds something the quality table
 * does not name as a string: the typed chord reads as its fallback, and these say what TS sees.
 */
struct LickQuality {
  /** The field is absent, so no figure is held back for the chord's quality. */
  bool absent = false;
  /** The field is not a quality name, so no figure that names its qualities fits the chord. */
  bool foreign = false;
  /** `String(quality)` when the table has no row for it, else empty. */
  std::optional<std::string> unknown;
};

/** The options of placeLicks after their checks, in the form the placement reads them. */
struct LickRequest {
  /** The placement, sorted by onset and checked. */
  std::vector<BassSegment> segments;
  TimeSignature ts;
  Genre genre = Genre::kPop;
  KeyScale scale;
  /** The ceiling the caller named, used when the context names none. */
  std::optional<double> difficulty;
  /** The floor of the register band. */
  double low = 0;
  std::optional<StringedProfile> instrument;
  /** One entry per segment when the caller's chords carry qualities the typed chord cannot hold. */
  std::vector<LickQuality> qualities;
};

/** The estimate `placeLicks` charges against the budget before it builds anything. */
double estimated_lick_bars(const std::vector<BassSegment>& segments, const TimeSignature& ts);

/** placeLicks from the point its context is resolved. */
std::vector<NoteEvent> place_licks_with(const LickRequest& request,
                                        const ResolvedContext& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_BASS_LICKS_H_
