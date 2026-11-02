#include "ops/codec_t3.h"

#include <cmath>
#include <limits>
#include <optional>
#include <string>

#include "cantus/core/errors.h"
#include "cantus/core/pitch.h"
#include "cantus/theory/scale.h"
#include "core/validation/validation.h"
#include "js/format.h"
#include "js/math.h"
#include "js/value.h"
#include "ops/accessors.h"
#include "ops/validate.h"
#include "theory/voicing/limits.gen.h"

namespace cantus::ops {

void read_ranges_option(const json::Value& asked, VoicingOptions& out) {
  if (const json::Value* ranges = field(asked, "ranges")) {
    // `opts.ranges.length`, then `opts.ranges.map(...)`: any value with a length is measured.
    json::Value length = length_of(*ranges);
    if (js::strict_equals(length, json::Value(0))) {
      throw InvalidInputError("ranges must contain at least one voice range");
    }
    assert_generation_budget(length, "voice ranges", json::Value(128));
    if (!ranges->is_array()) {
      throw js::TypeError("opts.ranges.map is not a function");
    }
    const json::Array& given = ranges->as_array();
    std::vector<VoiceRange> read;
    for (std::size_t index = 0; index < given.size(); ++index) {
      std::string label = "ranges[" + index_text(index) + "]";
      double min = assert_finite_number(property_of(given[index], "min"), label + ".min");
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
  out.voices =
      assert_positive_int(opt_or(asked, "voices", json::Value(4)), "voices", json::Value(128));
}

void read_max_spacing_option(const json::Value& asked, VoicingOptions& out) {
  double max_spacing = assert_finite_number(
      opt_or(asked, "maxSpacing", json::Value(DEFAULT_MAX_SPACING)), "maxSpacing");
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

std::optional<ResolvedKey> resolve_key_option(const VoicingOptions& opts) {
  return opts.key ? std::optional<ResolvedKey>(resolve_key(*opts.key)) : std::nullopt;
}

bool spelled_by_chord(double pitch, const ResolvedKey& key) {
  int pc = pitch_class_of(js::round(pitch));
  return pc != note_to_pitch_class(key.tonic) && !is_scale_tone(pc, KeyArg(key.scale));
}

void read_spelling_table_hints(const json::Value& chord, const std::optional<ResolvedKey>& key) {
  if (!key) {
    return;
  }
  for (int pc = 0; pc < 12; ++pc) {
    if (spelled_by_chord(pc, *key)) {
      read_spelled_hints(chord);
      return;
    }
  }
}

void read_voicing_hints(const std::vector<double>& pitches, const json::Value& chord,
                        const ResolvedKey& key) {
  for (double pitch : pitches) {
    if (spelled_by_chord(pitch, key)) {
      read_spelled_hints(chord);
      return;
    }
  }
}

SpelledVoicing spell_wire_voicing(const json::Array& pitches, const Chord& chord,
                                  const json::Value& wire, const KeyArg& key) {
  ResolvedKey resolved = resolve_key(key);
  std::vector<double> numbers;
  // The hints are read at the first pitch spelled by the chord, unless a pitch before it is
  // refused.
  bool unread = true;
  for (const json::Value& pitch : pitches) {
    if (is_wire_number(pitch)) {
      double number = *number_of(pitch);
      if (unread && (!std::isfinite(number) || spelled_by_chord(number, resolved))) {
        unread = false;
        if (std::isfinite(number)) {
          read_spelled_hints(wire);
        }
      }
      numbers.push_back(number);
      continue;
    }
    // The pitches before it are spelled first, and so is a probe pitch when it is the first.
    spell_voicing(numbers.empty() ? std::vector<double>{60} : numbers, chord, key);
    numbers.push_back(assert_finite_number(pitch, "pitch"));
  }
  return spell_voicing(numbers, chord, key);
}

namespace {

/** The chord's tones, then `resolvedKeyOf`. */
std::optional<ResolvedKey> read_voiced_tones_and_key(ChordData& data, const json::Value& asked,
                                                     VoicingOptions& out) {
  settle_chord_quality(data);
  read_key_option(asked, out);
  return resolve_key_option(out);
}

}  // namespace

void read_voiced_chord(ChordData& data, const json::Value& asked, VoicingOptions& out) {
  std::optional<ResolvedKey> key = read_voiced_tones_and_key(data, asked, out);
  reads_tone_letter_offsets(data.wire);
  read_spelling_table_hints(data.wire, key);
}

void read_next_voiced_chord(ChordData& data, const json::Value& asked, VoicingOptions& out) {
  std::optional<ResolvedKey> key = read_voiced_tones_and_key(data, asked, out);
  std::optional<ChordData> previous;
  if (const json::Value* given = opt_strict(asked, "previousChord")) {
    previous = read_chord_like(*given);
    out.previousChord = ChordArg(previous->chord);
  }
  reads_tone_letter_offsets(data.wire);
  if (previous && !previous->chord.intervals.empty()) {
    reads_tone_letter_offsets(previous->wire);
  }
  // The key spells the chord being left, then the chord being voiced.
  if (previous) {
    read_spelling_table_hints(previous->wire, key);
  }
  read_spelling_table_hints(data.wire, key);
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
