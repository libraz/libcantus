/**
 * @file codec_t3.h
 * @brief Wire codec of the types of theory/partwriting, theory/voicing: CANTUS_JSON_FIELDS for
 *        output, and readers of the voicing options and the voicings the ops take.
 *
 * Each option reader mirrors one resolver of ts/src/theory/voicing/satb.ts over the wire options,
 * so an adapter calls them in the order the TS entry point resolves them.
 */
#ifndef CANTUS_SRC_OPS_CODEC_T3_H_
#define CANTUS_SRC_OPS_CODEC_T3_H_

#include <string_view>
#include <vector>

#include "cantus/theory/partwriting.h"
#include "cantus/theory/voicing.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_c2.h"
#include "ops/codec_t1.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(PartWritingViolationKind k) { return json::Value(to_string(k)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(VoiceRange, min, max)
CANTUS_JSON_FIELDS(PartWritingViolation, kind, voices, fromIndex, toIndex, rationale)

/**
 * `resolveRanges`' reading of wire options: the explicit `ranges` when given, else the voice
 * count (`voices ?? 4`). Fills `out.ranges` or `out.voices`.
 */
void read_ranges_option(const json::Value& asked, VoicingOptions& out);

/** `resolveMaxSpacing` over wire options. */
void read_max_spacing_option(const json::Value& asked, VoicingOptions& out);

/** `resolveMaxCandidates` over wire options; `out.maxCandidates` stays empty when absent. */
void read_max_candidates_option(const json::Value& asked, VoicingOptions& out);

/** The `key` of wire options, as `resolvedKeyOf` reads it; `out.key` stays empty when absent. */
void read_key_option(const json::Value& asked, VoicingOptions& out);

/** `resolvePreviousChord` over wire options; `out.previousChord` stays empty when absent. */
void read_previous_chord_option(const json::Value& asked, VoicingOptions& out);

/** `assertVoicing`: an array holding a finite pitch in every voice. */
std::vector<double> read_voicing(const json::Value& value, std::string_view name);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T3_H_
