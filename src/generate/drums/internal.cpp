// Shared drum-engine definitions of ts/src/generate/drums/internal.ts.

#include "generate/drums/internal.h"

#include <cstddef>

#include "generate/drums/limits.gen.h"
#include "generate/vocabulary/types.h"
#include "js/math.h"

namespace cantus {

namespace {

/** A generated STYLE_MAP row, with the style and feel still by name. */
struct StyleMapRow {
  std::string_view key;
  struct {
    std::string_view style;
    std::string_view feel;
    bool ghostBoost;
    bool snareBeat3;
  } mapping;
};

constexpr std::array<StyleMapRow, kGrooveStyleNames.size()> kStyleMap = {
#include "generate/drums/style_map.gen.inc"
};

constexpr bool style_map_in_order() {
  for (std::size_t i = 0; i < kStyleMap.size(); ++i) {
    if (kStyleMap[i].key != kGrooveStyleNames[i]) {
      return false;
    }
  }
  return true;
}
static_assert(style_map_in_order(), "STYLE_MAP and GROOVE_STYLES disagree");

}  // namespace

std::string_view to_string(Section section) {
  return kSectionNames[static_cast<std::size_t>(section)];
}

std::optional<Section> parse_section(std::string_view name) {
  return parse_named<Section>(kSectionNames, name);
}

std::string_view to_string(DrumStyle style) {
  switch (style) {
    case DrumStyle::kSparse:
      return "sparse";
    case DrumStyle::kStandard:
      return "standard";
    case DrumStyle::kFourOnFloor:
      return "fourOnFloor";
    case DrumStyle::kUpbeat:
      return "upbeat";
    case DrumStyle::kRock:
      return "rock";
    case DrumStyle::kSynth:
      return "synth";
    case DrumStyle::kTrap:
      return "trap";
    case DrumStyle::kLatin:
      return "latin";
  }
  return "standard";
}

std::optional<DrumStyle> parse_drum_style(std::string_view name) {
  for (DrumStyle style :
       {DrumStyle::kSparse, DrumStyle::kStandard, DrumStyle::kFourOnFloor, DrumStyle::kUpbeat,
        DrumStyle::kRock, DrumStyle::kSynth, DrumStyle::kTrap, DrumStyle::kLatin}) {
    if (to_string(style) == name) {
      return style;
    }
  }
  return std::nullopt;
}

std::string_view to_string(GrooveFeel feel) { return kFeelNames[static_cast<std::size_t>(feel)]; }

std::optional<GrooveFeel> parse_groove_feel(std::string_view name) {
  return parse_named<GrooveFeel>(kFeelNames, name);
}

std::string_view to_string(GrooveStyle style) {
  return kGrooveStyleNames[static_cast<std::size_t>(style)];
}

std::optional<GrooveStyle> parse_groove_style(std::string_view name) {
  return parse_named<GrooveStyle>(kGrooveStyleNames, name);
}

std::string_view to_string(DrumRole role) { return kDrumRoleNames[static_cast<std::size_t>(role)]; }

std::optional<DrumRole> parse_drum_role(std::string_view name) {
  return parse_named<DrumRole>(kDrumRoleNames, name);
}

std::vector<std::string_view> feel_names() { return names_of(kFeelNames); }
std::vector<std::string_view> groove_style_names() { return names_of(kGrooveStyleNames); }
std::vector<std::string_view> drum_role_names() { return names_of(kDrumRoleNames); }
std::vector<std::string_view> section_names() { return names_of(kSectionNames); }

std::vector<double> backbeat_beats(bool snare_beat3, double bar_beats) {
  if (snare_beat3) {
    return bar_beats > 2 ? std::vector<double>{2} : std::vector<double>{};
  }
  std::vector<double> beats;
  for (double beat = 1; beat < bar_beats; beat += 2) {
    beats.push_back(beat);
  }
  return beats;
}

StyleMapping map_style(GrooveStyle style) {
  const StyleMapRow& row = kStyleMap[static_cast<std::size_t>(style)];
  return StyleMapping{*parse_drum_style(row.mapping.style), *parse_groove_feel(row.mapping.feel),
                      row.mapping.ghostBoost, row.mapping.snareBeat3};
}

SectionType map_section(Section section) {
  switch (section) {
    case Section::kIntro:
      return SectionType::kIntro;
    case Section::kVerse:
      return SectionType::kA;
    case Section::kPrechorus:
      return SectionType::kB;
    case Section::kChorus:
      return SectionType::kChorus;
    case Section::kBridge:
      return SectionType::kBridge;
    case Section::kOutro:
      return SectionType::kOutro;
  }
  return SectionType::kA;
}

double backing_scale(double rhythmic) {
  return BACKING_SCALE_FLOOR + (BACKING_SCALE_CEILING - BACKING_SCALE_FLOOR) * rhythmic;
}

double leaned_by(double probability, double rhythmic) {
  return js::max(0, js::min(1, probability * (0.5 + rhythmic)));
}

double feel_swing_amount(GrooveFeel feel) {
  if (feel == GrooveFeel::kSwing) {
    return 2.0 / 3;
  }
  if (feel == GrooveFeel::kShuffle) {
    return 1;
  }
  return 0;
}

MoodCategory ghost_mood_category(DrumStyle style) {
  if (style == DrumStyle::kSparse) {
    return MoodCategory::kCalm;
  }
  if (style == DrumStyle::kTrap || style == DrumStyle::kUpbeat) {
    return MoodCategory::kEnergetic;
  }
  return MoodCategory::kStandard;
}

PercMoodCategory perc_mood_category(DrumStyle style) {
  switch (style) {
    case DrumStyle::kSparse:
      return PercMoodCategory::kCalm;
    case DrumStyle::kUpbeat:
    case DrumStyle::kLatin:
      return PercMoodCategory::kEnergetic;
    case DrumStyle::kFourOnFloor:
      return PercMoodCategory::kIdol;
    case DrumStyle::kTrap:
    case DrumStyle::kRock:
      return PercMoodCategory::kRockDark;
    default:
      return PercMoodCategory::kStandard;
  }
}

int section_index(SectionType section) {
  switch (section) {
    case SectionType::kIntro:
      return 0;
    case SectionType::kA:
      return 1;
    case SectionType::kB:
      return 2;
    case SectionType::kChorus:
      return 3;
    case SectionType::kBridge:
      return 4;
    case SectionType::kOutro:
      return 5;
  }
  return 1;
}

SectionEnergy section_energy(SectionType section) {
  switch (section) {
    case SectionType::kIntro:
    case SectionType::kOutro:
      return SectionEnergy::kLow;
    case SectionType::kA:
    case SectionType::kBridge:
      return SectionEnergy::kMedium;
    case SectionType::kB:
      return SectionEnergy::kHigh;
    case SectionType::kChorus:
      return SectionEnergy::kPeak;
  }
  return SectionEnergy::kMedium;
}

double section_velocity_multiplier(SectionType section) {
  switch (section) {
    case SectionType::kIntro:
    case SectionType::kOutro:
      return 0.8;
    case SectionType::kA:
      return 0.9;
    case SectionType::kB:
      return 1.0;
    case SectionType::kChorus:
      return 1.1;
    case SectionType::kBridge:
      return 0.85;
  }
  return 1.0;
}

double section_density_multiplier(SectionType section) {
  switch (section) {
    case SectionType::kIntro:
      return 0.5;
    case SectionType::kA:
      return 0.7;
    case SectionType::kB:
      return 0.85;
    case SectionType::kChorus:
      return 1.0;
    case SectionType::kBridge:
      return 0.6;
    case SectionType::kOutro:
      return 0.6;
  }
  return 1.0;
}

double calculate_velocity(SectionType section, double beat) {
  double base = 80;
  double beat_adj = beat == 0 ? 10 : beat == 2 ? 5 : 0;
  return clamp_velocity((base + beat_adj) * section_velocity_multiplier(section));
}

bool is_midi_pitch(double pitch) { return pitch >= 0 && pitch <= 127; }

double clamp_velocity(double velocity) {
  return js::max(DRUM_MIN_VELOCITY, js::min(DRUM_MAX_VELOCITY, js::round(velocity)));
}

}  // namespace cantus
