/**
 * @file percussion.h
 * @brief Internal pieces of ts/src/generate/drums/percussion.ts: the auxiliary percussion layer.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_PERCUSSION_H_
#define CANTUS_SRC_GENERATE_DRUMS_PERCUSSION_H_

#include "cantus/generate/context.h"
#include "generate/drums/beat.h"
#include "generate/drums/hit.h"
#include "generate/drums/internal.h"

namespace cantus {

/** Enabled auxiliary percussion voices for a section (`PercussionConfig`). */
struct PercussionConfig {
  bool tambourine;
  bool shaker;
  bool handclap;
  bool shaker16th;
};

/** Which auxiliary voices play for a section (`getPercussionConfig`). */
PercussionConfig get_percussion_config(PercMoodCategory mood, SectionType section);

/** Emit one bar of auxiliary percussion (`generateAuxPercussionForBar`). */
void generate_aux_percussion_for_bar(HitList<DrumHit>& track, double bar_start,
                                     const PercussionConfig& config, DrumRole role,
                                     double density_mult, const Draw& draw, double bpm,
                                     const SectionCtx& sec, double swing_amount,
                                     double bar_beats = FOUR_FOUR_BEATS);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_PERCUSSION_H_
