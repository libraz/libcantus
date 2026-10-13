/**
 * @file session.h
 * @brief Internal helpers of ts/src/analyze/arrange/session.ts beside the public
 *        ArrangementSession in cantus/analyze/arrange.h: which beats an edit touched, and which
 *        slots of the harmony that dirties.
 */
#ifndef CANTUS_SRC_ANALYZE_ARRANGE_SESSION_H_
#define CANTUS_SRC_ANALYZE_ARRANGE_SESSION_H_

#include <optional>
#include <vector>

#include "analyze/timeline/timeline.h"
#include "cantus/core/types.h"

namespace cantus {

/** The beats an edit touched (`EditedSpan`). */
struct EditedSpan {
  double startBeat = 0;
  double endBeat = 0;
};

/**
 * Whether two note arrays hold the same notes in the same positions (`sameOrder`). A re-ordering
 * changes no beat of the music, but the position each annotation reports still moves.
 */
bool same_order(const std::vector<NoteEvent>& before, const std::vector<NoteEvent>& after);

/**
 * The beats covered by the notes that `before` and `after` disagree on (`editedSpan`), compared
 * as values and by multiplicity; nullopt when the two agree.
 */
std::optional<EditedSpan> edited_span(const std::vector<NoteEvent>& before,
                                      const std::vector<NoteEvent>& after);

/** Merge two edited spans into the one covering both (`unionSpan`). */
std::optional<EditedSpan> union_span(const std::optional<EditedSpan>& a,
                                     const std::optional<EditedSpan>& b);

/**
 * The slots of the evidence an edit dirties: all of them are clean for a pure re-ordering, and
 * none are known when the harmony was supplied (`evidence` null).
 */
std::optional<DirtySlots> dirty_slots_of(const TimelineEvidence* evidence,
                                         const std::optional<EditedSpan>& edited);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_ARRANGE_SESSION_H_
