/**
 * @file beat.h
 * @brief Internal pieces of ts/src/generate/drums/beat.ts: the per-beat voice processors of the
 *        groove generator and the swung grid they share.
 */
#ifndef CANTUS_SRC_GENERATE_DRUMS_BEAT_H_
#define CANTUS_SRC_GENERATE_DRUMS_BEAT_H_

#include <optional>

#include "cantus/generate/context.h"
#include "cantus/generate/drums.h"
#include "generate/drums/hihat.h"
#include "generate/drums/hit.h"
#include "generate/drums/internal.h"

namespace cantus {

/** Per-section drum state shared across the bars of a section (`SectionCtx`). */
struct SectionCtx {
  DrumStyle style;
  GrooveFeel feel;
  /** Whether the feel is the caller's own request rather than the style's. */
  bool feelRequested;
  double densityMult;
  /** Rhythmic dial in [0, 1]. */
  double rhythmic;
  /** Ornament dial in [0, 1]. */
  double ornament;
  /** Difficulty ceiling, absent when the caller set none. */
  std::optional<double> difficulty;
  bool ghostBoost;
  bool useRide;
  bool useFootHh;
  DrumRole role;
  MoodCategory ghostMood;
  bool snareBeat3;
};

/** Per-beat context passed to every beat processor (`BeatCtx`). */
struct BeatCtx {
  HitList<DrumHit>& track;
  double beatTick;
  double beat;
  double velocity;
  SectionType section;
  double bpm;
  double bar;
  double sectionBars;
  bool inPrechorusLift;
  double swingAmount;
  bool barHasOpenHh;
  double openHhBeat;
  /** Hi-hat subdivision for this bar. */
  HiHatLevel hhLevel;
  const Draw& draw;
};

/** Place a tick on the section's shared swung sixteenth grid (`swing16`). */
double swing16(double tick, const SectionCtx& sec, double swing_amount);

/** Emit the kick for one beat (`generateKickForBeat`). */
void generate_kick_for_beat(const BeatCtx& ctx, const SectionCtx& sec, const KickPattern& kick);

/** Emit the backbeat snare or side-stick for one beat (`generateSnareForBeat`). */
void generate_snare_for_beat(const BeatCtx& ctx, const SectionCtx& sec, bool is_intro_first);

/** Emit ghost snares leading into the backbeat (`generateGhostNotesForBeat`). */
void generate_ghost_notes_for_beat(const BeatCtx& ctx, const SectionCtx& sec);

/** Emit the pre-chorus lift buildup for one beat (`generatePreChorusBuildup`). */
void generate_pre_chorus_buildup(const BeatCtx& ctx, const SectionCtx& sec,
                                 bool is_section_last_bar);

/** Emit the timekeeping hi-hat, ride or foot for one beat (`generateHiHatForBeat`). */
void generate_hi_hat_for_beat(const BeatCtx& ctx, const SectionCtx& sec);

}  // namespace cantus

#endif  // CANTUS_SRC_GENERATE_DRUMS_BEAT_H_
