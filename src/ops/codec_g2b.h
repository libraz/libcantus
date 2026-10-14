/**
 * @file codec_g2b.h
 * @brief Wire codec of the types of generate/motif, generate/ornament, generate/groove,
 *        generate/rhythm, generate/progression: CANTUS_JSON_FIELDS for output, and the readers
 *        and writers the ops share.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_G2B_H_
#define CANTUS_SRC_OPS_CODEC_G2B_H_

#include <vector>

#include "cantus/generate/groove.h"
#include "cantus/generate/motif.h"
#include "cantus/generate/ornament.h"
#include "cantus/generate/progression.h"
#include "cantus/generate/rhythm.h"
#include "generate/motif/motif.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_g1.h"
#include "ops/codec_t1.h"
#include "ops/codec_t2.h"

namespace cantus {

inline json::Value to_json(ProgStyle style) { return json::Value(to_string(style)); }
inline json::Value to_json(ProgFunction function) { return json::Value(to_string(function)); }
inline json::Value to_json(OrnamentStyle style) { return json::Value(to_string(style)); }
inline json::Value to_json(MotifTransform transform) { return json::Value(to_string(transform)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(RhythmEvent, position, duration)
CANTUS_JSON_FIELDS(GrooveSlot, timingOffset, velocity)
CANTUS_JSON_FIELDS(GrooveTemplate, subdivision, slotsPerBar, slots, ts)
CANTUS_JSON_FIELDS(MotifCell, notes)
CANTUS_JSON_FIELDS(ProgressionPreset, id, name, degrees, functional, styles)
CANTUS_JSON_FIELDS(BorrowedDegrees, bVI, bVII, bIII, iv, bII, sharpIV)

/**
 * The samplers of the part a call draws under: `ctx.part(name)`, where the name is whatever the
 * caller wrote (a string or a finite number is a path segment).
 * @throws InvalidInputError if the name is not a path segment.
 */
Draw wire_part(const WireContext& ctx, const json::Value& name);

/**
 * `timeline.at(beat)` over a wire timeline: a timeline hybrid answers from its segments, any other
 * object through its `at`.
 * @throws js::TypeError if `at` is not a function.
 */
json::Value timeline_at(const Args& a, const json::Value& timeline, double beat);

/** `chordPitchClasses(chord)` over a chord as a timeline or a host answers with it. */
std::vector<int> wire_chord_pitch_classes(const json::Value& chord);

/**
 * The notes of a result: each is a copy of the wire note it names, with the fields TS moves written
 * over it, or a fresh `{ pitch, startBeat, durationBeat }`.
 */
json::Value motif_notes_json(const json::Array& source, const std::vector<MotifResult>& results);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_G2B_H_
