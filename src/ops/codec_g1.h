/**
 * @file codec_g1.h
 * @brief Wire codec of the types of generate (layer root), generate/context, generate/vocabulary,
 *        generate/drums: output fields, and the readers every generator adapter shares.
 *
 * - The context: read_generation_context() replays `resolveContext` over a wire value and keeps
 *   what the ResolvedContext hybrid carries as given (`seed`, the dials, `instruments`, `rng`, the
 *   validated vocabulary entries). Its `resolved` member is the typed context a generator runs on;
 *   a supplied `rng` reaches it as a PositionalDraw that calls back into the host where needed.
 * - Positional sources and samplers: WireRng is `rng.at(...path)` for any source the host passed;
 *   WireDraw is a sampler set as assertDraw reads it (a Draw hybrid, or an object whose members
 *   are callbacks or hybrid methods); draw_method() is one Draw method over its hybrid payload.
 * - Figures: WireGridModel is the grid model of generate/vocabulary/transform.h over wire onsets,
 *   which keeps every field a caller wrote and reads `velocity`, `limb` and `voice` as JS does.
 * - Vocabulary: the loose twins of fitsQuery, selectVocabulary, mergeVocabulary and
 *   assertVocabulary over wire entries, which TS reads field by field with JS semantics.
 */
#ifndef CANTUS_SRC_OPS_CODEC_G1_H_
#define CANTUS_SRC_OPS_CODEC_G1_H_

#include <any>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/core/random.h"
#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "cantus/generate/vocabulary.h"
#include "json/json.h"
#include "ops/args.h"
#include "ops/codec.h"
#include "ops/codec_c1.h"
#include "ops/codec_c2.h"

namespace cantus {

inline json::Value to_json(Genre genre) { return json::Value(to_string(genre)); }
inline json::Value to_json(ProvenanceBasis basis) { return json::Value(to_string(basis)); }
inline json::Value to_json(Section section) { return json::Value(to_string(section)); }
inline json::Value to_json(DrumVoice voice) { return json::Value(to_string(voice)); }
inline json::Value to_json(FillVelocityBase base) { return json::Value(to_string(base)); }

}  // namespace cantus

namespace cantus::ops {

CANTUS_JSON_FIELDS(DrumHit, pitch, startBeat, durationBeat, velocity, articulation)
CANTUS_JSON_FIELDS(Provenance, basis, note)
CANTUS_JSON_FIELDS(DrumStroke, voice, step, velocity, duration, articulation, limb)
CANTUS_JSON_FIELDS(DrumPattern, steps, strokes)
CANTUS_JSON_FIELDS(FillVelocity, base, scale, offset)
CANTUS_JSON_FIELDS(FillStroke, voice, offset, duration, velocity, articulation)
CANTUS_JSON_FIELDS(FillArchetype, atBeat, boundToBar)
// The built-in figures state `sections` before `barParity`.
CANTUS_JSON_FIELDS(KickSlot, step, probability, slot, sections, barParity)

/** A drum pattern entry, in the field order the built-in dictionary writes. */
void write_fields(const DrumVocabulary& v, FieldWriter& w);

//--------------------------------------------------------------------------------------------
// Positional sources and samplers

/** A positional source the host passed, read the way `rng.at(...path)` reads it. */
class WireRng {
 public:
  WireRng(const Args& args, json::Value rng);

  /**
   * `rng.at(...path)`: the raw draw, as the source returned it.
   * @throws js::TypeError when the source has no `at` to call.
   */
  json::Value at(const json::Array& path) const;

  /** The source as a PositionalDraw: each draw held to [0, 1) (`drawFrom`), then read as a number.
   */
  PositionalDraw positional() const;

 private:
  const Args* args_;
  std::shared_ptr<const json::Value> rng_;
};

/**
 * `drawFrom(rng, path)`: the raw draw at a path.
 * @throws InvalidInputError if the draw is not in [0, 1).
 */
json::Value draw_from(const WireRng& rng, const json::Array& path);

/** The wire form of a Draw: `{"$hy": "Draw", "rng", "path"}`. */
json::Value draw_hybrid(json::Value rng, json::Array prefix);

/**
 * One Draw method (`at`, `prob`, `range`, `float`) over a Draw hybrid's payload, with the method's
 * arguments as the host passed them.
 */
json::Value draw_method(const Args& a, const json::Value& draw, std::string_view method,
                        const json::Array& args);

/**
 * Call a wire value standing for a function: a callback, or a hybrid standing for one of its
 * methods (`member` names the method it is called as).
 */
json::Value call_wire_function(const Args& a, const json::Value& fn, std::string_view member,
                               const json::Array& args);

/** Whether a wire value is a function to JS: a callback, or a hybrid standing for a method. */
bool is_wire_function(const json::Value& value);

/** A sampler set as assertDraw admits it. */
class WireDraw {
 public:
  WireDraw(const Args& args, const json::Value& draw) : args_(&args), draw_(&draw) {}

  /** `draw[method](...args)`: the raw result. */
  json::Value call(std::string_view method, const json::Array& args) const;

 private:
  const Args* args_;
  const json::Value* draw_;
};

/**
 * `assertDraw(draw, name)`: an object carrying all four samplers.
 * @throws InvalidInputError naming the first sampler missing.
 */
WireDraw assert_wire_draw(const Args& a, const json::Value& draw, std::string_view name = "draw");

/**
 * `assertSeedPath(path, name)` over arguments `from` onwards: each a string or a finite number.
 * @throws InvalidInputError naming the first segment that is neither.
 */
json::Array assert_wire_seed_path(const Args& a, std::size_t from,
                                  std::string_view name = "draw path");

/** A WireDraw bound to a path, as the transforms sample it. */
struct WireSampler {
  const WireDraw& draw;
  json::Array path;

  /** `draw.prob(p, ...path, tag, step)`, read for its truth. */
  bool prob(double p, std::string_view tag, double step) const;
};

//--------------------------------------------------------------------------------------------
// The generation context

/** A ResolvedContext read from the wire. */
struct WireContext {
  /** The typed context a generator runs on; its vocabulary is left to the generator's reader. */
  ResolvedContext resolved;
  /** The validated values as given, for the hybrid (undefined where absent). */
  json::Value seed;
  json::Value rhythmic;
  json::Value harmonic;
  json::Value ornament;
  json::Value difficulty;
  json::Value bpm;
  /** `ctx.rng` and `ctx.instruments` as given. */
  json::Value rng;
  json::Value instruments;
  /** The validated vocabulary entries, as given. */
  json::Array vocabulary;

  /** `instruments?.[part]`. */
  json::Value instrument(std::string_view part) const;
};

/**
 * `resolveContext(input)` over a wire value.
 * @throws InvalidInputError as resolveContext does.
 */
WireContext read_generation_context(const Args& a, const json::Value& input);

/** The ResolvedContext hybrid of a context. */
json::Value resolved_context_hybrid(const WireContext& ctx);

/** `ResolvedContext#part(name)` over a ResolvedContext hybrid's payload: a Draw hybrid. */
json::Value resolved_context_part(const json::Value& context, const json::Value& name);

//--------------------------------------------------------------------------------------------
// Figures and vocabulary

/** The grid model of wire onsets: plain objects, kept whole as the transforms copy them. */
struct WireGridModel {
  using Event = json::Value;
  using Velocity = json::Value;
  using StreamKey = const json::Value*;

  static double step(const json::Value& e);
  static json::Value velocity(const json::Value& e);
  static json::Value scaled(const json::Value& v, double factor);
  static bool louder(const json::Value& a, const json::Value& b);
  static std::string stream_text(const json::Value& e);
  static const json::Value* stream_key(const json::Value& e);
  static bool same_stream(const json::Value* a, const json::Value* b);
  static json::Value placed(const json::Value& e, double at);
  static json::Value placed(const json::Value& e, double at, const json::Value& v);
};

/**
 * `assertGridEvents(events)`: a list of records with finite steps.
 * @throws InvalidInputError naming the first malformed onset.
 */
std::vector<json::Value> assert_wire_grid_events(const json::Value& events);

/** `fitsQuery(entry, query)` over wire values. */
bool wire_fits_query(const json::Value& entry, const json::Value& query);

/** `selectVocabulary(dictionary, query)` over wire values: the matching entries as given. */
json::Array wire_select_vocabulary(const json::Value& dictionary, const json::Value& query);

/** `mergeVocabulary(builtIn, supplied)` over wire values. */
json::Array wire_merge_vocabulary(const json::Value& built_in, const json::Value& supplied);

/**
 * `assertVocabulary(entry, label)` over a wire value; returns the entry as given.
 * @throws InvalidInputError naming the first field outside its domain.
 */
const json::Value& assert_wire_vocabulary(const json::Value& entry, std::string_view label);

/** `isDrumPattern(material)` over a wire value. */
bool wire_is_drum_pattern(const json::Value& material);

/** `isFillArchetype(material)` over a wire value. */
bool wire_is_fill_archetype(const json::Value& material);

//--------------------------------------------------------------------------------------------
// Generator inputs

/**
 * `kit === undefined || canSound(kit, pitch)` over a kit as the caller named it; empty for no
 * kit. The profile is read when the first hit asks, so a kit is refused only where TS reads it.
 */
std::function<bool(int)> wire_kit_check(const json::Value& kit);

/**
 * The conditions of a validated vocabulary entry, typed (id, genre, articulations, fitsOver,
 * sections, tempoRange, ts, difficulty), with an empty material. An id that is not text becomes
 * one no other id or built-in name can equal; `index` makes it distinct from the others.
 */
Vocabulary<std::any> read_vocabulary_header(const json::Value& entry, std::size_t index);

/**
 * The fill archetypes of a context's validated entries (`vocabularyOfKind(entries,
 * isFillArchetype)`), each checked stroke by stroke as `assertFillArchetype` checks it and typed
 * for generate_drums. An id that is not text becomes one no other id or built-in name can equal.
 * @throws InvalidInputError naming the first stroke field outside its domain.
 */
std::vector<Vocabulary<std::any>> read_fill_vocabulary(const json::Array& entries);

}  // namespace cantus::ops

#endif  // CANTUS_SRC_OPS_CODEC_G1_H_
