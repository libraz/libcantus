/**
 * @file spec.h
 * @brief Internal helpers of ts/src/theory/chord/spec.ts: normalization, the quality tables and
 *        the structural reading of an interval template.
 */
#ifndef CANTUS_SRC_THEORY_CHORD_SPEC_H_
#define CANTUS_SRC_THEORY_CHORD_SPEC_H_

#include <array>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "cantus/theory/chord.h"
#include "js/number.h"

namespace cantus {

/** The degrees an alteration may name (`ALTERABLE_DEGREES`). */
inline constexpr std::array<int, 4> kAlterableDegrees = {
#include "theory/chord/alterable_degrees.gen.inc"
};

/** The steps an alteration may move its degree by (`ALTERATION_STEPS`). */
inline constexpr std::array<int, 3> kAlterationSteps = {
#include "theory/chord/alteration_steps.gen.inc"
};

/** The degrees a spec may add (`ADDABLE_DEGREES`). */
inline constexpr std::array<int, 4> kAddableDegrees = {
#include "theory/chord/addable_degrees.gen.inc"
};

/** The degrees a spec may omit (`OMITTABLE_DEGREES`). */
inline constexpr std::array<int, 3> kOmittableDegrees = {
#include "theory/chord/omittable_degrees.gen.inc"
};

/** `allowed.join(', ')` of a list of degrees. */
template <std::size_t N>
std::string join_degrees(const std::array<int, N>& allowed) {
  std::string out;
  for (std::size_t i = 0; i < N; ++i) {
    if (i > 0) {
      out += ", ";
    }
    out += js::to_string(allowed[i]);
  }
  return out;
}

/** Whether `allowed.includes(value)`. */
template <std::size_t N>
bool includes_degree(const std::array<int, N>& allowed, double value) {
  for (int degree : allowed) {
    if (degree == value) {
      return true;
    }
  }
  return false;
}

/** The base names, in BASE_TONES order, for the spec validators. */
std::vector<std::string_view> chord_base_names();

/** The seventh names, in SEVENTH_SEMITONES order, for the spec validators. */
std::vector<std::string_view> chord_seventh_names();

/** Every quality, in the canonical order (`QUALITY_ORDER`). */
const std::vector<ChordQuality>& quality_order();

/** The interval template of a quality (`QUALITY_INTERVALS`). */
const std::vector<double>& quality_intervals(ChordQuality quality);

/** Reduce a spec to the one form that stands for its harmony (`normalizeChordSpec`). */
ChordSpec normalize_chord_spec(const ChordSpec& spec);

/** The tones of a validated, normalized spec (`specIntervals`). */
std::vector<double> spec_intervals(const ChordSpec& normalized);

/**
 * Validate a spec and return it normalized (`assertChordSpec`).
 * @throws InvalidInputError if a part is not one the model defines.
 */
ChordSpec assert_chord_spec(const ChordSpec& spec);

/** A fresh copy of the spec a quality stands for, rooted on `root_pc` (`chordSpecForQuality`). */
ChordSpec chord_spec_for_quality(ChordQuality quality, double root_pc,
                                 std::optional<double> bass_pc = std::nullopt);

/** The quality naming a spec exactly, or nullopt (`exactChordSpecQuality`). */
std::optional<ChordQuality> exact_chord_spec_quality(const ChordSpec& spec);

/** The structural reading of an interval template, or nullopt (`chordSpecFromIntervals`). */
std::optional<ChordSpec> chord_spec_from_intervals(const std::vector<double>& intervals);

}  // namespace cantus

#endif  // CANTUS_SRC_THEORY_CHORD_SPEC_H_
