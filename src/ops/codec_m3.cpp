#include "ops/codec_m3.h"

#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "analyze/arrange/internal.h"
#include "cantus/core/errors.h"
#include "cantus/model/motif.h"
#include "cantus/model/rhythm.h"
#include "core/validation/validation.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "model/shared.h"
#include "ops/codec_a4.h"
#include "ops/codec_c1.h"
#include "ops/codec_g2b.h"
#include "ops/codec_m1.h"
#include "ops/codec_m2.h"
#include "ops/error_map.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** The host of a reader run outside any call: the readers call no host function. */
const CallContext kNoHost;

/** `copyTrack(track, index, budget)`. */
json::Value copy_track(const json::Value& track, std::size_t index, const json::Value& budget) {
  std::string label = "tracks[" + index_text(index) + "]";
  assert_data_object(track, label);
  json::Object copy;
  copy.set("notes", arrangement_notes(member_of(track, "notes"), label + ".notes", budget));
  json::Value name = member_of(track, "name");
  if (!is_undefined(name)) {
    copy.set("name", std::move(name));
  }
  json::Value role = member_of(track, "role");
  if (!is_undefined(role)) {
    // `trackRoleOf` returns the role it was handed once it names one of the roles.
    assert_one_of(role, track_role_names(), label + ".role");
    copy.set("role", std::move(role));
  }
  return json::Value(std::move(copy));
}

/** `spanEnd(given)` over wire spans not yet checked: `Math.max` over their `endBeat`s. */
double wire_span_end(const json::Array& spans) {
  double end = 0;
  for (const json::Value& span : spans) {
    end = js::max(end, js::to_math_number(member_of(span, "endBeat")));
  }
  return end;
}

/** `copySettings(settings, tracks)`, over the tracks as copyTrack copied them. */
json::Value copy_settings(const json::Value& settings, const json::Array& tracks,
                          const CallContext& context) {
  if (is_undefined(settings)) {
    return undefined_value();
  }
  assert_data_object(settings, "arrangement settings");
  json::Value ts = member_of(settings, "ts");
  json::Value meters = member_of(settings, "meters");
  json::Object bag;
  if (!is_undefined(ts)) {
    bag.set("ts", ts);
  }
  if (!is_undefined(meters)) {
    bag.set("meters", meters);
  }
  MeterMap resolved = resolve_wire_meters(json::Value(std::move(bag)), "arrangement meters");
  json::Object copy;
  if (!is_undefined(ts)) {
    copy.set("ts",
             copy_plain(call_op(context, "toMeterData", {ts, "arrangement ts"}), "arrangement ts"));
  }
  if (!is_undefined(meters)) {
    copy.set("meters", copy_plain(to_json(resolved), "arrangement meters"));
  }
  json::Value key = member_of(settings, "key");
  if (!is_undefined(key)) {
    copy.set("key", call_op(context, "resolveKey", {key}));
  }
  json::Value keys = member_of(settings, "keys");
  if (!is_undefined(keys)) {
    // Validated and copied by the class that owns the shape.
    json::Object data;
    data.set("segments", json::Array{});
    data.set("totalBeats", 0.0);
    data.set("keys", assert_data_objects(keys, "arrangement keys"));
    copy.set("keys", member_of(to_json(read_timeline_data(json::Value(std::move(data)))), "keys"));
  }
  json::Value timeline = member_of(settings, "timeline");
  if (!is_undefined(timeline)) {
    const json::Array& given = assert_data_objects(timeline, "arrangement timeline");
    json::Object data;
    data.set("segments", given);
    data.set("totalBeats", to_json(wire_span_end(given)));
    copy.set("timeline",
             member_of(to_json(read_timeline_data(json::Value(std::move(data)))), "segments"));
  }
  json::Value harmony = member_of(settings, "harmonyTracks");
  if (!is_undefined(harmony)) {
    const json::Array& given = assert_data_array(harmony, "arrangement harmonyTracks");
    for (std::size_t index = 0; index < given.size(); ++index) {
      assert_integer(given[index], "arrangement harmonyTracks[" + index_text(index) + "]", 0,
                     static_cast<double>(tracks.size()) - 1);
    }
    // A percussion track states no harmony, which the analysis refuses too.
    for (std::size_t index = 0; index < given.size(); ++index) {
      double track = js::to_number(given[index]);
      const json::Value& role = get(tracks[static_cast<std::size_t>(track)], "role");
      if (role.is_string() && role.as_string() == to_string(TrackRole::kDrums)) {
        throw InvalidInputError("arrangement harmonyTracks[" + index_text(index) + "] " +
                                js::to_string(track) +
                                " names a percussion track, whose pitches state no harmony");
      }
    }
    copy.set("harmonyTracks", given);
  }
  json::Value severity = member_of(settings, "minSeverity");
  if (!is_undefined(severity)) {
    assert_integer(severity, "arrangement minSeverity", static_cast<double>(NoteSafety::kSafe),
                   static_cast<double>(NoteSafety::kDissonant));
    copy.set("minSeverity", std::move(severity));
  }
  json::Value pickup = member_of(settings, "pickupBeats");
  if (!is_undefined(pickup)) {
    double beats = assert_range(pickup, 0, kMaxSafeInteger, "arrangement pickupBeats");
    // A note before the declared pickup is one the analysis refuses, under the same name.
    json::Value note_bag = line_options(member_of(settings, "budget"));
    note_bag.as_object().set("minStartBeat", -beats);
    for (std::size_t index = 0; index < tracks.size(); ++index) {
      assert_note_events(get(tracks[index], "notes"), "tracks[" + index_text(index) + "].notes",
                         note_bag);
    }
    copy.set("pickupBeats", std::move(pickup));
  }
  json::Value rhythm = member_of(settings, "harmonicRhythm");
  if (!is_undefined(rhythm)) {
    assert_range(rhythm, kMinValue, kMaxSafeInteger, "arrangement harmonicRhythm");
    copy.set("harmonicRhythm", std::move(rhythm));
  }
  if (!is_undefined(member_of(settings, "profile"))) {
    copy.set("profile", to_string(read_arrangement_profile(settings)));
  }
  json::Value budget = member_of(settings, "budget");
  if (!is_undefined(budget)) {
    assert_positive_int(budget, "arrangement budget", kMaxSafeInteger);
    copy.set("budget", std::move(budget));
  }
  if (copy.empty()) {
    return undefined_value();
  }
  return json::Value(std::move(copy));
}

/** The dial names of a Complexity, in the order copyComplexity reads them. */
constexpr const char* kDials[] = {"rhythmic", "harmonic", "ornament", "difficulty"};

/** `copyComplexity(complexity)`. */
json::Value copy_complexity(const json::Value& complexity) {
  assert_data_object(complexity, "composer complexity");
  json::Object copy;
  for (const char* dial : kDials) {
    json::Value value = member_of(complexity, dial);
    if (!is_undefined(value)) {
      assert_finite_number(value, std::string("composer complexity ") + dial);
      copy.set(dial, std::move(value));
    }
  }
  return json::Value(std::move(copy));
}

/** `copyInstruments(instruments)`: each profile checked and copied by `Instrument.of`. */
json::Value copy_instruments(const json::Value& instruments, const CallContext& context) {
  assert_data_object(instruments, "composer instruments");
  json::Object copy;
  // `Object.entries`: a class instance keeps its state out of reach.
  if (tag_of(instruments) == Tag::kNone) {
    for (const json::Member& m : instruments.as_object()) {
      json::Value built = call_op(context, "Instrument.of", {m.value});
      copy.set(m.key, member_of(built, "data"));
    }
  }
  return json::Value(std::move(copy));
}

/** The vocabulary entries checked and copied as plain data. */
json::Value copy_vocabulary(const json::Value& vocabulary) {
  const json::Array& entries = assert_data_objects(vocabulary, "composer vocabulary");
  json::Array copy;
  for (std::size_t index = 0; index < entries.size(); ++index) {
    copy.push_back(copy_plain(entries[index], "composer vocabulary[" + index_text(index) + "]"));
  }
  return json::Value(std::move(copy));
}

}  // namespace

json::Value arrangement_notes(const json::Value& notes, const std::string& name,
                              const json::Value& budget) {
  assert_data_array(notes, name);
  json::Object bag;
  bag.set("allowNonPositiveDuration", true);
  if (!is_undefined(budget)) {
    bag.set("budget", budget);
  }
  json::Array out;
  for (const NoteEvent& note : assert_note_events(notes, name, json::Value(std::move(bag)))) {
    out.push_back(to_json(copy_note_event(note)));
  }
  return json::Value(std::move(out));
}

json::Value call_op(const CallContext& context, std::string_view op, json::Array args) {
  Args delegated(args, context);
  return find_op(op)->fn(delegated);
}

json::Value copy_checked_time_signature_wire(const json::Value& ts, std::string_view name) {
  assert_data_object(ts, name);
  return to_json(assert_time_signature(ts, name));
}

//--------------------------------------------------------------------------------------------
// Motif

json::Value motif_data(const json::Value& cell) {
  assert_data_object(cell, "motif cell");
  std::vector<NoteEvent> notes = assert_note_event_array(member_of(cell, "notes"), "motif notes");
  json::Object o;
  o.set("notes", to_json(Motif(MotifCell{notes}).notes()));
  return json::Value(std::move(o));
}

json::Value motif_wire(const json::Value& data) { return with_class("Motif", data); }

//--------------------------------------------------------------------------------------------
// Rhythm

json::Value rhythm_data(const json::Value& data) {
  assert_data_object(data, "rhythm data");
  json::Value listed = member_of(data, "events");
  const json::Array& given = assert_data_objects(listed, "rhythm events");
  std::vector<RhythmEvent> events;
  for (std::size_t index = 0; index < given.size(); ++index) {
    std::string name = "rhythm events[" + index_text(index) + "]";
    RhythmEvent event;
    event.position =
        assert_range(member_of(given[index], "position"), 0, kMaxSafeInteger, name + ".position");
    event.duration =
        assert_range(member_of(given[index], "duration"), 0, kMaxSafeInteger, name + ".duration");
    events.push_back(event);
  }
  json::Value ts = member_of(data, "ts");
  assert_data_object(ts, "rhythm ts");
  Rhythm rhythm(RhythmData{events, assert_time_signature(ts, "rhythm ts")});
  json::Object o;
  o.set("events", to_json(rhythm.events()));
  o.set("ts", to_json(rhythm.ts()));
  return json::Value(std::move(o));
}

json::Value rhythm_wire(const json::Value& data) { return with_class("Rhythm", data); }

//--------------------------------------------------------------------------------------------
// Arrangement

json::Value arrangement_data(const json::Value& data, const CallContext& context) {
  assert_data_object(data, "arrangement data");
  json::Value settings = member_of(data, "settings");
  // `data.settings?.budget`, read before the tracks so the notes are held to it.
  json::Value budget =
      is_null_or_undefined(settings) ? undefined_value() : member_of(settings, "budget");
  json::Value listed = member_of(data, "tracks");
  const json::Array& tracks = assert_data_array(listed, "arrangement tracks");
  json::Array copied;
  for (std::size_t index = 0; index < tracks.size(); ++index) {
    copied.push_back(copy_track(tracks[index], index, budget));
  }
  json::Value kept = copy_settings(settings, copied, context);
  json::Object o;
  o.set("tracks", json::Value(std::move(copied)));
  if (!is_undefined(kept)) {
    o.set("settings", std::move(kept));
  }
  return json::Value(std::move(o));
}

json::Value arrangement_wire(const json::Value& data) { return with_class("Arrangement", data); }

//--------------------------------------------------------------------------------------------
// Composer

json::Value composer_context(const json::Value& held, const CallContext& context) {
  json::Object ctx;
  for (const char* name : {"seed", "algorithmVersion", "rng", "bpm"}) {
    const json::Value& value = get(held, name);
    if (!is_undefined(value)) {
      ctx.set(name, value);
    }
  }
  const json::Value& complexity = get(held, "complexity");
  if (!is_undefined(complexity)) {
    ctx.set("complexity", copy_complexity(complexity));
  }
  const json::Value& instruments = get(held, "instruments");
  if (!is_undefined(instruments)) {
    ctx.set("instruments", copy_instruments(instruments, context));
  }
  const json::Value& vocabulary = get(held, "vocabulary");
  if (!is_undefined(vocabulary)) {
    ctx.set("vocabulary", copy_vocabulary(vocabulary));
  }
  return json::Value(std::move(ctx));
}

json::Value composer_options(const json::Value& options, const CallContext& context) {
  assert_data_object(options, "composer options");
  json::Object meters_bag;
  json::Value meters = member_of(options, "meters");
  if (!is_undefined(meters)) {
    meters_bag.set("meters", meters);
  }
  json::Object copy;
  copy.set("meters",
           to_json(resolve_wire_meters(json::Value(std::move(meters_bag)), "composer meters")));
  json::Value key = member_of(options, "key");
  if (!is_undefined(key)) {
    copy.set("key", call_op(context, "resolveKey", {key}));
  }
  for (const char* name : {"bpm", "seed", "algorithmVersion"}) {
    json::Value value = member_of(options, name);
    if (!is_undefined(value)) {
      copy.set(name, std::move(value));
    }
  }
  json::Value complexity = member_of(options, "complexity");
  if (!is_undefined(complexity)) {
    copy.set("complexity", copy_complexity(complexity));
  }
  json::Value instruments = member_of(options, "instruments");
  if (!is_undefined(instruments)) {
    copy.set("instruments", copy_instruments(instruments, context));
  }
  json::Value vocabulary = member_of(options, "vocabulary");
  if (!is_undefined(vocabulary)) {
    copy.set("vocabulary", copy_vocabulary(vocabulary));
  }
  json::Value rng = member_of(options, "rng");
  // Resolved through the resolver every generator reads the settings through, so the seed and
  // the version written here are the ones the parts are drawn under.
  json::Value held(std::move(copy));
  if (!is_undefined(rng)) {
    held.as_object().set("rng", rng);
  }
  json::Value resolved = call_op(context, "resolveContext", {composer_context(held, context)});
  // The data's key order: the seed and the version sit after the tempo, and the source last.
  json::Object out;
  for (const json::Member& m : held.as_object()) {
    if (m.key == "complexity" || m.key == "instruments" || m.key == "vocabulary" ||
        m.key == "rng") {
      continue;
    }
    if (m.key != "seed" && m.key != "algorithmVersion") {
      out.set(m.key, m.value);
    }
  }
  out.set("seed", get(resolved, "seed"));
  out.set("algorithmVersion", get(resolved, "algorithmVersion"));
  for (const char* name : {"complexity", "instruments", "vocabulary", "rng"}) {
    const json::Value& value = get(held, name);
    if (!is_undefined(value)) {
      out.set(name, value);
    }
  }
  return json::Value(std::move(out));
}

json::Value composer_data(const json::Value& held) { return without(held, {"rng"}); }

json::Value composer_wire(const json::Value& held) { return with_class("Composer", held); }

//--------------------------------------------------------------------------------------------
// Class instances

namespace {

json::Value read_motif_class(const json::Value& value) { return motif_data(like_data(value)); }

json::Value read_rhythm_class(const json::Value& value) { return rhythm_data(like_data(value)); }

}  // namespace

json::Value read_motif_instance(const Args& a, std::size_t i) {
  return kept_value<json::Value>(a, i, "Motif", read_motif_class);
}

json::Value read_rhythm_instance(const Args& a, std::size_t i) {
  return kept_value<json::Value>(a, i, "Rhythm", read_rhythm_class);
}

DecodedArrangement::DecodedArrangement(json::Value data,
                                       std::shared_ptr<const SessionHandle> session)
    : data_(std::move(data)), session_(std::move(session)) {
  json::build_indices(data_);
  if (session_) {
    prepare_shared_session(*session_);
  }
}

std::shared_ptr<const SessionHandle> DecodedArrangement::session(
    const std::function<std::shared_ptr<SessionHandle>()>& open) const {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!session_) {
    std::shared_ptr<SessionHandle> made = open();
    prepare_shared_session(*made);
    session_ = std::move(made);
  }
  return session_;
}

std::shared_ptr<SessionHandle> DecodedArrangement::update(
    const std::function<std::shared_ptr<SessionHandle>()>& open,
    const std::function<std::shared_ptr<SessionHandle>(const SessionHandle&)>& update) const {
  std::lock_guard<std::mutex> lock(update_mutex_);
  return update(*session(open));
}

const DecodedArrangement& arrangement_instance(const Args& a, std::size_t i) {
  const json::Value& value = class_instance(a, i, "Arrangement");
  return kept_instance<DecodedArrangement>(a, i, [&] {
    return std::make_shared<const DecodedArrangement>(
        arrangement_data(like_data(value), a.context()));
  });
}

json::Value read_composer_instance(const Args& a, std::size_t i) {
  return kept_value<json::Value>(a, i, "Composer", [&a](const json::Value& value) {
    return composer_options(like_data(value), a.context());
  });
}

bool decode_m3_class(const json::Value& value, std::string_view name,
                     std::shared_ptr<const Decoded>& kept) {
  if (name == "Motif") {
    kept = decoded_value(read_motif_class(value));
  } else if (name == "Rhythm") {
    kept = decoded_value(read_rhythm_class(value));
  } else if (name == "Arrangement") {
    kept = std::make_shared<const DecodedArrangement>(arrangement_data(like_data(value), kNoHost));
  } else if (name == "Composer") {
    kept = decoded_value(composer_options(like_data(value), kNoHost));
  } else {
    return false;
  }
  return true;
}

}  // namespace cantus::ops
