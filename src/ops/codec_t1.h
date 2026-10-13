/**
 * @file codec_t1.h
 * @brief Wire codec of the types of theory/chord, theory/scale, theory/spelling:
 *        CANTUS_JSON_FIELDS for output, and readers of the `*Like` and record inputs.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_T1_H_
#define CANTUS_SRC_OPS_CODEC_T1_H_

#include <string_view>

#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"
#include "cantus/theory/spelling.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"

namespace cantus {

inline json::Value to_json(KeyVariant v) { return json::Value(to_string(v)); }
inline json::Value to_json(KeyRelation r) { return json::Value(to_string(r)); }
inline json::Value to_json(ScaleSystem s) { return json::Value(to_string(s)); }
inline json::Value to_json(ChordQuality q) { return json::Value(to_string(q)); }
inline json::Value to_json(ChordBase b) { return json::Value(to_string(b)); }
inline json::Value to_json(ChordSeventh s) { return json::Value(to_string(s)); }
inline json::Value to_json(ChordToneRole r) { return json::Value(to_string(r)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(SpelledKeyScale, rootPc, modeMask12, tonic, variant)
/** The order keyFromFifths and every relation write a key in; resolveKey writes scale first. */
CANTUS_JSON_FIELDS(ResolvedKey, tonic, scale, variant)
CANTUS_JSON_FIELDS(RelatedKey, tonic, scale, variant, relation)
CANTUS_JSON_FIELDS(ScaleLadderPosition, rung, offset)
CANTUS_JSON_FIELDS(Alteration, degree, alter)
/** The order normalizeChordSpec builds a spec in. */
CANTUS_JSON_FIELDS(ChordSpec, rootPc, base, alterations, additions, omissions, seventh, bassPc)
CANTUS_JSON_FIELDS(PitchSpelling, letter, alter)
CANTUS_JSON_FIELDS(Chord, rootPc, quality, intervals, bassPc, rootSpelling, bassSpelling,
                   toneSpellings)
/** The order spanFromChord builds a span in. */
CANTUS_JSON_FIELDS(ChordSpan, rootPc, quality, startBeat, bassPc, intervals, degree,
                   secondaryDominant)
CANTUS_JSON_FIELDS(ChordSegment, startBeat, endBeat, chord)

/** A resolved key in the order resolveKey and tryResolveKeyName write it: scale first. */
json::Value scale_first(const ResolvedKey& key);

/** The names of the key variants, for assert_one_of(). */
std::vector<std::string_view> key_variant_names();

/** `toKeyScale` over a wire KeyLike: a validated key/scale. */
KeyScale read_key_like(const json::Value& value);

/**
 * `resolveKey`'s reading of a wire KeyLike: a name, or the scale with the tonic and variant it
 * carries, each read the way TS reads it before the key is resolved.
 */
KeyArg read_key_arg(const json::Value& value);

/** `assertModeMask` over a wire value. */
int read_mode_mask(const json::Value& value, std::string_view name);

/** `maskOf(value, name)` over a wire value: a record carrying a mode mask. */
int read_mask_of(const json::Value& value, std::string_view name);

/** `assertChordQuality` over a wire value. */
ChordQuality read_chord_quality(const json::Value& value);

/**
 * `assertChord(value, name)` over a wire value: a record with a finite root and a known quality.
 * Returns the record.
 */
const json::Value& assert_chord(const json::Value& value, std::string_view name = "chord");

/**
 * A wire chord as a typed one, each field converted the way JS arithmetic reads it. The checks TS
 * makes are the adapter's; a quality TS never reads may be unknown and reads as `fallback`.
 */
Chord read_chord_fields(const json::Value& value, ChordQuality fallback = ChordQuality::kMaj);

/** `assertChordSpec` over a wire value. */
ChordSpec read_chord_spec(const json::Value& value);

/** `assertOptions(context)` and the fields of a wire SpellingContext. */
SpellingContext read_spelling_context(const json::Value& value);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T1_H_
