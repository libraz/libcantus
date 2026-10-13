/**
 * @file event_index.h
 * @brief Internal entry points of ts/src/core/event-index/index.ts beside the public API.
 */
#ifndef CANTUS_SRC_CORE_EVENT_INDEX_EVENT_INDEX_H_
#define CANTUS_SRC_CORE_EVENT_INDEX_EVENT_INDEX_H_

#include <vector>

#include "cantus/core/event_index.h"

namespace cantus {

/** Copies of `events` ordered by onset, simultaneous onsets in input order (`sortedNoteEvents`). */
std::vector<NoteEvent> sorted_note_events(const std::vector<NoteEvent>& events);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_EVENT_INDEX_EVENT_INDEX_H_
