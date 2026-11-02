// Op adapters of generate (layer root), generate/context, generate/vocabulary, generate/drums.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_g1.h), in the TS order and with the TS names, then calls the typed
// function. A guard that returns its argument returns the wire value it was given. The figure
// transforms and placeDrumPattern run their typed bodies over wire onsets (WireGridModel), since
// TS keeps every field a caller wrote and reads the ones it does not check as JS values.

#include <cmath>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "cantus/generate/vocabulary.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/context/draw.h"
#include "generate/context/limits.gen.h"
#include "generate/drums/drums.h"
#include "generate/drums/hit.h"
#include "generate/drums/internal.h"
#include "generate/drums/vocabulary.h"
#include "generate/vocabulary/transform.h"
#include "generate/vocabulary/types.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_c1.h"
#include "ops/codec_g1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** Arguments `from` onwards. */
json::Array rest_of(const Args& a, std::size_t from) {
  json::Array out;
  for (std::size_t i = from; i < a.size(); ++i) {
    out.push_back(a[i]);
  }
  return out;
}

json::Value names_json(const std::vector<std::string_view>& names) {
  json::Array out;
  for (std::string_view name : names) {
    out.emplace_back(name);
  }
  return json::Value(std::move(out));
}

/** `list[key]`: the element an integer-index key names, the length, or undefined. */
json::Value element_at(const json::Array& list, const json::Value& key) {
  std::string type = js::type_of(key);
  if (type == "symbol" || type == "undefined" || key.is_null() || type == "boolean") {
    return undefined_value();
  }
  std::string name = key.is_string() ? key.as_string() : js::template_string(key);
  if (name == "length") {
    return json::Value(static_cast<double>(list.size()));
  }
  double index = js::number(name);
  if (std::isfinite(index) && index >= 0 && std::trunc(index) == index &&
      js::to_string(index) == name && index < static_cast<double>(list.size())) {
    return list[static_cast<std::size_t>(index)];
  }
  return undefined_value();
}

/** A drum hit written from a caller's stroke, whose duration and articulation are as given. */
struct WireDrumHit {
  int pitch = 0;
  double startBeat = 0;
  json::Value durationBeat;
  double velocity = 0;
  std::optional<json::Value> articulation;
};

void write_fields(const WireDrumHit& v, FieldWriter& w) {
  w.field("pitch", v.pitch);
  w.field("startBeat", v.startBeat);
  w.field("durationBeat", v.durationBeat);
  w.field("velocity", v.velocity);
  w.field("articulation", v.articulation);
}

/** placeDrumPattern's figures as the caller wrote them (see generate/drums/vocabulary.h). */
struct WirePatternModel {
  using Grid = WireGridModel;
  using Hit = WireDrumHit;

  const WireContext& ctx;
  json::Value kit;
  std::function<bool(int)> sounds;

  json::Array dictionary() const {
    static const json::Value kBuiltIn = to_json(DRUM_PATTERNS);
    json::Array supplied;
    for (const json::Value& entry : ctx.vocabulary) {
      if (wire_is_drum_pattern(get(entry, "material"))) {
        supplied.push_back(entry);
      }
    }
    // Read for its voices here: an entry the draw does not reach is as wrong as one it does.
    for (std::size_t index = 0; index < supplied.size(); ++index) {
      const json::Array& strokes = get(get(supplied[index], "material"), "strokes").as_array();
      for (std::size_t at = 0; at < strokes.size(); ++at) {
        const json::Value& voice = get(strokes[at], "voice");
        if (!is_js_object(strokes[at]) || !voice.is_string() || !drum_note_of(voice.as_string())) {
          throw InvalidInputError("drum pattern vocabulary[" + index_text(index) + "] strokes[" +
                                  index_text(at) + "].voice must name a drum voice; received " +
                                  describe_rejected(voice));
        }
      }
    }
    return wire_merge_vocabulary(kBuiltIn, json::Value(std::move(supplied)));
  }

  bool any_in_meter(const json::Array& dictionary, const TimeSignature& ts) const {
    json::Object query;
    query.set("ts", to_json(ts));
    return !wire_select_vocabulary(json::Value(dictionary), json::Value(std::move(query))).empty();
  }

  std::optional<json::Value> pick(const json::Array& dictionary, const PatternPlan& plan,
                                  const Draw& draw, int bar) const {
    json::Object query;
    query.set("genre", to_json(plan.genre));
    if (plan.section) {
      query.set("section", to_json(*plan.section));
    }
    query.set("bpm", plan.bpm);
    query.set("ts", to_json(plan.ts));
    if (plan.difficulty) {
      query.set("difficulty", *plan.difficulty);
    }
    // A figure calling for a technique the kit cannot produce is not offered at all.
    if (!is_undefined(kit)) {
      if (kit.is_null()) {
        throw js::TypeError("Cannot read properties of null (reading 'articulations')");
      }
      const json::Value& articulations = get(kit, "articulations");
      if (!is_undefined(articulations)) {
        query.set("articulations", articulations);
      }
    }
    json::Array candidates =
        wire_select_vocabulary(json::Value(dictionary), json::Value(std::move(query)));
    if (candidates.empty()) {
      return std::nullopt;
    }
    std::int64_t index = draw.range(0, static_cast<std::int64_t>(candidates.size()) - 1,
                                    {std::string("pattern"), static_cast<double>(bar)});
    return candidates[static_cast<std::size_t>(index)];
  }

  std::vector<json::Value> strokes(const json::Value& entry) const {
    return assert_wire_grid_events(get(get(entry, "material"), "strokes"));
  }

  double span_steps(const json::Value& entry) const {
    return assert_positive_int(get(get(entry, "material"), "steps"), "figure span steps");
  }

  static bool is_ghost(const json::Value& stroke) {
    return js::strict_equals(get(stroke, "articulation"), json::Value("ghost"));
  }

  static std::optional<int> pitch(const json::Value& stroke) {
    const json::Value& voice = get(stroke, "voice");
    return voice.is_string() ? drum_note_of(voice.as_string()) : std::nullopt;
  }

  static json::Value duration(const json::Value& stroke) {
    const json::Value& given = get(stroke, "duration");
    return given.is_null() || is_undefined(given) ? json::Value(STEP_BEATS) : given;
  }

  static double velocity(double base, const json::Value& stroke) {
    return js::multiply(get(stroke, "velocity"), base);
  }

  static std::optional<json::Value> articulation(const json::Value& stroke) {
    const json::Value& given = get(stroke, "articulation");
    return is_undefined(given) ? std::nullopt : std::optional<json::Value>(given);
  }

  bool playable(int pitch) const { return !sounds || sounds(pitch); }
};

//--------------------------------------------------------------------------------------------
// generate/context

void register_context() {
  def("$const:MIN_DIFFICULTY", [](Args&) -> json::Value { return CEILING_MIN_DIFFICULTY; });
  def("$const:MAX_DIFFICULTY", [](Args&) -> json::Value { return CEILING_MAX_DIFFICULTY; });
  def("sustainsStrokes", [](Args& a) -> json::Value {
    if (a.undefined(2) || a.undefined(1)) {
      return true;
    }
    double difficulty =
        assert_range(a[2], CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY, "complexity difficulty");
    double bpm = assert_finite_number(a[1], "bpm");
    double step_beats = assert_finite_number(a[0], "stepBeats");
    return sustains_strokes(step_beats, bpm, difficulty);
  });
  def("sustainsShift", [](Args& a) -> json::Value {
    if (a.undefined(3) || a.undefined(2)) {
      return true;
    }
    double difficulty =
        assert_range(a[3], CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY, "complexity difficulty");
    double bpm = assert_finite_number(a[2], "bpm");
    double semitones = assert_finite_semitones(a[0]);
    double step_beats = assert_finite_number(a[1], "stepBeats");
    return sustains_shift(semitones, step_beats, bpm, difficulty);
  });
  def("resolveContext", [](Args& a) -> json::Value {
    return resolved_context_hybrid(read_generation_context(a, a[0]));
  });
  def("ResolvedContext#part", [](Args& a) -> json::Value {
    a.hybrid(0, "ResolvedContext");
    return resolved_context_part(a[0], a[1]);
  });
  def("ResolvedContext#instrument", [](Args& a) -> json::Value {
    a.hybrid(0, "ResolvedContext");
    const json::Value& instruments = get(a[0], "instruments");
    const json::Value& part = a[1];
    if (instruments.is_null() || is_undefined(instruments) || js::type_of(part) == "symbol") {
      return undefined_value();
    }
    return get(instruments, part.is_string() ? part.as_string() : js::template_string(part));
  });
  for (std::string_view method : kDrawMethods) {
    def("Draw#" + std::string(method), [method](Args& a) -> json::Value {
      a.hybrid(0, "Draw");
      return draw_method(a, a[0], method, rest_of(a, 1));
    });
  }
}

//--------------------------------------------------------------------------------------------
// generate/vocabulary

void register_vocabulary() {
  def("$const:BAR_STEPS", [](Args&) -> json::Value { return to_json(BAR_STEPS); });
  def("$const:BEAT_STEPS", [](Args&) -> json::Value { return to_json(BEAT_STEPS); });
  def("$const:STEP_BEATS", [](Args&) -> json::Value { return STEP_BEATS; });
  def("$const:GENRES", [](Args&) -> json::Value { return names_json(genre_names()); });
  def("$const:PROVENANCE_BASES",
      [](Args&) -> json::Value { return names_json(provenance_basis_names()); });
  def("assertVocabulary", [](Args& a) -> json::Value {
    assert_wire_vocabulary(a[0], name_arg(a, 1, "vocabulary entry"));
    return a[0];
  });
  def("fitsQuery", [](Args& a) -> json::Value { return wire_fits_query(a[0], a[1]); });
  def("selectVocabulary",
      [](Args& a) -> json::Value { return wire_select_vocabulary(a[0], a[1]); });
  def("pickVocabulary", [](Args& a) -> json::Value {
    // Read before the early return: a dictionary that selects nothing must not hide a bad sampler.
    WireDraw sampler = assert_wire_draw(a, a[2]);
    json::Array path = assert_wire_seed_path(a, 3);
    json::Array candidates = wire_select_vocabulary(a[0], a[1]);
    if (candidates.empty()) {
      return undefined_value();
    }
    json::Array args{json::Value(0), json::Value(static_cast<double>(candidates.size()) - 1)};
    args.insert(args.end(), path.begin(), path.end());
    return element_at(candidates, sampler.call("range", args));
  });
  def("mergeVocabulary", [](Args& a) -> json::Value { return wire_merge_vocabulary(a[0], a[1]); });
  def("vocabularyOfKind", [](Args& a) -> json::Value {
    const json::Value& recognises = assert_callable(a[1], "isMaterial");
    json::Array out;
    for (const json::Value& entry : assert_array(a[0], "entries")) {
      const json::Value& material = get(assert_record(entry, "entry"), "material");
      if (js::truthy(call_wire_function(a, recognises, "isMaterial", json::Array{material}))) {
        out.push_back(entry);
      }
    }
    return json::Value(std::move(out));
  });
  def("gridMetricWeight", [](Args& a) -> json::Value {
    // Checked first: a missing step would read as beat 0, the downbeat.
    double step = assert_finite_number(a[0], "step");
    return to_json(step_weight(step, meter_at(0, read_meter_like(a[1], "ts"))));
  });
  def("thin", [](Args& a) -> json::Value {
    std::vector<json::Value> figure = assert_wire_grid_events(a[0]);
    double amount = assert_range(a[1], 0, 1, "thin amount");
    TimeSignature signature = meter_at(0, read_meter_like(a[2], "ts"));
    return events_json(thin_figure<WireGridModel>(figure, amount, signature));
  });
  def("double", [](Args& a) -> json::Value {
    double span = assert_positive_int(arg_or(a, 1, BAR_STEPS), "figure span steps");
    return events_json(double_figure<WireGridModel>(assert_wire_grid_events(a[0]), span));
  });
  def("halfTime", [](Args& a) -> json::Value {
    double span = assert_positive_int(arg_or(a, 1, BAR_STEPS), "figure span steps");
    return events_json(half_time_figure<WireGridModel>(assert_wire_grid_events(a[0]), span));
  });
  def("doubleTime", [](Args& a) -> json::Value {
    double span = assert_positive_int(arg_or(a, 1, BAR_STEPS), "figure span steps");
    return events_json(double_time_figure<WireGridModel>(assert_wire_grid_events(a[0]), span));
  });
  def("syncopate", [](Args& a) -> json::Value {
    std::vector<json::Value> figure = assert_wire_grid_events(a[0]);
    WireDraw sampler = assert_wire_draw(a, a[2]);
    json::Array path = assert_wire_seed_path(a, 3);
    const json::Value& amount = a[1];
    const json::Value* asked =
        js::type_of(amount) == "number" ? nullptr : &assert_record(amount, "amount");
    const json::Value& dial = asked == nullptr ? amount : get(*asked, "amount");
    const json::Value* ts = asked == nullptr ? nullptr : opt_null_default(*asked, "ts");
    TimeSignature signature = ts != nullptr ? meter_at(0, read_meter_like(*ts, "ts"))
                                            : figure_signature(kGenerateDefaultTs);
    double d = assert_range(dial, 0, 1, "syncopate amount");
    return events_json(
        syncopate_figure<WireGridModel>(figure, d, signature, WireSampler{sampler, path}));
  });
  def("ornamentBy", [](Args& a) -> json::Value {
    std::vector<json::Value> figure = assert_wire_grid_events(a[0]);
    const json::Value& marks = assert_callable(a[1], "isOrnament");
    WireDraw sampler = assert_wire_draw(a, a[3]);
    json::Array path = assert_wire_seed_path(a, 4);
    double amount = assert_range(a[2], 0, 1, "ornament amount");
    std::function<bool(const json::Value&)> is_ornament = [&a, &marks](const json::Value& e) {
      return js::truthy(call_wire_function(a, marks, "isOrnament", json::Array{e}));
    };
    return events_json(
        ornament_figure<WireGridModel>(figure, is_ornament, amount, WireSampler{sampler, path}));
  });
  def("deform", [](Args& a) -> json::Value {
    std::vector<json::Value> figure = assert_wire_grid_events(a[0]);
    const json::Value& asked = assert_record(a[1], "opts");
    WireDraw sampler = assert_wire_draw(a, a[2]);
    json::Array path = assert_wire_seed_path(a, 3);
    const json::Value* span_given = opt_strict(asked, "spanSteps");
    double span = assert_positive_int(span_given != nullptr ? *span_given : json::Value(BAR_STEPS),
                                      "figure span steps");
    WireDeformPlan plan{a, asked, opt_null_default(asked, "ts")};
    return events_json(
        deform_figure<WireGridModel>(figure, span, plan, WireSampler{sampler, path}));
  });
  def("withinCeiling", [](Args& a) -> json::Value {
    std::vector<json::Value> figure = assert_wire_grid_events(a[0]);
    if (a.undefined(2) || a.undefined(1)) {
      return true;
    }
    double bpm = assert_finite_number(a[1], "bpm");
    double difficulty =
        assert_range(a[2], CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY, "complexity difficulty");
    return figure_within_ceiling<WireGridModel>(figure, bpm, difficulty);
  });
}

//--------------------------------------------------------------------------------------------
// generate/drums

void register_drums() {
  def("$const:KICK_STEPS", [](Args&) -> json::Value { return to_json(KICK_STEPS); });
  def("$const:DRUM_KIT", [](Args&) -> json::Value { return to_json(DRUM_KIT); });
  def("$const:DRUM_PATTERNS", [](Args&) -> json::Value { return to_json(DRUM_PATTERNS); });
  def("$const:DRUM_NOTES", [](Args&) -> json::Value {
    json::Object o;
    for (const DrumNoteRow& row : kDrumNotes) {
      o.set(std::string(row.voice), row.note);
    }
    return json::Value(std::move(o));
  });
  def("$const:FILL_TYPES", [](Args&) -> json::Value {
    json::Array out;
    for (FillType type : FILL_TYPES) {
      out.emplace_back(to_string(type));
    }
    return json::Value(std::move(out));
  });
  def("$const:FILL_ARCHETYPES", [](Args&) -> json::Value {
    json::Object o;
    for (FillType type : FILL_TYPES) {
      o.set(std::string(to_string(type)), to_json(FILL_ARCHETYPES[static_cast<std::size_t>(type)]));
    }
    return json::Value(std::move(o));
  });
  def("$const:KICK_FIGURES", [](Args&) -> json::Value {
    json::Object o;
    for (const auto& [style, figure] : KICK_FIGURES) {
      o.set(std::string(to_string(style)), to_json(figure));
    }
    return json::Value(std::move(o));
  });
  def("drumVoiceOf", [](Args& a) -> json::Value {
    double pitch = assert_midi_pitch(a[0]);
    std::optional<DrumVoice> voice = drum_voice_of(static_cast<int>(pitch));
    return voice ? json::Value(to_string(*voice)) : undefined_value();
  });
  def("isDrumPattern", [](Args& a) -> json::Value { return wire_is_drum_pattern(a[0]); });
  def("isFillArchetype", [](Args& a) -> json::Value { return wire_is_fill_archetype(a[0]); });
  def("placeDrumPattern", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "drum pattern options");
    double bars = assert_positive_int(get(opts, "bars"), "drum pattern bars");
    assert_generation_budget(json::Value(bars * MAX_STROKES_PER_BAR), "drum pattern hits",
                             get(opts, "budget"));
    PatternPlan plan;
    plan.bars = static_cast<int>(bars);
    plan.genre =
        *parse_genre(assert_one_of(get(opts, "genre"), genre_names(), "drum pattern genre"));
    const json::Value& section = get(opts, "section");
    if (!is_undefined(section)) {
      plan.section =
          *parse_section(assert_one_of(section, section_names(), "drum pattern section"));
    }
    const json::Value* ts = opt_null_default(opts, "ts");
    plan.ts = ts != nullptr ? meter_at(0, read_meter_like(*ts, "ts")) : kGenerateDefaultTs;
    const json::Value& velocity = get(opts, "velocity");
    if (!is_undefined(velocity)) {
      assert_range(velocity, 1, 127, "drum pattern velocity");
    }
    const json::Value& feel = get(opts, "feel");
    plan.feel = is_undefined(feel) ? GrooveFeel::kStraight
                                   : *parse_groove_feel(assert_one_of(feel, feel_names(), "feel"));
    plan.rate = read_figure_rate(opts);
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    plan.bpm = ctx.resolved.bpm.value_or(DRUM_PATTERN_DEFAULT_BPM);
    Draw draw = ctx.resolved.part("drums");
    plan.baseVelocity =
        is_undefined(velocity) ? DRUM_PATTERN_DEFAULT_VELOCITY : *number_of(velocity);
    plan.rhythmic = ctx.resolved.rhythmic;
    plan.ornament = ctx.resolved.ornament;
    plan.difficulty = ctx.resolved.difficulty;
    json::Value kit = ctx.instrument("drums");
    WirePatternModel model{ctx, kit, wire_kit_check(kit)};
    return to_json(place_drum_pattern_with(plan, draw, model));
  });
  def("generateDrums", [](Args& a) -> json::Value {
    const json::Value& opts = assert_record(a[0], "drum options");
    double bars = assert_positive_int(get(opts, "bars"), "drum bars");
    // Generation is linear in bar count, so the estimate is the hit count itself.
    assert_generation_budget(json::Value(bars * MAX_HITS_PER_BAR), "drum hits",
                             get(opts, "budget"));
    DrumsRequest request;
    request.bars = static_cast<int>(bars);
    const json::Value& euclid = get(opts, "euclideanKick");
    if (js::truthy(euclid)) {
      double steps =
          assert_integer(opt_or(euclid, "steps", json::Value(16)), "euclidean steps", 1, 16);
      double pulses = assert_integer(get(euclid, "pulses"), "euclidean pulses");
      double rotation =
          assert_integer(opt_or(euclid, "rotation", json::Value(0)), "euclidean rotation");
      request.euclidean = EuclideanPlan{pulses, steps, rotation};
    }
    request.style =
        *parse_groove_style(assert_one_of(get(opts, "style"), groove_style_names(), "drum style"));
    request.section =
        *parse_section(assert_one_of(get(opts, "section"), section_names(), "drum section"));
    const json::Value& next = get(opts, "nextSection");
    if (!is_undefined(next)) {
      request.nextSection =
          *parse_section(assert_one_of(next, section_names(), "drum nextSection"));
    }
    WireContext ctx = read_generation_context(a, get(opts, "ctx"));
    const json::Value& feel = get(opts, "feel");
    if (!is_undefined(feel)) {
      request.feel = *parse_groove_feel(assert_one_of(feel, feel_names(), "drum feel"));
    }
    const json::Value& role = get(opts, "role");
    request.role = is_undefined(role)
                       ? DrumRole::kFull
                       : *parse_drum_role(assert_one_of(role, drum_role_names(), "drum role"));
    // The groove is written against a four-beat bar, so a meter map is read whole.
    json::Object bag;
    const json::Value& ts = get(opts, "ts");
    if (!is_undefined(ts)) {
      bag.set("ts", ts);
    }
    MeterMap meters = resolve_wire_meters(json::Value(std::move(bag)), "ts");
    for (const MeterChange& change : meters) {
      if (change.ts.numerator != 4 || change.ts.denominator != 4) {
        throw InvalidInputError("drum time signature must be 4/4 throughout; received " +
                                js::to_string(change.ts.numerator) + "/" +
                                js::to_string(change.ts.denominator) + " at beat " +
                                js::to_string(change.startBeat));
      }
    }
    request.ts = meter_at(0, meters);
    request.fills = js::truthy(get(opts, "fills"));
    request.playable = wire_kit_check(ctx.instrument("drums"));
    ctx.resolved.vocabulary = read_fill_vocabulary(ctx.vocabulary);
    return to_json(generate_drums_with(request, ctx.resolved));
  });
}

}  // namespace

void register_g1() {
  register_context();
  register_vocabulary();
  register_drums();
}

}  // namespace cantus::ops
