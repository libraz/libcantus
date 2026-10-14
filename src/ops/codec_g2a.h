/**
 * @file codec_g2a.h
 * @brief Wire codec of the types of generate/bass, generate/countermelody: CANTUS_JSON_FIELDS for
 *        output, and readers of the chord placements and caller licks the ops take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_G2A_H_
#define CANTUS_SRC_OPS_CODEC_G2A_H_

#include <any>
#include <optional>
#include <string_view>
#include <vector>

#include "cantus/generate/bass.h"
#include "generate/bass/licks.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_g1.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(BassStyle style) { return json::Value(to_string(style)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(LickNote, degree, step, velocity, voice, limb, alter, lengthSteps, articulation)
CANTUS_JSON_FIELDS(LickMaterial, lengthSteps, notes)

/** A lick entry, in the field order the built-in dictionary writes. */
void write_fields(const BassLick& v, FieldWriter& w);

/** A chord placement as the lick placement reads it: the segments and how each quality reads. */
struct BassPlacement {
  std::vector<BassSegment> segments;
  /** One entry per segment, in the order of `segments`. */
  std::vector<LickQuality> qualities;
};

/**
 * `placement.map((segment) => ({ ...segment, chord: toChordData(segment.chord) })).sort(by
 * startBeat)` followed by `assertBassSegments`, over a wire placement.
 * @throws InvalidInputError or js::TypeError as TS does.
 */
BassPlacement read_bass_placement(const json::Array& placement);

/** read_bass_placement() for the entry points that never read a chord's quality by name. */
inline std::vector<BassSegment> read_bass_segments(const json::Array& placement) {
  return read_bass_placement(placement).segments;
}

/** `isLickMaterial(material)` over a wire value. */
bool wire_is_lick_material(const json::Value& material);

/**
 * The lick entries of a context's validated entries (`vocabularyOfKind(entries, isLickMaterial)`),
 * each checked note by note as `assertLickMaterial` checks it and typed for the generators.
 * @throws InvalidInputError naming the first note field outside its domain.
 */
std::vector<Vocabulary<std::any>> read_lick_vocabulary(const json::Array& entries);

/**
 * `value.length` and `value[0 .. length)` of a list, a text or an object that has a length: the
 * elements as they read, and the length as a budget check reads it (undefined where the value has
 * none).
 */
void read_array_like(const json::Value& value, std::vector<json::Value>& elements,
                     json::Value& length);

/**
 * The instrument the context names for a part, as `bassRegister` reads it: a stringed profile
 * the context holds, validated as `instrumentRange` validates it.
 * @param named `resolved.instrument(part)`.
 * @throws js::TypeError if `named` is null.
 */
std::optional<InstrumentProfile> read_named_stringed(const json::Value& named);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_G2A_H_
