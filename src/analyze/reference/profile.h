/**
 * @file profile.h
 * @brief Internal entry points of ts/src/analyze/reference/profile.ts beside analyze_reference():
 *        the harmonic reading a profile is built on, and the profile built from one in hand.
 */
#ifndef CANTUS_SRC_ANALYZE_REFERENCE_PROFILE_H_
#define CANTUS_SRC_ANALYZE_REFERENCE_PROFILE_H_

#include <vector>

#include "cantus/analyze/keys.h"
#include "cantus/analyze/reference.h"
#include "cantus/analyze/timeline.h"

namespace cantus {

/** The chord timeline, the key regions it was read against and the key held longest. */
struct ReferenceReadings {
  ChordTimeline timeline;
  std::vector<KeyRegion> keys;
  ResolvedKey prevailingKey;
};

/**
 * The harmonic reading for analyze_reference() (`readingsFor`): inferred from the notes, or the
 * given timeline read against the stated key or the keys searched for in the notes.
 * @throws InvalidInputError if the notes or an option cannot be read.
 */
ReferenceReadings readings_for(const std::vector<NoteEvent>& notes,
                               const ReferenceProfileOptions& opts = {});

/**
 * Build a profile from a harmonic reading already in hand (`referenceFromReadings`).
 * @throws InvalidInputError if the notes or an option cannot be read.
 */
ReferenceProfile reference_from_readings(const std::vector<NoteEvent>& notes,
                                         const ReferenceReadings& readings,
                                         const ReferenceProfileOptions& opts = {});

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_REFERENCE_PROFILE_H_
