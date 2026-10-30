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

#include <optional>
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

/** `resolvedKeyOf` over options read_key_option() has read: the key resolved, or nullopt. */
std::optional<ResolvedKey> resolve_key_option(const VoicingOptions& opts);

/**
 * Whether spelling `pitch` in `key` consults a chord (`refineByContext`): its rounded pitch class
 * is neither the tonic's nor a scale tone.
 */
bool spelled_by_chord(double pitch, const ResolvedKey& key);

/**
 * What `spellingTable(key, chord)` reads of a wire chord: nothing without a key, else its spelling
 * hints (read_spelled_hints()) once the key leaves some pitch class to the chord to spell.
 */
void read_spelling_table_hints(const json::Value& chord, const std::optional<ResolvedKey>& key);

/**
 * What `spellVoicing` reads of a wire chord over finite pitches: its spelling hints, once a pitch
 * is spelled by the chord.
 */
void read_voicing_hints(const std::vector<double>& pitches, const json::Value& chord,
                        const ResolvedKey& key);

/**
 * `spellVoicing(pitches, chord, key)` over wire pitches, `chord` read from `wire`: the chord's
 * hints are read at the first pitch spelled by it, and a pitch that is no number is refused once
 * the ones before it are spelled.
 */
SpelledVoicing spell_wire_voicing(const json::Array& pitches, const Chord& chord,
                                  const json::Value& wire, const KeyArg& key);

/**
 * What `voiceChord` reads of a read chord once the search options are read: the chord's tones,
 * where the candidates are enumerated, then the key (`resolvedKeyOf`), then the roles the chord's
 * own spelling gives its tones, where the voicing is scored, then the hints the key spells it by.
 */
void read_voiced_chord(ChordData& data, const json::Value& asked, VoicingOptions& out);

/**
 * read_voiced_chord() as `nextVoicing` reads it: `resolvePreviousChord` comes before the scoring,
 * which then reads the roles of the chord being left as well, looking for its seventh.
 */
void read_next_voiced_chord(ChordData& data, const json::Value& asked, VoicingOptions& out);

/** `assertVoicing`: an array holding a finite pitch in every voice. */
std::vector<double> read_voicing(const json::Value& value, std::string_view name);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_T3_H_
