#include "ops/codec_a1b.h"

#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/limits.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/number.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"

namespace cantus::ops {

namespace {

/** The profile names a table lookup can find, as `Object.keys(NAMED_PROFILES).join(', ')`. */
std::string profile_names() {
  std::string out;
  for (KeyProfileName name :
       {KeyProfileName::kKrumhansl, KeyProfileName::kTemperley, KeyProfileName::kFlat}) {
    if (!out.empty()) {
      out += ", ";
    }
    out += to_string(name);
  }
  return out;
}

/** `assertProfileVector` over a wire list. */
std::array<double, 12> read_profile_vector(const json::Value& vector, const std::string& name) {
  const json::Array& entries = vector.as_array();
  if (entries.size() != static_cast<std::size_t>(PROFILE_LENGTH)) {
    throw InvalidInputError(name + " must have " + js::to_string(PROFILE_LENGTH) + " entries");
  }
  std::array<double, 12> out{};
  for (std::size_t index = 0; index < entries.size(); ++index) {
    std::optional<double> number =
        js::type_of(entries[index]) == "number" ? number_of(entries[index]) : std::nullopt;
    if (!number || !std::isfinite(*number)) {
      throw InvalidInputError(name + "[" + js::to_string(static_cast<double>(index)) +
                              "] must be a finite number");
    }
    out[index] = *number;
  }
  return out;
}

/** `resolveKeyProfile` over a wire value; null is an absent option. */
ResolvedProfile resolve_wire_profile(const json::Value* profile) {
  if (profile == nullptr) {
    return ResolvedProfile{krumhansl_kessler_profile()};
  }
  if (profile->is_string()) {
    if (std::optional<KeyProfileName> name = parse_key_profile_name(profile->as_string())) {
      return ResolvedProfile{named_profile(*name)};
    }
    // A name the table inherits from Object.prototype finds a value that is no profile.
    if (inherits_object_member(profile->as_string())) {
      return ResolvedProfile{};
    }
    throw InvalidInputError("unknown key profile '" + profile->as_string() + "'; expected one of " +
                            profile_names());
  }
  if (js::type_of(*profile) != "object" || profile->is_null()) {
    throw InvalidInputError("profile must be a profile name or a { major, minor } pair");
  }
  const json::Value& major = get(*profile, "major");
  const json::Value& minor = get(*profile, "minor");
  if (!major.is_array() || !minor.is_array()) {
    throw InvalidInputError("profile must carry a major and a minor vector");
  }
  KeyProfilePair pair;
  pair.major = read_profile_vector(major, "profile.major");
  pair.minor = read_profile_vector(minor, "profile.minor");
  return ResolvedProfile{pair};
}

}  // namespace

void write_fields(const KeyRegion& v, FieldWriter& w) {
  w.field("startBeat", v.startBeat);
  w.field("endBeat", v.endBeat);
  w.field("key", scale_first(v.key));
  w.field("confidence", v.confidence);
  w.field("modulation", v.modulation);
  w.field("pivot", v.pivot);
}

std::vector<int> read_pitches(const json::Value& pitches, std::string_view name,
                              const json::Value& budget) {
  const json::Array& list = assert_array(pitches, name);
  assert_generation_budget(json::Value(static_cast<double>(list.size())), name, budget);
  std::vector<int> out;
  for (std::size_t index = 0; index < list.size(); ++index) {
    const json::Value& pitch = list[index];
    json::Value checked = pitch.is_null() || is_undefined(pitch)
                              ? json::Value(std::numeric_limits<double>::quiet_NaN())
                              : pitch;
    out.push_back(static_cast<int>(
        assert_midi_pitch(checked, "pitches[" + js::to_string(static_cast<double>(index)) + "]")));
  }
  return out;
}

ChordSource modulation_chord_source(const json::Array& segments,
                                    std::vector<std::unique_ptr<Chord>>& cache) {
  cache.clear();
  cache.resize(segments.size());
  return [&segments, &cache](std::size_t index) -> const Chord& {
    if (!cache[index]) {
      const json::Value& wire = get(segments[index], "chord");
      // `assertChord`, then the guards of the tones, then `soundsDominantSeventh`'s scans of the
      // intervals, which the candidate a fifth below the root asks for.
      assert_record(wire, "chord");
      assert_finite_number(get(wire, "rootPc"), "chord.rootPc");
      ChordQuality quality = assert_chord_quality(wire);
      assert_mask_inputs(wire);
      if (reads_interval(wire, 4)) {
        reads_interval(wire, 10);
      }
      cache[index] = std::make_unique<Chord>(read_chord_fields(wire, quality));
    }
    return *cache[index];
  };
}

ProfileSource wire_profile_source(const json::Value* profile) {
  std::optional<json::Value> held;
  if (profile != nullptr) {
    held = *profile;
  }
  return [held] { return resolve_wire_profile(held ? &*held : nullptr); };
}

std::optional<std::variant<bool, std::vector<ModalScaleName>>> read_modal_modes(
    const json::Value* modes) {
  if (modes == nullptr) {
    return std::nullopt;
  }
  if (modes->is_bool()) {
    return modes->as_bool();
  }
  if (!modes->is_array()) {
    throw InvalidInputError("modes must be a boolean or an array of mode names");
  }
  std::vector<ModalScaleName> names;
  for (const json::Value& name : modes->as_array()) {
    std::optional<ModalScaleName> known;
    if (name.is_string()) {
      known = parse_modal_scale_name(name.as_string());
    }
    if (!known) {
      std::string expected;
      for (ModalScaleName candidate : modal_scale_names()) {
        if (!expected.empty()) {
          expected += ", ";
        }
        expected += to_string(candidate);
      }
      throw InvalidInputError("unknown mode '" + js::string_of(name) + "'; expected one of " +
                              expected);
    }
    names.push_back(*known);
  }
  return names;
}

bool is_true_option(const json::Value& asked, std::string_view key) {
  const json::Value* value = field(asked, key);
  return value != nullptr && value->is_bool() && value->as_bool();
}

}  // namespace cantus::ops
