/**
 * @file codec_a3.h
 * @brief Wire codec of the types of analyze/form, analyze/rhythm: CANTUS_JSON_FIELDS for output.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A3_H_
#define CANTUS_SRC_OPS_CODEC_A3_H_

#include "cantus/analyze/form.h"
#include "cantus/analyze/rhythm.h"
#include "ops/codec.h"
#include "ops/codec_a1a.h"
#include "ops/codec_a2.h"
#include "ops/codec_c1.h"

namespace cantus {

inline json::Value to_json(PhraseSignal signal) { return json::Value(to_string(signal)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(Hypermeter, groupBars, downbeats, confidence, rationale)
CANTUS_JSON_FIELDS(Phrase, startBeat, endBeat, cadence, signals, confidence, structuralWeight,
                   rationale)
CANTUS_JSON_FIELDS(StructuralCadence, phraseIndex, atBeat, endBeat, cadence, weight, rationale)
CANTUS_JSON_FIELDS(FormSection, label, startBeat, endBeat, bars, firstOccurrence, similarity,
                   rationale)
CANTUS_JSON_FIELDS(BarPositionProfile, ts, slotsPerBar, shares, onsets)
CANTUS_JSON_FIELDS(RhythmAnalysis, startBeat, endBeat, bars, onsets, onsetDensity, barOnsets,
                   onsetLevels, barPositions, interOnsetShares, restRatio, syncopation,
                   offGridRatio, rationale)

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A3_H_
