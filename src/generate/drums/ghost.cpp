// Ghost-note shaping of ts/src/generate/drums/ghost.ts.

#include "generate/drums/ghost.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <string_view>

#include "js/math.h"

namespace cantus {

namespace {

/** One GHOST_DENSITY_TABLE row: a section's density level per mood category. */
struct GhostDensityRow {
  std::string_view section;
  std::vector<int> levels;
};

const std::array<GhostDensityRow, 6>& ghost_density_table() {
  static const std::array<GhostDensityRow, 6> rows = {
#include "generate/drums/ghost_density_table.gen.inc"
  };
  return rows;
}

/** Trigger probability at each density level (`GHOST_LEVEL_PROBABILITY`). */
constexpr std::array<double, 4> kGhostLevelProbability =
#include "generate/drums/ghost_level_probability.gen.inc"
    ;
static_assert(kGhostLevelProbability.back() > 0, "GHOST_LEVEL_PROBABILITY has four levels");

std::string_view table_key(SectionType section) {
  switch (section) {
    case SectionType::kIntro:
      return "intro";
    case SectionType::kA:
      return "a";
    case SectionType::kB:
      return "b";
    case SectionType::kChorus:
      return "chorus";
    case SectionType::kBridge:
      return "bridge";
    case SectionType::kOutro:
      return "outro";
  }
  return "a";
}

const std::vector<int>& density_row(SectionType section) {
  std::string_view key = table_key(section);
  for (const GhostDensityRow& row : ghost_density_table()) {
    if (row.section == key) {
      return row.levels;
    }
  }
  return density_row(SectionType::kA);
}

double clamp_level(double level) { return js::max(0, js::min(3, level)); }

double adjust_for_bpm(double level, double bpm) {
  if (bpm >= 160 && level != 0) {
    return clamp_level(level - 1);
  }
  if (bpm <= 90 && level != 3) {
    return clamp_level(level + 1);
  }
  return level;
}

}  // namespace

std::string_view to_string(GhostPosition position) {
  return position == GhostPosition::kE ? "e" : "a";
}

double get_ghost_density(MoodCategory mood, SectionType section, double bpm) {
  const std::vector<int>& row = density_row(section);
  std::size_t column = static_cast<std::size_t>(mood);
  double level = adjust_for_bpm(column < row.size() ? row[column] : 0, bpm);
  return kGhostLevelProbability[static_cast<std::size_t>(level)];
}

double get_ghost_velocity(SectionType section, double beat_position) {
  double base = 0.4;
  double even = std::fmod(beat_position, 2) == 0 ? 0.05 : 0;
  switch (section) {
    case SectionType::kA:
      base = 0.35 + even;
      break;
    case SectionType::kChorus:
      base = 0.5 + even;
      break;
    case SectionType::kBridge:
      base = 0.25 + even;
      break;
    case SectionType::kB:
      base = 0.4 + even;
      break;
    case SectionType::kIntro:
    case SectionType::kOutro:
      base = 0.38;
      break;
  }
  return js::max(0.25, js::min(0.65, base));
}

double get_ghost_probability_at_position(double beat, int sixteenth_in_beat,
                                         const std::vector<double>& lead_ins) {
  bool leads_into_backbeat =
      std::find(lead_ins.begin(), lead_ins.end(), beat) != lead_ins.end() && sixteenth_in_beat == 3;
  return leads_into_backbeat ? 0.6 : 0.25;
}

std::vector<GhostPosition> select_ghost_positions(MoodCategory mood) {
  if (mood == MoodCategory::kEnergetic) {
    return {GhostPosition::kE, GhostPosition::kA};
  }
  return {GhostPosition::kE};
}

}  // namespace cantus
