/**
 * @file codec_g3.h
 * @brief Wire codec of the types of generate/plan: output fields, and the reader of a plan that
 *        replays assertCompositionPlan over a wire value.
 */
#ifndef CANTUS_SRC_OPS_CODEC_G3_H_
#define CANTUS_SRC_OPS_CODEC_G3_H_

#include <string_view>

#include "cantus/generate/plan.h"
#include "ops/codec.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a5.h"
#include "ops/codec_t1.h"

namespace cantus {

inline json::Value to_json(ViolationKind kind) { return json::Value(to_string(kind)); }
inline json::Value to_json(ViolationSeverity severity) { return json::Value(to_string(severity)); }

}  // namespace cantus

namespace cantus::ops {

/** A phrase writes its `register_` member as `register`. */
void write_fields(const PlannedPhrase& v, FieldWriter& w);

/** A plan writes its keys scale first. */
void write_fields(const CompositionPlan& v, FieldWriter& w);

/** A fit writes its `register_` member as `register`. */
void write_fields(const CompositionFit& v, FieldWriter& w);

CANTUS_JSON_FIELDS(PlannedSection, label, startBeat, endBeat)
CANTUS_JSON_FIELDS(PlannedRegister, low, high, mean)
CANTUS_JSON_FIELDS(PlannedChord, startBeat, endBeat, key, roman)
CANTUS_JSON_FIELDS(PlannedMotif, phrase, startBeat, endBeat, notes, rhythm, from, relation)
CANTUS_JSON_FIELDS(PlannedRhythm, onsetLevels, interOnsetShares, syncopation)
CANTUS_JSON_FIELDS(PlanSpan, startBeat, endBeat, bars)
CANTUS_JSON_FIELDS(CompositionViolation, kind, severity, atBeat, expected, actual, rationale)
CANTUS_JSON_FIELDS(CompositionEvaluation, violations, fit)

/**
 * `assertCompositionPlan(value, name)` over a wire value: every field is checked in the TS order
 * with the TS messages, and the plan is returned typed.
 * @throws InvalidInputError naming the path to the field that is wrong.
 */
CompositionPlan read_composition_plan(const json::Value& value, std::string_view name);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_G3_H_
