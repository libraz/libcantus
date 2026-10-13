/**
 * @file drums.h
 * @brief Internal pieces of ts/src/generate/drums/index.ts: generateDrums once its own option
 *        checks have passed and its context is resolved.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_DRUMS_H_
#define CANTUS_SRC_GENERATE_DRUMS_DRUMS_H_

#include <functional>
#include <optional>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"

namespace cantus {

/** A checked Euclidean kick request: `pulses`, `steps ?? 16`, `rotation ?? 0`. */
struct EuclideanPlan {
  double pulses = 0;
  double steps = 0;
  double rotation = 0;
};

/** The options of generateDrums after its checks, in the form the generator reads them. */
struct DrumsRequest {
  int bars = 0;
  GrooveStyle style = GrooveStyle::kStandard;
  Section section = Section::kVerse;
  std::optional<Section> nextSection;
  /** `opts.fills`, read for its truth. */
  bool fills = false;
  /** The feel the caller named, absent for the style's own. */
  std::optional<GrooveFeel> feel;
  DrumRole role = DrumRole::kFull;
  /** The signature at beat 0 of the meter, already checked to be 4/4 throughout. */
  TimeSignature ts;
  std::optional<EuclideanPlan> euclidean;
  /** Whether the kit named for the part has a voice; empty when no kit was named. */
  std::function<bool(int)> playable;
};

/** generateDrums from the point its context is resolved. */
std::vector<DrumHit> generate_drums_with(const DrumsRequest& request,
                                         const ResolvedContext& resolved);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_DRUMS_H_
