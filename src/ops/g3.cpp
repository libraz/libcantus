// Op adapters of generate/melody, generate/plan.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_g3.h), in the TS order and with the TS names, then calls the typed
// function. A plan is read and checked in one pass by read_composition_plan().

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "generate/melody/melody.h"
#include "generate/plan/derive.h"
#include "generate/plan/limits.gen.h"
#include "generate/plan/timeline.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_a1c.h"
#include "ops/codec_a5.h"
#include "ops/codec_g1.h"
#include "ops/codec_g3.h"
#include "ops/codec_t1.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

bool nullish(const json::Value& v) { return v.is_null() || is_undefined(v); }

/** `readPreserve`: every dimension's weight, an omitted one being 1. */
ResolvedWeights read_preserve(const json::Value& value) {
  json::Value none{json::Object()};
  const json::Value& read = is_undefined(value) ? none : assert_record(value, "opts.preserve");
  ResolvedWeights weights;
  for (std::string_view aspect : preserve_aspects()) {
    const json::Value& weight = get(read, aspect);
    *preserve_slot(weights, aspect) =
        is_undefined(weight) ? 1.0
                             : assert_range(weight, 0, 1, "opts.preserve." + std::string(aspect));
  }
  return weights;
}

/** `readRegister`: whole MIDI pitches with low not above high. */
PlanRegisterRange read_register(const json::Value& value) {
  const json::Value& read = assert_record(value, "opts.register");
  double low = assert_midi_pitch(get(read, "low"), "opts.register.low");
  double high = assert_midi_pitch(get(read, "high"), "opts.register.high");
  if (low > high) {
    throw InvalidInputError("opts.register.low must not exceed opts.register.high; received " +
                            js::to_string(low) + " > " + js::to_string(high));
  }
  return PlanRegisterRange{static_cast<int>(low), static_cast<int>(high)};
}

/** `melodyContext`: the caller's context with the plan's seed and algorithm version filled in. */
json::Value melody_context_input(const CompositionPlan& plan, const json::Value& input) {
  json::Object merged;
  auto from_plan = [&](const json::Value& seed) {
    merged.set("seed", seed);
    merged.set("algorithmVersion", json::Value(static_cast<double>(plan.algorithmVersion)));
  };
  json::Value plan_seed{static_cast<double>(plan.seed)};
  if (is_undefined(input)) {
    from_plan(plan_seed);
    return json::Value(std::move(merged));
  }
  if (js::type_of(input) == "number") {
    from_plan(input);
    return json::Value(std::move(merged));
  }
  const json::Value& read = assert_record(input, "ctx");
  if (!is_undefined(get(read, "rng"))) {
    throw InvalidInputError(
        "ctx.rng cannot drive a melody: every onset and tie-break is drawn at an address of phrase "
        "and beat under a seed; pass a seed instead");
  }
  if (read.is_object()) {
    for (const json::Member& member : read.as_object()) {
      merged.set(member.key, member.value);
    }
  }
  if (nullish(get(read, "seed"))) {
    merged.set("seed", plan_seed);
  }
  if (nullish(get(read, "algorithmVersion"))) {
    merged.set("algorithmVersion", json::Value(static_cast<double>(plan.algorithmVersion)));
  }
  return json::Value(std::move(merged));
}

}  // namespace

void register_g3() {
  def("$const:COMPOSITION_PLAN_VERSION", [](Args&) -> json::Value {
    return json::Value(static_cast<double>(COMPOSITION_PLAN_VERSION));
  });
  def("assertCompositionPlan", [](Args& a) -> json::Value {
    std::string name = name_arg(a, 1, "composition plan");
    read_composition_plan(a[0], name);
    return a[0];
  });
  def("planTimeline", [](Args& a) -> json::Value {
    return to_json(plan_chord_timeline(read_composition_plan(a[0], "composition plan")));
  });
  def("deriveCompositionPlan", [](Args& a) -> json::Value {
    ReferenceProfile profile = read_reference_profile(a[0], "reference");
    json::Value bag = arg_or(a, 1, json::Object());
    const json::Value& asked = assert_options(bag, "opts");
    DeriveRequest request;
    for (const json::Value& chord : get(get(a[0], "harmony"), "chords").as_array()) {
      request.chordKeys.push_back(*number_of(get(chord, "key")));
    }
    request.preserve = read_preserve(get(asked, "preserve"));
    const json::Value& register_value = get(asked, "register");
    if (!is_undefined(register_value)) {
      request.requestedRegister = read_register(register_value);
    }
    const json::Value& given = get(asked, "ctx");
    if (js::type_of(given) == "object" && !given.is_null() && !is_undefined(get(given, "rng"))) {
      throw InvalidInputError(
          "opts.ctx.rng is not accepted: a composition plan records its seed, not a source");
    }
    WireContext ctx = read_generation_context(a, given);
    const json::Value& key = get(asked, "key");
    if (!is_undefined(key)) {
      request.requestedKey = [key]() { return resolve_key(read_key_arg(key)); };
    }
    json::Value budget = get(asked, "budget");
    request.chargeMotifSelection = [budget](double cells) {
      assert_generation_budget(json::Value(cells), "plan motif selection", budget);
    };
    CompositionPlan plan = derive_composition_plan_with(profile, request, ctx.resolved);
    // The seed is recorded as the caller wrote it, a negative zero included.
    plan.seed = *number_of(ctx.seed);
    return to_json(plan);
  });
  def("evaluateComposition", [](Args& a) -> json::Value {
    CompositionPlan plan = read_composition_plan(a[1], "evaluated plan");
    json::Value bag = arg_or(a, 2, json::Object());
    const json::Value& asked = assert_options(bag, "evaluate options");
    const json::Value& budget = get(asked, "budget");
    std::vector<NoteEvent> notes =
        assert_note_events(a[0], "evaluated melody", line_options(budget));
    EvaluateCompositionOptions typed;
    typed.budget = number_of(budget);
    return to_json(evaluate_composition(notes, plan, typed));
  });
  def("generateMelody", [](Args& a) -> json::Value {
    CompositionPlan plan = read_composition_plan(a[0], "composition plan");
    json::Value bag = arg_or(a, 1, json::Object());
    const json::Value& asked = assert_options(bag, "opts");
    const json::Value& budget = get(asked, "budget");
    if (!is_undefined(budget)) {
      assert_positive_int(budget, "budget", kMaxSafeInteger);
    }
    WireContext ctx = read_generation_context(a, melody_context_input(plan, get(asked, "ctx")));
    return to_json(generate_melody_with(plan, number_of(budget), ctx.resolved));
  });
}

}  // namespace cantus::ops
