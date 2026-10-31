/**
 * @file order.h
 * @brief The canonical note order and the sounding-note filter by index
 *        (ts/src/core/event-index/order.ts).
 */
#ifndef CANTUS_SRC_CORE_EVENT_INDEX_ORDER_H_
#define CANTUS_SRC_CORE_EVENT_INDEX_ORDER_H_

#include <cstddef>
#include <vector>

#include "cantus/core/types.h"

namespace cantus {

/** Indices of the notes by onset, then pitch, then position (`canonicalNoteOrder`). */
std::vector<std::size_t> canonical_note_order(const std::vector<NoteEvent>& notes);

/** Indices of the notes drop_silent_notes() keeps, ascending (`soundingIndices`). */
std::vector<std::size_t> sounding_indices(const std::vector<NoteEvent>& notes);

}  // namespace cantus

#endif  // CANTUS_SRC_CORE_EVENT_INDEX_ORDER_H_
