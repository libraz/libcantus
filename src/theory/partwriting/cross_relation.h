/**
 * @file cross_relation.h
 * @brief Internal header of ts/src/theory/partwriting/cross-relation.ts: the cross relation,
 *        written once for the voicing search and the checker.
 */
#ifndef CANTUS_SRC_THEORY_PARTWRITING_CROSS_RELATION_H_
#define CANTUS_SRC_THEORY_PARTWRITING_CROSS_RELATION_H_

#include <vector>

#include "cantus/core/pitch.h"
#include "cantus/core/types.h"
#include "cantus/theory/chord.h"

namespace cantus {

/** One chord of an exercise as the rule reads it: what sounds, and what it is
 * (`ChromaticMoment`). */
struct ChromaticMoment {
  /** The written notes, ascending. */
  const std::vector<NoteData>& notes;
  /** The chord they realize. */
  const Chord& chord;
};

/** What stands on either side of the pair being judged (`ChromaticContext`). */
struct ChromaticContext {
  /** The voicing before the pair, naming how the earlier notes were reached. */
  const std::vector<NoteData>* before = nullptr;
  /** The chord after the pair, naming what the later chord resolves to. */
  const Chord* after = nullptr;
};

/** One exposed contradiction, by the voices holding the two notes (`CrossRelation`). */
struct CrossRelation {
  /** The voice holding the earlier note. */
  int earlierVoice = 0;
  /** The voice holding the later one. */
  int laterVoice = 0;
  /** The earlier note itself. */
  NoteData earlier;
  /** The later note itself. */
  NoteData later;
};

/** Whether a voice is the bass or the top voice of its chord (`isOuterVoice`). */
bool is_outer_voice(int voice, const std::vector<NoteData>& notes);

/**
 * Every cross relation between two consecutive chords: the same letter carrying different
 * accidentals in two different voices, one entry per contradicting pair (`crossRelations`).
 */
std::vector<CrossRelation> cross_relations(const ChromaticMoment& from, const ChromaticMoment& to,
                                           const KeyScale& key,
                                           const ChromaticContext& context = {});

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_PARTWRITING_CROSS_RELATION_H_
