/**
 * @file fills.h
 * @brief Internal pieces of ts/src/generate/drums/fills.ts: choosing a fill for a transition and
 *        writing it beat by beat.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_FILLS_H_
#define CANTUS_SRC_GENERATE_DRUMS_FILLS_H_

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "generate/drums/hit.h"
#include "generate/drums/internal.h"

namespace cantus {

/** The caller's archetypes by id, as a Map built from its entries holds them. */
using SuppliedFills = std::vector<std::pair<std::string, FillArchetype>>;

/** The names of FILL_VELOCITY_BASES, for assert_one_of(). */
std::vector<std::string_view> fill_velocity_base_names();

/**
 * Reject a caller's fill whose strokes the generator cannot write (`assertFillArchetype`).
 * @throws InvalidInputError naming the first stroke field outside its domain.
 */
void assert_fill_archetype(const FillArchetype& material, const std::string& label);

/** The archetype an id names, a caller's own first (`fillArchetypeFor`). */
const FillArchetype* fill_archetype_for(const std::string& id, const SuppliedFills& supplied);

/** Beat at which a fill begins, widening with section energy (`getFillStartBeat`). */
double get_fill_start_beat(SectionEnergy energy);

/**
 * Pick a fill archetype for a section transition (`selectFillType`): the id drawn, or nullopt
 * when the table has nothing the transition accepts.
 */
std::optional<std::string> select_fill_type(SectionType from, SectionType to, DrumStyle style,
                                            SectionEnergy next_energy, const Draw& draw, double bar,
                                            const std::vector<std::string>& extra,
                                            const std::function<bool(const std::string&)>& accepts);

/** Whether a fill is inside the difficulty ceiling at this tempo (`fillWithinCeiling`). */
bool fill_within_ceiling(const FillArchetype& shape, double from_beat, double bar_beats,
                         std::optional<double> bpm, std::optional<double> difficulty);

/** Emit a fill for a single beat of the fill bar (`generateFill`). */
void generate_fill(HitList<DrumHit>& track, double beat_tick, double beat,
                   const FillArchetype& shape, double velocity,
                   const std::function<double(double)>& place);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_FILLS_H_
