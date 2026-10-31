#include "ops/codec_g1.h"

#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <variant>

#include "cantus/core/errors.h"
#include "cantus/core/instrument.h"
#include "core/instrument/articulation.h"
#include "core/instrument/profile.h"
#include "core/random/internal.h"
#include "core/validation/validation.h"
#include "generate/context/context.h"
#include "generate/context/draw.h"
#include "generate/drums/fills.h"
#include "generate/drums/internal.h"
#include "generate/vocabulary/types.h"
#include "js/format.h"
#include "js/math.h"
#include "js/number.h"
#include "js/utf16.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a2.h"
#include "ops/codec_t1.h"
#include "ops/error_map.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** `Number.MIN_VALUE`. */
constexpr double kMinValue = std::numeric_limits<double>::denorm_min();

std::string str(std::string_view s) { return std::string(s); }

const json::Value& arg_at(const json::Array& args, std::size_t i) {
  return i < args.size() ? args[i] : undefined_value();
}

/** The `$hy` type name of a hybrid, or empty. */
std::string_view hybrid_type(const json::Value& value) {
  if (tag_of(value) != Tag::kHybrid) {
    return {};
  }
  const json::Value* type = value.as_object().find("$hy");
  return type != nullptr && type->is_string() ? std::string_view(type->as_string())
                                              : std::string_view();
}

bool is_draw_hybrid(const json::Value& value) { return hybrid_type(value) == "Draw"; }

/** The methods a hybrid type carries, by its TS member names. */
std::vector<std::string_view> hybrid_methods(std::string_view type) {
  if (type == "Draw") {
    return {kDrawMethods.begin(), kDrawMethods.end()};
  }
  if (type == "PositionalRng" || type == "ChordTimeline") {
    return {"at"};
  }
  if (type == "ResolvedContext") {
    return {"instrument", "part"};
  }
  return {};
}

/**
 * Whether a hybrid shows a payload field as a property, as its manifest type lists it; the rest of
 * its payload (a supplied source, the instruments) is the core's own and reads as undefined.
 */
bool shows_property(std::string_view type, std::string_view key) {
  static constexpr std::string_view kContextProperties[] = {
      "seed",       "rhythmic", "harmonic",         "ornament",
      "difficulty", "bpm",      "algorithmVersion", "vocabulary"};
  if (type == "ResolvedContext") {
    for (std::string_view known : kContextProperties) {
      if (known == key) {
        return true;
      }
    }
    return false;
  }
  return type == "ChordTimeline" && key == "segments";
}

bool has_hybrid_method(const json::Value& value, std::string_view method) {
  for (std::string_view known : hybrid_methods(hybrid_type(value))) {
    if (known == method) {
      return true;
    }
  }
  return false;
}

/**
 * The method a hybrid in a function position stands for when called as `member`: the method of
 * that name, or the type's only method.
 */
std::string_view stood_for(const json::Value& hybrid, std::string_view member) {
  std::vector<std::string_view> methods = hybrid_methods(hybrid_type(hybrid));
  for (std::string_view known : methods) {
    if (known == member) {
      return known;
    }
  }
  if (methods.size() == 1) {
    return methods[0];
  }
  throw RequestError("a " + js::quote(hybrid_type(hybrid)) + " hybrid has no method " +
                     js::quote(member));
}

/** A seed path over wire segments, read as hashPath reads them. */
SeedPath seed_path_of(const Args& a, const json::Array& segments) {
  json::Array copy = segments;
  Args view(copy, a.context());
  return read_seed_path(view, 0);
}

json::Array path_json(const SeedPath& path) {
  json::Array out;
  for (const SeedSegment& segment : path) {
    if (const std::string* text = std::get_if<std::string>(&segment)) {
      out.emplace_back(*text);
    } else {
      out.emplace_back(std::get<double>(segment));
    }
  }
  return out;
}

/** `prefix` followed by `args[from..]`, as `[...prefix, ...path]` builds it. */
json::Array joined(const json::Array& prefix, const json::Array& args, std::size_t from) {
  json::Array out = prefix;
  for (std::size_t i = from; i < args.size(); ++i) {
    out.push_back(args[i]);
  }
  return out;
}

std::string nullish_name(const json::Value& v) { return v.is_null() ? "null" : "undefined"; }

bool nullish(const json::Value& v) { return v.is_null() || is_undefined(v); }

/** `receiver.includes(search)` for an array or a string; `expression` names the receiver. */
bool includes_value(const json::Value& receiver, const json::Value& search,
                    std::string_view expression) {
  if (nullish(receiver)) {
    throw js::TypeError("Cannot read properties of " + nullish_name(receiver) +
                        " (reading 'includes')");
  }
  if (receiver.is_array()) {
    for (const json::Value& element : receiver.as_array()) {
      if (js::same_value_zero(element, search)) {
        return true;
      }
    }
    return false;
  }
  if (receiver.is_string()) {
    std::u16string text = js::to_utf16(receiver.as_string());
    std::u16string needle = js::to_utf16(js::template_string(search));
    return text.find(needle) != std::u16string::npos;
  }
  throw js::TypeError(str(expression) + ".includes is not a function");
}

/** `const [low, high] = value` for an iterable wire value. */
std::pair<json::Value, json::Value> first_two(const json::Value& value) {
  if (value.is_array()) {
    const json::Array& items = value.as_array();
    return {items.size() > 0 ? items[0] : undefined_value(),
            items.size() > 1 ? items[1] : undefined_value()};
  }
  if (value.is_string()) {
    // A string iterates by code point: a surrogate pair is one element, a lone surrogate another.
    std::vector<json::Value> points;
    std::u16string units = js::to_utf16(value.as_string());
    for (std::size_t i = 0; i < units.size() && points.size() < 2;) {
      bool pair = units[i] >= 0xd800 && units[i] <= 0xdbff && i + 1 < units.size() &&
                  units[i + 1] >= 0xdc00 && units[i + 1] <= 0xdfff;
      std::size_t width = pair ? 2 : 1;
      points.emplace_back(js::from_utf16(std::u16string_view(units).substr(i, width)));
      i += width;
    }
    while (points.size() < 2) {
      points.push_back(undefined_value());
    }
    return {points[0], points[1]};
  }
  std::string type = js::type_of(value);
  std::string shown = type;
  if (type == "number" || type == "boolean") {
    shown += " " + js::template_string(value);
  }
  throw js::TypeError(shown + " is not iterable (cannot read property Symbol(Symbol.iterator))");
}

/** `assertNames(values, allowed, label)` of assertVocabulary. */
void assert_names(const json::Value& values, const std::vector<std::string_view>& allowed,
                  const std::string& label) {
  if (!values.is_array()) {
    throw InvalidInputError(label + " must be an array of names; received " +
                            describe_rejected(values));
  }
  const json::Array& names = values.as_array();
  for (std::size_t index = 0; index < names.size(); ++index) {
    assert_one_of(names[index], allowed, label + "[" + index_text(index) + "]");
  }
}

std::vector<std::string_view> chord_quality_names() {
  std::vector<std::string_view> names;
  for (ChordQuality quality : chord_qualities()) {
    names.push_back(to_string(quality));
  }
  return names;
}

/** The stream an onset belongs to: `event.limb ?? event.voice ?? ''`. */
const json::Value& stream_of(const json::Value& e) {
  static const json::Value kNone{std::string()};
  const json::Value& limb = get(e, "limb");
  if (!nullish(limb)) {
    return limb;
  }
  const json::Value& voice = get(e, "voice");
  return nullish(voice) ? kNone : voice;
}

}  // namespace

void write_fields(const DrumVocabulary& v, FieldWriter& w) {
  w.field("id", v.id);
  w.field("genre", v.genre);
  w.field("difficulty", v.difficulty);
  w.field("articulations", v.articulations);
  w.field("ts", v.ts);
  if (v.tempoRange) {
    w.field("tempoRange", std::vector<double>{(*v.tempoRange)[0], (*v.tempoRange)[1]});
  }
  w.field("material", v.material);
  w.field("provenance", v.provenance);
  w.field("sections", v.sections);
  w.field("fitsOver", v.fitsOver);
}

//--------------------------------------------------------------------------------------------
// Positional sources and samplers

WireRng::WireRng(const Args& args, json::Value rng)
    : args_(&args), rng_(std::make_shared<const json::Value>(std::move(rng))) {}

json::Value WireRng::at(const json::Array& path) const {
  const json::Value& rng = *rng_;
  if (is_positional_rng_hybrid(rng)) {
    return json::Value(read_positional_rng(rng).at(seed_path_of(*args_, path)));
  }
  if (is_draw_hybrid(rng)) {
    return draw_method(*args_, rng, "at", path);
  }
  // A text or a list has an `at` of its own, which indexes it by the first segment.
  if (rng.is_string() || rng.is_array()) {
    return indexed_at(rng, path.empty() ? std::nan("") : js::to_number(path[0]));
  }
  if (nullish(rng)) {
    throw js::TypeError("Cannot read properties of " + nullish_name(rng) + " (reading 'at')");
  }
  if (rng.is_object() && tag_of(rng) != Tag::kHybrid) {
    const json::Value& at = get(rng, "at");
    if (is_wire_function(at)) {
      return call_wire_function(*args_, at, "at", path);
    }
  }
  throw js::TypeError("rng.at is not a function");
}

PositionalDraw WireRng::positional() const {
  if (is_positional_rng_hybrid(*rng_)) {
    PositionalRng rng = read_positional_rng(*rng_);
    return [rng](const SeedPath& path) { return rng.at(path); };
  }
  WireRng self = *this;
  return [self](const SeedPath& path) { return js::to_number(draw_from(self, path_json(path))); };
}

json::Value draw_from(const WireRng& rng, const json::Array& path) {
  json::Value draw = rng.at(path);
  if (!(js::less_equal(json::Value(0), draw) && js::less_than(draw, json::Value(1)))) {
    throw InvalidInputError("positional draw must be in [0, 1); received " +
                            js::template_string(draw));
  }
  return draw;
}

json::Value draw_hybrid(json::Value rng, json::Array prefix) {
  json::Object o;
  o.set("$hy", "Draw");
  o.set("rng", std::move(rng));
  o.set("path", json::Value(std::move(prefix)));
  return json::Value(std::move(o));
}

json::Value draw_method(const Args& a, const json::Value& draw, std::string_view method,
                        const json::Array& args) {
  const json::Value& prefix = get(draw, "path");
  if (!prefix.is_array()) {
    throw RequestError("a Draw hybrid needs a path");
  }
  WireRng source(a, get(draw, "rng"));
  if (method == "at") {
    return draw_from(source, joined(prefix.as_array(), args, 0));
  }
  if (method == "prob") {
    // `includeAt(rng, p, ...prefix, ...path)`.
    double p = assert_range(arg_at(args, 0), 0, 1, "complexity");
    json::Value drawn = draw_from(source, joined(prefix.as_array(), args, 1));
    return json::Value(js::less_than(drawn, json::Value(p)));
  }
  if (method == "range") {
    double lo = assert_integer(arg_at(args, 0), "range lower bound");
    double hi = assert_integer(arg_at(args, 1), "range upper bound");
    if (lo > hi) {
      throw InvalidInputError("range lower bound must not exceed upper bound; received " +
                              js::to_string(lo) + " > " + js::to_string(hi));
    }
    // A span that is not itself a safe integer would be sampled at reduced precision.
    assert_integer(json::Value(hi - lo), "range span", 0);
    json::Value drawn = draw_from(source, joined(prefix.as_array(), args, 2));
    return json::Value(lo + std::floor(js::multiply(drawn, hi - lo + 1)));
  }
  if (method == "float") {
    double lo = assert_finite_number(arg_at(args, 0), "float lower bound");
    double hi = assert_finite_number(arg_at(args, 1), "float upper bound");
    if (lo > hi) {
      throw InvalidInputError("float lower bound must not exceed upper bound; received " +
                              js::to_string(lo) + " > " + js::to_string(hi));
    }
    assert_finite_number(json::Value(hi - lo), "float span");
    json::Value drawn = draw_from(source, joined(prefix.as_array(), args, 2));
    return json::Value(scale_unit_draw(js::to_number(drawn), lo, hi));
  }
  throw RequestError("a Draw hybrid has no method " + js::quote(method));
}

bool is_wire_function(const json::Value& value) {
  return js::type_of(value) == "function" || tag_of(value) == Tag::kHybrid;
}

json::Value call_wire_function(const Args& a, const json::Value& fn, std::string_view member,
                               const json::Array& args) {
  if (tag_of(fn) == Tag::kCallback) {
    return a.callback(fn)(args);
  }
  std::string_view type = hybrid_type(fn);
  std::string_view method = stood_for(fn, member);
  if (type == "Draw") {
    return draw_method(a, fn, method, args);
  }
  if (type == "PositionalRng") {
    return json::Value(read_positional_rng(fn).at(seed_path_of(a, args)));
  }
  throw RequestError("a " + js::quote(type) + " hybrid cannot be called as " + js::quote(member));
}

json::Value WireDraw::call(std::string_view method, const json::Array& args) const {
  if (has_hybrid_method(*draw_, method)) {
    return call_wire_function(*args_, *draw_, method, args);
  }
  return call_wire_function(*args_, get(*draw_, method), method, args);
}

WireDraw assert_wire_draw(const Args& a, const json::Value& draw, std::string_view name) {
  const json::Value& sampler = assert_record(draw, name);
  for (std::string_view method : kDrawMethods) {
    if (!has_hybrid_method(sampler, method)) {
      const json::Value& member = get(sampler, method);
      if (!is_wire_function(member)) {
        assert_function(member, str(name) + "." + str(method));
      }
    }
  }
  return WireDraw(a, sampler);
}

json::Array assert_wire_seed_path(const Args& a, std::size_t from, std::string_view name) {
  json::Array path;
  for (std::size_t i = from; i < a.size(); ++i) {
    const json::Value& step = a[i];
    std::optional<double> number = js::type_of(step) == "number" ? number_of(step) : std::nullopt;
    if (!step.is_string() && !(number && std::isfinite(*number))) {
      throw InvalidInputError(str(name) + "[" + index_text(i - from) +
                              "] must be a string or a finite number; received " +
                              describe_rejected(step));
    }
    path.push_back(step);
  }
  return path;
}

bool WireSampler::prob(double p, const SeedPath& key) const {
  json::Array args{json::Value(p)};
  args.insert(args.end(), path.begin(), path.end());
  for (const SeedSegment& segment : key) {
    if (const std::string* name = std::get_if<std::string>(&segment)) {
      args.emplace_back(*name);
    } else {
      args.emplace_back(std::get<double>(segment));
    }
  }
  return js::truthy(draw.call("prob", args));
}

//--------------------------------------------------------------------------------------------
// The generation context

json::Value WireContext::instrument(std::string_view part) const {
  if (nullish(instruments)) {
    return undefined_value();
  }
  return get(instruments, part);
}

WireContext read_generation_context(const Args& a, const json::Value& input) {
  bool numeric = js::type_of(input) == "number";
  // Absent is the default context; a null passed on by a caller that had none is refused.
  if (!input.is_null() && !numeric && !is_undefined(input)) {
    assert_record(input, "ctx");
  }
  if (input.is_null()) {
    throw InvalidInputError("ctx must be a seed or a generation context; received null");
  }
  // `typeof input === 'number' ? { seed: input } : (input ?? { seed: DEFAULT_SEED })`.
  auto field_of = [&](std::string_view key) -> const json::Value& {
    static const json::Value kDefaultSeed{static_cast<double>(CONTEXT_DEFAULT_SEED)};
    if (numeric || is_undefined(input)) {
      if (key != "seed") {
        return undefined_value();
      }
      return numeric ? input : kDefaultSeed;
    }
    // A context handed back is read through its properties alone.
    if (tag_of(input) == Tag::kHybrid && !shows_property(hybrid_type(input), key)) {
      return undefined_value();
    }
    return get(input, key);
  };
  WireContext out;
  GenerationContext typed;
  const json::Value& given_seed = field_of("seed");
  out.seed =
      nullish(given_seed) ? json::Value(static_cast<double>(CONTEXT_DEFAULT_SEED)) : given_seed;
  typed.seed = static_cast<std::uint32_t>(assert_integer(out.seed, "seed", 0, 4294967295.0));
  const json::Value& given_complexity = field_of("complexity");
  static const json::Value kNoComplexity{json::Object()};
  const json::Value& complexity =
      nullish(given_complexity) ? kNoComplexity : assert_record(given_complexity, "ctx.complexity");
  Complexity dials;
  auto dial = [&](std::string_view key, json::Value& kept, std::optional<double>& value,
                  std::string_view name) {
    const json::Value& given = get(complexity, key);
    if (!is_undefined(given)) {
      value = assert_range(given, 0, 1, name);
      kept = given;
    }
  };
  out.rhythmic = undefined_value();
  out.harmonic = undefined_value();
  out.ornament = undefined_value();
  out.difficulty = undefined_value();
  out.bpm = undefined_value();
  dial("rhythmic", out.rhythmic, dials.rhythmic, "complexity rhythmic");
  dial("harmonic", out.harmonic, dials.harmonic, "complexity harmonic");
  dial("ornament", out.ornament, dials.ornament, "complexity ornament");
  const json::Value& difficulty = get(complexity, "difficulty");
  if (!is_undefined(difficulty)) {
    dials.difficulty = assert_range(difficulty, CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY,
                                    "complexity difficulty");
    out.difficulty = difficulty;
  }
  typed.complexity = dials;
  const json::Value& bpm = field_of("bpm");
  if (!is_undefined(bpm)) {
    typed.bpm = assert_range(bpm, kMinValue, 1000, "bpm");
    out.bpm = bpm;
  }
  const json::Value& version = field_of("algorithmVersion");
  if (!is_undefined(version)) {
    typed.algorithmVersion =
        static_cast<std::int64_t>(assert_integer(version, "algorithm version"));
  }
  out.rng = field_of("rng");
  // A falsy source means none was supplied; anything else has to be one.
  if (js::truthy(out.rng)) {
    assert_record(out.rng, "ctx.rng");
    if (!is_positional_rng_hybrid(out.rng) && !is_draw_hybrid(out.rng)) {
      assert_function(get(out.rng, "at"), "ctx.rng.at");
    }
  }
  out.instruments = field_of("instruments");
  if (!nullish(out.instruments)) {
    assert_record(out.instruments, "ctx.instruments");
  }
  // Validated on the way in: an entry naming a difficulty of 40 would clear every ceiling.
  const json::Value& vocabulary = field_of("vocabulary");
  if (!nullish(vocabulary)) {
    const json::Array& entries = assert_array(vocabulary, "ctx.vocabulary");
    for (std::size_t index = 0; index < entries.size(); ++index) {
      out.vocabulary.push_back(
          assert_wire_vocabulary(entries[index], "vocabulary[" + index_text(index) + "]"));
    }
  }
  if (js::truthy(out.rng)) {
    typed.rng = WireRng(a, out.rng).positional();
  }
  out.resolved = resolve_context(GenerationContextInput(std::move(typed)));
  return out;
}

json::Value resolved_context_hybrid(const WireContext& ctx) {
  json::Object o;
  o.set("$hy", "ResolvedContext");
  o.set("seed", ctx.seed);
  auto given = [&o](const char* key, const json::Value& value) {
    if (!is_undefined(value)) {
      o.set(key, value);
    }
  };
  given("rhythmic", ctx.rhythmic);
  given("harmonic", ctx.harmonic);
  given("ornament", ctx.ornament);
  given("difficulty", ctx.difficulty);
  given("bpm", ctx.bpm);
  o.set("algorithmVersion", static_cast<double>(ctx.resolved.algorithmVersion));
  o.set("vocabulary", json::Value(ctx.vocabulary));
  if (!is_undefined(ctx.instruments)) {
    o.set("instruments", ctx.instruments);
  }
  if (!is_undefined(ctx.rng)) {
    o.set("rng", ctx.rng);
  }
  return json::Value(std::move(o));
}

json::Value resolved_context_part(const json::Value& context, const json::Value& name) {
  std::optional<double> version = number_of(get(context, "algorithmVersion"));
  std::optional<double> seed = number_of(get(context, "seed"));
  if (!version || !seed) {
    throw RequestError("a ResolvedContext hybrid needs a numeric seed and algorithm version");
  }
  json::Array prefix{name, json::Value(str(kVersionSegment)), json::Value(*version)};
  const json::Value& supplied = get(context, "rng");
  if (js::truthy(supplied)) {
    return draw_hybrid(supplied, std::move(prefix));
  }
  CallContext none;
  Args view(prefix, none);
  SeedPath path = read_seed_path(view, 0);
  std::uint32_t derived = derive_seed(js::to_uint32(*seed), path);
  return draw_hybrid(positional_rng_hybrid(derived), json::Array());
}

//--------------------------------------------------------------------------------------------
// Figures and vocabulary

double WireGridModel::step(const json::Value& e) { return *number_of(get(e, "step")); }

json::Value WireGridModel::velocity(const json::Value& e) { return get(e, "velocity"); }

json::Value WireGridModel::scaled(const json::Value& v, double factor) {
  return json::Value(js::multiply(v, factor));
}

bool WireGridModel::louder(const json::Value& a, const json::Value& b) {
  return js::greater_than(a, b);
}

std::string WireGridModel::stream_text(const json::Value& e) {
  return js::template_string(stream_of(e));
}

const json::Value* WireGridModel::stream_key(const json::Value& e) { return &stream_of(e); }

bool WireGridModel::same_stream(const json::Value* a, const json::Value* b) {
  return js::same_value_zero(*a, *b);
}

json::Value WireGridModel::placed(const json::Value& e, double at) {
  json::Value out = e;
  out.as_object().set("step", json::Value(at));
  return out;
}

json::Value WireGridModel::placed(const json::Value& e, double at, const json::Value& v) {
  json::Value out = placed(e, at);
  // An undefined velocity is a key the wire leaves out.
  if (!is_undefined(v)) {
    out.as_object().set("velocity", v);
  }
  return out;
}

std::vector<json::Value> assert_wire_grid_events(const json::Value& events) {
  const json::Array& list = assert_array(events, "figure events");
  for (std::size_t index = 0; index < list.size(); ++index) {
    std::string name = "figure events[" + index_text(index) + "]";
    assert_record(list[index], name);
    assert_finite_number(get(list[index], "step"), name + ".step");
  }
  return list;
}

/**
 * `sameTs`'s grouping half over an entry's wire grouping: equal when neither side states one, or
 * both state the same list.
 */
bool wire_same_grouping(const json::Value& own, const std::optional<std::vector<int>>& asked) {
  if (is_undefined(own) || !asked) {
    return is_undefined(own) && !asked;
  }
  if (!own.is_array() || own.as_array().size() != asked->size()) {
    return false;
  }
  for (std::size_t index = 0; index < asked->size(); ++index) {
    if (!js::strict_equals(own.as_array()[index], json::Value((*asked)[index]))) {
      return false;
    }
  }
  return true;
}

bool wire_fits_query(const json::Value& entry, const json::Value& query) {
  const json::Value& candidate = assert_record(entry, "vocabulary entry");
  const json::Value& asked = assert_record(query, "vocabulary query");
  const json::Value& genre = get(asked, "genre");
  if (!is_undefined(genre) && !js::strict_equals(get(candidate, "genre"), genre)) {
    return false;
  }
  const json::Value& section = get(asked, "section");
  const json::Value& sections = get(candidate, "sections");
  if (!is_undefined(section) && js::truthy(sections) &&
      !includes_value(sections, section, "candidate.sections")) {
    return false;
  }
  const json::Value& bpm = get(asked, "bpm");
  const json::Value& tempo_range = get(candidate, "tempoRange");
  if (!is_undefined(bpm) && js::truthy(tempo_range)) {
    auto [low, high] = first_two(tempo_range);
    if (js::less_than(bpm, low) || js::greater_than(bpm, high)) {
      return false;
    }
  }
  const json::Value& ts = get(asked, "ts");
  const json::Value& own_ts = get(candidate, "ts");
  if (!is_undefined(ts) && js::truthy(own_ts)) {
    TimeSignature signature = meter_at(0, read_meter_like(ts, "ts"));
    if (!(js::strict_equals(get(own_ts, "numerator"), json::Value(signature.numerator)) &&
          js::strict_equals(get(own_ts, "denominator"), json::Value(signature.denominator)) &&
          wire_same_grouping(get(own_ts, "grouping"), signature.grouping))) {
      return false;
    }
  }
  const json::Value& quality = get(asked, "quality");
  const json::Value& fits_over = get(candidate, "fitsOver");
  if (!is_undefined(quality) && js::truthy(fits_over) &&
      !includes_value(fits_over, quality, "candidate.fitsOver")) {
    return false;
  }
  const json::Value& available = get(asked, "articulations");
  if (!is_undefined(available)) {
    const json::Value& needed = get(candidate, "articulations");
    if (nullish(needed)) {
      throw js::TypeError("Cannot read properties of " + nullish_name(needed) +
                          " (reading 'some')");
    }
    if (!needed.is_array()) {
      throw js::TypeError("candidate.articulations.some is not a function");
    }
    for (const json::Value& articulation : needed.as_array()) {
      if (!includes_value(available, articulation, "available")) {
        return false;
      }
    }
  }
  // The ceiling is the caller's limit, and it only ever takes candidates away.
  const json::Value& ceiling = get(asked, "difficulty");
  return is_undefined(ceiling) || js::less_equal(get(candidate, "difficulty"), ceiling);
}

json::Array wire_select_vocabulary(const json::Value& dictionary, const json::Value& query) {
  json::Array out;
  for (const json::Value& entry : assert_array(dictionary, "dictionary")) {
    if (wire_fits_query(entry, query)) {
      out.push_back(entry);
    }
  }
  return out;
}

json::Array wire_merge_vocabulary(const json::Value& built_in, const json::Value& supplied) {
  const json::Array& library = assert_array(built_in, "builtIn");
  static const json::Array kNone;
  const json::Array& extra = nullish(supplied) ? kNone : assert_array(supplied, "supplied");
  if (extra.empty()) {
    return library;
  }
  // The id decides a replacement, so every entry on both sides is read as a record first.
  auto id_of = [](const json::Value& entry, std::size_t index,
                  std::string_view side) -> const json::Value& {
    return get(assert_record(entry, str(side) + "[" + index_text(index) + "]"), "id");
  };
  // `new Map(...)`: a repeated id keeps its first position and its last entry.
  std::vector<std::pair<const json::Value*, const json::Value*>> by_id;
  for (std::size_t index = 0; index < extra.size(); ++index) {
    const json::Value& id = id_of(extra[index], index, "supplied");
    bool replaced = false;
    for (auto& held : by_id) {
      if (js::same_value_zero(*held.first, id)) {
        held.second = &extra[index];
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      by_id.emplace_back(&id, &extra[index]);
    }
  }
  auto replacement = [&by_id](const json::Value& id) -> const json::Value* {
    for (const auto& held : by_id) {
      if (js::same_value_zero(*held.first, id)) {
        return held.second;
      }
    }
    return nullptr;
  };
  json::Array merged;
  for (std::size_t index = 0; index < library.size(); ++index) {
    const json::Value* chosen = replacement(id_of(library[index], index, "builtIn"));
    merged.push_back(chosen != nullptr ? *chosen : library[index]);
  }
  std::vector<const json::Value*> replaced_ids;
  for (std::size_t index = 0; index < library.size(); ++index) {
    replaced_ids.push_back(&id_of(library[index], index, "builtIn"));
  }
  for (const json::Value& entry : extra) {
    const json::Value& id = get(entry, "id");
    bool replaces = false;
    for (const json::Value* own : replaced_ids) {
      replaces = replaces || js::same_value_zero(*own, id);
    }
    if (!replaces) {
      merged.push_back(entry);
    }
  }
  return merged;
}

const json::Value& assert_wire_vocabulary(const json::Value& entry, std::string_view label) {
  std::string name(label);
  // The names are checked against the tables that define them.
  if (!is_js_object(entry)) {
    throw InvalidInputError(name + " must be a dictionary entry; received " +
                            describe_rejected(entry));
  }
  assert_one_of(get(entry, "genre"), genre_names(), name + " genre");
  const json::Value& provenance = get(entry, "provenance");
  assert_one_of(nullish(provenance) ? undefined_value() : get(provenance, "basis"),
                provenance_basis_names(), name + " provenance basis");
  assert_names(get(entry, "articulations"), articulation_names(), name + " articulations");
  const json::Value& sections = get(entry, "sections");
  if (!is_undefined(sections)) {
    assert_names(sections, section_names(), name + " sections");
  }
  const json::Value& fits_over = get(entry, "fitsOver");
  if (!is_undefined(fits_over)) {
    assert_names(fits_over, chord_quality_names(), name + " fitsOver");
  }
  const json::Value& ts = get(entry, "ts");
  if (!is_undefined(ts)) {
    assert_time_signature(ts, name + " ts");
  }
  assert_range(get(entry, "difficulty"), 1, 5, name + " difficulty");
  const json::Value& tempo_range = get(entry, "tempoRange");
  if (!is_undefined(tempo_range)) {
    if (!tempo_range.is_array() || tempo_range.as_array().size() != 2) {
      throw InvalidInputError(name + " tempoRange must be a low and a high tempo; received " +
                              describe_rejected(tempo_range));
    }
    const json::Value& low = tempo_range.as_array()[0];
    const json::Value& high = tempo_range.as_array()[1];
    assert_range(low, kMinValue, 1000, name + " tempoRange low");
    assert_range(high, low, json::Value(1000), name + " tempoRange high");
  }
  return entry;
}

bool wire_is_drum_pattern(const json::Value& material) {
  return is_js_object(material) && js::type_of(get(material, "steps")) == "number" &&
         get(material, "strokes").is_array();
}

bool wire_is_fill_archetype(const json::Value& material) {
  return is_js_object(material) && get(material, "atBeat").is_array();
}

//--------------------------------------------------------------------------------------------
// Generator inputs

std::function<bool(int)> wire_kit_check(const json::Value& kit) {
  if (is_undefined(kit)) {
    return {};
  }
  auto given = std::make_shared<const json::Value>(kit);
  auto profile = std::make_shared<std::optional<InstrumentProfile>>();
  return [given, profile](int pitch) {
    if (!*profile) {
      *profile = read_instrument_profile(*given, "instrument");
    }
    assert_midi_pitch(pitch, "pitch");
    return sounds_in(**profile, pitch);
  };
}

Vocabulary<std::any> read_vocabulary_header(const json::Value& entry, std::size_t index) {
  Vocabulary<std::any> typed;
  const json::Value& id = get(entry, "id");
  // An id that is not text cannot meet a built-in name; it stays distinct from every other id.
  typed.id = id.is_string() ? id.as_string() : std::string("\x01") + index_text(index);
  typed.genre = *parse_genre(get(entry, "genre").as_string());
  for (const json::Value& name : get(entry, "articulations").as_array()) {
    typed.articulations.push_back(*parse_articulation(name.as_string()));
  }
  const json::Value& fits_over = get(entry, "fitsOver");
  if (fits_over.is_array()) {
    typed.fitsOver.emplace();
    for (const json::Value& name : fits_over.as_array()) {
      for (ChordQuality quality : chord_qualities()) {
        if (to_string(quality) == name.as_string()) {
          typed.fitsOver->push_back(quality);
        }
      }
    }
  }
  const json::Value& sections = get(entry, "sections");
  if (sections.is_array()) {
    typed.sections.emplace();
    for (const json::Value& name : sections.as_array()) {
      typed.sections->push_back(*parse_section(name.as_string()));
    }
  }
  const json::Value& tempo_range = get(entry, "tempoRange");
  if (tempo_range.is_array()) {
    typed.tempoRange = std::array<double, 2>{*number_of(tempo_range.as_array()[0]),
                                             *number_of(tempo_range.as_array()[1])};
  }
  const json::Value& ts = get(entry, "ts");
  if (!is_undefined(ts)) {
    typed.ts = assert_time_signature(ts, "ts");
  }
  typed.difficulty = *number_of(get(entry, "difficulty"));
  return typed;
}

std::vector<Vocabulary<std::any>> read_fill_vocabulary(const json::Array& entries) {
  std::vector<Vocabulary<std::any>> out;
  for (std::size_t index = 0; index < entries.size(); ++index) {
    const json::Value& entry = entries[index];
    const json::Value& material = get(entry, "material");
    if (!wire_is_fill_archetype(material)) {
      continue;
    }
    std::string label = "drum fill vocabulary[" + index_text(out.size()) + "]";
    FillArchetype shape;
    const json::Array& beats = get(material, "atBeat").as_array();
    for (std::size_t beat = 0; beat < beats.size(); ++beat) {
      const json::Array& given =
          assert_array(beats[beat], label + " atBeat[" + index_text(beat) + "]");
      std::vector<FillStroke> strokes;
      for (std::size_t at = 0; at < given.size(); ++at) {
        std::string name = label + " atBeat[" + index_text(beat) + "][" + index_text(at) + "]";
        const json::Value& record = assert_record(given[at], name);
        FillStroke stroke;
        stroke.voice = static_cast<int>(assert_midi_pitch(get(record, "voice"), name + ".voice"));
        stroke.offset = assert_finite_number(get(record, "offset"), name + ".offset");
        stroke.duration = assert_finite_number(get(record, "duration"), name + ".duration");
        const json::Value& velocity = assert_record(get(record, "velocity"), name + ".velocity");
        stroke.velocity.base = *parse_fill_velocity_base(assert_one_of(
            get(velocity, "base"), fill_velocity_base_names(), name + ".velocity.base"));
        const json::Value& scale = get(velocity, "scale");
        if (!is_undefined(scale)) {
          stroke.velocity.scale = assert_finite_number(scale, name + ".velocity.scale");
        }
        const json::Value& offset = get(velocity, "offset");
        if (!is_undefined(offset)) {
          stroke.velocity.offset = assert_range(offset, -127, 127, name + ".velocity.offset");
        }
        const json::Value& articulation = get(record, "articulation");
        if (!is_undefined(articulation)) {
          stroke.articulation = parse_articulation(
              assert_one_of(articulation, articulation_names(), name + ".articulation"));
        }
        strokes.push_back(stroke);
      }
      shape.atBeat.push_back(std::move(strokes));
    }
    if (js::truthy(get(material, "boundToBar"))) {
      shape.boundToBar = true;
    }
    Vocabulary<std::any> typed = read_vocabulary_header(entry, index);
    typed.material = std::move(shape);
    out.push_back(std::move(typed));
  }
  return out;
}

json::Value events_json(std::vector<json::Value> events) {
  return json::Value(
      json::Array(std::make_move_iterator(events.begin()), std::make_move_iterator(events.end())));
}

/** `assertFunction(value, name)`, where a hybrid standing for a method is a function too. */
const json::Value& assert_callable(const json::Value& value, std::string_view name) {
  return is_wire_function(value) ? value : assert_function(value, name);
}

/** `assertOneOf(opts.rate ?? 'straight', FIGURE_RATES, 'rate')`. */
FigureRate read_figure_rate(const json::Value& opts) {
  return *parse_figure_rate(assert_one_of(opt_or(opts, "rate", to_string(FigureRate::kStraight)),
                                          figure_rate_names(), "rate"));
}

FigureRate WireDeformPlan::rate() const { return read_figure_rate(asked); }

std::optional<double> WireDeformPlan::rhythmic() const {
  const json::Value* given = opt_strict(asked, "rhythmic");
  if (given == nullptr) {
    return std::nullopt;
  }
  return assert_range(*given, 0, 1, "complexity rhythmic");
}

TimeSignature WireDeformPlan::signature() const {
  return ts != nullptr ? meter_at(0, read_meter_like(*ts, "ts")) : figure_signature(kFigureTs);
}

std::optional<OrnamentRequest<WireGridModel>> WireDeformPlan::ornament() const {
  const json::Value& amount = get(asked, "ornament");
  std::optional<double> checked;
  if (!is_undefined(amount)) {
    checked = assert_range(amount, 0, 1, "ornament amount");
  }
  const json::Value& test = get(asked, "isOrnament");
  if (!js::truthy(test)) {
    return std::nullopt;
  }
  assert_callable(test, "opts.isOrnament");
  if (!checked) {
    return std::nullopt;
  }
  const Args& args = a;
  const json::Value& marks = test;
  std::function<bool(const json::Value&)> is_ornament = [&args, &marks](const json::Value& e) {
    return js::truthy(call_wire_function(args, marks, "isOrnament", json::Array{e}));
  };
  return OrnamentRequest<WireGridModel>{is_ornament, *checked};
}

}  // namespace cantus::ops
