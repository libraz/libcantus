/**
 * @file codec_a1a.h
 * @brief Wire codec of the types of analyze (layer root), analyze/functional:
 *        CANTUS_JSON_FIELDS for output, and readers of the option bags the ops take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A1A_H_
#define CANTUS_SRC_OPS_CODEC_A1A_H_

#include "cantus/analyze/functional.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_t1.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(HarmonicFunction f) { return json::Value(to_string(f)); }
inline json::Value to_json(BorrowedSource s) { return json::Value(to_string(s)); }
inline json::Value to_json(AugmentedSixthKind k) { return json::Value(to_string(k)); }
inline json::Value to_json(CadenceType t) { return json::Value(to_string(t)); }
inline json::Value to_json(CadenceStrength s) { return json::Value(to_string(s)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(RejectedCandidate, label, reason)
CANTUS_JSON_FIELDS(ChordAnalysis, function, borrowed, source, roman, rationale, alternatives)
CANTUS_JSON_FIELDS(RomanExplanation, roman, rationale, alternatives)
CANTUS_JSON_FIELDS(PivotChord, chord, romanFrom, romanTo)
/** The order cadenceBetween builds a result in; the soprano is appended when there is one. */
CANTUS_JSON_FIELDS(CadenceResult, type, strength, rootPosition, evaded, rationale, alternatives,
                   soprano)

/** The `applied` and `neapolitan` switches of a numeral options bag (each `=== true`). */
ChordToRomanOptions read_chord_to_roman_options(const json::Value& asked);

/**
 * Whether a plain object inherits a property of this name from `Object.prototype`, so that
 * `table[name]` finds a value for a name its own keys do not hold.
 */
bool inherits_object_member(std::string_view name);

/**
 * The table entry a chord's `quality` names (`Object.hasOwn(QUALITY_INTERVALS, quality)`): a
 * string, or any other value by the text it has, so the number 5 names the power chord. Nullopt
 * for a name the table does not hold.
 */
std::optional<ChordQuality> table_quality(const json::Value& quality);

/**
 * `assertChordQuality` over a wire chord.
 * @throws InvalidInputError "Unknown chord quality: ..." for a quality no table has.
 */
ChordQuality assert_chord_quality(const json::Value& chord);

/** assert_chord_quality() on the chord data of a read chord, taking the quality it names. */
void settle_chord_quality(ChordData& data);

/**
 * What reading a wire chord as an augmented sixth reads of its spelling hints (`spellChord`'s root
 * hint, then its tone spellings), when the chord stands on the key's lowered submediant and sounds
 * one of the kinds.
 */
void read_augmented_sixth_hints(const ChordData& data, const KeyArg& key);

/** The `voicing` option of `detectCadence`, read the way its destructuring reads it. */
std::optional<std::array<std::vector<double>, 2>> read_cadence_voicing(const json::Value& asked);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A1A_H_
