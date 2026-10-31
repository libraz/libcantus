// Hi-hat shaping of ts/src/generate/drums/hihat.ts.

#include "generate/drums/hihat.h"

#include <cmath>
#include <cstdint>
#include <limits>

#include "js/math.h"

namespace cantus {

namespace {

HiHatLevel sparser(HiHatLevel level) {
  if (level == HiHatLevel::kSixteenth) {
    return HiHatLevel::kEighth;
  }
  return HiHatLevel::kQuarter;
}

HiHatLevel denser(HiHatLevel level) {
  if (level == HiHatLevel::kQuarter) {
    return HiHatLevel::kEighth;
  }
  return HiHatLevel::kSixteenth;
}

}  // namespace

bool should_play_hi_hat(DrumRole role) { return role != DrumRole::kFxOnly; }

int role_hi_hat_instrument(DrumRole role, bool use_ride) {
  if (role == DrumRole::kAmbient) {
    return kGm.RIDE;
  }
  if (role == DrumRole::kMinimal) {
    return kGm.FHH;
  }
  return use_ride ? kGm.RIDE : kGm.CHH;
}

double hi_hat_step(HiHatLevel level) {
  if (level == HiHatLevel::kSixteenth) {
    return 0.25;
  }
  return level == HiHatLevel::kEighth ? 0.5 : 1;
}

HiHatBar get_hi_hat_bar(SectionType section, DrumStyle style, double rhythmic, double bpm,
                        const Draw& draw, std::optional<double> difficulty, double bar) {
  bool allow16th = bpm < HH_16TH_BPM_THRESHOLD;
  HiHatLevel base = HiHatLevel::kEighth;
  bool dialed = true;
  if (style == DrumStyle::kSparse) {
    base = section == SectionType::kChorus ? HiHatLevel::kEighth : HiHatLevel::kQuarter;
  } else if (style == DrumStyle::kFourOnFloor) {
    base = allow16th && section == SectionType::kChorus && draw.prob(0.25, {"hhLevel"})
               ? HiHatLevel::kSixteenth
               : HiHatLevel::kEighth;
    dialed = false;
  } else if (style == DrumStyle::kSynth) {
    base = !allow16th || (section == SectionType::kA && draw.prob(0.2, {"hhLevel"}))
               ? HiHatLevel::kEighth
               : HiHatLevel::kSixteenth;
    dialed = false;
  } else if (style == DrumStyle::kTrap) {
    base = allow16th ? HiHatLevel::kSixteenth : HiHatLevel::kEighth;
    dialed = false;
  } else if (style == DrumStyle::kLatin) {
    base = allow16th && section == SectionType::kChorus && draw.prob(0.3, {"hhLevel"})
               ? HiHatLevel::kSixteenth
               : HiHatLevel::kEighth;
    dialed = false;
  } else {
    switch (section) {
      case SectionType::kIntro:
        base = HiHatLevel::kQuarter;
        break;
      case SectionType::kOutro:
        base = HiHatLevel::kEighth;
        break;
      case SectionType::kA:
        base = draw.prob(0.3, {"hhLevel"}) ? HiHatLevel::kQuarter : HiHatLevel::kEighth;
        break;
      case SectionType::kB:
        base = allow16th && draw.prob(0.25, {"hhLevel"}) ? HiHatLevel::kSixteenth
                                                         : HiHatLevel::kEighth;
        break;
      case SectionType::kChorus:
        base = allow16th && draw.prob(0.35, {"hhLevel"}) ? HiHatLevel::kSixteenth
                                                         : HiHatLevel::kEighth;
        break;
      case SectionType::kBridge:
        base = HiHatLevel::kEighth;
        break;
    }
  }

  // The tempo and the ceiling bound every level the dial can reach alike.
  auto playable = [allow16th, bpm, difficulty](HiHatLevel proposed) {
    HiHatLevel level =
        !allow16th && proposed == HiHatLevel::kSixteenth ? HiHatLevel::kEighth : proposed;
    while (level != HiHatLevel::kQuarter &&
           !sustains_strokes(hi_hat_step(level), bpm, difficulty)) {
      level = sparser(level);
    }
    return level;
  };

  HiHatLevel level = base;
  double thinned_up_to = -std::numeric_limits<double>::infinity();
  double filled_above = std::numeric_limits<double>::infinity();
  if (dialed) {
    // The middle of the dial is the style's own level: the lower half thins, the upper fills.
    double thin = draw.at({"hhThin", bar});
    if (thin >= 2 * rhythmic) {
      level = sparser(level);
    }
    double fill = draw.at({"hhFill", bar});
    if (fill < 2 * rhythmic - 1) {
      level = denser(level);
    }
    thinned_up_to = thin / 2;
    filled_above = (fill + 1) / 2;
  }

  auto rank = [](HiHatLevel candidate) { return static_cast<int>(candidate); };
  int sparsest = rank(playable(dialed ? sparser(base) : base));
  int middle = rank(playable(base));
  int densest = rank(playable(dialed ? denser(base) : base));
  auto entry_of = [&](HiHatLevel grid) {
    return sparsest >= rank(grid)  ? -std::numeric_limits<double>::infinity()
           : middle >= rank(grid)  ? thinned_up_to
           : densest >= rank(grid) ? filled_above
                                   : std::numeric_limits<double>::infinity();
  };
  return HiHatBar{playable(level),
                  {entry_of(HiHatLevel::kQuarter), entry_of(HiHatLevel::kEighth),
                   entry_of(HiHatLevel::kSixteenth)}};
}

double hi_hat_velocity_multiplier(int sixteenth, double jitter) {
  switch (sixteenth) {
    case 0:
      return 0.95 * jitter;
    case 2:
      return 0.75 * jitter;
    case 1:
      return 0.55 * jitter;
    default:
      return 0.5 * jitter;
  }
}

double open_hi_hat_bar_interval(SectionType section, DrumStyle style) {
  if (style == DrumStyle::kSparse) {
    return section == SectionType::kChorus ? 4 : 0;
  }
  switch (section) {
    case SectionType::kIntro:
      return style == DrumStyle::kFourOnFloor ? 4 : 0;
    case SectionType::kA:
      return style == DrumStyle::kFourOnFloor || style == DrumStyle::kUpbeat ? 2 : 4;
    case SectionType::kB:
      return 2;
    case SectionType::kChorus:
      return style == DrumStyle::kRock || style == DrumStyle::kFourOnFloor ? 1 : 2;
    case SectionType::kBridge:
      return 0;
    case SectionType::kOutro:
      return 4;
  }
  return 0;
}

double open_hi_hat_beat(SectionType section, const Draw& draw, double bar) {
  if (section == SectionType::kChorus) {
    std::int64_t choice = draw.range(0, 3, {"ohhBeat", bar});
    if (choice < 2) {
      return 3;
    }
    if (choice < 3) {
      return 1;
    }
    return 2;
  }
  return 3;
}

bool should_use_foot_hi_hat(SectionType section, DrumRole role) {
  if (role == DrumRole::kFxOnly) {
    return false;
  }
  switch (section) {
    case SectionType::kIntro:
    case SectionType::kBridge:
    case SectionType::kOutro:
      return true;
    default:
      return role == DrumRole::kAmbient || role == DrumRole::kMinimal;
  }
}

HiHatType section_hi_hat_type(SectionType section, DrumRole role) {
  if (role == DrumRole::kAmbient) {
    return HiHatType::kRide;
  }
  if (role == DrumRole::kMinimal) {
    return HiHatType::kPedal;
  }
  switch (section) {
    case SectionType::kIntro:
    case SectionType::kA:
      return HiHatType::kPedal;
    case SectionType::kB:
      return HiHatType::kClosed;
    case SectionType::kChorus:
      return HiHatType::kOpen;
    case SectionType::kBridge:
      return HiHatType::kRide;
    case SectionType::kOutro:
      return HiHatType::kHalfOpen;
  }
  return HiHatType::kClosed;
}

int hi_hat_note(HiHatType type) {
  switch (type) {
    case HiHatType::kPedal:
      return kGm.FHH;
    case HiHatType::kOpen:
      return kGm.OHH;
    case HiHatType::kRide:
      return kGm.RIDE;
    default:
      return kGm.CHH;
  }
}

double hi_hat_type_velocity_multiplier(HiHatType type) {
  switch (type) {
    case HiHatType::kHalfOpen:
      return 0.75;
    case HiHatType::kPedal:
      return 0.65;
    case HiHatType::kOpen:
      return 1.0;
    case HiHatType::kRide:
      return 0.9;
    default:
      return 0.85;
  }
}

bool should_add_open_hh_accent(SectionType section, double beat, double bar, const Draw& draw) {
  if (section != SectionType::kChorus && section != SectionType::kB) {
    return false;
  }
  if (section == SectionType::kChorus) {
    if (beat == 1 || beat == 3) {
      return draw.prob(0.6, {"ohhAccent", bar, beat});
    }
    return false;
  }
  if (beat == 3 && std::fmod(bar, 2) == 1) {
    return draw.prob(0.4, {"ohhAccent", bar, beat});
  }
  return false;
}

double foot_hi_hat_velocity(const Draw& draw, double bar, double beat) {
  return static_cast<double>(draw.range(FHH_VEL_MIN, FHH_VEL_MAX, {"fhhVelocity", bar, beat}));
}

bool uses_offbeat_open_hi_hat(DrumStyle style) { return style == DrumStyle::kFourOnFloor; }

double offbeat_open_hi_hat_chance(double bpm) { return js::max(0.15, js::min(0.8, 45 / bpm)); }

bool should_use_ride_for_section(SectionType section, DrumStyle style) {
  if (style == DrumStyle::kRock && section == SectionType::kChorus) {
    return true;
  }
  if (style == DrumStyle::kSparse) {
    return false;
  }
  return section == SectionType::kBridge;
}

}  // namespace cantus
