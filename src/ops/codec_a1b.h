/**
 * @file codec_a1b.h
 * @brief Wire codec of the types of analyze/detect, analyze/keys: CANTUS_JSON_FIELDS for output,
 *        and readers of the pitch lists, profile and mode options, and meter options the ops
 *        take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A1B_H_
#define CANTUS_SRC_OPS_CODEC_A1B_H_

#include <memory>
#include <optional>
#include <string_view>
#include <variant>
#include <vector>

#include "analyze/detect/profiles.h"
#include "analyze/keys/keys.h"
#include "cantus/analyze/detect.h"
#include "cantus/analyze/keys.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_a1a.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/codec_t1.h"

namespace cantus {

inline json::Value to_json(ModalScaleName n) { return json::Value(to_string(n)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(ChordMatch, rootPc, quality, missingPcs, extraPcs, exact, inversion, bassPc)
CANTUS_JSON_FIELDS(KeyMatch, key, mode, variant, scaleName, fit, score, rationale, alternatives)

/** A region: its key is written the way `resolveKey` writes one, scale first. */
void write_fields(const KeyRegion& v, FieldWriter& w);

/**
 * `assertPitches` over a wire list: an array within the budget of MIDI pitches, a missing element
 * reading as NaN.
 */
std::vector<int> read_pitches(const json::Value& pitches, std::string_view name,
                              const json::Value& budget);

/**
 * The `profile` option as a source that resolves it when the analysis first needs it
 * (`resolveKeyProfile`); `profile` is null for an absent option.
 */
ProfileSource wire_profile_source(const json::Value* profile);

/** `resolveModalCandidates`' reading of the `modes` option; `modes` is null for an absent one. */
std::optional<std::variant<bool, std::vector<ModalScaleName>>> read_modal_modes(
    const json::Value* modes);

/**
 * The chords of wire segments as `detectModulations` reads them: each checked (`assertChord`, the
 * tone guards, the dominant-seventh scan) and read the first time the search asks for it. The
 * cache must outlive the source.
 */
ChordSource modulation_chord_source(const json::Array& segments,
                                    std::vector<std::unique_ptr<Chord>>& cache);

/** The `explain`-style switch `x === true` of an option bag. */
bool is_true_option(const json::Value& asked, std::string_view key);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A1B_H_
