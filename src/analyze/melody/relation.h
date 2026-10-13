/**
 * @file relation.h
 * @brief Internal helpers of ts/src/analyze/melody/relation.ts: the relation between two lines
 *        already read into their notes. relate_motifs() is declared in cantus/analyze/melody.h.
 */
#ifndef CANTUS_SRC_ANALYZE_MELODY_RELATION_H_
#define CANTUS_SRC_ANALYZE_MELODY_RELATION_H_

#include <functional>
#include <vector>

#include "analyze/melody/internal.h"
#include "cantus/analyze/melody.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Resolves the key context when a relation first needs it. */
using KeySource = std::function<ResolvedKey()>;

/**
 * `relateMotifs` over two lines: the key, when `key_source` is given, is resolved before
 * anything is read.
 */
Nullable<MotifRelation> relate_lines(const std::vector<LineNote>& model,
                                     const std::vector<LineNote>& answer,
                                     const KeySource* key_source);

}  // namespace cantus

#endif  // CANTUS_SRC_ANALYZE_MELODY_RELATION_H_
