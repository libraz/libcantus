/**
 * @file progression.h
 * @brief Public C++ API of ts/src/generate/progression: chord progressions laid out one chord per
 *        bar, from presets written in scale degrees.
 *
 * A preset is chosen by id, or deterministically from the presets matching a style and seeded by
 * the context. Its degrees cycle to fill the bars; with `complexity.harmonic` above zero, some
 * chords become the secondary dominant of the chord that follows.
 */
#ifndef CANTUS_GENERATE_PROGRESSION_H_
#define CANTUS_GENERATE_PROGRESSION_H_

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cantus/core/meter.h"
#include "cantus/generate/context.h"
#include "cantus/theory/chord.h"
#include "cantus/theory/scale.h"

namespace cantus {

/** Broad production style a progression preset suits (`ProgStyle`). */
enum class ProgStyle : std::uint8_t { kMinimal, kDance, kIdol, kRock };

/** Every production style a preset may suit, in declaration order (`PROG_STYLES`). */
inline constexpr std::array<ProgStyle, 4> PROG_STYLES = {ProgStyle::kMinimal, ProgStyle::kDance,
                                                         ProgStyle::kIdol, ProgStyle::kRock};

/** The TS name of a style ("minimal", ...). */
std::string_view to_string(ProgStyle style);

/** The style named `name`, or nullopt. */
std::optional<ProgStyle> parse_prog_style(std::string_view name);

/** Harmonic-function role of a progression as a whole (`ProgFunction`). */
enum class ProgFunction : std::uint8_t { kLoop, kTensionBuild, kCadenceStrong, kStable };

/** The TS name of a role ("loop", ...). */
std::string_view to_string(ProgFunction function);

/** The role named `name`, or nullopt. */
std::optional<ProgFunction> parse_prog_function(std::string_view name);

/** A named chord-progression preset expressed in scale degrees (`ProgressionPreset`). */
struct ProgressionPreset {
  std::string id;
  std::string name;
  /** The chord roots, in order: 1..7 for the key's scale degrees, BORROWED_DEGREES for others. */
  std::vector<int> degrees;
  ProgFunction functional = ProgFunction::kLoop;
  std::vector<ProgStyle> styles;
};

/** The codes of the borrowed (non-diatonic) chord roots a preset can name (`BORROWED_DEGREES`). */
struct BorrowedDegrees {
  /** Flat submediant: bVI. */
  int bVI;
  /** Flat subtonic: bVII. */
  int bVII;
  /** Flat mediant: bIII. */
  int bIII;
  /** Minor subdominant borrowed from the parallel minor: iv. */
  int iv;
  /** Neapolitan: bII. */
  int bII;
  /** Sharp subdominant, the diminished #IV. */
  int sharpIV;
};

/** The borrowed degree codes. */
extern const BorrowedDegrees BORROWED_DEGREES;

/** A caller's own progression: only `degrees` is required (`Partial<ProgressionPreset>`). */
struct ProgressionPresetInput {
  explicit ProgressionPresetInput(std::vector<int> degrees_) : degrees(std::move(degrees_)) {}

  std::optional<std::string> id;
  std::optional<std::string> name;
  std::vector<int> degrees;
  std::optional<ProgFunction> functional;
  std::optional<std::vector<ProgStyle>> styles;
};

/** Options of generate_progression() (`ProgressionOptions`). */
struct ProgressionOptions {
  ProgressionOptions(KeyArg key_, ProgStyle style_, int bars_)
      : key(std::move(key_)), style(style_), bars(bars_) {}

  /** The key the degrees are resolved against. */
  KeyArg key;
  /** Which pool of built-in presets to choose from; ignored when a preset names the progression. */
  ProgStyle style;
  int bars;
  /** The meter the bars are counted in; 4/4 when absent. */
  std::optional<MeterArg> ts;
  /** Pick a specific built-in preset by id instead of choosing one by style. */
  std::optional<std::string> presetId;
  /** Use this progression rather than a built-in one. */
  std::optional<ProgressionPresetInput> preset;
  /** The quality forced on every chord; each takes its diatonic triad quality when absent. */
  std::optional<ChordQuality> ext;
  /** The generation context; `{ seed: 0 }` when absent. */
  std::optional<GenerationContextInput> ctx;
};

/** All built-in progression presets (`progressions`). */
std::vector<ProgressionPreset> progressions();

/** Presets whose style list includes the given style (`progressionsByStyle`). */
std::vector<ProgressionPreset> progressions_by_style(ProgStyle style);

/**
 * The preset generate_progression() would choose for a style and seed
 * (`pickProgressionPreset`).
 * @throws InvalidInputError if no preset claims the style.
 */
ProgressionPreset pick_progression_preset(ProgStyle style, const GenerationContextInput& ctx = 0U);

/**
 * Generate a chord progression laid out one chord per bar (`generateProgression`).
 * @throws InvalidInputError if the bars, the key, the context or the preset is malformed, or the
 *   preset id or the style names no preset.
 * @throws BudgetExceededError if the bars exceed the generation budget.
 */
std::vector<ChordSpan> generate_progression(const ProgressionOptions& opts);

}  // namespace cantus

#endif  // CANTUS_GENERATE_PROGRESSION_H_
