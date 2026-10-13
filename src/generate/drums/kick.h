/**
 * @file kick.h
 * @brief Internal pieces of ts/src/generate/drums/kick.ts: realising a kick figure for one bar.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_KICK_H_
#define CANTUS_SRC_GENERATE_DRUMS_KICK_H_

#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "generate/drums/internal.h"

namespace cantus {

/** Whether a pre-chorus bar sits in the two-bar lift into the chorus (`isInPreChorusLift`). */
bool is_in_pre_chorus_lift(SectionType section, double bar, double section_bars,
                           bool next_is_chorus);

/** Realise a kick figure for one bar (`realiseKickFigure`). */
KickPattern realise_kick_figure(const KickFigure& figure, SectionType section, double bar,
                                const Draw& draw, double rhythmic);

/** A section- and style-aware kick pattern for one bar (`getKickPattern`). */
KickPattern get_kick_pattern(SectionType section, DrumStyle style, double bar, const Draw& draw,
                             double rhythmic);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_KICK_H_
