import {
  type BeatCtx,
  generateGhostNotesForBeat,
  generateHiHatForBeat,
  generateKickForBeat,
  generatePreChorusBuildup,
  generateSnareForBeat,
  type SectionCtx,
} from './beat.js';
import { euclideanRhythm, patternToMask } from './euclid.js';
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
import {
  euclideanToKickPattern,
  getKickPattern,
  isInPreChorusLift,
  type KickPattern,
} from './kick.js';
import { generateAuxPercussionForBar, getPercussionConfig } from './percussion.js';
import { createRng } from './rng.js';

/**
 * A single drum onset emitted by {@link generateDrums}.
 *
 * @category Composition
 */
export type { DrumHit } from './hit.js';

/**
 * Groove feel (the swing/straight rhythmic character) for {@link generateDrums}.
 *
 * @category Composition
 */
export type GrooveFeel = Feel;

/**
 * Drum voicing role and groove style identifiers for {@link generateDrums}.
 *
 * @category Composition
 */
export type { DrumRole, GrooveStyle } from './internal.js';

/**
 * Public section identifiers for {@link generateDrums}.
 *
 * @category Composition
 */
export type Section = PublicSection;

/**
 * A Euclidean (Bjorklund) kick pattern for {@link generateDrums}.
 *
 * @category Composition
 */
export type EuclideanKick = {
  /** Number of kick onsets, clamped to `[0, steps]`. */
  pulses: number;
  /**
   * Total steps in the bar (1..16).
   *
   * @defaultValue 16
   */
  steps?: number;
  /**
   * Steps to rotate the onsets toward later positions.
   *
   * @defaultValue 0
   */
  rotation?: number;
};

/**
 * Options controlling {@link generateDrums}.
 *
 * @category Composition
 */
export type DrumsOptions = {
  bars: number;
  bpm: number;
  style: GrooveStyle;
  section: Section;
  density: number;
  /**
   * Replace the final bar with a fill.
   *
   * @defaultValue false
   */
  fills?: boolean;
  feel?: GrooveFeel;
  /**
   * Voicing role; `'fxOnly'` suppresses the main kick/snare/ghost/fill voices.
   *
   * @defaultValue `'full'`
   */
  role?: DrumRole;
  /**
   * Seed for the deterministic PRNG.
   *
   * @defaultValue 0
   */
  seed?: number;
  /**
   * Section the final-bar fill leads into. Shapes which fill archetype is
   * chosen (into-chorus and out-of-intro fills differ from generic ones).
   * Defaults to `section`, i.e. a within-section fill.
   */
  nextSection?: Section;
  /**
   * When set, the kick follows this Euclidean rhythm instead of the
   * style/section pattern, giving direct access to evenly spread onsets.
   */
  euclideanKick?: EuclideanKick;
};

/**
 * Generate a drum performance as a flat list of onsets.
 *
 * Every voice (kick, snare, ghost snares, closed/open/foot hi-hats, ride, toms,
 * crash, and auxiliary percussion) is emitted as a {@link DrumHit} distinguished
 * by its General MIDI pitch. Groove style selects an internal style and feel;
 * `density` sets the backing-density level; `section` shapes kick, hi-hat, ghost,
 * and percussion density. 16th-note hi-hats drop to 8ths at or above 150 BPM.
 * When `fills` is true the final bar is replaced with a fill whose archetype is
 * shaped by `nextSection`; a fill that would emit nothing on its beat falls back
 * to the normal groove so the phrase end is never silent. `euclideanKick`
 * overrides the kick with an evenly-spread Euclidean pattern. Output is fully
 * determined by the options plus `seed`.
 *
 * @param opts Generation options.
 * @returns Percussion onsets in bar order.
 *
 * @example
 * ```ts
 * import { generateDrums } from '@libraz/libcantus';
 * const hits = generateDrums({ bars: 4, bpm: 120, style: 'standard', section: 'chorus', density: 0.6, fills: true });
 * // Fully determined by the options plus seed (defaults to 0).
 * ```
 *
 * @category Composition
 */
export function generateDrums(opts: DrumsOptions): DrumHit[] {
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

  // The final-bar fill is shaped by the section it leads into. When no next
  // section is given the fill is treated as within-section (from === to).
  const nextSection = opts.nextSection ? mapSection(opts.nextSection) : section;
  const nextEnergy = sectionEnergy(nextSection);

  const euclidKick: KickPattern | undefined = opts.euclideanKick
    ? euclideanToKickPattern(
        patternToMask(
          euclideanRhythm(
            opts.euclideanKick.pulses,
            opts.euclideanKick.steps ?? 16,
            opts.euclideanKick.rotation ?? 0,
          ),
        ),
      )
    : undefined;

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
    if (euclidKick) {
      kick = euclidKick;
    } else if (reuseSectionKick) {
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
          currentFill = selectFillType(section, nextSection, style, nextEnergy, rng);
        }
        if (playMainVoices) {
          const before = track.hits.length;
          generateFill(track, beatTick, beat, currentFill, velocity);
          if (track.hits.length > before) {
            continue;
          }
          // Safety net: an archetype that contributes nothing on this beat would
          // leave a silent phrase end, so fall through to the normal groove.
        } else {
          // fxOnly deliberately emits no main voices on the fill beats.
          continue;
        }
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
