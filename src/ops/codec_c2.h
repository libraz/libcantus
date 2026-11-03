/**
 * @file codec_c2.h
 * @brief Wire codec of the types of core/pitch, core/interval, core/random, core/duration,
 *        core/tempo, core/tuning, core/event-index: CANTUS_JSON_FIELDS for output, and readers
 *        of the inputs that carry a validation of their own.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_C2_H_
#define CANTUS_SRC_OPS_CODEC_C2_H_

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/duration.h"
#include "cantus/core/event_index.h"
#include "cantus/core/interval.h"
#include "cantus/core/pitch.h"
#include "cantus/core/random.h"
#include "cantus/core/tempo.h"
#include "cantus/core/tuning.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"

namespace cantus {

inline json::Value to_json(NoteNameSystem s) { return json::Value(to_string(s)); }
inline json::Value to_json(KeyNameMode m) { return json::Value(to_string(m)); }
inline json::Value to_json(NoteValue v) { return json::Value(to_string(v)); }
inline json::Value to_json(ConsonanceClass c) {
  return json::Value(static_cast<double>(static_cast<int>(c)));
}

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(NoteData, letter, alter, octave)
CANTUS_JSON_FIELDS(KeyName, tonic, mode)
CANTUS_JSON_FIELDS(SpelledInterval, number, quality, semitones, descending)
CANTUS_JSON_FIELDS(Tuplet, actual, normal)
CANTUS_JSON_FIELDS(SpelledDuration, base, dots, tuplet)
CANTUS_JSON_FIELDS(TuningTable, refStep, refFreq, divisions)

/** `assertNote` over a wire value: a record with an integer letter, alteration and octave. */
NoteData read_note(const json::Value& value, std::string_view name);

/** `toNoteData` over a wire NoteLike. */
NoteData read_note_like(const json::Value& value);

/** `toSpelledInterval` over a wire IntervalLike. */
SpelledInterval read_interval_like(const json::Value& value);

/** The `system` of a note-name options bag (`assertSystem`); absent when the bag has none. */
std::optional<NoteNameSystem> read_note_name_system(const json::Value& opts);

/** A MIDI spelling name (`assertOneOf(value, ['sharp', 'flat'], 'midi spelling')`). */
MidiSpelling read_midi_spelling(const json::Value& value);

/** The semitones of a note transposition: a finite number, else rejected with `${value}`. */
double read_transpose_semitones(const json::Value& value);

/** The `spelling` of a note transposition's wire options. */
TransposeNoteOptions read_transpose_note_options(const json::Value& asked);

/** `assertDuration` over a wire `NoteValue | DurationData`. */
DurationArg read_duration(const json::Value& value, std::string_view name);

/** The options of a duration conversion: `assertOptions`, then the `beatUnit` it holds. */
DurationOptions read_duration_options(const json::Value& options);

/** `assertTempoMap` over a wire value. */
TempoMap read_tempo_map(const json::Value& value, std::string_view name = "tempo map");

/** `assertTuning` over a wire value. */
TuningTable read_tuning(const json::Value& value);

/**
 * The seed path made of arguments `from` onwards, each a string or a finite number
 * (`hashPath`'s reading of its segments).
 */
SeedPath read_seed_path(const Args& args, std::size_t from);

/** A seed read as `assertInteger(seed, name, 0, 0xffffffff)` reads it. */
std::uint32_t read_seed(const json::Value& value, std::string_view name);

/** The wire form of a PositionalRng: `{"$hy": "PositionalRng", "seed"}`. */
json::Value positional_rng_hybrid(std::uint32_t seed);

/** Whether a wire value is a PositionalRng hybrid. */
bool is_positional_rng_hybrid(const json::Value& value);

/**
 * The source behind a PositionalRng hybrid.
 * @throws RequestError when the hybrid carries no numeric seed.
 */
PositionalRng read_positional_rng(const json::Value& hybrid);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_C2_H_
