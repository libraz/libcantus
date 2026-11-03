#include "ops/codec_t4.h"

#include <string>
#include <vector>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** A pitch field of the query that is present: a MIDI pitch. */
std::optional<int> read_pitch_field(const json::Value& object, std::string_view key,
                                    std::string_view name) {
  const json::Value* value = field(object, key);
  if (value == nullptr) {
    return std::nullopt;
  }
  return static_cast<int>(assert_midi_pitch(*value, name));
}

}  // namespace

std::vector<std::string_view> safety_profile_names() {
  std::vector<std::string_view> names;
  for (const NamedProfileWeights& row : PROFILE_WEIGHTS) {
    names.push_back(row.name);
  }
  return names;
}

SafetyContext read_safety_context(const json::Value& query) {
  assert_record(query, "safety query");
  SafetyContext context;
  context.profile = *parse_safety_profile(
      assert_one_of(get(query, "profile"), safety_profile_names(), "safety profile"));
  context.prevPitch = read_pitch_field(query, "prevPitch", "prevPitch");
  context.vocalLow = read_pitch_field(query, "vocalLow", "vocalLow");
  context.vocalHigh = read_pitch_field(query, "vocalHigh", "vocalHigh");
  if (context.vocalLow && context.vocalHigh && *context.vocalLow > *context.vocalHigh) {
    throw InvalidInputError("vocalLow must not exceed vocalHigh");
  }
  const json::Value& voices = get(query, "otherVoices");
  if (!voices.is_array()) {
    throw InvalidInputError("otherVoices must be an array; received " + describe_rejected(voices));
  }
  assert_generation_budget(json::Value(static_cast<double>(voices.as_array().size())),
                           "other voices", undefined_value());
  for (std::size_t index = 0; index < voices.as_array().size(); ++index) {
    std::string label = "otherVoices[" + index_text(index) + "]";
    const json::Value& voice = assert_record(voices.as_array()[index], label);
    VoiceSnapshot snapshot;
    snapshot.pitch = static_cast<int>(assert_midi_pitch(get(voice, "pitch"), label + ".pitch"));
    snapshot.prevPitch = read_pitch_field(voice, "prevPitch", label + ".prevPitch");
    context.otherVoices.push_back(snapshot);
  }
  // No harmony is null; anything else is a chord.
  const json::Value& chord = get(query, "chord");
  if (!chord.is_null()) {
    assert_record(chord, "chord");
  }
  context.strongBeat = js::truthy(get(query, "strongBeat"));
  return context;
}

bool read_safety_chord(const json::Value& query, double pitch) {
  const json::Value& chord = get(query, "chord");
  if (chord.is_null()) {
    return false;
  }
  assert_mask_inputs(chord);
  if (is_chord_member(pitch, read_chord_fields(chord))) {
    return false;
  }
  assert_chord(chord);
  return true;
}

EvaluateSafetyOptions read_evaluate_safety_options(const json::Value& asked) {
  EvaluateSafetyOptions opts;
  if (const json::Value* suggestions = opt_null_default(asked, "suggestions")) {
    opts.suggestions = js::truthy(*suggestions);
  }
  if (const json::Value* partners = opt_null_default(asked, "partners")) {
    opts.partners = js::truthy(*partners);
  }
  return opts;
}

void read_safety_harmony(const json::Value& query, SafetyContext& context) {
  const json::Value& chord = get(query, "chord");
  if (!chord.is_null()) {
    context.chord = read_chord_fields(chord);
  }
  context.key = read_key_like(get(query, "key"));
}

}  // namespace cantus::ops
