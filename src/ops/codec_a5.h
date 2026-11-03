/**
 * @file codec_a5.h
 * @brief Wire codec of the types of analyze/reference: CANTUS_JSON_FIELDS for output, and the
 *        reader of a reference profile, which replays the checks of validate.ts as it reads.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A5_H_
#define CANTUS_SRC_OPS_CODEC_A5_H_

#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

#include "cantus/analyze/reference.h"
#include "cantus/core/errors.h"
#include "cantus/core/nullable.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_a1a.h"
#include "ops/codec_a1b.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_a3.h"
#include "ops/codec_c1.h"
#include "ops/codec_t1.h"

namespace cantus::ops {

/** A key region: its key is written scale first, as resolveKey writes it. */
void write_fields(const ReferenceKeyRegion& v, FieldWriter& w);

/** The melodic reading: the register field is named `register`. */
void write_fields(const ReferenceMelody& v, FieldWriter& w);

CANTUS_JSON_FIELDS(ReferencePhraseMelody, shape, low, high, mean, peakPitch, peakPosition, outline,
                   onsetDensity, restRatio)
CANTUS_JSON_FIELDS(ReferenceCadence, atBeat, type, weight)
CANTUS_JSON_FIELDS(ReferencePhrase, startBeat, endBeat, bars, section, confidence, cadence, melody,
                   motifNodes)
CANTUS_JSON_FIELDS(ReferenceHypermeter, groupBars, confidence)
CANTUS_JSON_FIELDS(ReferenceForm, hypermeter, sections, phrases)
CANTUS_JSON_FIELDS(ReferenceChord, startBeat, endBeat, key, roman, function, level)
CANTUS_JSON_FIELDS(ReferenceHarmony, keys, chords, rhythm)
CANTUS_JSON_FIELDS(ReferenceRegister, low, high, mean)
CANTUS_JSON_FIELDS(ReferenceMotif, intervals, rhythm, unitBeats, spanBeats, occurrences)
CANTUS_JSON_FIELDS(ReferenceSpan, startBeat, endBeat, bars)
CANTUS_JSON_FIELDS(ReferenceProfile, profileVersion, span, meters, form, harmony, melody)
CANTUS_JSON_FIELDS(FormLikeness, sectionSequenceSimilarity, phraseLengthSimilarity)
CANTUS_JSON_FIELDS(HarmonyLikeness, progressionSimilarity, functionSimilarity, cadenceSimilarity,
                   keyPlanSimilarity, harmonicRhythmOnsetSimilarity,
                   harmonicRhythmDensitySimilarity)
CANTUS_JSON_FIELDS(MelodyLikeness, surfaceSimilarity, motifStructureSimilarity, contourSimilarity,
                   registerSimilarity)
CANTUS_JSON_FIELDS(RhythmLikeness, onsetSimilarity, densitySimilarity, durationSimilarity,
                   syncopationSimilarity)
CANTUS_JSON_FIELDS(ReferenceComparison, form, harmony, melody, rhythm, rationale)

/** `assertNullable`: a field that has to be present but may be null. */
template <class F>
auto read_nullable(const json::Value& value, std::string_view name,
                   F&& read) -> Nullable<std::decay_t<decltype(read(value, name))>> {
  if (is_undefined(value)) {
    throw InvalidInputError(std::string(name) + " must be present; received undefined");
  }
  if (value.is_null()) {
    return std::nullopt;
  }
  return read(value, name);
}

/** `assertResolvedKeyField`: the key as the library reads every key-shaped argument. */
ResolvedKey read_resolved_key_field(const json::Value& value, std::string_view name);

/**
 * The options referenceFromReadings reads, from the bag it is handed, in its order; the notes
 * checked against the bag's budget go to `typed_notes`.
 */
ReferenceProfileOptions reference_options(const json::Value& bag, const json::Value& notes,
                                          std::vector<NoteEvent>& typed_notes);

/**
 * `assertReferenceProfile(value, name)` over a wire value, read into the typed profile.
 * @throws InvalidInputError with the TS message naming the path to the field that is wrong.
 */
ReferenceProfile read_reference_profile(const json::Value& value, std::string_view name);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A5_H_
