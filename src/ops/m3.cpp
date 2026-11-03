// Op adapters of model/{motif, rhythm, arrangement, composer}.
//
// A model class crosses as a `$class` value (ops/codec_m3.h). Each adapter replays the TS
// method's own prologue over the wire arguments, in the TS order, and reaches the function the
// method forwards to through that function's op, so the function's prologue runs exactly as it
// does when the function is called directly.

#include <algorithm>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "analyze/reference/profile.h"
#include "cantus/core/errors.h"
#include "cantus/model/motif.h"
#include "core/validation/validation.h"
#include "generate/vocabulary/limits.gen.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "model/limits.gen.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a4.h"
#include "ops/codec_a5.h"
#include "ops/codec_c1.h"
#include "ops/codec_g1.h"
#include "ops/codec_m1.h"
#include "ops/codec_m2.h"
#include "ops/codec_m3.h"
#include "ops/codec_t1.h"
#include "ops/counters.h"
#include "ops/error_map.h"
#include "ops/handles.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** The op a method forwards to, called with wire arguments. */
json::Value forward(const Args& a, std::string_view op, json::Array args) {
  return call_op(a.context(), op, std::move(args));
}

/** `value?.key`, read through the value's public surface. */
json::Value optional_property(const json::Value& value, std::string_view key) {
  return is_null_or_undefined(value) ? undefined_value() : member_of(value, key);
}

/** `value.key`: the TypeError JS raises for null or undefined, else the member. */
json::Value member_or_throw(const json::Value& value, std::string_view key) {
  property_of(value, key);
  return member_of(value, key);
}

/** `value.length` of an array or a string, else the member of that name. */
json::Value length_of(const json::Value& value) { return ops::length_of(value, member_of); }

/** `list[index]`: the TypeError JS raises for null or undefined, else the element or member. */
json::Value element_of(const json::Value& list, std::size_t index) {
  return ops::element_of(list, index, member_of);
}

/** `key in value`: the TypeError JS raises for a value that is no object. */
bool in_operator(const json::Value& value, std::string_view key) {
  if (!is_js_object(value)) {
    throw js::TypeError("Cannot use 'in' operator to search for '" + std::string(key) + "' in " +
                        js::string_of(value));
  }
  return has_member(value, key);
}

/** `{...value}` into a fresh record. */
json::Object spread(const json::Value& value) {
  json::Object out;
  spread_into(out, value);
  return out;
}

/** A record with one field set, or left out when the value is undefined. */
void set_defined(json::Object& o, const char* name, json::Value value) {
  if (!is_undefined(value)) {
    o.set(name, std::move(value));
  }
}

/** A record with the named fields left out (`const { a, b, ...rest } = value`). */
json::Object rest_of(const json::Value& value, std::initializer_list<std::string_view> names) {
  json::Object out;
  for (const json::Member& m : spread(value)) {
    bool named = false;
    for (std::string_view name : names) {
      named = named || m.key == name;
    }
    if (!named) {
      out.set(m.key, m.value);
    }
  }
  return out;
}

/** The notes of a cell or a pattern's data, a field of a record the readers built. */
const json::Value& field_of(const json::Value& data, std::string_view name) {
  return get(data, name);
}

//--------------------------------------------------------------------------------------------
// A host callback the class wraps before a function sees it

/** The callback id a wrapped predicate is handed to a function under. */
constexpr std::uint32_t kWrappedPredicate = UINT32_MAX - 1;

/**
 * The host of a forwarded call whose predicate the class wraps: `(grid) =>
 * isOrnament(grid.source)`. The wrapped id is answered here, with the caller's predicate called on
 * the onset's source; every other callback goes to the call's own host.
 */
class SourcePredicate {
 public:
  SourcePredicate(const Args& outer, json::Value predicate)
      : outer_(&outer), predicate_(std::move(predicate)), context_(&SourcePredicate::call, this) {}

  SourcePredicate(const SourcePredicate&) = delete;
  SourcePredicate& operator=(const SourcePredicate&) = delete;

  /** The host the forwarded call runs under. */
  const CallContext& context() const noexcept { return context_; }

  /** The function the forwarded call is handed in the predicate's place. */
  static json::Value placeholder() {
    json::Object o;
    o.set("$cb", static_cast<double>(kWrappedPredicate));
    return json::Value(std::move(o));
  }

 private:
  static std::int32_t call(void* self, std::uint32_t id, const char* args_json,
                           std::size_t args_len, char** out_json, std::size_t* out_len) {
    auto* me = static_cast<SourcePredicate*>(self);
    json::Value args = json::parse(std::string_view(args_json, args_len));
    json::Value result;
    try {
      if (id == kWrappedPredicate) {
        const json::Value& grid = args.as_array().empty() ? undefined_value() : args.as_array()[0];
        json::Value source = member_or_throw(grid, "source");
        if (!is_wire_function(me->predicate_)) {
          throw js::TypeError("isOrnament is not a function");
        }
        result = call_wire_function(*me->outer_, me->predicate_, "isOrnament", json::Array{source});
      } else {
        result = me->outer_->context().invoke(id, args.as_array());
      }
    } catch (const HostCallbackError&) {
      // The host keeps what it threw; the forwarded call reports the same failure.
      return 1;
    }
    if (is_undefined(result)) {
      *out_json = nullptr;
      *out_len = 0;
      return 0;
    }
    me->result_ = ops::stringify(result);
    *out_json = me->result_.data();
    *out_len = me->result_.size();
    return 0;
  }

  const Args* outer_;
  json::Value predicate_;
  CallContext context_;
  std::string result_;
};

//--------------------------------------------------------------------------------------------
// model/motif

/** `sameNote(note, other)` against a note read off another motif's public data. */
bool same_motif_note(const json::Value& note, const json::Value& other) {
  if (is_undefined(other)) {
    return false;
  }
  return js::strict_equals(get(note, "pitch"), member_or_throw(other, "pitch")) &&
         js::strict_equals(get(note, "startBeat"), member_of(other, "startBeat")) &&
         js::strict_equals(get(note, "durationBeat"), member_of(other, "durationBeat"));
}

void register_motif() {
  auto from_cell = [](Args& a) -> json::Value { return motif_wire(motif_data(a[0])); };
  def_class_method("Motif.constructor", from_cell);
  def_class_method("Motif.fromData", from_cell);
  def_class_method("Motif.fromJSON", from_cell);
  def_class_method("Motif.generate", [](Args& a) -> json::Value {
    // `{ ...opts, chord: chordFrom(opts.chord) }`
    assert_record(a[0], "motif options");
    json::Object bag = spread(a[0]);
    json::Value chord = member_or_throw(a[0], "chord");
    if (!is_null_or_undefined(chord)) {
      chord = forward(a, "toChordData", json::Array{chord});
    }
    set_defined(bag, "chord", std::move(chord));
    json::Value cell = forward(a, "generateMotif", json::Array{json::Value(std::move(bag))});
    return motif_wire(motif_data(cell));
  });
  def_class_method("Motif.fromNotes", [](Args& a) -> json::Value {
    json::Object cell;
    cell.set("notes", json::Value(assert_array(a[0], "motif notes")));
    return motif_wire(motif_data(json::Value(std::move(cell))));
  });

  def_class_method("Motif#notes", [](Args& a) -> json::Value {
    return field_of(read_motif_instance(a, 0), "notes");
  });
  def_class_method("Motif#totalBeats", [](Args& a) -> json::Value {
    json::Value data = read_motif_instance(a, 0);
    return to_json(Motif(MotifCell{assert_note_events(get(data, "notes"))}).total_beats());
  });
  auto data_method = [](Args& a) -> json::Value { return read_motif_instance(a, 0); };
  def_class_method("Motif#data", data_method);
  def_class_method("Motif#toJSON", data_method);
  def_class_method("Motif#transform", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    json::Value cell = forward(a, "transformMotif", json::Array{self, a[1], a[2], a[3]});
    return motif_wire(motif_data(cell));
  });
  def_class_method("Motif#develop", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    // Read through the public surface rather than by class, as TS reads it.
    json::Value chords =
        in_operator(a[1], "chordTimeline") ? member_of(a[1], "chordTimeline") : a[1];
    json::Value cell = forward(a, "developMotif", json::Array{self, chords, a[2], a[3], a[4]});
    return motif_wire(motif_data(cell));
  });
  def_class_method("Motif#relateTo", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    json::Value mine = forward(a, "motifFromNotes", json::Array{get(self, "notes")});
    json::Value theirs = forward(a, "motifFromNotes", json::Array{member_or_throw(a[1], "notes")});
    return forward(a, "relateMotifs", json::Array{mine, theirs, a[2]});
  });
  def_class_method("Motif#similarityTo", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    return forward(a, "melodicSimilarity",
                   json::Array{get(self, "notes"), member_or_throw(a[1], "notes")});
  });
  def_class_method("Motif#toScore", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    json::Value notes = forward(a, "motifToNoteEvents", json::Array{self});
    return forward(a, "Score.of", json::Array{notes, a[1]});
  });
  def_class_method("Motif#equals", [](Args& a) -> json::Value {
    json::Value self = read_motif_instance(a, 0);
    json::Value theirs = member_or_throw(a[1], "data");
    json::Value notes = member_or_throw(theirs, "notes");
    const json::Array& mine = get(self, "notes").as_array();
    return same_elements(mine, notes, same_motif_note);
  });
}

//--------------------------------------------------------------------------------------------
// model/rhythm

/** The part name the pattern's draws are addressed under (`PART`). */
constexpr const char* kRhythmPart = "rhythm";

/** `spanOf(events)`: the furthest point any onset sounds to. */
double rhythm_span(const json::Value& data) {
  double end = 0;
  for (const json::Value& event : get(data, "events").as_array()) {
    end = js::max(end, *number_of(get(event, "position")) + *number_of(get(event, "duration")));
  }
  return end;
}

/** `toGrid(events)`: each onset on the sixteenth grid, carrying the onset it was built from. */
json::Value rhythm_grid(const json::Value& data) {
  json::Array out;
  for (const json::Value& event : get(data, "events").as_array()) {
    json::Object grid;
    grid.set("step", to_json(*number_of(get(event, "position")) / STEP_BEATS));
    grid.set("velocity", GRID_VELOCITY);
    grid.set("source", event);
    out.push_back(json::Value(std::move(grid)));
  }
  return json::Value(std::move(out));
}

/** `toGrid(events)` as the list the transforms take. */
std::vector<json::Value> rhythm_grid_events(const json::Value& data) {
  json::Array grid = rhythm_grid(data).as_array();
  return std::vector<json::Value>(std::make_move_iterator(grid.begin()),
                                  std::make_move_iterator(grid.end()));
}

/** `#spanSteps()`. */
json::Value rhythm_span_steps(const json::Value& data) {
  return to_json(rhythm_span(data) / STEP_BEATS);
}

/** `#withGrid(events)`: the onsets a transform returned, read back over the same span. */
json::Value rhythm_with_grid(const json::Value& data, const json::Value& events) {
  double span = rhythm_span(data);
  std::vector<json::Value> positions;
  for (const json::Value& event : events.as_array()) {
    json::Value position = js::multiply(member_of(event, "step"), STEP_BEATS);
    bool seen = false;
    for (const json::Value& held : positions) {
      seen = seen || js::same_value_zero(held, position);
    }
    if (!seen) {
      positions.push_back(std::move(position));
    }
  }
  std::stable_sort(
      positions.begin(), positions.end(),
      [](const json::Value& x, const json::Value& y) { return *number_of(x) < *number_of(y); });
  json::Array onsets;
  for (std::size_t index = 0; index < positions.size(); ++index) {
    double position = *number_of(positions[index]);
    double next = index + 1 < positions.size() ? *number_of(positions[index + 1]) : span;
    json::Object onset;
    onset.set("position", positions[index]);
    onset.set("duration", to_json(next - position));
    onsets.push_back(json::Value(std::move(onset)));
  }
  json::Object next;
  next.set("events", json::Value(std::move(onsets)));
  next.set("ts", get(data, "ts"));
  return rhythm_wire(rhythm_data(json::Value(std::move(next))));
}

/** `resolveContext(ctx)`, as its hybrid. */
json::Value resolved_context(const Args& a, const json::Value& ctx) {
  return forward(a, "resolveContext", json::Array{ctx});
}

/** `resolved.part(PART)`. */
json::Value rhythm_draw(const Args& a, const json::Value& resolved) {
  return forward(a, "ResolvedContext#part", json::Array{resolved, kRhythmPart});
}

/** `sameEvent(event, other)` against an onset read off another pattern's public data. */
bool same_event(const json::Value& event, const json::Value& other) {
  if (is_undefined(other)) {
    return false;
  }
  return js::strict_equals(get(event, "position"), member_or_throw(other, "position")) &&
         js::strict_equals(get(event, "duration"), member_of(other, "duration"));
}

/** `sameSignature(ts, other)` against a signature read off another pattern's public data. */
bool same_signature(const json::Value& ts, const json::Value& other) {
  json::Value grouping = get(ts, "grouping");
  if (is_null_or_undefined(grouping)) {
    grouping = json::Value(json::Array{});
  }
  json::Value theirs = member_or_throw(other, "grouping");
  if (is_null_or_undefined(theirs)) {
    theirs = json::Value(json::Array{});
  }
  if (!js::strict_equals(get(ts, "numerator"), member_of(other, "numerator")) ||
      !js::strict_equals(get(ts, "denominator"), member_of(other, "denominator")) ||
      !js::strict_equals(length_of(grouping), length_of(theirs))) {
    return false;
  }
  for (std::size_t index = 0; index < grouping.as_array().size(); ++index) {
    if (!js::strict_equals(grouping.as_array()[index], element_of(theirs, index))) {
      return false;
    }
  }
  return true;
}

void register_rhythm() {
  auto from_data = [](Args& a) -> json::Value { return rhythm_wire(rhythm_data(a[0])); };
  def_class_method("Rhythm.constructor", from_data);
  def_class_method("Rhythm.fromData", from_data);
  def_class_method("Rhythm.fromJSON", from_data);
  def_class_method("Rhythm.generate", [](Args& a) -> json::Value {
    // Read once, here: the pattern and the meter it is counted in are stored together.
    json::Value given = forward(a, "toMeterData", json::Array{a[0], "ts"});
    json::Value meter = forward(a, "meterAt", json::Array{0.0, given});
    json::Object data;
    data.set("events", forward(a, "generateRhythm", json::Array{meter, a[1]}));
    data.set("ts", meter);
    return rhythm_wire(rhythm_data(json::Value(std::move(data))));
  });
  def_class_method("Rhythm.of", [](Args& a) -> json::Value {
    json::Object data;
    data.set("events", assert_data_array(a[0], "rhythm events"));
    json::Value given = forward(a, "toMeterData", json::Array{a[1], "ts"});
    data.set("ts", forward(a, "meterAt", json::Array{0.0, given}));
    return rhythm_wire(rhythm_data(json::Value(std::move(data))));
  });

  def_class_method("Rhythm#events", [](Args& a) -> json::Value {
    return field_of(read_rhythm_instance(a, 0), "events");
  });
  def_class_method("Rhythm#ts", [](Args& a) -> json::Value {
    return copy_checked_time_signature_wire(field_of(read_rhythm_instance(a, 0), "ts"),
                                            "rhythm ts");
  });
  def_class_method("Rhythm#totalBeats", [](Args& a) -> json::Value {
    return to_json(rhythm_span(read_rhythm_instance(a, 0)));
  });
  auto data_method = [](Args& a) -> json::Value { return read_rhythm_instance(a, 0); };
  def_class_method("Rhythm#data", data_method);
  def_class_method("Rhythm#toJSON", data_method);
  def_class_method("Rhythm#density", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    return forward(a, "rhythmDensity", json::Array{get(self, "events"), get(self, "ts")});
  });
  def_class_method("Rhythm#thin", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value events = forward(a, "thin", json::Array{rhythm_grid(self), a[1], get(self, "ts")});
    return rhythm_with_grid(self, events);
  });
  def_class_method("Rhythm#syncopate", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value grid = rhythm_grid(self);
    json::Object amount;
    set_defined(amount, "amount", a[1]);
    amount.set("ts", get(self, "ts"));
    json::Value draw = rhythm_draw(a, resolved_context(a, a[2]));
    json::Value events =
        forward(a, "syncopate", json::Array{grid, json::Value(std::move(amount)), draw});
    return rhythm_with_grid(self, events);
  });
  // The class's own grid and span go to the transforms unchecked: a span off the sixteenth grid
  // and an empty pattern are both patterns the class holds.
  def_class_method("Rhythm#doubleTime", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value events = events_json(double_time_figure<WireGridModel>(
        rhythm_grid_events(self), *number_of(rhythm_span_steps(self))));
    return rhythm_with_grid(self, events);
  });
  def_class_method("Rhythm#halfTime", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value events = events_json(half_time_figure<WireGridModel>(
        rhythm_grid_events(self), *number_of(rhythm_span_steps(self))));
    return rhythm_with_grid(self, events);
  });
  def_class_method("Rhythm#ornamentBy", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value grid = rhythm_grid(self);
    json::Value draw = rhythm_draw(a, resolved_context(a, a[3]));
    SourcePredicate wrapped(a, a[1]);
    json::Array args{grid, SourcePredicate::placeholder(), a[2], draw};
    json::Value events = call_op(wrapped.context(), "ornamentBy", std::move(args));
    return rhythm_with_grid(self, events);
  });
  def_class_method("Rhythm#deform", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value resolved = resolved_context(a, a[2]);
    json::Value is_ornament = optional_property(a[1], "isOrnament");
    json::Object options;
    set_defined(options, "rhythmic", get(resolved, "rhythmic"));
    set_defined(options, "ornament", get(resolved, "ornament"));
    set_defined(options, "rate", optional_property(a[1], "rate"));
    options.set("ts", get(self, "ts"));
    if (!is_undefined(is_ornament)) {
      options.set("isOrnament", SourcePredicate::placeholder());
    }
    json::Value draw = rhythm_draw(a, resolved);
    SourcePredicate wrapped(a, is_ornament);
    // `deformFigure` under the predicate's host, so the placeholder answers through it.
    json::Array inner_values{json::Value(std::move(options)), draw};
    Args inner(inner_values, wrapped.context());
    WireDraw sampler = assert_wire_draw(inner, inner_values[1]);
    WireDeformPlan plan{inner, inner_values[0], opt_null_default(inner_values[0], "ts")};
    json::Value events = events_json(
        deform_figure<WireGridModel>(rhythm_grid_events(self), *number_of(rhythm_span_steps(self)),
                                     plan, WireSampler{sampler, json::Array()}));
    return rhythm_with_grid(self, events);
  });
  def_class_method("Rhythm#withinCeiling", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value resolved = resolved_context(a, a[1]);
    return forward(
        a, "withinCeiling",
        json::Array{rhythm_grid(self), get(resolved, "bpm"), get(resolved, "difficulty")});
  });
  def_class_method("Rhythm#toScore", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value notes =
        forward(a, "rhythmToNoteEvents", json::Array{get(self, "events"), a[1], a[2]});
    json::Object opts;
    opts.set("meters", get(self, "ts"));
    return forward(a, "Score.of", json::Array{notes, json::Value(std::move(opts))});
  });
  def_class_method("Rhythm#equals", [](Args& a) -> json::Value {
    json::Value self = read_rhythm_instance(a, 0);
    json::Value theirs = member_or_throw(a[1], "data");
    json::Value events = member_or_throw(theirs, "events");
    const json::Array& mine = get(self, "events").as_array();
    if (!same_elements(mine, events, same_event)) {
      return false;
    }
    return same_signature(get(self, "ts"), member_of(theirs, "ts"));
  });
}

//--------------------------------------------------------------------------------------------
// model/arrangement

/** `new Timeline({ segments, totalBeats: spanEnd(segments), ...more })`, as its wire. */
json::Value timeline_over(const json::Value& segments, const json::Value& keys) {
  json::Object data;
  data.set("segments", segments);
  data.set("totalBeats", to_json(settled_span_end({&segments, &keys})));
  if (!is_undefined(keys)) {
    data.set("keys", keys);
  }
  return to_json(read_timeline_data(json::Value(std::move(data))));
}

/** `#analysisOptions()`: the stored settings as the options the analysis functions take. */
json::Value arrangement_options(const json::Value& data) {
  const json::Value& settings = get(data, "settings");
  if (is_undefined(settings)) {
    return json::Value(json::Object{});
  }
  json::Object opts = rest_of(settings, {"timeline"});
  const json::Value& timeline = get(settings, "timeline");
  if (!is_undefined(timeline)) {
    // `chordTimelineOf(segments)`: the timeline class's own `{ at, segments }`.
    opts.set("timeline", member_of(timeline_over(timeline, undefined_value()), "chordTimeline"));
  }
  return json::Value(std::move(opts));
}

/** `createArrangementSession([...tracks], #analysisOptions())`: what `#session()` opens. */
std::function<std::shared_ptr<SessionHandle>()> session_opener(const Args& a,
                                                               const DecodedArrangement& self) {
  return [&a, &self] {
    return open_arrangement_session(a, get(self.data(), "tracks"),
                                    arrangement_options(self.data()));
  };
}

/** `#session()`: the reading of the tracks under the stored settings, made on the first ask. */
std::shared_ptr<const SessionHandle> arrangement_session(const Args& a,
                                                         const DecodedArrangement& self) {
  return self.session(session_opener(a, self));
}

/** `analysisOptionsOf(setup)`: a caller's setup as the analysis functions take it. */
json::Value analysis_options_of(const Args& a, const json::Value& setup) {
  if (is_undefined(setup)) {
    return json::Value(json::Object{});
  }
  assert_data_object(setup, "arrangement options");
  json::Value key = member_of(setup, "key");
  json::Value meters = member_of(setup, "meters");
  json::Object opts = rest_of(setup, {"key", "meters"});
  if (!is_undefined(key)) {
    opts.set("key", forward(a, "resolveKey", json::Array{key}));
  }
  if (!is_undefined(meters)) {
    json::Object bag;
    bag.set("meters", meters);
    opts.set("meters",
             to_json(resolve_wire_meters(json::Value(std::move(bag)), "arrangement meters")));
  }
  return json::Value(std::move(opts));
}

/** `#layered(theirs)`: a caller's meter replaces the arrangement's rather than joining it. */
json::Value layered(const json::Value& data, const json::Value& theirs) {
  json::Value mine = arrangement_options(data);
  json::Object out = is_undefined(get(theirs, "ts")) && is_undefined(get(theirs, "meters"))
                         ? mine.as_object()
                         : rest_of(mine, {"ts", "meters"});
  spread_into(out, theirs);
  return json::Value(std::move(out));
}

/** `timeline()`: the harmony the analysis found, with the key regions under it. */
json::Value arrangement_timeline(const json::Value& analysis) {
  return timeline_over(get(get(analysis, "timeline"), "segments"), get(analysis, "keys"));
}

/** `#scoreOptions()`: the context one track's notes are read as a score against. */
json::Value arrangement_score_options(const json::Value& data) {
  const json::Value& settings = get(data, "settings");
  json::Object opts;
  if (!is_undefined(settings)) {
    const json::Value& meters = get(settings, "meters");
    set_defined(opts, "meters", is_undefined(meters) ? get(settings, "ts") : meters);
    set_defined(opts, "key", get(settings, "key"));
  }
  return json::Value(std::move(opts));
}

/** The readings an arrangement's analysis holds, typed for referenceFromReadings. */
ReferenceReadings arrangement_readings(const json::Value& analysis) {
  ReferenceReadings readings;
  for (const json::Value& segment : get(get(analysis, "timeline"), "segments").as_array()) {
    readings.timeline.segments.push_back(ChordSegment{*number_of(get(segment, "startBeat")),
                                                      *number_of(get(segment, "endBeat")),
                                                      read_chord_data(get(segment, "chord"))});
  }
  for (const json::Value& region : get(analysis, "keys").as_array()) {
    readings.keys.push_back(read_key_region(region));
  }
  readings.prevailingKey = read_key_value(get(analysis, "prevailingKey")).data();
  return readings;
}

void register_arrangement() {
  auto from_data = [](Args& a) -> json::Value {
    return arrangement_wire(arrangement_data(a[0], a.context()));
  };
  def_class_method("Arrangement.constructor", from_data);
  def_class_method("Arrangement.fromData", from_data);
  def_class_method("Arrangement.fromJSON", from_data);
  def_class_method("Arrangement.of", [](Args& a) -> json::Value {
    // `settingsFrom(opts)`, evaluated before the tracks are read.
    json::Value settings = undefined_value();
    const json::Value& setup = a[1];
    if (!is_undefined(setup)) {
      assert_data_object(setup, "arrangement options");
      json::Value key = member_of(setup, "key");
      json::Value meters = member_of(setup, "meters");
      json::Value timeline = member_of(setup, "timeline");
      json::Object read = rest_of(setup, {"key", "meters", "timeline"});
      if (!is_undefined(key)) {
        read.set("key", forward(a, "resolveKey", json::Array{key}));
      }
      if (!is_undefined(meters)) {
        json::Object bag;
        bag.set("meters", meters);
        read.set("meters",
                 to_json(resolve_wire_meters(json::Value(std::move(bag)), "arrangement meters")));
      }
      if (!is_undefined(timeline)) {
        assert_data_object(timeline, "arrangement timeline");
        read.set("timeline", assert_data_array(member_of(timeline, "segments"),
                                               "arrangement timeline segments"));
      }
      settings = json::Value(std::move(read));
    }
    json::Object data;
    data.set("tracks", assert_data_array(a[0], "tracks"));
    set_defined(data, "settings", std::move(settings));
    return arrangement_wire(arrangement_data(json::Value(std::move(data)), a.context()));
  });

  def_class_method("Arrangement#tracks", [](Args& a) -> json::Value {
    return copy_plain(get(arrangement_instance(a, 0).data(), "tracks"), "arrangement tracks");
  });
  auto data_method = [](Args& a) -> json::Value {
    return copy_plain(arrangement_instance(a, 0).data(), "arrangement data");
  };
  def_class_method("Arrangement#data", data_method);
  def_class_method("Arrangement#toJSON", data_method);
  def_class_method("Arrangement#analysis", [](Args& a) -> json::Value {
    std::shared_ptr<const SessionHandle> session =
        arrangement_session(a, arrangement_instance(a, 0));
    const json::Value& analysis = session_analysis(*session);
    json::Value rest =
        copy_plain(json::Value(rest_of(analysis, {"timeline"})), "arrangement analysis");
    rest.as_object().set("timeline", member_of(arrangement_timeline(analysis), "chordTimeline"));
    return rest;
  });
  def_class_method("Arrangement#conflicts", [](Args& a) -> json::Value {
    std::shared_ptr<const SessionHandle> session =
        arrangement_session(a, arrangement_instance(a, 0));
    return copy_plain(get(session_analysis(*session), "conflicts"), "arrangement conflicts");
  });
  def_class_method("Arrangement#track", [](Args& a) -> json::Value {
    const DecodedArrangement& self = arrangement_instance(a, 0);
    std::shared_ptr<const SessionHandle> session = arrangement_session(a, self);
    const json::Array& tracks = get(session_analysis(*session), "tracks").as_array();
    for (std::size_t index = 0; index < tracks.size(); ++index) {
      if (js::strict_equals(get(tracks[index], "name"), a[1])) {
        const json::Array& given = get(self.data(), "tracks").as_array();
        if (index >= given.size()) {
          return undefined_value();
        }
        return forward(
            a, "Score.of",
            json::Array{get(given[index], "notes"), arrangement_score_options(self.data())});
      }
    }
    return undefined_value();
  });
  def_class_method("Arrangement#update", [](Args& a) -> json::Value {
    const DecodedArrangement& self = arrangement_instance(a, 0);
    const json::Value& edits = a[1];
    // The reading keeps the arrays it is handed, so it is handed copies.
    json::Value budget = get(get(self.data(), "settings"), "budget");
    json::Array copied;
    for (std::size_t index = 0;
         js::less_than(json::Value(static_cast<double>(index)), length_of(edits)); ++index) {
      json::Value edit = element_of(edits, index);
      if (is_undefined(edit)) {
        continue;
      }
      json::Object entry;
      set_defined(entry, "trackIndex", member_or_throw(edit, "trackIndex"));
      entry.set("notes", arrangement_notes(member_of(edit, "notes"),
                                           "edits[" + index_text(index) + "].notes", budget));
      copied.push_back(json::Value(std::move(entry)));
    }
    json::Value edited(std::move(copied));
    std::shared_ptr<SessionHandle> next =
        self.update(session_opener(a, self), [&a, &edited](const SessionHandle& session) {
          return update_arrangement_session(a, session, edited);
        });
    json::Object result;
    result.set("tracks", assert_data_array(session_tracks(*next), "tracks"));
    set_defined(result, "settings", get(self.data(), "settings"));
    json::Value wire =
        arrangement_wire(arrangement_data(json::Value(std::move(result)), a.context()));
    if (a.retained(0) == nullptr) {
      return wire;
    }
    // A receiver held as a snapshot hands its result the updated session (TS `#adopt`).
    counters::bump(counters::class_decodes);
    auto decoded = std::make_shared<const DecodedArrangement>(
        arrangement_data(like_data(wire), a.context()), std::move(next));
    json::Value ref = retain(wire, std::move(decoded));
    wire.as_object().set("$ref", *ref.as_object().find("$ref"));
    return wire;
  });
  def_class_method("Arrangement#tension", [](Args& a) -> json::Value {
    const DecodedArrangement& self = arrangement_instance(a, 0);
    std::shared_ptr<const SessionHandle> session = arrangement_session(a, self);
    json::Value opts = layered(self.data(), analysis_options_of(a, a[1]));
    return forward(a, "tensionCurveFrom",
                   json::Array{get(self.data(), "tracks"), session_analysis(*session), opts});
  });
  def_class_method("Arrangement#analyze", [](Args& a) -> json::Value {
    const json::Value& self = arrangement_instance(a, 0).data();
    json::Value opts = layered(self, analysis_options_of(a, a[1]));
    return forward(a, "analyzeArrangement", json::Array{get(self, "tracks"), opts});
  });
  def_class_method("Arrangement#timeline", [](Args& a) -> json::Value {
    std::shared_ptr<const SessionHandle> session =
        arrangement_session(a, arrangement_instance(a, 0));
    return arrangement_timeline(session_analysis(*session));
  });
  def_class_method("Arrangement#reference", [](Args& a) -> json::Value {
    const DecodedArrangement& held = arrangement_instance(a, 0);
    const json::Value& self = held.data();
    const json::Value& harmony_tracks = get(get(self, "settings"), "harmonyTracks");
    json::Array harmony;
    json::Array melody;
    const json::Array& tracks = get(self, "tracks").as_array();
    for (std::size_t index = 0; index < tracks.size(); ++index) {
      const json::Value& role = get(tracks[index], "role");
      bool listed = is_undefined(harmony_tracks);
      if (!listed) {
        for (const json::Value& entry : harmony_tracks.as_array()) {
          listed = listed || js::same_value_zero(entry, json::Value(static_cast<double>(index)));
        }
      }
      const json::Array& notes = get(tracks[index], "notes").as_array();
      if (!js::strict_equals(role, json::Value("drums")) && listed) {
        harmony.insert(harmony.end(), notes.begin(), notes.end());
      }
      if (js::strict_equals(role, json::Value("melody"))) {
        melody.insert(melody.end(), notes.begin(), notes.end());
      }
    }
    std::shared_ptr<const SessionHandle> session = arrangement_session(a, held);
    const json::Value& analysis = session_analysis(*session);
    json::Object bag;
    // `settings?.meters ?? settings?.ts`.
    const json::Value& settings = get(self, "settings");
    const json::Value& meters = get(settings, "meters");
    set_defined(bag, "meters", is_null_or_undefined(meters) ? get(settings, "ts") : meters);
    bag.set("totalBeats", member_of(arrangement_timeline(analysis), "totalBeats"));
    if (!melody.empty()) {
      bag.set("melody", json::Value(std::move(melody)));
    }
    spread_into(bag, a[1]);
    json::Value harmony_notes(std::move(harmony));
    std::vector<NoteEvent> typed;
    ReferenceProfileOptions opts =
        reference_options(json::Value(std::move(bag)), harmony_notes, typed);
    return to_json(reference_from_readings(typed, arrangement_readings(analysis), opts));
  });
  def_class_method("Arrangement#equals", [](Args& a) -> json::Value {
    const json::Value& self = arrangement_instance(a, 0).data();
    return same_plain(self, member_or_throw(a[1], "data"));
  });
}

//--------------------------------------------------------------------------------------------
// model/composer

/** `#requireKey(part)`: the key a pitched part is written in. */
const json::Value& composer_key(const json::Value& held, const char* part) {
  const json::Value& key = get(held, "key");
  if (is_undefined(key)) {
    throw InvalidInputError(std::string("composer ") + part +
                            " needs a key for the part it writes; the composer names none — "
                            "give it one, or take the key harmonize reads off a melody and pass "
                            "it on with with({ key })");
  }
  return key;
}

/** `#unchangingMeter(part)`: the one signature a part laid out in bars is written against. */
json::Value unchanging_meter(const Args& a, const json::Value& held, const char* part) {
  if (get(held, "meters").as_array().size() > 1) {
    throw InvalidInputError(std::string("composer ") + part +
                            " needs one meter for the whole part; the composer changes meter");
  }
  return forward(a, "meterAt", json::Array{0.0, get(held, "meters")});
}

/** `#scoreOptions(key)`: the context every score a composer hands back is read against. */
json::Value composer_score_options(const json::Value& held, const json::Value& key) {
  json::Object opts;
  opts.set("meters", get(held, "meters"));
  set_defined(opts, "tempo", get(held, "bpm"));
  set_defined(opts, "key", key);
  return json::Value(std::move(opts));
}

/** `harmonizedSpan(melodyEnd, chords, barBeats)`. */
double harmonized_span(double melody_end, const json::Value& chords, double bar_beats) {
  const json::Array& spans = chords.as_array();
  if (spans.empty()) {
    return melody_end;
  }
  double last = *number_of(get(spans.back(), "startBeat"));
  double slot =
      spans.size() < 2 ? bar_beats : last - *number_of(get(spans[spans.size() - 2], "startBeat"));
  return js::max(melody_end, last + slot);
}

/** `melody.transpose(semitones)` of whatever the caller handed as a melody. */
json::Value transpose_melody(const Args& a, const json::Value& melody, const json::Value& by) {
  if (js::type_of(member_or_throw(melody, "transpose")) != "function") {
    throw js::TypeError("melody.transpose is not a function");
  }
  return call_member(melody, "transpose", json::Array{by}, a.context());
}

/** A composer over its held settings with one setting replaced (`with({ name: value })`). */
json::Value composer_with(const Args& a, const json::Value& held, const char* name,
                          const json::Value& value) {
  json::Object merged;
  for (const json::Member& m : held.as_object()) {
    if (m.key != name) {
      merged.set(m.key, m.value);
    }
  }
  set_defined(merged, name, value);
  return composer_wire(composer_options(json::Value(std::move(merged)), a.context()));
}

void register_composer() {
  auto of = [](Args& a) -> json::Value {
    return composer_wire(composer_options(a[0], a.context()));
  };
  def_class_method("Composer.constructor", of);
  def_class_method("Composer.of", of);
  def_class_method("Composer.fromData", of);
  def_class_method("Composer.fromJSON", of);

  def_class_method("Composer#with", [](Args& a) -> json::Value {
    json::Object merged = read_composer_instance(a, 0).as_object();
    spread_into(merged, a[1]);
    return composer_wire(composer_options(json::Value(std::move(merged)), a.context()));
  });
  def_class_method("Composer#withKey", [](Args& a) -> json::Value {
    return composer_with(a, read_composer_instance(a, 0), "key", a[1]);
  });
  def_class_method("Composer#withSeed", [](Args& a) -> json::Value {
    return composer_with(a, read_composer_instance(a, 0), "seed", a[1]);
  });
  def_class_method("Composer#withComplexity", [](Args& a) -> json::Value {
    return composer_with(a, read_composer_instance(a, 0), "complexity", a[1]);
  });
  def_class_method("Composer#progression", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    const json::Value& key = composer_key(held, "progression");
    json::Value ts = unchanging_meter(a, held, "progression");
    json::Object bag = spread(a[1]);
    bag.set("key", key);
    bag.set("ts", ts);
    bag.set("ctx", composer_context(held, a.context()));
    json::Value chords =
        forward(a, "generateProgression", json::Array{json::Value(std::move(bag))});
    json::Value bar = forward(a, "beatsPerBar", json::Array{ts});
    json::Value total = to_json(js::multiply(member_or_throw(a[1], "bars"), *number_of(bar)));
    return forward(a, "Timeline.fromChords", json::Array{chords, total, key});
  });
  def_class_method("Composer#drums", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    json::Object bag = spread(a[1]);
    bag.set("ts", unchanging_meter(a, held, "drums"));
    bag.set("ctx", composer_context(held, a.context()));
    json::Value hits = forward(a, "generateDrums", json::Array{json::Value(std::move(bag))});
    return forward(a, "Score.of",
                   json::Array{hits, composer_score_options(held, undefined_value())});
  });
  def_class_method("Composer#bass", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    json::Value segments = a[1].is_array() ? a[1] : member_or_throw(a[1], "segments");
    const json::Value& key = composer_key(held, "bass");
    const json::Value& given = is_null_or_undefined(a[2]) ? json::Value(json::Object{}) : a[2];
    json::Value instrument = member_of(given, "instrument");
    json::Object bag = rest_of(given, {"instrument"});
    if (!is_undefined(instrument)) {
      bag.set("instrument",
              forward(a, "toStringedProfile", json::Array{instrument, "bass instrument"}));
    }
    bag.set("segments", segments);
    bag.set("key", key);
    bag.set("ts", get(held, "meters"));
    bag.set("ctx", composer_context(held, a.context()));
    json::Value notes = forward(a, "generateBassLine", json::Array{json::Value(std::move(bag))});
    return forward(a, "Score.of", json::Array{notes, composer_score_options(held, key)});
  });
  def_class_method("Composer#counterMelody", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    const json::Value& key = composer_key(held, "counterMelody");
    const json::Value& given = is_null_or_undefined(a[2]) ? json::Value(json::Object{}) : a[2];
    json::Value timeline = member_of(given, "timeline");
    json::Object bag = rest_of(given, {"timeline"});
    if (!is_undefined(timeline)) {
      // `toChordTimeline(harmony)`: read through the public surface.
      bag.set("timeline", in_operator(timeline, "chordTimeline")
                              ? member_of(timeline, "chordTimeline")
                              : timeline);
    }
    bag.set("melody", member_or_throw(a[1], "notes"));
    bag.set("key", key);
    bag.set("ts", get(held, "meters"));
    bag.set("ctx", composer_context(held, a.context()));
    json::Value notes =
        forward(a, "generateCounterMelody", json::Array{json::Value(std::move(bag))});
    return forward(a, "Score.of", json::Array{notes, composer_score_options(held, key)});
  });
  def_class_method("Composer#harmonize", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    json::Object bag = spread(a[2]);
    bag.set("melody", member_or_throw(a[1], "notes"));
    set_defined(bag, "key", get(held, "key"));
    bag.set("ts", get(held, "meters"));
    bag.set("ctx", composer_context(held, a.context()));
    json::Value result = forward(a, "harmonizeMelody", json::Array{json::Value(std::move(bag))});
    const json::Value& semitones = get(result, "transposeSemitones");
    json::Value moved = transpose_melody(a, a[1], semitones);
    const json::Array& chords = get(result, "chords").as_array();
    json::Value last = chords.empty() ? json::Value(0.0) : get(chords.back(), "startBeat");
    json::Value bar = forward(a, "beatsPerBarAt", json::Array{last, get(held, "meters")});
    double total = harmonized_span(js::to_math_number(member_or_throw(moved, "totalBeats")),
                                   get(result, "chords"), *number_of(bar));
    json::Object out;
    out.set("chords",
            forward(a, "Timeline.fromChords",
                    json::Array{get(result, "chords"), to_json(total), get(result, "key")}));
    // Scored in the key the chords are in: where the line was moved, it now sounds there.
    out.set("melody", forward(a, "Score.of",
                              json::Array{member_or_throw(moved, "notes"),
                                          composer_score_options(held, get(result, "key"))}));
    out.set("transposeSemitones", semitones);
    return json::Value(std::move(out));
  });
  def_class_method("Composer#plan", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    json::Value ctx = composer_context(held, a.context());
    if (!is_undefined(get(ctx, "rng"))) {
      throw InvalidInputError(
          "composer plan cannot record a caller-held rng; give the composer a seed instead");
    }
    json::Object bag;
    set_defined(bag, "key", get(held, "key"));
    spread_into(bag, a[2]);
    bag.set("ctx", std::move(ctx));
    return forward(a, "deriveCompositionPlan", json::Array{a[1], json::Value(std::move(bag))});
  });
  def_class_method("Composer#melody", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    // Generated first: the generator is what validates the plan read below.
    json::Value notes = forward(a, "generateMelody", json::Array{a[1], a[2]});
    json::Object score;
    score.set("meters", member_or_throw(a[1], "meters"));
    set_defined(score, "key", element_of(member_or_throw(a[1], "keys"), 0));
    set_defined(score, "tempo", get(held, "bpm"));
    return forward(a, "Score.of", json::Array{notes, json::Value(std::move(score))});
  });
  def_class_method("Composer#equals", [](Args& a) -> json::Value {
    json::Value held = read_composer_instance(a, 0);
    if (!same_plain(composer_data(held), member_or_throw(a[1], "data"))) {
      return false;
    }
    // A source is compared by identity; across the boundary, by the value standing for it.
    json::Value theirs = member_or_throw(member_or_throw(a[1], "context"), "rng");
    return get(held, "rng") == theirs;
  });
  def_class_method("Composer#context", [](Args& a) -> json::Value {
    return composer_context(read_composer_instance(a, 0), a.context());
  });
  auto data_method = [](Args& a) -> json::Value {
    return composer_data(read_composer_instance(a, 0));
  };
  def_class_method("Composer#data", data_method);
  def_class_method("Composer#toJSON", data_method);
}

}  // namespace

void register_m3() {
  register_motif();
  register_rhythm();
  register_arrangement();
  register_composer();
}

}  // namespace cantus::ops
