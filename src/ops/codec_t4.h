/**
 * @file codec_t4.h
 * @brief Wire codec of the types of theory/safety: CANTUS_JSON_FIELDS for output, and the reader
 *        of the safety query the ops take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_T4_H_
#define CANTUS_SRC_OPS_CODEC_T4_H_

#include "cantus/theory/safety.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_t1.h"

namespace cantus {

inline json::Value to_json(NoteSafety s) { return json::Value(static_cast<double>(s)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(ProfileWeights, imperfectConsonance, perfectConsonance, dissonance, chordTone,
                   contraryMotion, obliqueMotion, similarMotion, parallelImperfect, stepwise,
                   melodicDistance, forbiddenLeap, registerDrift)
CANTUS_JSON_FIELDS(SafetyPartner, index, reasons)
/** The order evaluateSafety builds a result in. */
CANTUS_JSON_FIELDS(SafetyResult, safety, reasons, rationale, resolveTo, suggestions, partners)

/**
 * `assertSafetyContext` over a wire query, and the fields of it that carry no further checks: the
 * profile, the pitches, the other voices and the beat. The harmony is read by
 * read_safety_harmony().
 */
SafetyContext read_safety_context(const json::Value& query);

/** The chord and the key of a wire query, which TS reads once a pitch is being evaluated. */
void read_safety_harmony(const json::Value& query, SafetyContext& context);

/**
 * What evaluating `pitch` asserts of the query's chord: the guards of its tones (`isChordMember`),
 * then, for a pitch outside the chord, `assertChord` (`intervalAboveRoot`). Returns whether the
 * chord was asserted.
 */
bool read_safety_chord(const json::Value& query, double pitch);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T4_H_
