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
  roleHiHatInstrument,
  sectionHiHatType,
  shouldAddOpenHHAccent,
  shouldPlayHiHat,
  shouldUseBridgeCrossStick,
} from './hihat.js';
import type { HitList } from './hit.js';
import type { BackingDensity, DrumRole, DrumStyle, Feel, SectionType } from './internal.js';
import { EIGHTH, GM, type MoodCategory, SIXTEENTH } from './internal.js';
import type { KickPattern } from './kick.js';
import type { DrumRng } from './rng.js';
import { effectiveSwing, quantizeSwing } from './swing.js';

/** Per-section drum state shared across the bars of a section. */
export type SectionCtx = {
  style: DrumStyle;
  feel: Feel;
  densityMult: number;
  backingDensity: BackingDensity;
  hhLevel: HiHatLevel;
  useGhostNotes: boolean;
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
  rng: DrumRng;
};

/**
 * How much of the feel's swing a style actually takes. Trap sits on a straight
 * (or triplet-hat) grid, latin only leans; everything else swings by half.
 */
function styleSwingFactor(style: DrumStyle): number {
  if (style === 'trap') {
    return 0;
  }
  if (style === 'latin') {
    return 0.35;
  }
  return 0.5;
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
  return effectiveSwing(sec.feel, swingAmount) * styleSwingFactor(sec.style);
}

/** Place a tick on the section's shared swung 16th grid. */
export function swing16(tick: number, sec: SectionCtx, swingAmount: number): number {
  return quantizeSwing(tick, sectionSwing(sec, swingAmount), 'sixteenth');
}

/** Emit the kick for one beat. */
export function generateKickForBeat(ctx: BeatCtx, sec: SectionCtx, kick: KickPattern): void {
  if (ctx.inPrechorusLift) {
    return;
  }
  const on = [kick.beat1, kick.beat2, kick.beat3, kick.beat4][ctx.beat] ?? false;
  const and = [kick.beat1and, kick.beat2and, kick.beat3and, kick.beat4and][ctx.beat] ?? false;

  if (on) {
    ctx.track.add(GM.BD, ctx.beatTick, EIGHTH, ctx.velocity);
  }
  if (and) {
    const andTick = swing16(ctx.beatTick + EIGHTH, sec, ctx.swingAmount);
    ctx.track.add(GM.BD, andTick, EIGHTH, ctx.velocity * 0.85);
  }
}

/** Emit the backbeat snare (or side-stick) for one beat. */
export function generateSnareForBeat(ctx: BeatCtx, sec: SectionCtx, isIntroFirst: boolean): void {
  if (ctx.inPrechorusLift) {
    return;
  }
  const snareOn = sec.snareBeat3 ? ctx.beat === 2 : ctx.beat === 1 || ctx.beat === 3;
  if (!snareOn || isIntroFirst) {
    return;
  }
  if (sec.useRide && shouldUseBridgeCrossStick(ctx.section, ctx.beat)) {
    return;
  }

  const backbeatVel = Math.min(127, ctx.velocity + 16);
  const promoteSparseChorus =
    sec.style === 'sparse' && ctx.section === 'chorus' && sec.role === 'full';

  if (sec.role === 'fxOnly') {
    return;
  }
  // `minimal` is one step quieter than `ambient` in every style: a side-stick
  // at a reduced velocity, never the full backbeat and never nothing at all.
  // Deciding it per style produced the loudest snare of any role in one branch
  // and no snare whatsoever in another.
  if (sec.role === 'minimal') {
    ctx.track.add(GM.SIDESTICK, ctx.beatTick, EIGHTH, ctx.velocity * 0.65);
    return;
  }
  if (promoteSparseChorus) {
    ctx.track.add(GM.SD, ctx.beatTick, EIGHTH, backbeatVel);
  } else if (sec.style === 'sparse' || sec.role === 'ambient') {
    ctx.track.add(GM.SIDESTICK, ctx.beatTick, EIGHTH, ctx.velocity * 0.8);
  } else {
    ctx.track.add(GM.SD, ctx.beatTick, EIGHTH, backbeatVel);
  }
}

/** Emit ghost snares at the "e"/"a" 16ths of beats 1 and 3. */
export function generateGhostNotesForBeat(ctx: BeatCtx, sec: SectionCtx): void {
  if (ctx.beat !== 0 && ctx.beat !== 2) {
    return;
  }
  const positions = selectGhostPositions(sec.ghostMood);
  let ghostProb = getGhostDensity(sec.ghostMood, ctx.section, sec.backingDensity, ctx.bpm);
  if (sec.ghostBoost) {
    ghostProb = Math.min(1, ghostProb * 1.4);
  }

  for (const pos of positions) {
    const sixteenthInBeat = pos === 'e' ? 1 : 3;
    const posProb = getGhostProbabilityAtPosition(ctx.beat, sixteenthInBeat);
    if (!ctx.rng.prob(ghostProb * posProb)) {
      continue;
    }
    const variation = ctx.rng.float(0.85, 1.15);
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
  ctx.track.add(GM.SD, ctx.beatTick, EIGHTH, buildupVel);
  ctx.track.add(
    GM.SD,
    swing16(ctx.beatTick + EIGHTH, sec, ctx.swingAmount),
    EIGHTH,
    buildupVel * 0.85,
  );
  if (isSectionLastBar && ctx.beat === 3) {
    ctx.track.add(GM.CRASH, ctx.beatTick + EIGHTH + SIXTEENTH, SIXTEENTH, ctx.velocity * 1.1);
  }
}

/** Emit the timekeeping hi-hat (or ride/foot) for one beat. */
export function generateHiHatForBeat(ctx: BeatCtx, sec: SectionCtx): void {
  if (!shouldPlayHiHat(sec.role)) {
    return;
  }

  const crossStick = sec.useRide && shouldUseBridgeCrossStick(ctx.section, ctx.beat);
  const hhInstrument = crossStick ? GM.SIDESTICK : roleHiHatInstrument(sec.role, sec.useRide);
  const hhType = sectionHiHatType(ctx.section, sec.role);
  const typeMult = hiHatTypeVelocityMultiplier(hhType);
  const isDynamicOpen = ctx.barHasOpenHh && ctx.beat === ctx.openHhBeat;
  const allowsOpenHiHat = sec.role !== 'ambient' && sec.role !== 'minimal';
  const dm = sec.densityMult;

  if (sec.hhLevel === 'quarter') {
    const introRest = ctx.section === 'intro' && ctx.beat !== 0;
    if (!introRest) {
      if (isDynamicOpen && allowsOpenHiHat) {
        ctx.track.add(
          GM.OHH,
          ctx.beatTick,
          EIGHTH,
          ctx.velocity * dm * 0.75 * typeMult + OHH_VEL_BOOST,
        );
      } else {
        ctx.track.add(
          hhInstrument,
          ctx.beatTick,
          EIGHTH,
          Math.max(20, ctx.velocity * dm * 0.75 * typeMult),
        );
      }
    } else if (sec.useFootHh) {
      ctx.track.add(GM.FHH, ctx.beatTick, EIGHTH, footHiHatVelocity(ctx.rng));
    }
    return;
  }

  if (sec.hhLevel === 'eighth') {
    for (let eighth = 0; eighth < 2; eighth += 1) {
      let hhTick = ctx.beatTick + eighth * EIGHTH;
      if (eighth === 1) {
        hhTick = swing16(hhTick, sec, ctx.swingAmount);
      }
      if (ctx.section === 'intro' && eighth === 1) {
        if (sec.useFootHh && ctx.beat % 2 === 0) {
          ctx.track.add(GM.FHH, hhTick, EIGHTH, footHiHatVelocity(ctx.rng));
        }
        continue;
      }
      const hhVel = Math.max(20, ctx.velocity * dm * typeMult * (eighth === 0 ? 0.9 : 0.65));
      if (isDynamicOpen && allowsOpenHiHat && eighth === 0) {
        ctx.track.add(GM.OHH, hhTick, EIGHTH, hhVel + OHH_VEL_BOOST);
        continue;
      }
      let useOpen = false;
      if (sec.style === 'fourOnFloor' && eighth === 1) {
        const openProb = Math.max(0.15, Math.min(0.8, 45 / ctx.bpm));
        useOpen = (ctx.beat === 1 || ctx.beat === 3) && ctx.rng.prob(openProb);
      } else if (eighth === 0) {
        useOpen = shouldAddOpenHHAccent(ctx.section, ctx.beat, ctx.bar, ctx.rng);
      }
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
    const metricVel = hiHatVelocityMultiplier(sixteenth, ctx.rng);
    const hhVel = Math.max(20, ctx.velocity * dm * typeMult * metricVel);
    if (isDynamicOpen && allowsOpenHiHat && sixteenth === 0) {
      ctx.track.add(GM.OHH, hhTick, SIXTEENTH, hhVel + OHH_VEL_BOOST);
      continue;
    }
    if (allowsOpenHiHat && ctx.beat === 3 && sixteenth === 3) {
      const openProb = Math.max(0.1, Math.min(0.4, 30 / ctx.bpm));
      if (ctx.rng.prob(openProb)) {
        ctx.track.add(GM.OHH, hhTick, SIXTEENTH, Math.max(20, hhVel * 1.2));
        continue;
      }
    }
    ctx.track.add(hhInstrument, hhTick, SIXTEENTH / 2, hhVel);
  }
}
