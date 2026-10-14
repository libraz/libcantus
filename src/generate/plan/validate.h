/**
 * @file validate.h
 * @brief Internal pieces of ts/src/generate/plan/validate.ts: the checks of a composition plan
 *        that the typed validator and the reader of a wire plan share.
 */
#ifndef CANTUS_SRC_GENERATE_PLAN_VALIDATE_H_
#define CANTUS_SRC_GENERATE_PLAN_VALIDATE_H_

#include <string>
#include <string_view>
#include <vector>

#include "cantus/analyze/melody.h"
#include "cantus/generate/plan.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** `endBeat` must not precede `startBeat` (`assertSpanOrder`), both already known finite. */
void assert_plan_span_order(double start_beat, double end_beat, std::string_view name);

/** One share of a mass distribution must be non-negative. */
void assert_plan_mass_share(double share, std::string_view name);

/** A mass distribution must sum to 1 within the tolerance. */
void assert_plan_mass_sum(double sum, std::string_view name);

/** A distribution must have the length its dimension asks for. */
void assert_plan_mass_length(double length, double expected, std::string_view name);

/**
 * A key field must be a key resolveKey accepts (`assertResolvedKeyField`).
 * @throws InvalidInputError "<name> must be a valid key: ..." when it is not.
 */
void assert_plan_key(const KeyArg& key, std::string_view name);

/**
 * A numeral must be one romanToChord can read against its key.
 * @throws InvalidInputError "<name>.roman must be readable by romanToChord; ..." when it is not.
 */
void assert_plan_roman(const std::string& roman, const ResolvedKey& key, std::string_view name);

/** A relation's time ratio must be positive. */
void assert_plan_time_ratio(double time_ratio, std::string_view name);

/** A derivation's source must come before it. */
void assert_plan_source_before(double from, double own_index, std::string_view name);

/** A root motif carries no relation. */
void assert_plan_root_has_no_relation(bool relation_is_null, std::string_view name);

/** A derived statement carries no rhythm of its own. */
void assert_plan_derived_has_no_rhythm(bool derived, std::string_view name);

/** A root's rhythm holds `notes - 1` gaps. */
void assert_plan_rhythm_length(double notes, double length, std::string_view name);

/** A root's rhythm gap must be positive. */
void assert_plan_rhythm_gap(double gap, std::string_view name);

/** A root's rhythm must sum to less than the statement's length. */
void assert_plan_rhythm_total(double total, double length, std::string_view name);

/** The schema version must be this build's. */
void assert_plan_version(const std::string& received, bool matches, std::string_view name);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PLAN_VALIDATE_H_
