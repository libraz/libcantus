/**
 * @file codec_t2.h
 * @brief Wire codec of the types of theory/symbol, theory/tendency, theory/counterpoint,
 *        theory/transposition, theory/harmony, theory/chordscale, theory/figured-bass:
 *        CANTUS_JSON_FIELDS for output, and readers of the `*Like` and record inputs.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_T2_H_
#define CANTUS_SRC_OPS_CODEC_T2_H_

#include <optional>
#include <string_view>

#include "cantus/theory/chordscale.h"
#include "cantus/theory/counterpoint.h"
#include "cantus/theory/figured_bass.h"
#include "cantus/theory/harmony.h"
#include "cantus/theory/symbol.h"
#include "json/json.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/codec_t1.h"

namespace cantus {

inline json::Value to_json(HarmonyRole r) { return json::Value(to_string(r)); }
inline json::Value to_json(LockLevel l) { return json::Value(to_string(l)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(VoicedRole, role, lock, belongsToChordId)
CANTUS_JSON_FIELDS(ChordScaleMatch, name, rootPc)
CANTUS_JSON_FIELDS(ChordScaleReportEntry, name, rootPc, avoid, passing, tensions)
CANTUS_JSON_FIELDS(FiguredBassSuspension, from, to, note, resolution)
CANTUS_JSON_FIELDS(FiguredBassRealization, chord, notes, suspensions)
CANTUS_JSON_FIELDS(VoiceMotionShares, contrary, oblique, similar, parallel)
CANTUS_JSON_FIELDS(VoiceSeparation, mean, min)
CANTUS_JSON_FIELDS(VoiceIndependenceReport, motion, rhythmicComplementarity, separation, crossings,
                   longestPerfectRun, sounding)

/** A wire ChordLike after `toChordData`: the chord as TS returns it, and as the typed API reads it.
 */
struct ChordData {
  /** The typed reading; a quality TS never reads may be unknown and reads as `maj`. */
  Chord chord;
  /** The validated data object, the quality as the caller wrote it. */
  json::Value wire;
};

/** `toChordData` over a wire ChordLike. */
ChordData read_chord_like(const json::Value& value);

/**
 * The `system` option of a chord symbol (`asked.system ?? DEFAULT_SYSTEM`): nullopt when absent or
 * null, else a known system.
 * @throws InvalidInputError if it names no system.
 */
std::optional<NoteNameSystem> read_symbol_system(const json::Value& asked);

/** The `flats` option of a chord symbol; absent unless it is a boolean. */
std::optional<bool> read_symbol_flats(const json::Value& asked);

/** `pitchOf` over a wire pitch or note: a number as it is, a note as its MIDI number. */
double read_pitch(const json::Value& value);

/** `typeof value === 'number'`. */
bool is_wire_number(const json::Value& value);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T2_H_
