// Per-beat drum voice processors of ts/src/generate/drums/beat.ts.

#include "generate/drums/beat.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "generate/drums/ghost.h"
#include "generate/drums/swing.h"
#include "js/math.h"

namespace cantus {

namespace {

/** How much of the feel's swing a style takes when the caller named no feel. */
double style_swing_factor(DrumStyle style) {
  if (style == DrumStyle::kTrap) {
    return 0;
  }
  if (style == DrumStyle::kLatin) {
    return 0.35;
  }
  return 1;
}

/** The one swing amount every voice of a section shares (`sectionSwing`). */
double section_swing(const SectionCtx& sec, double swing_amount) {
  double swing = effective_swing(sec.feel, swing_amount);
  return sec.feelRequested ? swing : swing * style_swing_factor(sec.style);
}

/** One stroke of the backbeat voice (`BackbeatStroke`). */
struct BackbeatStroke {
  int pitch;
  double velocity;
};

/** How loudly a role plays the backbeat, relative to the beat it lands on. */
double role_backbeat_weight(DrumRole role) {
  if (role == DrumRole::kMinimal) {
    return 0.65;
  }
  return role == DrumRole::kAmbient ? 0.8 : 1;
}

/** The drum a section states its backbeat on, or none (`backbeatVoice`). */
std::optional<int> backbeat_voice(const SectionCtx& sec) {
  if (sec.role == DrumRole::kFxOnly) {
    return std::nullopt;
  }
  bool side_stick = sec.style == DrumStyle::kLatin || sec.role == DrumRole::kAmbient ||
                    sec.role == DrumRole::kMinimal;
  return side_stick ? kGm.SIDESTICK : kGm.SD;
}

/** Whether a section decorates its backbeat with ghost snares (`writesSnareGhosts`). */
bool writes_snare_ghosts(const SectionCtx& sec) {
  return backbeat_voice(sec) == kGm.SD && sec.style != DrumStyle::kSparse;
}

/** The backbeat stroke of a section, at the weight its role plays it (`backbeatStroke`). */
std::optional<BackbeatStroke> backbeat_stroke(const SectionCtx& sec, double velocity) {
  std::optional<int> pitch = backbeat_voice(sec);
  if (!pitch) {
    return std::nullopt;
  }
  if (*pitch == kGm.SD) {
    return BackbeatStroke{*pitch, js::min(127, velocity + BACKBEAT_LIFT)};
  }
  return BackbeatStroke{*pitch, velocity * role_backbeat_weight(sec.role)};
}

bool contains(const std::vector<double>& beats, double beat) {
  return std::find(beats.begin(), beats.end(), beat) != beats.end();
}

/** Whether the downbeat of this beat carries an open hi-hat accent (`opensOnDownbeat`). */
bool opens_on_downbeat(const BeatCtx& ctx, const SectionCtx& sec) {
  if (uses_offbeat_open_hi_hat(sec.style)) {
    return false;
  }
  return should_add_open_hh_accent(ctx.section, ctx.beat, ctx.bar, ctx.draw);
}

/** Whether the "and" of this beat carries an open hi-hat (`opensOffbeat`). */
bool opens_offbeat(const BeatCtx& ctx, const SectionCtx& sec) {
  if (!uses_offbeat_open_hi_hat(sec.style) || (ctx.beat != 1 && ctx.beat != 3)) {
    return false;
  }
  return ctx.draw.prob(offbeat_open_hi_hat_chance(ctx.bpm), {"openHat", ctx.bar, ctx.beat, 1.0});
}

}  // namespace

double swing16(double tick, const SectionCtx& sec, double swing_amount) {
  return quantize_swing(tick, section_swing(sec, swing_amount), SwingResolution::kSixteenth);
}

void generate_kick_for_beat(const BeatCtx& ctx, const SectionCtx& sec, const KickPattern& kick) {
  if (ctx.inPrechorusLift) {
    return;
  }
  double sixteenths = static_cast<double>(kick.size()) / 4;
  for (double step = 0; step < sixteenths; step += 1) {
    double index = ctx.beat * sixteenths + step;
    if (!(index >= 0 && index < static_cast<double>(kick.size()) &&
          kick[static_cast<std::size_t>(index)])) {
      continue;
    }
    if (step == 0) {
      ctx.track.add(kGm.BD, ctx.beatTick, DRUM_EIGHTH, ctx.velocity);
      continue;
    }
    bool off_beat = std::fmod(step, 2) == 1;
    if (off_beat && !sustains_strokes(DRUM_SIXTEENTH, ctx.bpm, sec.difficulty)) {
      continue;
    }
    double tick = swing16(ctx.beatTick + step * DRUM_SIXTEENTH, sec, ctx.swingAmount);
    ctx.track.add(kGm.BD, tick, off_beat ? DRUM_SIXTEENTH : DRUM_EIGHTH, ctx.velocity * 0.85);
  }
}

void generate_snare_for_beat(const BeatCtx& ctx, const SectionCtx& sec, bool is_intro_first) {
  if (ctx.inPrechorusLift) {
    return;
  }
  if (!contains(backbeat_beats(sec.snareBeat3), ctx.beat) || is_intro_first) {
    return;
  }
  std::optional<BackbeatStroke> stroke = backbeat_stroke(sec, ctx.velocity);
  if (!stroke) {
    return;
  }
  ctx.track.add(stroke->pitch, ctx.beatTick, DRUM_EIGHTH, stroke->velocity);
}

void generate_ghost_notes_for_beat(const BeatCtx& ctx, const SectionCtx& sec) {
  // The one gate on the voice: no exit path writes a snare-head ghost into another backbeat.
  if (!writes_snare_ghosts(sec)) {
    return;
  }
  // The beat before each backbeat, wherever the groove puts its backbeat.
  std::vector<double> lead_ins;
  for (double beat : backbeat_beats(sec.snareBeat3)) {
    lead_ins.push_back(std::fmod(beat - 1 + FOUR_FOUR_BEATS, FOUR_FOUR_BEATS));
  }
  if (!contains(lead_ins, ctx.beat)) {
    return;
  }
  // The ornament dial decides how many survive; the ceiling decides whether 16ths are reachable.
  if (!sustains_strokes(DRUM_SIXTEENTH, ctx.bpm, sec.difficulty)) {
    return;
  }
  std::vector<GhostPosition> positions = select_ghost_positions(sec.ghostMood);
  double ghost_prob =
      leaned_by(get_ghost_density(sec.ghostMood, ctx.section, ctx.bpm), sec.ornament);
  if (sec.ghostBoost) {
    ghost_prob = js::min(1, ghost_prob * 1.4);
  }
  for (GhostPosition pos : positions) {
    int sixteenth_in_beat = pos == GhostPosition::kE ? 1 : 3;
    double pos_prob = get_ghost_probability_at_position(ctx.beat, sixteenth_in_beat, lead_ins);
    std::string name(to_string(pos));
    if (!ctx.draw.prob(ghost_prob * pos_prob, {"ghost", ctx.bar, ctx.beat, name})) {
      continue;
    }
    double variation = ctx.draw.float_(0.85, 1.15, {"ghostVelocity", ctx.bar, ctx.beat, name});
    double ghost_base = get_ghost_velocity(ctx.section, ctx.beat / 2);
    double ghost_vel = ctx.velocity * ghost_base * variation;
    if (pos == GhostPosition::kA) {
      ghost_vel *= 0.9;
    }
    double offset = pos == GhostPosition::kE ? DRUM_SIXTEENTH : 3 * DRUM_SIXTEENTH;
    double tick = swing16(ctx.beatTick + offset, sec, ctx.swingAmount);
    ctx.track.add(kGm.SD, tick, DRUM_SIXTEENTH, ghost_vel);
  }
}

void generate_pre_chorus_buildup(const BeatCtx& ctx, const SectionCtx& sec,
                                 bool is_section_last_bar) {
  if (sec.style == DrumStyle::kSparse) {
    if (is_section_last_bar && ctx.beat == 3) {
      ctx.track.add(kGm.SD, ctx.beatTick, DRUM_EIGHTH, js::max(45, ctx.velocity * 0.75));
      ctx.track.add(kGm.CRASH, ctx.beatTick + DRUM_EIGHTH + DRUM_SIXTEENTH, DRUM_SIXTEENTH,
                    ctx.velocity * 0.9);
    }
    return;
  }
  double bars_in_lift = 2;
  double bar_in_lift = ctx.bar - (ctx.sectionBars - bars_in_lift);
  double progress = (bar_in_lift * 4 + ctx.beat) / (bars_in_lift * 4);
  double buildup_vel = ctx.velocity * (0.5 + 0.5 * progress);
  // The lift is a stream on one voice, so the ceiling decides how fine it may be written.
  bool takes_eighths = sustains_strokes(DRUM_EIGHTH, ctx.bpm, sec.difficulty);
  if (takes_eighths || sustains_strokes(DRUM_QUARTER, ctx.bpm, sec.difficulty)) {
    ctx.track.add(kGm.SD, ctx.beatTick, DRUM_EIGHTH, buildup_vel);
  }
  if (takes_eighths) {
    ctx.track.add(kGm.SD, swing16(ctx.beatTick + DRUM_EIGHTH, sec, ctx.swingAmount), DRUM_EIGHTH,
                  buildup_vel * 0.85);
  }
  if (is_section_last_bar && ctx.beat == 3) {
    ctx.track.add(kGm.CRASH,
                  swing16(ctx.beatTick + DRUM_EIGHTH + DRUM_SIXTEENTH, sec, ctx.swingAmount),
                  DRUM_SIXTEENTH, ctx.velocity * 1.1);
  }
}

void generate_hi_hat_for_beat(const BeatCtx& ctx, const SectionCtx& sec) {
  if (!should_play_hi_hat(sec.role)) {
    return;
  }
  int hh_instrument = role_hi_hat_instrument(sec.role, sec.useRide);
  HiHatType hh_type = section_hi_hat_type(ctx.section, sec.role);
  double type_mult = hi_hat_type_velocity_multiplier(hh_type);
  bool allows_open_hi_hat = sec.role != DrumRole::kAmbient && sec.role != DrumRole::kMinimal;
  bool is_dynamic_open =
      ctx.barHasOpenHh && ctx.beat == ctx.openHhBeat && !uses_offbeat_open_hi_hat(sec.style);
  double dm = sec.densityMult;

  if (ctx.hhLevel == HiHatLevel::kQuarter) {
    // The intro's quarter grid rests between its downbeats.
    if (ctx.section == SectionType::kIntro && ctx.beat != 0) {
      return;
    }
    double hh_vel = js::max(20, ctx.velocity * dm * 0.75 * type_mult);
    if (allows_open_hi_hat && is_dynamic_open) {
      ctx.track.add(kGm.OHH, ctx.beatTick, DRUM_EIGHTH, hh_vel + OHH_VEL_BOOST);
    } else if (allows_open_hi_hat && opens_on_downbeat(ctx, sec)) {
      ctx.track.add(hi_hat_note(HiHatType::kOpen), ctx.beatTick, DRUM_EIGHTH,
                    js::max(20, hh_vel * 1.1));
    } else {
      ctx.track.add(hh_instrument, ctx.beatTick, DRUM_EIGHTH, hh_vel);
    }
    return;
  }

  if (ctx.hhLevel == HiHatLevel::kEighth) {
    for (double eighth = 0; eighth < 2; eighth += 1) {
      double hh_tick = ctx.beatTick + eighth * DRUM_EIGHTH;
      if (eighth == 1) {
        hh_tick = swing16(hh_tick, sec, ctx.swingAmount);
      }
      if (ctx.section == SectionType::kIntro && eighth == 1) {
        if (sec.useFootHh && std::fmod(ctx.beat, 2) == 0) {
          ctx.track.add(kGm.FHH, hh_tick, DRUM_EIGHTH,
                        foot_hi_hat_velocity(ctx.draw, ctx.bar, ctx.beat));
        }
        continue;
      }
      double hh_vel = js::max(20, ctx.velocity * dm * type_mult * (eighth == 0 ? 0.9 : 0.65));
      if (is_dynamic_open && allows_open_hi_hat && eighth == 0) {
        ctx.track.add(kGm.OHH, hh_tick, DRUM_EIGHTH, hh_vel + OHH_VEL_BOOST);
        continue;
      }
      bool use_open = eighth == 0 ? opens_on_downbeat(ctx, sec) : opens_offbeat(ctx, sec);
      if (use_open && allows_open_hi_hat) {
        ctx.track.add(hi_hat_note(HiHatType::kOpen), hh_tick, DRUM_EIGHTH,
                      js::max(20, hh_vel * 1.1));
      } else {
        ctx.track.add(hh_instrument, hh_tick, DRUM_EIGHTH / 2, hh_vel);
      }
    }
    return;
  }

  for (double sixteenth = 0; sixteenth < 4; sixteenth += 1) {
    double hh_tick = ctx.beatTick + sixteenth * DRUM_SIXTEENTH;
    // Every off-beat sixteenth goes through the shared grid, the "and" included.
    if (sixteenth != 0) {
      hh_tick = swing16(hh_tick, sec, ctx.swingAmount);
    }
    double metric_vel = hi_hat_velocity_multiplier(
        static_cast<int>(sixteenth),
        ctx.draw.float_(0.95, 1.05, {"hatVelocity", ctx.bar, ctx.beat, sixteenth}));
    double hh_vel = js::max(20, ctx.velocity * dm * type_mult * metric_vel);
    if (is_dynamic_open && allows_open_hi_hat && sixteenth == 0) {
      ctx.track.add(kGm.OHH, hh_tick, DRUM_SIXTEENTH, hh_vel + OHH_VEL_BOOST);
      continue;
    }
    // The accents of the coarser grids are taken here too, at the positions they write them on.
    if (allows_open_hi_hat && sixteenth == 0 && opens_on_downbeat(ctx, sec)) {
      ctx.track.add(hi_hat_note(HiHatType::kOpen), hh_tick, DRUM_SIXTEENTH,
                    js::max(20, hh_vel * 1.1));
      continue;
    }
    if (allows_open_hi_hat && sixteenth == 2 && opens_offbeat(ctx, sec)) {
      ctx.track.add(hi_hat_note(HiHatType::kOpen), hh_tick, DRUM_SIXTEENTH,
                    js::max(20, hh_vel * 1.1));
      continue;
    }
    if (allows_open_hi_hat && ctx.beat == 3 && sixteenth == 3) {
      double open_prob = js::max(0.1, js::min(0.4, 30 / ctx.bpm));
      if (ctx.draw.prob(open_prob, {"openHat", ctx.bar, ctx.beat, sixteenth})) {
        ctx.track.add(kGm.OHH, hh_tick, DRUM_SIXTEENTH, js::max(20, hh_vel * 1.2));
        continue;
      }
    }
    ctx.track.add(hh_instrument, hh_tick, DRUM_SIXTEENTH / 2, hh_vel);
  }
}

}  // namespace cantus
