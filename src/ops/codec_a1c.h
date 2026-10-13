/**
 * @file codec_a1c.h
 * @brief Wire codec of the types of analyze/voice, analyze/melody: CANTUS_JSON_FIELDS for output,
 *        and readers of the melodic phrases, motifs and voices the ops take.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A1C_H_
#define CANTUS_SRC_OPS_CODEC_A1C_H_

#include <optional>
#include <string_view>
#include <vector>

#include "analyze/melody/internal.h"
#include "analyze/voice/voice.h"
#include "cantus/analyze/melody.h"
#include "cantus/analyze/voice.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"
#include "ops/codec_t1.h"

namespace cantus {

inline json::Value to_json(ContourDirection d) { return json::Value(to_string(d)); }
inline json::Value to_json(MelodicContourShape s) { return json::Value(to_string(s)); }
inline json::Value to_json(MotifRelationKind k) { return json::Value(to_string(k)); }
inline json::Value to_json(SuspensionFigure f) { return json::Value(to_string(f)); }
inline json::Value to_json(TheoryLabelKind k) { return json::Value(to_string(k)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(MelodicContour, directions, shape, peakIndex, troughIndex, range, rationale)
CANTUS_JSON_FIELDS(MotifOccurrence, noteIndex, startBeat, endBeat, transpose, timeRatio)
CANTUS_JSON_FIELDS(MotifData, notes, intervals, rhythm, occurrences, rationale)
CANTUS_JSON_FIELDS(MotifRelationSummary, kind, sequence, semitones, degrees, timeRatio)
CANTUS_JSON_FIELDS(MelodicComparison, similarity, pitchSimilarity, rhythmSimilarity, rationale)
CANTUS_JSON_FIELDS(MotifGraphNode, motif, occurrence, startBeat, endBeat)
CANTUS_JSON_FIELDS(MotifGraphEdge, from, to, relation, similarity)
CANTUS_JSON_FIELDS(MotifGraph, nodes, edges)
CANTUS_JSON_FIELDS(TheoryLabel, kind, role, degree, type, resolveTo)
/** The order analyzeVoice builds a note in; the original index follows. */
CANTUS_JSON_FIELDS(AnalyzedNote, noteId, pitch, startBeat, durationBeat, labels, rationale,
                   originalIndex, trackIndex)

/**
 * `keyScaleAt(key)` over wire argument `i`: a function answers per beat, any other key is read
 * once, here.
 */
KeyAtBeat read_key_context(const Args& a, std::size_t i);

/** read_key_context() over a key context found in an option field. */
KeyAtBeat read_key_context(const Args& a, const json::Value& key);

/**
 * A chord a host supplied to `analyzeVoice`, checked as the first read of it checks it; nullopt
 * for none.
 */
std::optional<VoiceChord> read_host_chord(const json::Value& wire);

/** A relation in the order relateMotifs builds one: the shared part, the kind, then the rest. */
void write_fields(const MotifRelation& v, FieldWriter& w);

/** The options bag a note list is read with: notes that never sound are allowed. */
json::Value line_options(const json::Value& budget);

/** `phraseNotes` over a wire phrase: the array itself, or the `notes` of a record. */
const json::Value& read_phrase_notes(const json::Value& phrase);

/**
 * A wire line as the numbers an analysis reads of its notes (`notes[i]?.pitch ?? 0` and the
 * like), each field converted the way JS arithmetic reads it.
 */
std::vector<LineNote> read_line(const json::Array& notes);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A1C_H_
