// What a reading of the melody costs: ts/src/generate/harmonize/cost.ts.

#include "generate/harmonize/cost.h"

#include <algorithm>
#include <cstddef>

#include "cantus/core/pitch.h"
#include "generate/harmonize/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

constexpr double kRootMotionCost[] =
#include "generate/harmonize/root_motion_cost.gen.inc"
    ;

/** Whether a candidate is the key's dominant, in a quality that can act as one. */
bool is_dominant_of(const Candidate& cand, int tonic_pc) {
  return cand.rootPc == (tonic_pc + 7) % 12 &&
         (cand.quality == ChordQuality::kMaj || cand.quality == ChordQuality::kDom7);
}

}  // namespace

double emission_cost(const Segment& seg, const Candidate& cand,
                     const std::vector<NoteEvent>& melody, const KeyScale& key) {
  const std::vector<int>& pcs = cand.pcs;
  double cost = cand.base * seg.weight;
  for (const CostNote& cost_note : seg.costNotes) {
    if (cost_note.index >= melody.size()) {
      continue;
    }
    const NoteEvent& note = melody[cost_note.index];
    if (std::find(pcs.begin(), pcs.end(), pitch_class_of(note.pitch)) != pcs.end()) {
      continue;
    }
    cost += (cost_note.strong ? HARMONIZE_NON_CHORD_TONE_STRONG : HARMONIZE_NON_CHORD_TONE_WEAK) *
            cost_note.weight;
    if (!is_key_tone(note.pitch, key)) {
      cost += HARMONIZE_NON_SCALE_TONE * cost_note.weight;
    }
  }
  return cost;
}

double transition_cost(const Candidate& prev, const Candidate& cur, int tonic_pc) {
  double cost =
      prev.rootPc == cur.rootPc && prev.quality == cur.quality ? 0 : HARMONIZE_CHORD_CHANGE;
  int down = (prev.rootPc - cur.rootPc + 12) % 12;
  if (down == 7) {
    cost += HARMONIZE_DESCENDING_FIFTH;
  } else if (down == 5) {
    cost += HARMONIZE_ASCENDING_FIFTH;
  } else {
    cost += kRootMotionCost[std::min<int>(down, 12 - down)];
  }
  if (is_dominant_of(prev, tonic_pc) && cur.rootPc == tonic_pc) {
    cost += HARMONIZE_DOMINANT_TO_TONIC;
  }
  if (prev.secondaryDominant && cur.degree != prev.targetDegree) {
    cost += HARMONIZE_SECONDARY_UNRESOLVED;
  }
  // Reaching a chord's own dominant from that chord leads straight back where it came from.
  if (cur.secondaryDominant && prev.degree.has_value() && prev.degree == cur.targetDegree) {
    cost += HARMONIZE_SECONDARY_AFTER_TARGET;
  }
  return cost;
}

double phrase_end_bonus(const Candidate* prev, const Candidate& cur, int tonic_pc,
                        const Segment& seg, const std::vector<NoteEvent>& melody) {
  if (cur.rootPc != tonic_pc || !seg.closingIndex) {
    return 0;
  }
  if (*seg.closingIndex >= melody.size() ||
      pitch_class_of(melody[*seg.closingIndex].pitch) != tonic_pc) {
    return 0;
  }
  double weight = js::max(seg.weight, seg.beats);
  return (HARMONIZE_PHRASE_TONIC +
          (prev != nullptr && is_dominant_of(*prev, tonic_pc) ? HARMONIZE_PHRASE_AUTHENTIC : 0)) *
         weight;
}

}  // namespace cantus
