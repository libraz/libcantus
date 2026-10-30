// Op adapters of theory/safety.
//
// Each adapter replays the TS validation prologue over the wire arguments with the loose twins
// (ops/validate.h, ops/codec_t4.h), in the TS order and with the TS names, then calls the typed
// function.

#include <array>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cantus/core/errors.h"
#include "cantus/theory/safety.h"
#include "js/math.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/codec_t4.h"
#include "ops/register_all.h"
#include "ops/registry.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** A `Record<SafetyProfile, ProfileWeights>` keyed like the TS object. */
json::Value profile_weights_object() {
  json::Object o;
  for (const NamedProfileWeights& row : PROFILE_WEIGHTS) {
    o.set(std::string(row.name), to_json(row.weights));
  }
  return json::Value(std::move(o));
}

/** An enum as TS emits it: the value-to-name mapping and the name-to-value one. */
template <std::size_t N>
json::Value enum_object(const std::array<std::pair<double, const char*>, N>& entries) {
  json::Object o;
  for (const auto& [value, name] : entries) {
    o.set(js::to_string(value), name);
  }
  for (const auto& [value, name] : entries) {
    o.set(name, value);
  }
  return json::Value(std::move(o));
}

/** The weight fields a wire override may name, with the member each one replaces. */
struct WeightField {
  std::string_view name;
  std::optional<double> ProfileWeightOverrides::*member;
};

constexpr WeightField kWeightFields[] = {
    {"imperfectConsonance", &ProfileWeightOverrides::imperfectConsonance},
    {"perfectConsonance", &ProfileWeightOverrides::perfectConsonance},
    {"dissonance", &ProfileWeightOverrides::dissonance},
    {"chordTone", &ProfileWeightOverrides::chordTone},
    {"contraryMotion", &ProfileWeightOverrides::contraryMotion},
    {"obliqueMotion", &ProfileWeightOverrides::obliqueMotion},
    {"similarMotion", &ProfileWeightOverrides::similarMotion},
    {"parallelImperfect", &ProfileWeightOverrides::parallelImperfect},
    {"stepwise", &ProfileWeightOverrides::stepwise},
    {"melodicDistance", &ProfileWeightOverrides::melodicDistance},
    {"forbiddenLeap", &ProfileWeightOverrides::forbiddenLeap},
    {"registerDrift", &ProfileWeightOverrides::registerDrift},
};

void register_safety() {
  def("$const:PROFILE_WEIGHTS", [](Args&) -> json::Value { return profile_weights_object(); });
  def("$const:NoteSafety", [](Args&) -> json::Value {
    return enum_object<3>({{{0, "Safe"}, {1, "Warning"}, {2, "Dissonant"}}});
  });
  def("$const:ReasonFlag", [](Args&) -> json::Value {
    return enum_object<17>(
        {{{static_cast<double>(ReasonFlag::kChordTone), "ChordTone"},
          {static_cast<double>(ReasonFlag::kTension), "Tension"},
          {static_cast<double>(ReasonFlag::kAvoidNote), "AvoidNote"},
          {static_cast<double>(ReasonFlag::kScaleTone), "ScaleTone"},
          {static_cast<double>(ReasonFlag::kNonScale), "NonScale"},
          {static_cast<double>(ReasonFlag::kOutOfRange), "OutOfRange"},
          {static_cast<double>(ReasonFlag::kTritone), "Tritone"},
          {static_cast<double>(ReasonFlag::kLargeLeap), "LargeLeap"},
          {static_cast<double>(ReasonFlag::kMinorSecond), "MinorSecond"},
          {static_cast<double>(ReasonFlag::kMajorSeventh), "MajorSeventh"},
          {static_cast<double>(ReasonFlag::kVerticalDissonance), "VerticalDissonance"},
          {static_cast<double>(ReasonFlag::kParallelPerfect), "ParallelPerfect"},
          {static_cast<double>(ReasonFlag::kHiddenParallel), "HiddenParallel"},
          {static_cast<double>(ReasonFlag::kVoiceCrossing), "VoiceCrossing"},
          {static_cast<double>(ReasonFlag::kSuspension), "Suspension"},
          {static_cast<double>(ReasonFlag::kNeedsResolution), "NeedsResolution"},
          {static_cast<double>(ReasonFlag::kMelodicTritone), "MelodicTritone"}}});
  });
  def("profileWeights", [](Args& a) -> json::Value {
    std::vector<std::string_view> names;
    for (const NamedProfileWeights& row : PROFILE_WEIGHTS) {
      names.push_back(row.name);
    }
    SafetyProfile profile = *parse_safety_profile(assert_one_of(a[0], names, "safety profile"));
    ProfileWeightOverrides overrides;
    // A field the table does not have is checked all the same and added after the table's own.
    std::vector<std::pair<std::string, double>> extra;
    if (!a.undefined(1)) {
      const json::Value& given = assert_record(a[1], "overrides");
      for (const json::Member& member : given.as_object()) {
        if (is_undefined(member.value)) {
          continue;
        }
        std::string name = unescape_key(member.key);
        double value = assert_finite_number(member.value, "weight " + name);
        const WeightField* known = nullptr;
        for (const WeightField& candidate : kWeightFields) {
          if (candidate.name == name) {
            known = &candidate;
          }
        }
        if (known != nullptr) {
          overrides.*(known->member) = value;
        } else if (name != "__proto__") {
          extra.emplace_back(std::move(name), value);
        }
      }
    }
    json::Value weights = to_json(profile_weights(profile, overrides));
    for (auto& [name, value] : extra) {
      weights.as_object().set(std::move(name), value);
    }
    return weights;
  });
  def("evaluateSafety", [](Args& a) -> json::Value {
    SafetyContext context = read_safety_context(a[0]);
    SafetyQuery query;
    static_cast<SafetyContext&>(query) = context;
    query.candidatePitch =
        static_cast<int>(assert_midi_pitch(get(a[0], "candidatePitch"), "candidatePitch"));
    const json::Value& asked = assert_options(a[1], "opts");
    EvaluateSafetyOptions opts;
    if (const json::Value* suggestions = opt_null_default(asked, "suggestions")) {
      opts.suggestions = js::truthy(*suggestions);
    }
    if (const json::Value* partners = opt_null_default(asked, "partners")) {
      opts.partners = js::truthy(*partners);
    }
    read_safety_harmony(a[0], query);
    read_safety_chord(a[0], query.candidatePitch);
    return to_json(evaluate_safety(query, opts));
  });
  def("enumerateSafePitches", [](Args& a) -> json::Value {
    SafetyContext context = read_safety_context(a[0]);
    double low = assert_midi_pitch(a[1], "pitchLow");
    double high = assert_midi_pitch(a[2], "pitchHigh");
    read_safety_harmony(a[0], context);
    // The chord is asserted at the first pitch outside it, enumerating down from the top.
    if (low <= high) {
      double top =
          context.vocalHigh ? js::min(high, static_cast<double>(*context.vocalHigh)) : high;
      double bottom = context.vocalLow ? js::max(low, static_cast<double>(*context.vocalLow)) : low;
      for (double pitch = top; pitch >= bottom; pitch -= 1) {
        if (read_safety_chord(a[0], pitch)) {
          break;
        }
      }
    }
    return to_json(enumerate_safe_pitches(context, low, high));
  });
}

}  // namespace

void register_t4() { register_safety(); }

}  // namespace cantus::ops
