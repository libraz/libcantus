// Op adapters of analyze/arrange.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_a4.h), in the TS order and with the TS names, then calls the typed
// stages. Values a result carries over from its input (a track's name, a given timeline or key
// regions, the chords a cadence names) are the input's own wire values.

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "analyze/arrange/session.h"
#include "analyze/arrange/tension.h"
#include "analyze/grid.h"
#include "analyze/keys/keys.h"
#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a2.h"
#include "ops/codec_a4.h"
#include "ops/counters.h"
#include "ops/handles.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

/** `x == null`. */
bool is_nullish(const json::Value& value) { return value.is_null() || is_undefined(value); }

/** The options of a call that takes them as `opts = {}`. */
json::Value options_of(const Args& a, std::size_t i) { return arg_or(a, i, json::Object()); }

/** `Cannot read properties of null (reading 'x')` for a value that has no properties. */
[[noreturn]] void no_properties(const json::Value& value, std::string_view property) {
  throw js::TypeError(std::string("Cannot read properties of ") +
                      (value.is_null() ? "null" : "undefined") + " (reading '" +
                      std::string(property) + "')");
}

//--------------------------------------------------------------------------------------------
// What the arrangement entry points check of their arguments

/** The tracks of a call, with the note options and counts the entrance checks produce. */
struct ReadTracks {
  std::vector<ArrangementTrack> typed;
  double note_count = 0;
};

/** The note-event options every arrangement entrance applies, pickup included. */
json::Value arrangement_note_options(const json::Value& opts) {
  json::Object bag;
  bag.set("allowNonPositiveDuration", true);
  bag.set("budget", get(opts, "budget"));
  if (const json::Value* pickup = opt_strict(opts, "pickupBeats")) {
    double length = assert_range(*pickup, 0, kMaxSafeInteger, "arrangement pickupBeats");
    bag.set("minStartBeat", -length);
  }
  return json::Value(std::move(bag));
}

/** `assertArray`, the track budget and `assertTrackNotes` over wire tracks. */
ReadTracks read_tracks(const json::Value& tracks, const json::Value& note_options,
                       const json::Value& opts) {
  const json::Array& list = assert_array(tracks, "arrangement tracks");
  assert_generation_budget(json::Value(static_cast<double>(list.size())), "arrangement tracks",
                           get(opts, "budget"));
  ReadTracks out;
  for (std::size_t index = 0; index < list.size(); ++index) {
    const json::Value& track = list[index];
    const json::Value& notes = is_nullish(track) ? undefined_value() : get(track, "notes");
    if (!notes.is_array()) {
      throw InvalidInputError("tracks[" + index_text(index) +
                              "].notes must be an array; received " + describe_rejected(notes));
    }
    ArrangementTrack typed;
    typed.notes =
        assert_note_events(notes, "tracks[" + index_text(index) + "].notes", note_options);
    // Percussion is told from the role as it was written, before the roles are checked.
    const json::Value& role = get(track, "role");
    if (role.is_string() && role.as_string() == "drums") {
      typed.role = TrackRole::kDrums;
    }
    out.note_count += static_cast<double>(typed.notes.size());
    out.typed.push_back(std::move(typed));
  }
  // The pooled total is what the downstream analysis actually sizes its work by.
  assert_generation_budget(json::Value(out.note_count), "arrangement notes", get(opts, "budget"));
  return out;
}

/** `opts.minSeverity`, which names a point on the safety scale. */
std::optional<double> read_min_severity(const json::Value& opts) {
  const json::Value* given = opt_strict(opts, "minSeverity");
  if (given == nullptr) {
    return std::nullopt;
  }
  return assert_integer(*given, "arrangement minSeverity", static_cast<double>(NoteSafety::kSafe),
                        static_cast<double>(NoteSafety::kDissonant));
}

/** `assertGivenTimeline` and `assertGivenKeys` over the two options. */
void assert_given(const json::Value& opts) {
  if (const json::Value* timeline = opt_strict(opts, "timeline")) {
    assert_wire_timeline(*timeline, "arrangement timeline");
  }
  const json::Value* keys = opt_strict(opts, "keys");
  if (keys == nullptr) {
    return;
  }
  std::string name = "arrangement keys";
  if (!keys->is_array()) {
    throw InvalidInputError(name + " must be an array of key regions; received " +
                            describe_rejected(*keys));
  }
  std::vector<SegmentSpan> spans;
  for (std::size_t index = 0; index < keys->as_array().size(); ++index) {
    const json::Value& region = keys->as_array()[index];
    std::string label = name + "[" + index_text(index) + "]";
    if (!is_js_object(region)) {
      throw InvalidInputError(label + " must be a key region; received " +
                              describe_rejected(region));
    }
    double start = assert_finite_number(get(region, "startBeat"), label + ".startBeat");
    double end = assert_finite_number(get(region, "endBeat"), label + ".endBeat");
    spans.push_back(SegmentSpan{start, end});
    const json::Value& key = get(region, "key");
    std::string kind = js::type_of(key);
    if (is_nullish(key) || (kind != "string" && kind != "object")) {
      throw InvalidInputError(label + ".key must name a key; received " + describe_rejected(key));
    }
    resolve_key(read_key_arg(key));
  }
  assert_spans_in_order(spans, name);
}

/** `harmonyTrackSet(opts.harmonyTracks, tracks)`. */
std::optional<std::set<std::size_t>> read_harmony_tracks(
    const json::Value& opts, const std::vector<ArrangementTrack>& tracks) {
  const json::Value* given = opt_strict(opts, "harmonyTracks");
  if (given == nullptr) {
    return std::nullopt;
  }
  if (given->is_null()) {
    no_properties(*given, "length");
  }
  std::vector<double> indices;
  if (given->is_string() && js::utf16_length(given->as_string()) > 0) {
    // A text is walked by its characters, and a character is no track index.
    throw InvalidInputError("harmonyTracks[0] must be a track index; received " +
                            js::utf16_slice(given->as_string(), 0, 1));
  }
  if (given->is_array()) {
    for (std::size_t index = 0; index < given->as_array().size(); ++index) {
      const json::Value& value = given->as_array()[index];
      std::optional<double> number =
          js::type_of(value) == "number" ? number_of(value) : std::nullopt;
      if (!number || !std::isfinite(*number)) {
        throw InvalidInputError("harmonyTracks[" + index_text(index) +
                                "] must be a track index; received " + js::template_string(value));
      }
      indices.push_back(*number);
    }
  }
  return harmony_track_set(indices, tracks);
}

/** The roles of the tracks, each checked against the roles that exist (`trackRoleOf`). */
void read_roles(const json::Value& tracks, std::vector<ArrangementTrack>& typed) {
  const json::Array& list = tracks.as_array();
  for (std::size_t index = 0; index < list.size(); ++index) {
    const json::Value& role = get(list[index], "role");
    typed[index].role = TrackRole::kOther;
    if (!is_undefined(role)) {
      std::string name =
          assert_one_of(role, track_role_names(), "tracks[" + index_text(index) + "].role");
      typed[index].role = *parse_track_role(name);
    }
  }
}

/** The names a call's tracks carry, as the caller wrote them; unset where it named none. */
std::vector<std::optional<json::Value>> read_names(const json::Value& tracks) {
  std::vector<std::optional<json::Value>> names;
  for (const json::Value& track : tracks.as_array()) {
    const json::Value& name = get(track, "name");
    if (is_nullish(name)) {
      names.emplace_back(std::nullopt);
    } else {
      names.emplace_back(name);
    }
  }
  return names;
}

/** The typed names: the caller's, as text, or the default. */
void set_names(std::vector<ArrangementTrack>& typed,
               const std::vector<std::optional<json::Value>>& names) {
  for (std::size_t index = 0; index < typed.size(); ++index) {
    if (names[index]) {
      typed[index].name = js::template_string(*names[index]);
    }
  }
}

//--------------------------------------------------------------------------------------------
// The harmony of a call

/** The key regions a caller supplied, read for the lookups the analysis makes of them. */
struct GivenKeys {
  /** The regions as the caller wrote them. */
  json::Value wire;
  /** The same regions with their scales, for lookups. */
  std::vector<KeyRegion> typed;
  /** The key that prevails across them as the caller wrote it, or null. */
  json::Value prevailing;
};

/**
 * `prevailingKeyOf(given)`, which is the op itself, then the scales the lookups read: the regions
 * are records whose keys carry a scale once it has passed.
 */
GivenKeys read_given_keys(const Args& a, const json::Value& keys) {
  GivenKeys out;
  out.wire = keys;
  json::Array arguments;
  arguments.push_back(keys);
  Args delegated(arguments, a.context());
  out.prevailing = find_op("prevailingKeyOf")->fn(delegated);
  for (const json::Value& region : keys.as_array()) {
    KeyRegion typed;
    typed.startBeat = js::to_number(get(region, "startBeat"));
    typed.endBeat = js::to_number(get(region, "endBeat"));
    typed.key.scale = read_key_like(get(get(region, "key"), "scale"));
    out.typed.push_back(std::move(typed));
  }
  return out;
}

/** The harmony of an arrangement call, in the forms the analyses and the result need. */
struct WireHarmony {
  ArrangementHarmony harmony;
  /** The regions the key lookup runs over, and the key it falls back on. */
  std::vector<KeyRegion> regions;
  ResolvedKey fallback;
  std::optional<KeyLookup> lookup;
  /** The result's own fields. */
  json::Value keys_json;
  json::Value prevailing_json;
  json::Value timeline_json;
  std::vector<double> segment_confidence;
  /** The wire chords of a supplied timeline, by segment. */
  std::shared_ptr<WireSegments> given_segments;
  /** The evidence an inferred timeline leaves behind, and the object behind each of its chords. */
  std::unique_ptr<TimelineEvidence> evidence;
  std::vector<ChordObject> segment_objects;
  /** The typed timeline of an inferred harmony. */
  ChordTimeline timeline;
};

/** The options of the timeline inference an arrangement runs, read as TS reads them. */
ChordTimelineOptions inference_options(const json::Value& opts, const MeterMap& meters,
                                       std::optional<double> pickup) {
  ChordTimelineOptions out;
  if (const json::Value* key = opt_strict(opts, "key")) {
    out.key = read_key_arg(*key);
  }
  out.meters = MeterArg(meters);
  out.pickupBeats = pickup;
  if (const json::Value* rhythm = opt_null_default(opts, "harmonicRhythm")) {
    out.harmonicRhythm = assert_range(*rhythm, kMinValue, kMaxSafeInteger, "harmonic rhythm");
  }
  if (const json::Value* budget = field(opts, "budget")) {
    out.budget = number_of(*budget);
  }
  return out;
}

/** The pickup length a call declared, if any. */
std::optional<double> pickup_of(const json::Value& opts) {
  const json::Value* pickup = opt_strict(opts, "pickupBeats");
  return pickup != nullptr ? number_of(*pickup) : std::nullopt;
}

/** The scale lookup over the regions of a harmony, once they are settled. */
void settle_lookup(WireHarmony& h) {
  h.lookup.emplace(h.regions, h.fallback);
  h.harmony.scale_at = [&lookup = *h.lookup](double beat) { return scale_of(lookup(beat)); };
}

//--------------------------------------------------------------------------------------------
// analyze/arrange: the analysis of an arrangement

/** What an analysis leaves behind besides its result. */
struct WireRun {
  json::Value analysis;
  std::shared_ptr<TimelineEvidence> evidence;
  std::vector<ChordObject> segment_objects;
  std::vector<ArrangementTrack> tracks;
};

/** Replace a field of a wire object by what the caller wrote, where it wrote one. */
void carry(json::Value& object, std::string_view key, const std::optional<json::Value>& written) {
  if (written) {
    object.as_object().set(std::string(key), *written);
  }
}

WireRun analyze_wire(const Args& a, const json::Value& tracks, const json::Value& opts,
                     TimelineEvidence* previous, const DirtySlots* dirty) {
  counters::bump(previous == nullptr ? counters::full_analyses : counters::incremental_analyses);
  MeterMap meters = resolve_wire_meters(opts, "arrangement meters");
  json::Value note_options = arrangement_note_options(opts);
  ReadTracks read = read_tracks(tracks, note_options, opts);
  SafetyProfile profile = read_arrangement_profile(opts);
  // A severity outside the scale narrows the report to nothing, which reads like a clean piece.
  double min_severity = read_min_severity(opts).value_or(static_cast<double>(NoteSafety::kWarning));
  assert_given(opts);
  std::optional<std::set<std::size_t>> harmony_tracks = read_harmony_tracks(opts, read.typed);
  read_roles(tracks, read.typed);
  std::vector<std::optional<json::Value>> names = read_names(tracks);
  set_names(read.typed, names);
  std::vector<PreparedTrack> prepared = prepare_tracks(read.typed);
  double voice_count = 0;
  for (const PreparedTrack& track : prepared) {
    voice_count += static_cast<double>(track.voices.size());
  }
  assert_generation_budget(json::Value(read.note_count * voice_count),
                           "arrangement note-voice comparisons", get(opts, "budget"));
  std::vector<NoteEvent> pooled =
      pool_notes(read.typed, harmony_tracks ? &*harmony_tracks : nullptr);
  std::optional<double> budget =
      field(opts, "budget") ? number_of(*field(opts, "budget")) : std::nullopt;

  WireHarmony h;
  const json::Value* given_timeline = opt_strict(opts, "timeline");
  const json::Value* given_keys_wire = opt_strict(opts, "keys");
  std::optional<GivenKeys> given_keys;
  if (given_timeline == nullptr) {
    TimelineAnalysis inferred =
        analyze_timeline(pooled, inference_options(opts, meters, pickup_of(opts)), previous, dirty);
    h.evidence = std::make_unique<TimelineEvidence>(std::move(inferred.evidence));
    h.segment_objects = std::move(inferred.segment_objects);
    h.timeline = std::move(inferred.result.timeline);
    h.segment_confidence = std::move(inferred.result.segmentConfidence);
    h.harmony.timeline = host_of(h.timeline);
    h.timeline_json = to_json(h.timeline);
    if (given_keys_wire != nullptr) {
      // The caller's regions replace the inferred ones; the chords stay as inferred.
      given_keys = read_given_keys(a, *given_keys_wire);
      h.regions = given_keys->typed;
      h.keys_json = given_keys->wire;
      if (given_keys->prevailing.is_null()) {
        h.fallback = inferred.result.prevailingKey;
        h.prevailing_json = scale_first(inferred.result.prevailingKey);
      } else {
        h.fallback = ResolvedKey{};
        h.fallback.scale = read_key_like(get(given_keys->prevailing, "scale"));
        h.prevailing_json = given_keys->prevailing;
      }
    } else {
      h.regions = std::move(inferred.result.keys);
      h.fallback = inferred.result.prevailingKey;
      h.keys_json = to_json(h.regions);
      h.prevailing_json = scale_first(inferred.result.prevailingKey);
    }
  } else {
    h.harmony.timeline = wire_timeline_host(a, *given_timeline);
    h.given_segments = std::make_shared<WireSegments>(get(*given_timeline, "segments").as_array());
    std::optional<KeyArg> key;
    if (const json::Value* named = opt_strict(opts, "key")) {
      key = read_key_arg(*named);
    }
    std::optional<std::vector<KeyRegion>> typed_given;
    if (given_keys_wire != nullptr) {
      given_keys = read_given_keys(a, *given_keys_wire);
      typed_given = given_keys->typed;
    }
    CallerKeys caller = caller_keys(h.harmony.timeline, key, typed_given, pooled, meters, budget);
    h.segment_confidence = std::move(caller.segment_confidence);
    h.regions = std::move(caller.keys);
    h.fallback = caller.prevailing_key;
    // A timeline the caller built is returned as the timeline it describes: a callback cannot
    // leave the library, so what it answers with is its segments.
    if (is_timeline_hybrid(*given_timeline)) {
      h.timeline_json = *given_timeline;
    } else {
      json::Object described;
      described.set("$hy", "ChordTimeline");
      described.set("segments", get(*given_timeline, "segments"));
      h.timeline_json = json::Value(std::move(described));
    }
    if (given_keys) {
      h.keys_json = given_keys->wire;
      if (given_keys->prevailing.is_null()) {
        h.prevailing_json = scale_first(caller.prevailing_key);
      } else {
        h.fallback = ResolvedKey{};
        h.fallback.scale = read_key_like(get(given_keys->prevailing, "scale"));
        h.prevailing_json = given_keys->prevailing;
      }
    } else {
      h.keys_json = to_json(h.regions);
      h.prevailing_json = scale_first(caller.prevailing_key);
    }
  }
  settle_lookup(h);
  TrackPass pass = analyze_tracks(prepared, h.harmony, profile, min_severity, meters);

  json::Value cadences = to_json(pass.cadences);
  if (given_timeline != nullptr) {
    // A cadence names the chords of the segments it was found between as they were written.
    for (std::size_t i = 0; i < pass.cadences.size(); ++i) {
      json::Object& hit = cadences.as_array()[i].as_object();
      hit.set("from", h.given_segments->chord_value(pass.arrivals[i] - 1));
      hit.set("to", h.given_segments->chord_value(pass.arrivals[i]));
    }
  }
  json::Value track_json = to_json(pass.tracks);
  for (std::size_t i = 0; i < pass.tracks.size(); ++i) {
    carry(track_json.as_array()[i], "name", names[i]);
  }
  json::Value conflicts = to_json(pass.conflicts);
  for (std::size_t i = 0; i < pass.conflicts.size(); ++i) {
    carry(conflicts.as_array()[i], "trackName", names[pass.conflicts[i].trackIndex]);
  }

  WireRun run;
  json::Object analysis;
  analysis.set("keys", std::move(h.keys_json));
  analysis.set("prevailingKey", std::move(h.prevailing_json));
  analysis.set("timeline", std::move(h.timeline_json));
  analysis.set("segmentConfidence", to_json(h.segment_confidence));
  analysis.set("cadences", std::move(cadences));
  analysis.set("tracks", std::move(track_json));
  analysis.set("conflicts", std::move(conflicts));
  run.analysis = json::Value(std::move(analysis));
  run.evidence = std::move(h.evidence);
  run.segment_objects = std::move(h.segment_objects);
  run.tracks = std::move(read.typed);
  return run;
}

}  // namespace

//--------------------------------------------------------------------------------------------
// analyze/arrange: sessions

/** The identity tokens of the objects a session hands out, which an update carries over. */
class ObjectTokens {
 public:
  /** The token of a chord object, allocated on first sight. */
  std::uint64_t of(const ChordObject& object) {
    auto found = tokens_.find(object.get());
    if (found == tokens_.end()) {
      found = tokens_.emplace(object.get(), Entry{object, Identity{}}).first;
    }
    return found->second.identity.token();
  }

 private:
  struct Entry {
    // Held so the address stays the object's own for as long as the token is.
    ChordObject object;
    Identity identity;
  };
  std::map<const void*, Entry> tokens_;
};

/** An arrangement session held open: the wire it was made from and the analysis of it. */
class SessionHandle : public Handle {
 public:
  static constexpr const char* kTypeName = "ArrangementSession";

  json::Value tracks;
  json::Value opts;
  json::Value analysis;
  std::vector<ArrangementTrack> typed_tracks;
  std::shared_ptr<TimelineEvidence> evidence;
  /** Held by an update, which takes the evidence's tables over; shared along with the evidence. */
  std::shared_ptr<std::recursive_mutex> evidence_lock = std::make_shared<std::recursive_mutex>();
  std::vector<ChordObject> segment_objects;
  std::shared_ptr<ObjectTokens> tokens = std::make_shared<ObjectTokens>();
  /** The token of the analysis, which stays while the analysis does. */
  std::shared_ptr<Identity> analysis_identity = std::make_shared<Identity>();

  /**
   * The analysis with its identity tokens, and the tokens of the chords an update carried. Each
   * member is copied once; the chord tokens are taken before the analysis token, innermost first.
   */
  json::Value tagged_analysis() {
    const json::Value* timeline = analysis.as_object().find("timeline");
    const json::Array* segments =
        segment_objects.empty() ? nullptr : &timeline->as_object().find("segments")->as_array();
    std::size_t tagged =
        segments == nullptr ? 0 : std::min<std::size_t>(segments->size(), segment_objects.size());
    for (std::size_t i = 0; i < tagged; ++i) {
      tokens->of(segment_objects[i]);
    }
    json::Object out;
    out.set("$id", static_cast<double>(analysis_identity->token()));
    for (const json::Member& member : analysis.as_object()) {
      out.set(member.key, tagged > 0 && &member.value == timeline
                              ? tagged_timeline(*timeline, tagged)
                              : member.value);
    }
    return json::Value(std::move(out));
  }

 private:
  /** The timeline with the chord of each of its first `tagged` segments carrying its token. */
  json::Value tagged_timeline(const json::Value& timeline, std::size_t tagged) {
    json::Object out;
    for (const json::Member& member : timeline.as_object()) {
      if (member.key != "segments") {
        out.set(member.key, member.value);
        continue;
      }
      json::Array segments;
      for (const json::Value& segment : member.value.as_array()) {
        std::size_t i = segments.size();
        if (i >= tagged) {
          segments.push_back(segment);
          continue;
        }
        json::Object fields;
        for (const json::Member& field : segment.as_object()) {
          if (field.key != "chord") {
            fields.set(field.key, field.value);
            continue;
          }
          json::Object chord;
          chord.set("$id", static_cast<double>(tokens->of(segment_objects[i])));
          for (const json::Member& part : field.value.as_object()) {
            chord.set(part.key, part.value);
          }
          fields.set(field.key, json::Value(std::move(chord)));
        }
        segments.push_back(json::Value(std::move(fields)));
      }
      out.set(member.key, json::Value(std::move(segments)));
    }
    return json::Value(std::move(out));
  }
};

std::shared_ptr<SessionHandle> open_arrangement_session(const Args& a, json::Value tracks,
                                                        json::Value opts) {
  auto session = std::make_shared<SessionHandle>();
  session->opts = std::move(opts);
  session->tracks = std::move(tracks);
  WireRun run = analyze_wire(a, session->tracks, session->opts, nullptr, nullptr);
  session->analysis = std::move(run.analysis);
  session->evidence = std::move(run.evidence);
  session->segment_objects = std::move(run.segment_objects);
  session->typed_tracks = std::move(run.tracks);
  return session;
}

std::shared_ptr<SessionHandle> update_arrangement_session(const Args& a, const SessionHandle& self,
                                                          const json::Value& edits) {
  // `edits.length`: a text has one too, and walks as characters.
  if (is_nullish(edits)) {
    no_properties(edits, "length");
  }
  json::Value edit_count =
      edits.is_array()    ? json::Value(static_cast<double>(edits.as_array().size()))
      : edits.is_string() ? json::Value(static_cast<double>(js::utf16_length(edits.as_string())))
                          : get(edits, "length");
  assert_generation_budget(edit_count, "arrangement edits", get(self.opts, "budget"));
  if (edits.is_string() && !edits.as_string().empty()) {
    // A character has no `trackIndex`.
    throw InvalidInputError("edits[0].trackIndex undefined is outside the session's " +
                            js::to_string(static_cast<double>(self.tracks.as_array().size())) +
                            " tracks");
  }
  json::Array next = self.tracks.as_array();
  std::vector<ArrangementTrack> next_typed = self.typed_tracks;
  std::optional<EditedSpan> edited;
  bool reordered = false;
  if (edits.is_array()) {
    for (std::size_t index = 0; index < edits.as_array().size(); ++index) {
      const json::Value& edit = edits.as_array()[index];
      if (is_undefined(edit)) {
        continue;
      }
      if (edit.is_null()) {
        no_properties(edit, "trackIndex");
      }
      const json::Value& wire_index = get(edit, "trackIndex");
      // `next[edit.trackIndex]` finds a track only for a whole index inside the array.
      std::optional<double> position;
      if (js::type_of(wire_index) == "number") {
        position = number_of(wire_index);
      } else if (wire_index.is_string()) {
        position = js::number(wire_index.as_string());
      }
      bool found = position && *position >= 0 && *position < static_cast<double>(next.size()) &&
                   *position == std::floor(*position) &&
                   (js::type_of(wire_index) == "number" ||
                    js::to_string(*position) == wire_index.as_string());
      if (!found) {
        throw InvalidInputError("edits[" + index_text(index) + "].trackIndex " +
                                js::template_string(wire_index) + " is outside the session's " +
                                js::to_string(static_cast<double>(self.tracks.as_array().size())) +
                                " tracks");
      }
      auto at = static_cast<std::size_t>(*position);
      const json::Value& notes = get(edit, "notes");
      if (!notes.is_array()) {
        throw InvalidInputError("edits[" + index_text(index) +
                                "].notes must be an array; received " + describe_rejected(notes));
      }
      json::Object bag;
      bag.set("allowNonPositiveDuration", true);
      bag.set("budget", get(self.opts, "budget"));
      std::vector<NoteEvent> typed = assert_note_events(
          notes, "edits[" + index_text(index) + "].notes", json::Value(std::move(bag)));
      edited = union_span(edited, edited_span(next_typed[at].notes, typed));
      reordered = reordered || !same_order(next_typed[at].notes, typed);
      json::Object replaced;
      if (next[at].is_object()) {
        replaced = next[at].as_object();
      }
      replaced.set("notes", notes);
      next[at] = json::Value(std::move(replaced));
      next_typed[at].notes = std::move(typed);
    }
  }
  auto session = std::make_shared<SessionHandle>();
  session->opts = self.opts;
  session->tracks = json::Value(std::move(next));
  session->tokens = self.tokens;
  // Nothing the analysis reads actually changed, so the analysis has not.
  if (!edited && !reordered) {
    session->analysis = self.analysis;
    session->evidence = self.evidence;
    session->evidence_lock = self.evidence_lock;
    session->segment_objects = self.segment_objects;
    session->typed_tracks = std::move(next_typed);
    session->analysis_identity = self.analysis_identity;
    return session;
  }
  // Sessions sharing one evidence update in turn: the first takes its tables, the rest start anew.
  std::lock_guard<std::recursive_mutex> taking(*self.evidence_lock);
  std::optional<DirtySlots> dirty = dirty_slots_of(self.evidence.get(), edited);
  WireRun run = analyze_wire(a, session->tracks, session->opts, self.evidence.get(),
                             dirty ? &*dirty : nullptr);
  session->analysis = std::move(run.analysis);
  session->evidence = std::move(run.evidence);
  session->segment_objects = std::move(run.segment_objects);
  session->typed_tracks = std::move(run.tracks);
  return session;
}

const json::Value& session_tracks(const SessionHandle& session) { return session.tracks; }

const json::Value& session_analysis(const SessionHandle& session) { return session.analysis; }

void prepare_shared_session(const SessionHandle& session) {
  json::build_indices(session.tracks);
  json::build_indices(session.opts);
  json::build_indices(session.analysis);
}

namespace {

void register_arrange() {
  def("analyzePolyphony", [](Args& a) -> json::Value {
    json::Object bag;
    bag.set("allowNonPositiveDuration", true);
    std::vector<NoteEvent> passage = assert_note_events(a[0], "notes", json::Value(std::move(bag)));
    if (!is_chord_function(a[1])) {
      assert_function(a[1], "chordAtBeat");
    }
    std::function<std::optional<VoiceChord>(double)> chord_at;
    if (js::type_of(a[1]) == "function") {
      Callback callback = a.callback(1);
      chord_at = [callback](double beat) {
        return read_host_chord(callback(json::Array{json::Value(beat)}));
      };
    } else {
      const json::Value& listed = get(a[1], "segments");
      if (!listed.is_array()) {
        throw InvalidInputError("timeline.segments must be an array; received " +
                                describe_rejected(listed));
      }
      const json::Array& segments = listed.as_array();
      chord_at = [&segments](double beat) {
        return read_host_chord(timeline_chord_at(segments, beat));
      };
    }
    std::function<KeyAtBeat()> key = [&a] { return read_key_context(a, 2); };
    return to_json(analyze_polyphony_over(passage, chord_at, key));
  });

  def("analyzeArrangement", [](Args& a) -> json::Value {
    json::Value opts = options_of(a, 1);
    return analyze_wire(a, a[0], opts, nullptr, nullptr).analysis;
  });

  def(
      "createArrangementSession",
      [](Args& a) -> json::Value {
        json::Value opts = options_of(a, 1);
        return new_handle(open_arrangement_session(a, a.take(0), std::move(opts)));
      },
      kHandles);

  def_method<SessionHandle>("ArrangementSession#tracks",
                            [](SessionHandle& self, Args&) -> json::Value { return self.tracks; });
  def_method<SessionHandle>(
      "ArrangementSession#analysis",
      [](SessionHandle& self, Args&) -> json::Value { return self.tagged_analysis(); });
  def_method<SessionHandle>("ArrangementSession#update",
                            [](SessionHandle& self, Args& a) -> json::Value {
                              return new_handle(update_arrangement_session(a, self, a[1]));
                            });

  def("tensionCurve", [](Args& a) -> json::Value {
    json::Value opts = options_of(a, 1);
    MeterMap meters = resolve_wire_meters(opts, "arrangement meters");
    json::Value note_options = arrangement_note_options(opts);
    ReadTracks read = read_tracks(a[0], note_options, opts);
    SafetyProfile profile = read_arrangement_profile(opts);
    const json::Value* given_step = opt_null_default(opts, "step");
    double step = assert_range(given_step != nullptr ? *given_step : json::Value(1.0), kMinValue,
                               kMaxSafeInteger, "tension sampling step");
    // Read by no sampling this call makes, and checked all the same.
    read_min_severity(opts);
    assert_given(opts);
    std::optional<std::set<std::size_t>> harmony_tracks = read_harmony_tracks(opts, read.typed);
    std::vector<NoteEvent> pooled =
        pool_notes(read.typed, harmony_tracks ? &*harmony_tracks : nullptr);
    std::vector<NoteEvent> all = pool_notes(read.typed);
    double total_beats = latest_sounding_end(all);
    GridOrigin placed = grid_for_notes(all, step);
    std::optional<double> budget =
        field(opts, "budget") ? number_of(*field(opts, "budget")) : std::nullopt;

    WireHarmony h;
    const json::Value* given_timeline = opt_strict(opts, "timeline");
    const json::Value* given_keys_wire = opt_strict(opts, "keys");
    std::optional<GivenKeys> given_keys;
    std::vector<KeyRegion> keys;
    ResolvedKey prevailing_key;
    if (given_timeline == nullptr) {
      ChordTimelineResult inferred =
          chord_timeline_from_notes(pooled, inference_options(opts, meters, pickup_of(opts)));
      h.timeline = std::move(inferred.timeline);
      h.harmony.timeline = host_of(h.timeline);
      keys = std::move(inferred.keys);
      prevailing_key = std::move(inferred.prevailingKey);
    } else {
      h.harmony.timeline = wire_timeline_host(a, *given_timeline);
      // A caller-supplied timeline still needs key regions to be read against.
      if (given_keys_wire != nullptr) {
        given_keys = read_given_keys(a, *given_keys_wire);
        keys = given_keys->typed;
      } else if (const json::Value* named = opt_strict(opts, "key")) {
        keys = stated_key_regions(resolve_key(read_key_arg(*named)), placed.startBeat, total_beats);
      } else {
        KeyTimelineOptions key_options;
        key_options.meters = meters;
        key_options.totalBeats = total_beats;
        key_options.budget = budget;
        keys = key_timeline_from_notes(pooled, key_options);
      }
      Nullable<ResolvedKey> prevailing = prevailing_key_of(keys);
      prevailing_key = prevailing ? *prevailing : resolve_key(major_key(0));
    }
    if (given_keys_wire != nullptr) {
      if (!given_keys) {
        given_keys = read_given_keys(a, *given_keys_wire);
      }
      h.regions = given_keys->typed;
    } else {
      h.regions = std::move(keys);
    }
    Nullable<ResolvedKey> regions_prevailing = prevailing_key_of(h.regions);
    h.fallback = regions_prevailing ? *regions_prevailing : prevailing_key;
    settle_lookup(h);

    std::vector<PreparedTrack> prepared = [&] {
      read_roles(a[0], read.typed);
      set_names(read.typed, read_names(a[0]));
      return prepare_tracks(read.typed);
    }();
    TensionGrid grid;
    grid.sample_start = placed.origin;
    grid.music_start = placed.startBeat;
    grid.total_beats = total_beats;
    grid.step = step;
    return to_json(sample_tension(prepared, h.harmony, *h.lookup, profile, meters, grid, budget));
  });

  def("tensionCurveFrom", [](Args& a) -> json::Value {
    json::Value opts = options_of(a, 2);
    const json::Value& asked = assert_record(opts, "opts");
    const json::Value& analysis = assert_record(a[1], "analysis");
    // How much of an analysis's harmony the options leave in place: restricting the harmony to a
    // few tracks changes which notes state it, so nothing survives; naming a key or its regions
    // changes only what the chords are heard against.
    json::Object merged;
    if (is_undefined(get(asked, "harmonyTracks"))) {
      merged.set("timeline", get(analysis, "timeline"));
      if (is_undefined(get(asked, "key")) && is_undefined(get(asked, "keys"))) {
        merged.set("keys", get(analysis, "keys"));
      }
    }
    for (const json::Member& member : asked.as_object()) {
      merged.set(member.key, member.value);
    }
    // The call it delegates to.
    const OpEntry* entry = find_op("tensionCurve");
    json::Array arguments;
    arguments.push_back(a[0]);
    arguments.push_back(json::Value(std::move(merged)));
    Args delegated(arguments, a.context());
    return entry->fn(delegated);
  });
}

}  // namespace

void register_a4() { register_arrange(); }

}  // namespace cantus::ops
