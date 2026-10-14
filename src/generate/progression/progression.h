/**
 * @file progression.h
 * @brief Internal pieces of ts/src/generate/progression/index.ts: the steps of
 *        generateProgression once its preset is settled.
 */
#ifndef CANTUS_SRC_GENERATE_PROGRESSION_PROGRESSION_H_
#define CANTUS_SRC_GENERATE_PROGRESSION_PROGRESSION_H_

#include <optional>
#include <string_view>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/core/types.h"
#include "cantus/generate/context.h"
#include "cantus/generate/progression.h"

namespace cantus {

/** The meter a progression is laid out in when the caller names none (`DEFAULT_TS`). */
extern const TimeSignature kProgressionDefaultTs;

/** The names of PROG_STYLES, for assert_one_of(). */
std::vector<std::string_view> prog_style_names();

/** The built-in presets as the table holds them (`PRESETS`). */
const std::vector<ProgressionPreset>& builtin_presets();

/** Whether a degree code is one of the borrowed ones (`Object.values(BORROWED_DEGREES)`). */
bool is_borrowed_degree(double degree);

/**
 * The preset a style resolves to under a resolved context (`presetFor`).
 * @param style The style's name as the caller wrote it, for the error message; empty when the
 *   style has no name in the table.
 * @throws InvalidInputError if no preset claims the style.
 */
ProgressionPreset preset_for(const std::optional<ProgStyle>& style, const std::string& named,
                             const ResolvedContext& ctx);

/** What generateProgression reads of the settled preset and the forced quality. */
struct ProgressionPlan {
  KeyScale key;
  std::vector<int> degrees;
  bool cadenceStrong = false;
  std::optional<ChordQuality> ext;
  double bars = 0;
  double barBeats = 0;
};

/** generateProgression from the point its preset is settled. */
std::vector<ChordSpan> generate_progression_with(const ProgressionPlan& plan,
                                                 const ResolvedContext& ctx);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_PROGRESSION_PROGRESSION_H_
