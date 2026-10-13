import type { Draw } from '../context/index.js';
import { sustainsStrokes } from '../context/index.js';
import {
  getGhostDensity,
  getGhostProbabilityAtPosition,
  getGhostVelocity,
  selectGhostPositions,
} from './ghost.js';
import {
  footHiHatVelocity,
  type HiHatLevel,
  hiHatNote,
  hiHatTypeVelocityMultiplier,
  hiHatVelocityMultiplier,
  OHH_VEL_BOOST,
  offbeatOpenHiHatChance,
  roleHiHatInstrument,
  sectionHiHatType,
  shouldAddOpenHHAccent,
  shouldPlayHiHat,
  usesOffbeatOpenHiHat,
} from './hihat.js';
import type { HitList } from './hit.js';
import type { DrumRole, DrumStyle, Feel, SectionType } from './internal.js';
import {
  BACKBEAT_LIFT,
  backbeatBeats,
  EIGHTH,
  GM,
  leanedBy,
  type MoodCategory,
  QUARTER,
  SIXTEENTH,
} from './internal.js';
import type { KickPattern } from './kick.js';
import { effectiveSwing, quantizeSwing } from './swing.js';

/** Per-section drum state shared across the bars of a section. */
export type SectionCtx = {
  style: DrumStyle;
  feel: Feel;
  /**
   * Whether the feel is the caller's own request rather than the one the style
   * implies. A named feel is taken at its word by every style.
   */
  feelRequested: boolean;
  densityMult: number;
  /** Rhythmic dial in [0, 1]: subdivision and syncopation. */
  rhythmic: number;
  /** Ornament dial in [0, 1]: how many ghosts and decorations survive. */
  ornament: number;
  /** Difficulty ceiling, or undefined when the caller set none. */
  difficulty: number | undefined;
  ghostBoost: boolean;
  useRide: boolean;
  useFootHh: boolean;
  role: DrumRole;
  ghostMood: MoodCategory;
  snareBeat3: boolean;
};

/** Per-beat context passed to every beat processor. */
export type BeatCtx = {
  track: HitList;
  beatTick: number;
  beat: number;
  velocity: number;
  section: SectionType;
  bpm: number;
  bar: number;
  sectionBars: number;
  inPrechorusLift: boolean;
  swingAmount: number;
  barHasOpenHh: boolean;
  openHhBeat: number;
  /** Hi-hat subdivision for this bar. */
  hhLevel: HiHatLevel;
  draw: Draw;
};

/**
 * How much of the feel's swing a style takes when the caller named no feel.
 *
 * These are the characters of the styles themselves: trap sits on a straight
 * (or triplet-hat) grid and latin only leans. They apply to the feel a style
 * implies, never to one the caller asked for — a request that comes back
 * unrecognisable is worse than one that comes back refused.
 */
function styleSwingFactor(style: DrumStyle): number {
  if (style === 'trap') {
    return 0;
  }
  if (style === 'latin') {
    return 0.35;
  }
  return 1;
}

/**
 * The one swing amount every voice of a section shares.
 *
 * Kick, hi-hat, and ghost notes must land on the same grid: when the kick's
 * "and" is fully swung and the hi-hat's is not, the two voices separate by tens
 * of milliseconds at the same notated position, which is audible as flamming
 * rather than as groove.
 */
function sectionSwing(sec: SectionCtx, swingAmount: number): number {
  const swing = effectiveSwing(sec.feel, swingAmount);
  return sec.feelRequested ? swing : swing * styleSwingFactor(sec.style);
}

/** Place a tick on the section's shared swung 16th grid. */
export function swing16(tick: number, sec: SectionCtx, swingAmount: number): number {
  return quantizeSwing(tick, sectionSwing(sec, swingAmount), 'sixteenth');
}

/**
 * Emit the kick for one beat.
 *
 * The grid is sixteenths. The downbeat of the beat sounds as written; every
 * other step is an off-beat kick, so it goes through the section's shared swung
 * grid and sits a little below the downbeat, as a player would place it. A kick
 * on an odd sixteenth is the one the ceiling can refuse: at that tempo the foot
 * does not get there, and the stroke is dropped rather than moved.
 */
export function generateKickForBeat(ctx: BeatCtx, sec: SectionCtx, kick: KickPattern): void {
  if (ctx.inPrechorusLift) {
    return;
  }
  const sixteenths = kick.length / 4;
  for (let step = 0; step < sixteenths; step += 1) {
    const index = ctx.beat * sixteenths + step;
    if (!kick[index]) {
      continue;
    }
    if (step === 0) {
      ctx.track.add(GM.BD, ctx.beatTick, EIGHTH, ctx.velocity);
      continue;
    }
    const offBeat = step % 2 === 1;
    if (offBeat && !sustainsStrokes(SIXTEENTH, ctx.bpm, sec.difficulty)) {
      continue;
    }
    const tick = swing16(ctx.beatTick + step * SIXTEENTH, sec, ctx.swingAmount);
    ctx.track.add(GM.BD, tick, offBeat ? SIXTEENTH : EIGHTH, ctx.velocity * 0.85);
  }
}

/** One stroke of the backbeat voice: which drum it is and how hard it is hit. */
export type BackbeatStroke = {
  pitch: number;
  velocity: number;
};

/** How loudly a role plays the backbeat, relative to the beat it lands on. */
function roleBackbeatWeight(role: DrumRole): number {
  if (role === 'minimal') {
    return 0.65;
  }
  return role === 'ambient' ? 0.8 : 1;
}

/**
 * The drum a section states its backbeat on, or undefined where the role writes
 * no backbeat at all.
 *
 * The style names the instrument: a latin groove states its backbeat as a rim
 * click, so it keeps the side-stick whatever the role asks for, and every other
 * style writes the drum itself. The quieter roles cross-stick theirs, and
 * `'fxOnly'` states none. Only the voice is decided here — the backbeat keeps
 * the positions {@link backbeatBeats} names, so a latin groove is the timbre of
 * a clave rather than its rhythm; the pattern dictionary is where a written-out
 * clave lives.
 *
 * Every voice that answers the backbeat reads this one predicate, so a groove
 * cannot decorate a stroke it never plays.
 *
 * @param sec Section context.
 * @returns The note number of the backbeat voice, or undefined for no backbeat.
 */
export function backbeatVoice(sec: SectionCtx): number | undefined {
  if (sec.role === 'fxOnly') {
    return undefined;
  }
  const sideStick = sec.style === 'latin' || sec.role === 'ambient' || sec.role === 'minimal';
  return sideStick ? GM.SIDESTICK : GM.SD;
}

/**
 * Whether a section decorates its backbeat with ghost snares.
 *
 * A ghost is a soft stroke on the snare head leading into the backbeat, so a
 * groove ghosts exactly when {@link backbeatVoice} is the snare drum: a
 * rim-click clave and a cross-sticked backbeat are not the voice being
 * decorated, and a ghost against either answers a stroke that is not there. A
 * sparse groove keeps its silence whatever it states its backbeat on.
 *
 * The section is not part of the question. How many ghosts survive is the
 * ornament dial's business in every section, and the density table
 * ({@link getGhostDensity}) carries a row for each of them, so a section scales
 * the dial rather than switching the voice off.
 */
export function writesSnareGhosts(sec: SectionCtx): boolean {
  return backbeatVoice(sec) === GM.SD && sec.style !== 'sparse';
}

/**
 * The backbeat stroke of a section: the drum {@link backbeatVoice} names, at
 * the weight its role plays it.
 *
 * `'full'` plays the backbeat at full value, `'ambient'` and `'minimal'` grow
 * quieter with the side-stick they step down to, and `'fxOnly'` writes no
 * backbeat. `'minimal'` is one step quieter than `'ambient'` in every style —
 * never the full backbeat and never nothing at all.
 *
 * @param sec Section context.
 * @param velocity Base velocity of the beat the stroke lands on.
 * @returns The stroke to write, or undefined when the role writes no backbeat.
 */
export function backbeatStroke(sec: SectionCtx, velocity: number): BackbeatStroke | undefined {
  const pitch = backbeatVoice(sec);
  if (pitch === undefined) {
    return undefined;
  }
  return pitch === GM.SD
    ? { pitch, velocity: Math.min(127, velocity + BACKBEAT_LIFT) }
    : { pitch, velocity: velocity * roleBackbeatWeight(sec.role) };
}

/**
 * Beats in the bar the beat processors are written against.
 *
 * The same bar {@link backbeatBeats} answers for by default here: this module
 * is called once per beat of a four-four bar, and a groove in another metre is
 * placed by the vocabulary path rather than by these processors.
 */
const FOUR_FOUR_BEATS = 4;

/** Emit the backbeat snare (or side-stick) for one beat. */
export function generateSnareForBeat(ctx: BeatCtx, sec: SectionCtx, isIntroFirst: boolean): void {
  if (ctx.inPrechorusLift) {
    return;
  }
  if (!backbeatBeats(sec.snareBeat3).includes(ctx.beat) || isIntroFirst) {
    return;
  }
  const stroke = backbeatStroke(sec, ctx.velocity);
  if (!stroke) {
    return;
  }
  ctx.track.add(stroke.pitch, ctx.beatTick, EIGHTH, stroke.velocity);
}

/** Emit ghost snares at the "e"/"a" 16ths of the beats that lead into a backbeat. */
export function generateGhostNotesForBeat(ctx: BeatCtx, sec: SectionCtx): void {
  // The one gate on the voice, so no exit path can write a snare-head ghost
  // into a groove whose backbeat is not on the snare head.
  if (!writesSnareGhosts(sec)) {
    return;
  }
  // The beat before each backbeat, wherever the groove puts its backbeat: a
  // snare on the third beat — trap's own backbeat — is led into from the
  // second, and the fixed pair wrote the ghosts a beat early and again on the
  // backbeat itself, so trap's backbeat had no lead-in written at all.
  const backbeats = backbeatBeats(sec.snareBeat3);
  const leadIns = backbeats.map((beat) => (beat - 1 + FOUR_FOUR_BEATS) % FOUR_FOUR_BEATS);
  if (!leadIns.includes(ctx.beat)) {
    return;
  }
  // A ghost is decoration, so the ornament dial decides how many survive; the
  // ceiling decides whether 16ths are reachable at this tempo at all.
  if (!sustainsStrokes(SIXTEENTH, ctx.bpm, sec.difficulty)) {
    return;
  }
  const positions = selectGhostPositions(sec.ghostMood);
  let ghostProb = leanedBy(getGhostDensity(sec.ghostMood, ctx.section, ctx.bpm), sec.ornament);
  if (sec.ghostBoost) {
    ghostProb = Math.min(1, ghostProb * 1.4);
  }

  for (const pos of positions) {
    const sixteenthInBeat = pos === 'e' ? 1 : 3;
    const posProb = getGhostProbabilityAtPosition(ctx.beat, sixteenthInBeat, leadIns);
    if (!ctx.draw.prob(ghostProb * posProb, 'ghost', ctx.bar, ctx.beat, pos)) {
      continue;
    }
    const variation = ctx.draw.float(0.85, 1.15, 'ghostVelocity', ctx.bar, ctx.beat, pos);
    const ghostBase = getGhostVelocity(ctx.section, ctx.beat / 2);
    let ghostVel = ctx.velocity * ghostBase * variation;
    if (pos === 'a') {
      ghostVel *= 0.9;
    }
    const offset = pos === 'e' ? SIXTEENTH : 3 * SIXTEENTH;
    const tick = swing16(ctx.beatTick + offset, sec, ctx.swingAmount);
    ctx.track.add(GM.SD, tick, SIXTEENTH, ghostVel);
  }
}

/** Emit the pre-chorus lift buildup for one beat. */
export function generatePreChorusBuildup(
  ctx: BeatCtx,
  sec: SectionCtx,
  isSectionLastBar: boolean,
): void {
  if (sec.style === 'sparse') {
    if (isSectionLastBar && ctx.beat === 3) {
      ctx.track.add(GM.SD, ctx.beatTick, EIGHTH, Math.max(45, ctx.velocity * 0.75));
      ctx.track.add(GM.CRASH, ctx.beatTick + EIGHTH + SIXTEENTH, SIXTEENTH, ctx.velocity * 0.9);
    }
    return;
  }
  const barsInLift = 2;
  const barInLift = ctx.bar - (ctx.sectionBars - barsInLift);
  const progress = (barInLift * 4 + ctx.beat) / (barsInLift * 4);
  const buildupVel = ctx.velocity * (0.5 + 0.5 * progress);
  // The lift is a stream on one voice, so the ceiling decides how fine it may
  // be written: the offbeat goes first, and where even the quarter is out of
  // reach at this tempo the crash carries the phrase end alone.
  const takesEighths = sustainsStrokes(EIGHTH, ctx.bpm, sec.difficulty);
  if (takesEighths || sustainsStrokes(QUARTER, ctx.bpm, sec.difficulty)) {
    ctx.track.add(GM.SD, ctx.beatTick, EIGHTH, buildupVel);
  }
  if (takesEighths) {
    ctx.track.add(
      GM.SD,
      swing16(ctx.beatTick + EIGHTH, sec, ctx.swingAmount),
      EIGHTH,
      buildupVel * 0.85,
    );
  }
  if (isSectionLastBar && ctx.beat === 3) {
    // Through the section's own grid, as the snare above it is: written
    // straight while the rest of the bar swings, the crash lands ahead of the
    // stroke it is meant to land with and reads as a flam.
    ctx.track.add(
      GM.CRASH,
      swing16(ctx.beatTick + EIGHTH + SIXTEENTH, sec, ctx.swingAmount),
      SIXTEENTH,
      ctx.velocity * 1.1,
    );
  }
}

/**
 * Whether the downbeat of this beat carries an open hi-hat accent.
 *
 * The decision belongs to the beat rather than to the subdivision it is written
 * on, so a finer grid reached by raising the rhythmic dial keeps the open hat
 * the coarser one had: the dial fills strokes in between the ones already
 * sounding instead of changing what they are. A style that opens off the beat
 * takes no part here, so that one beat never carries two open-hat rules.
 */
function opensOnDownbeat(ctx: BeatCtx, sec: SectionCtx): boolean {
  if (usesOffbeatOpenHiHat(sec.style)) {
    return false;
  }
  return shouldAddOpenHHAccent(ctx.section, ctx.beat, ctx.bar, ctx.draw);
}

/**
 * Whether the "and" of this beat carries an open hi-hat, for the styles that
 * write their open hats there. The draw is addressed by the eighth it lands on,
 * so the same "and" opens whichever grid the bar is written on.
 */
function opensOffbeat(ctx: BeatCtx, sec: SectionCtx): boolean {
  if (!usesOffbeatOpenHiHat(sec.style) || (ctx.beat !== 1 && ctx.beat !== 3)) {
    return false;
  }
  return ctx.draw.prob(offbeatOpenHiHatChance(ctx.bpm), 'openHat', ctx.bar, ctx.beat, 1);
}

/** Emit the timekeeping hi-hat (or ride/foot) for one beat. */
export function generateHiHatForBeat(ctx: BeatCtx, sec: SectionCtx): void {
  if (!shouldPlayHiHat(sec.role)) {
    return;
  }

  const hhInstrument = roleHiHatInstrument(sec.role, sec.useRide);
  const hhType = sectionHiHatType(ctx.section, sec.role);
  const typeMult = hiHatTypeVelocityMultiplier(hhType);
  const allowsOpenHiHat = sec.role !== 'ambient' && sec.role !== 'minimal';
  const isDynamicOpen =
    ctx.barHasOpenHh && ctx.beat === ctx.openHhBeat && !usesOffbeatOpenHiHat(sec.style);
  const dm = sec.densityMult;

  if (ctx.hhLevel === 'quarter') {
    // The intro's quarter grid rests between its downbeats. The foot pulse is
    // written for the bar rather than for these beats: a pedal hat here is a
    // stroke the denser grids replace with a stick hat, and the dial would then
    // take a sound away as it was raised.
    if (ctx.section === 'intro' && ctx.beat !== 0) {
      return;
    }
    const hhVel = Math.max(20, ctx.velocity * dm * 0.75 * typeMult);
    if (allowsOpenHiHat && isDynamicOpen) {
      ctx.track.add(GM.OHH, ctx.beatTick, EIGHTH, hhVel + OHH_VEL_BOOST);
    } else if (allowsOpenHiHat && opensOnDownbeat(ctx, sec)) {
      ctx.track.add(hiHatNote('open'), ctx.beatTick, EIGHTH, Math.max(20, hhVel * 1.1));
    } else {
      ctx.track.add(hhInstrument, ctx.beatTick, EIGHTH, hhVel);
    }
    return;
  }

  if (ctx.hhLevel === 'eighth') {
    for (let eighth = 0; eighth < 2; eighth += 1) {
      let hhTick = ctx.beatTick + eighth * EIGHTH;
      if (eighth === 1) {
        hhTick = swing16(hhTick, sec, ctx.swingAmount);
      }
      if (ctx.section === 'intro' && eighth === 1) {
        if (sec.useFootHh && ctx.beat % 2 === 0) {
          ctx.track.add(GM.FHH, hhTick, EIGHTH, footHiHatVelocity(ctx.draw, ctx.bar, ctx.beat));
        }
        continue;
      }
      const hhVel = Math.max(20, ctx.velocity * dm * typeMult * (eighth === 0 ? 0.9 : 0.65));
      if (isDynamicOpen && allowsOpenHiHat && eighth === 0) {
        ctx.track.add(GM.OHH, hhTick, EIGHTH, hhVel + OHH_VEL_BOOST);
        continue;
      }
      const useOpen = eighth === 0 ? opensOnDownbeat(ctx, sec) : opensOffbeat(ctx, sec);
      if (useOpen && allowsOpenHiHat) {
        ctx.track.add(hiHatNote('open'), hhTick, EIGHTH, Math.max(20, hhVel * 1.1));
      } else {
        ctx.track.add(hhInstrument, hhTick, EIGHTH / 2, hhVel);
      }
    }
    return;
  }

  for (let sixteenth = 0; sixteenth < 4; sixteenth += 1) {
    let hhTick = ctx.beatTick + sixteenth * SIXTEENTH;
    // Every off-beat 16th goes through the shared grid, the "and" included:
    // leaving position 2 straight put the hat and the kick's "and" on different
    // ticks in the same bar.
    if (sixteenth !== 0) {
      hhTick = swing16(hhTick, sec, ctx.swingAmount);
    }
    const metricVel = hiHatVelocityMultiplier(
      sixteenth,
      ctx.draw.float(0.95, 1.05, 'hatVelocity', ctx.bar, ctx.beat, sixteenth),
    );
    const hhVel = Math.max(20, ctx.velocity * dm * typeMult * metricVel);
    if (isDynamicOpen && allowsOpenHiHat && sixteenth === 0) {
      ctx.track.add(GM.OHH, hhTick, SIXTEENTH, hhVel + OHH_VEL_BOOST);
      continue;
    }
    // The accents of the coarser grids are taken here as well, at the positions
    // those grids write them on: the beat itself, and the "and" for the styles
    // that open there. Deciding them only on the eighth grid meant reaching the
    // sixteenths turned an open hat back into a closed one.
    if (allowsOpenHiHat && sixteenth === 0 && opensOnDownbeat(ctx, sec)) {
      ctx.track.add(hiHatNote('open'), hhTick, SIXTEENTH, Math.max(20, hhVel * 1.1));
      continue;
    }
    if (allowsOpenHiHat && sixteenth === 2 && opensOffbeat(ctx, sec)) {
      ctx.track.add(hiHatNote('open'), hhTick, SIXTEENTH, Math.max(20, hhVel * 1.1));
      continue;
    }
    if (allowsOpenHiHat && ctx.beat === 3 && sixteenth === 3) {
      const openProb = Math.max(0.1, Math.min(0.4, 30 / ctx.bpm));
      if (ctx.draw.prob(openProb, 'openHat', ctx.bar, ctx.beat, sixteenth)) {
        ctx.track.add(GM.OHH, hhTick, SIXTEENTH, Math.max(20, hhVel * 1.2));
        continue;
      }
    }
    ctx.track.add(hhInstrument, hhTick, SIXTEENTH / 2, hhVel);
  }
}
