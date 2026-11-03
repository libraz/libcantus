/**
 * @file kick.h
 * @brief Internal pieces of ts/src/generate/drums/kick.ts: realising a kick figure for one bar.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_KICK_H_
#define CANTUS_SRC_GENERATE_DRUMS_KICK_H_

#include <optional>
#include <vector>

#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "generate/drums/internal.h"

namespace cantus {

/**
 * A realised bar of kick, slot by slot (`KickEntries`): the rhythmic-dial setting above which the
 * slot sounds (minus infinity for one the figure states outright), or absent where it is silent.
 */
using KickEntries = std::vector<std::optional<double>>;

/** Whether a pre-chorus bar sits in the two-bar lift into the chorus (`isInPreChorusLift`). */
bool is_in_pre_chorus_lift(SectionType section, double bar, double section_bars,
                           bool next_is_chorus);

/** Realise a kick figure for one bar, with the dial setting each slot enters at. */
KickEntries realise_kick_entries(const KickFigure& figure, SectionType section, double bar,
                                 const Draw& draw, double rhythmic);

/**
 * A section- and style-aware kick figure for one bar, with the dial setting each sounding slot
 * enters at (`getKickEntries`).
 */
KickEntries get_kick_entries(SectionType section, DrumStyle style, double bar, const Draw& draw,
                             double rhythmic);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_KICK_H_
