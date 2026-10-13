// The playing-difficulty ceiling of ts/src/generate/context/difficulty.ts.

#include "generate/context/difficulty.h"

#include <array>
#include <cmath>
#include <cstddef>

#include "cantus/core/validation.h"
#include "cantus/generate/context.h"
#include "generate/context/limits.gen.h"
#include "js/math.h"

namespace cantus {

namespace {

/** Levels on the ceiling's scale, one row of each rate table per level. */
constexpr std::size_t kLevels =
    static_cast<std::size_t>(CEILING_MAX_DIFFICULTY - CEILING_MIN_DIFFICULTY + 1);

using LevelTable = std::array<double, kLevels>;

/** Strokes per second one limb sustains at each level (`STROKES_PER_SECOND`). */
constexpr LevelTable kStrokesPerSecond =
#include "generate/context/strokes_per_second.gen.inc"
    ;
static_assert(kStrokesPerSecond.back() > 0, "STROKES_PER_SECOND and the ceiling disagree");

/** Frets per second the fretting hand travels at each level (`FRETS_PER_SECOND`). */
constexpr LevelTable kFretsPerSecond =
#include "generate/context/frets_per_second.gen.inc"
    ;
static_assert(kFretsPerSecond.back() > 0, "FRETS_PER_SECOND and the ceiling disagree");

/** Seconds one quarter-note beat lasts at a tempo. */
double seconds_per_beat(double bpm) { return 60 / bpm; }

/** Read a per-level table at a possibly fractional level, interpolating (`atLevel`). */
double at_level(const LevelTable& table, double difficulty) {
  double level = js::min(CEILING_MAX_DIFFICULTY, js::max(CEILING_MIN_DIFFICULTY, difficulty));
  double lower = std::floor(level);
  double upper = std::ceil(level);
  auto row = [&table](double index) -> const double* {
    return index >= 0 && index < static_cast<double>(table.size())
               ? &table[static_cast<std::size_t>(index)]
               : nullptr;
  };
  const double* low_row = row(lower - 1);
  double low = low_row != nullptr ? *low_row : table[0];
  const double* high_row = row(upper - 1);
  double high = high_row != nullptr ? *high_row : low;
  return low + (high - low) * (level - lower);
}

}  // namespace

double assert_difficulty(double difficulty, std::string_view label) {
  return assert_range(difficulty, CEILING_MIN_DIFFICULTY, CEILING_MAX_DIFFICULTY, label);
}

bool sustains_strokes(double step_beats, std::optional<double> bpm,
                      std::optional<double> difficulty) {
  if (!difficulty || !bpm) {
    return true;
  }
  // A ceiling off the shared scale would read off the end of the rate table.
  assert_difficulty(*difficulty);
  assert_finite_number(*bpm, "bpm");
  if (assert_finite_number(step_beats, "stepBeats") <= 0) {
    return true;
  }
  double rate = 1 / (step_beats * seconds_per_beat(*bpm));
  return rate <= at_level(kStrokesPerSecond, *difficulty);
}

bool sustains_shift(double semitones, double step_beats, std::optional<double> bpm,
                    std::optional<double> difficulty) {
  if (!difficulty || !bpm) {
    return true;
  }
  assert_difficulty(*difficulty);
  assert_finite_number(*bpm, "bpm");
  assert_finite_semitones(semitones);
  if (assert_finite_number(step_beats, "stepBeats") <= 0) {
    return true;
  }
  double seconds = step_beats * seconds_per_beat(*bpm);
  return std::abs(semitones) / seconds <= at_level(kFretsPerSecond, *difficulty);
}

}  // namespace cantus
