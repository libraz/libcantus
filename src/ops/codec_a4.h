/**
 * @file codec_a4.h
 * @brief Wire codec of the types of analyze/arrange: CANTUS_JSON_FIELDS for output, and the host
 *        of a chord timeline a caller supplies.
 *
 * The enum writers live in namespace cantus beside their types, where the codec templates of
 * ops/codec.h find them by argument-dependent lookup.
 */
#ifndef CANTUS_SRC_OPS_CODEC_A4_H_
#define CANTUS_SRC_OPS_CODEC_A4_H_

#include <memory>

#include "analyze/arrange/tracks.h"
#include "cantus/analyze/arrange.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_t4.h"

namespace cantus {

inline json::Value to_json(TrackRole role) { return json::Value(to_string(role)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(TensionPoint, beat, tension)
CANTUS_JSON_FIELDS(TrackAnalysis, name, role, notes)
/** The partner's note is named last: its original index is added after its reasons. */
CANTUS_JSON_FIELDS(ConflictPartner, trackIndex, noteId, reasons, originalIndex)
CANTUS_JSON_FIELDS(Conflict, beat, trackName, trackIndex, noteId, pitch, labels, safety, reasons,
                   originalIndex, rationale, resolveTo, suggestions, partners)

/** The analysis of an arrangement; its prevailing key is written scale first. */
void write_fields(const ArrangementAnalysis& v, FieldWriter& w);

/**
 * The timeline a caller supplied, read the ways the arrangement analyses read one: its segments,
 * and what `timeline.at` answers. A hybrid answers from its segments; an object answers with its
 * `at`, a callback or the method of another timeline.
 * @throws js::TypeError if the timeline has no `at` to call.
 */
TimelineHost wire_timeline_host(const Args& a, const json::Value& timeline);

/** An arrangement session: tracks, options, the analysis and what an update reuses of it. */
class SessionHandle;

/** `createArrangementSession(tracks, opts)` with `opts` already read: a session no handle names. */
std::shared_ptr<SessionHandle> open_arrangement_session(const Args& a, json::Value tracks,
                                                        json::Value opts);

/** `ArrangementSession#update(edits)`: the session after the edits; `self` is unchanged. */
std::shared_ptr<SessionHandle> update_arrangement_session(const Args& a, const SessionHandle& self,
                                                          const json::Value& edits);

/** The session's tracks (`ArrangementSession#tracks`). */
const json::Value& session_tracks(const SessionHandle& session);

/** The session's analysis, without identity tokens. */
const json::Value& session_analysis(const SessionHandle& session);

/** Build the key indices of what the session holds, so several threads may read it at once. */
void prepare_shared_session(const SessionHandle& session);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_A4_H_
