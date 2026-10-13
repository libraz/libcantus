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

/** The names of the profiles, for assert_one_of(). */
std::vector<std::string_view> profile_names() {
  std::vector<std::string_view> names;
  for (const NamedProfileWeights& row : PROFILE_WEIGHTS) {
    names.push_back(row.name);
  }
  return names;
}

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

SafetyContext read_safety_context(const json::Value& query) {
  assert_record(query, "safety query");
  SafetyContext context;
  context.profile = *parse_safety_profile(
      assert_one_of(get(query, "profile"), profile_names(), "safety profile"));
  context.prevPitch = read_pitch_field(query, "prevPitch", "prevPitch");
  context.vocalLow = read_pitch_field(query, "vocalLow", "vocalLow");
  context.vocalHigh = read_pitch_field(query, "vocalHigh", "vocalHigh");
  if (context.vocalLow && context.vocalHigh && *context.vocalLow > *context.vocalHigh) {
    throw InvalidInputError("vocalLow must not exceed vocalHigh");
  }
  const json::Value& voices = get(query, "otherVoices");
  if (!voices.is_array()) {
    throw InvalidInputError("otherVoices must be an array; received " + js::type_of(voices));
  }
  assert_generation_budget(json::Value(static_cast<double>(voices.as_array().size())),
                           "other voices", undefined_value());
  for (std::size_t index = 0; index < voices.as_array().size(); ++index) {
    const json::Value& voice = voices.as_array()[index];
    if (!js::truthy(voice)) {
      throw InvalidInputError("otherVoices[" + index_text(index) +
                              "] must be an object; received " + describe_rejected(voice));
    }
    std::string label = "otherVoices[" + index_text(index) + "]";
    VoiceSnapshot snapshot;
    snapshot.pitch = static_cast<int>(assert_midi_pitch(get(voice, "pitch"), label + ".pitch"));
    snapshot.prevPitch = read_pitch_field(voice, "prevPitch", label + ".prevPitch");
    context.otherVoices.push_back(snapshot);
  }
  context.strongBeat = js::truthy(get(query, "strongBeat"));
  return context;
}

void read_safety_harmony(const json::Value& query, SafetyContext& context) {
  const json::Value& chord = get(query, "chord");
  if (js::truthy(chord)) {
    context.chord = read_chord_fields(chord);
  }
  context.key = read_key_like(get(query, "key"));
}

}  // namespace cantus::ops
