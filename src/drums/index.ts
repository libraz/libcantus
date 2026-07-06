import {
  type BeatCtx,
  generateGhostNotesForBeat,
  generateHiHatForBeat,
  generateKickForBeat,
  generatePreChorusBuildup,
  generateSnareForBeat,
  type SectionCtx,
} from './beat.js';
import { type FillType, generateFill, getFillStartBeat, selectFillType } from './fills.js';
import {
  footHiHatVelocity,
  getHiHatLevel,
  openHiHatBarInterval,
  openHiHatBeat,
  shouldPlayHiHat,
  shouldUseFootHiHat,
  shouldUseRideForSection,
} from './hihat.js';
import { type DrumHit, HitList } from './hit.js';
import {
  calculateVelocity,
  type DrumRole,
  type Feel,
  feelSwingAmount,
  GM,
  type GrooveStyle,
  ghostMoodCategory,
  mapDensity,
  mapSection,
  mapStyle,
  type PublicSection,
  percMoodCategory,
  sectionDensityMultiplier,
  sectionEnergy,
} from './internal.js';
import { getKickPattern, isInPreChorusLift, type KickPattern } from './kick.js';
import { generateAuxPercussionForBar, getPercussionConfig } from './percussion.js';
import { createRng } from './rng.js';

export type { DrumHit } from './hit.js';
export type GrooveFeel = Feel;
export type { DrumRole, GrooveStyle } from './internal.js';

/** Public section identifiers for {@link generateDrums}. */
export type Section = PublicSection;

/** Options controlling {@link generateDrums}. */
export type DrumGenOptions = {
  bars: number;
  bpm: number;
  style: GrooveStyle;
  section: Section;
  density: number;
  fills?: boolean;
  feel?: GrooveFeel;
  role?: DrumRole;
  seed?: number;
};

/**
 * Generate a drum performance as a flat list of onsets.
 *
 * Every voice (kick, snare, ghost snares, closed/open/foot hi-hats, ride, toms,
 * crash, and auxiliary percussion) is emitted as a {@link DrumHit} distinguished
 * by its General MIDI pitch. Groove style selects an internal style and feel;
 * `density` sets the backing-density level; `section` shapes kick, hi-hat, ghost,
 * and percussion density. 16th-note hi-hats drop to 8ths at or above 150 BPM.
 * When `fills` is true the final bar is replaced with a fill. Output is fully
 * determined by the options plus `seed`.
 *
 * @param opts Generation options.
 * @returns Percussion onsets in bar order.
 */
export function generateDrums(opts: DrumGenOptions): DrumHit[] {
  const track = new HitList();
  const rng = createRng(opts.seed ?? 0);
  const mapping = mapStyle(opts.style);
  const style = mapping.style;
  const feel: Feel = opts.feel ?? mapping.feel;
  const role: DrumRole = opts.role ?? 'full';
  // fxOnly leaves only fx/aux voices: the main kick, snare, ghost, and fill
  // voices are suppressed just as timekeeping hi-hats already are.
  const playMainVoices = role !== 'fxOnly';
  const section = mapSection(opts.section);
  const backingDensity = mapDensity(opts.density);
  const swingAmount = feelSwingAmount(feel);

  let densityMult = sectionDensityMultiplier(section);
  if (backingDensity === 'thin') {
    densityMult *= 0.75;
  } else if (backingDensity === 'thick') {
    densityMult *= 1.15;
  }

  const sec: SectionCtx = {
    style,
    feel,
    densityMult,
    backingDensity,
    hhLevel: getHiHatLevel(section, style, backingDensity, opts.bpm, rng),
    useGhostNotes:
      (section === 'b' || section === 'chorus' || section === 'bridge') && style !== 'sparse',
    ghostBoost: mapping.ghostBoost,
    useRide: shouldUseRideForSection(section, style),
    useFootHh: shouldUseFootHiHat(section, role),
    role,
    ghostMood: ghostMoodCategory(style),
    snareBeat3: mapping.snareBeat3,
  };

  const ohhBarInterval = openHiHatBarInterval(section, style);
  const energy = sectionEnergy(section);
  const fillStartBeat = getFillStartBeat(energy);
  const percMood = percMoodCategory(style);

  const reuseSectionKick = (section === 'b' || section === 'chorus') && style !== 'sparse';
  let sectionKick: KickPattern | undefined;

  for (let bar = 0; bar < opts.bars; bar += 1) {
    const barStart = bar * 4;
    const isLastBar = bar === opts.bars - 1;

    if (bar === 0 && section === 'chorus') {
      track.add(GM.CRASH, barStart, 0.5, 100 * densityMult);
    }

    let barHasOpenHh = false;
    let openHhBeatIndex = 3;
    if (ohhBarInterval > 0 && bar % ohhBarInterval === ohhBarInterval - 1) {
      openHhBeatIndex = openHiHatBeat(section, rng);
      barHasOpenHh = !track.hasCrashNear(barStart + openHhBeatIndex);
    }

    let kick: KickPattern;
    if (reuseSectionKick) {
      sectionKick ??= getKickPattern(section, style, 0, rng);
      kick = sectionKick;
    } else {
      kick = getKickPattern(section, style, bar, rng);
    }

    const inLift = isInPreChorusLift(section, bar, opts.bars, section === 'b');
    let currentFill: FillType = 'snareRoll';

    for (let beat = 0; beat < 4; beat += 1) {
      const beatTick = barStart + beat;
      const velocity = calculateVelocity(section, beat);

      if (opts.fills && isLastBar && !inLift && beat >= fillStartBeat) {
        if (beat === fillStartBeat) {
          currentFill = selectFillType(section, section, style, energy, rng);
        }
        if (playMainVoices) {
          generateFill(track, beatTick, beat, currentFill, velocity);
        }
        continue;
      }

      const ctx: BeatCtx = {
        track,
        beatTick,
        beat,
        velocity,
        section,
        bpm: opts.bpm,
        bar,
        sectionBars: opts.bars,
        inPrechorusLift: inLift,
        swingAmount,
        barHasOpenHh,
        openHhBeat: openHhBeatIndex,
        rng,
      };

      if (playMainVoices) {
        if (inLift) {
          generatePreChorusBuildup(ctx, sec, isLastBar);
        }
        generateKickForBeat(ctx, sec, kick);
        generateSnareForBeat(ctx, sec, section === 'intro' && bar === 0);
        if (sec.useGhostNotes && !inLift) {
          generateGhostNotesForBeat(ctx, sec);
        }
      }
      generateHiHatForBeat(ctx, sec);
    }

    if (sec.useFootHh && shouldPlayHiHat(role)) {
      for (let fhhBeat = 0; fhhBeat < 4; fhhBeat += 2) {
        const fhhTick = barStart + fhhBeat;
        const occupied = track.hits.some((h) => h.pitch === GM.FHH && h.startBeat === fhhTick);
        if (!occupied) {
          track.add(GM.FHH, fhhTick, 0.5, footHiHatVelocity(rng));
        }
      }
    }

    generateAuxPercussionForBar(
      track,
      barStart,
      getPercussionConfig(percMood, section),
      role,
      densityMult,
      rng,
      opts.bpm,
    );
  }

  return track.hits;
}
