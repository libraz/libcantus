#include "ops/codec_t3.h"

#include <cmath>
#include <limits>
#include <string>

#include "cantus/core/errors.h"
#include "core/validation/validation.h"
#include "ops/accessors.h"
#include "ops/validate.h"
#include "theory/voicing/limits.gen.h"

namespace cantus::ops {

void read_ranges_option(const json::Value& asked, VoicingOptions& out) {
  if (const json::Value* ranges = field(asked, "ranges")) {
    const json::Array& given = assert_array(*ranges, "ranges");
    if (given.empty()) {
      throw InvalidInputError("ranges must contain at least one voice range");
    }
    assert_generation_budget(json::Value(static_cast<double>(given.size())), "voice ranges",
                             json::Value(128));
    std::vector<VoiceRange> read;
    for (std::size_t index = 0; index < given.size(); ++index) {
      std::string label = "ranges[" + index_text(index) + "]";
      double min = assert_finite_number(get(given[index], "min"), label + ".min");
      double max = assert_finite_number(get(given[index], "max"), label + ".max");
      if (min > max) {
        throw InvalidInputError(label + ".min must not exceed max");
      }
      assert_generation_budget(json::Value(std::floor(max) - std::ceil(min) + 1), label + " span",
                               json::Value(4096));
      read.push_back(VoiceRange{min, max});
    }
    out.ranges = std::move(read);
    return;
  }
  const json::Value* voices = opt_null_default(asked, "voices");
  out.voices =
      assert_positive_int(voices != nullptr ? *voices : json::Value(4), "voices", json::Value(128));
}

void read_max_spacing_option(const json::Value& asked, VoicingOptions& out) {
  const json::Value* given = opt_null_default(asked, "maxSpacing");
  double max_spacing = assert_finite_number(
      given != nullptr ? *given : json::Value(DEFAULT_MAX_SPACING), "maxSpacing");
  if (max_spacing < 0) {
    throw InvalidInputError("maxSpacing must be non-negative");
  }
  out.maxSpacing = max_spacing;
}

void read_max_candidates_option(const json::Value& asked, VoicingOptions& out) {
  if (const json::Value* given = opt_strict(asked, "maxCandidates")) {
    out.maxCandidates = assert_positive_int(*given, "maxCandidates", json::Value(1000000));
  }
}

void read_key_option(const json::Value& asked, VoicingOptions& out) {
  if (const json::Value* given = opt_strict(asked, "key")) {
    out.key = read_key_arg(*given);
  }
}

void read_previous_chord_option(const json::Value& asked, VoicingOptions& out) {
  if (const json::Value* given = opt_strict(asked, "previousChord")) {
    out.previousChord = ChordArg(read_chord_like(*given).chord);
  }
}

std::vector<double> read_voicing(const json::Value& value, std::string_view name) {
  const json::Array& voices = assert_array(value, name);
  std::vector<double> out;
  for (std::size_t index = 0; index < voices.size(); ++index) {
    std::string label = std::string(name) + "[" + index_text(index) + "]";
    const json::Value& pitch = voices[index];
    // An absent voice is read as NaN, which the guard refuses by that name.
    out.push_back(
        pitch.is_null() || is_undefined(pitch)
            ? cantus::assert_finite_number(std::numeric_limits<double>::quiet_NaN(), label)
            : assert_finite_number(pitch, label));
  }
  return out;
}

}  // namespace cantus::ops
