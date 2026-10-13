import type { Draw } from '../context/index.js';
import { sustainsStrokes } from '../context/index.js';
import type { DrumRole, DrumStyle, SectionType } from './internal.js';
import { GM } from './internal.js';

/** Hi-hat subdivision level. */
export type HiHatLevel = 'quarter' | 'eighth' | 'sixteenth';

/** Hi-hat articulation type. */
export type HiHatType = 'closed' | 'pedal' | 'open' | 'halfOpen' | 'ride';

/** BPM at or above which 16th-note hi-hats become 8ths for playability. */
export const HH_16TH_BPM_THRESHOLD = 150;

const FHH_VEL_MIN = 45;
const FHH_VEL_MAX = 60;
/** Velocity boost applied to dynamic open hi-hat accents. */
export const OHH_VEL_BOOST = 7;

/** True unless the role suppresses timekeeping cymbals entirely. */
export function shouldPlayHiHat(role: DrumRole): boolean {
  return role !== 'fxOnly';
}

/** Preferred timekeeping instrument for a role. */
export function roleHiHatInstrument(role: DrumRole, useRide: boolean): number {
  if (role === 'ambient') {
    return GM.RIDE;
  }
  if (role === 'minimal') {
    return GM.FHH;
  }
  return useRide ? GM.RIDE : GM.CHH;
}

function sparser(level: HiHatLevel): HiHatLevel {
  if (level === 'sixteenth') {
    return 'eighth';
  }
  if (level === 'eighth') {
    return 'quarter';
  }
  return 'quarter';
}

function denser(level: HiHatLevel): HiHatLevel {
  if (level === 'quarter') {
    return 'eighth';
  }
  if (level === 'eighth') {
    return 'sixteenth';
  }
  return 'sixteenth';
}

/** Beats between consecutive strokes at a hi-hat subdivision. */
export function hiHatStep(level: HiHatLevel): number {
  if (level === 'sixteenth') {
    return 0.25;
  }
  return level === 'eighth' ? 0.5 : 1;
}

/**
 * Choose the hi-hat subdivision for a section, style, rhythmic dial, and tempo.
 *
 * The style and section propose a level; the dial then moves it, and it moves
 * in one direction only. Both of its tests read a draw fixed by position — one
 * for thinning out, one for filling in — so as the dial rises the thinning
 * switches off before the filling switches on, and the level never falls.
 *
 * A difficulty ceiling can thin the level further: with a tempo to measure
 * against, a subdivision the player cannot keep up is a candidate to reject,
 * not a level to write and hope.
 *
 * The two dial draws are addressed by bar, so the dial moves the hats a bar at
 * a time rather than switching a whole section between two subdivisions.
 */
export function getHiHatLevel(
  section: SectionType,
  style: DrumStyle,
  rhythmic: number,
  bpm: number,
  draw: Draw,
  difficulty: number | undefined,
  bar: number,
): HiHatLevel {
  const allow16th = bpm < HH_16TH_BPM_THRESHOLD;
  let base: HiHatLevel = 'eighth';
  let dialed = true;

  if (style === 'sparse') {
    base = section === 'chorus' ? 'eighth' : 'quarter';
  } else if (style === 'fourOnFloor') {
    base = allow16th && section === 'chorus' && draw.prob(0.25, 'hhLevel') ? 'sixteenth' : 'eighth';
    dialed = false;
  } else if (style === 'synth') {
    base = !allow16th || (section === 'a' && draw.prob(0.2, 'hhLevel')) ? 'eighth' : 'sixteenth';
    dialed = false;
  } else if (style === 'trap') {
    base = allow16th ? 'sixteenth' : 'eighth';
    dialed = false;
  } else if (style === 'latin') {
    base = allow16th && section === 'chorus' && draw.prob(0.3, 'hhLevel') ? 'sixteenth' : 'eighth';
    dialed = false;
  } else {
    switch (section) {
      case 'intro':
        base = 'quarter';
        break;
      case 'outro':
        base = 'eighth';
        break;
      case 'a':
        base = draw.prob(0.3, 'hhLevel') ? 'quarter' : 'eighth';
        break;
      case 'b':
        base = allow16th && draw.prob(0.25, 'hhLevel') ? 'sixteenth' : 'eighth';
        break;
      case 'chorus':
        base = allow16th && draw.prob(0.35, 'hhLevel') ? 'sixteenth' : 'eighth';
        break;
      case 'bridge':
        base = 'eighth';
        break;
    }
  }

  let level = base;
  if (dialed) {
    // The middle of the dial is the style's own level, so the two halves are
    // read separately: the lower half thins the level out, the upper half
    // fills it in, and each transition is spread across its half instead of
    // landing on one bucket boundary.
    if (draw.at('hhThin', bar) >= 2 * rhythmic) {
      level = sparser(level);
    }
    if (draw.at('hhFill', bar) < 2 * rhythmic - 1) {
      level = denser(level);
    }
  }

  if (!allow16th && level === 'sixteenth') {
    level = 'eighth';
  }
  while (level !== 'quarter' && !sustainsStrokes(hiHatStep(level), bpm, difficulty)) {
    level = sparser(level);
  }
  return level;
}

/**
 * Metric velocity multiplier for a 16th position within a beat.
 *
 * @param sixteenth Position within the beat, 0 to 3.
 * @param jitter Humanizing factor around 1, drawn by the caller for that
 *   position so the same 16th of the same bar always sounds the same.
 */
export function hiHatVelocityMultiplier(sixteenth: number, jitter: number): number {
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

/** Bars between dynamic open hi-hat accents (0 disables them). */
export function openHiHatBarInterval(section: SectionType, style: DrumStyle): number {
  if (style === 'sparse') {
    return section === 'chorus' ? 4 : 0;
  }
  switch (section) {
    case 'intro':
      return style === 'fourOnFloor' ? 4 : 0;
    case 'a':
      return style === 'fourOnFloor' || style === 'upbeat' ? 2 : 4;
    case 'b':
      return 2;
    case 'chorus':
      return style === 'rock' || style === 'fourOnFloor' ? 1 : 2;
    case 'bridge':
      return 0;
    case 'outro':
      return 4;
  }
}

/** Beat that receives the dynamic open hi-hat within a bar. */
export function openHiHatBeat(section: SectionType, draw: Draw, bar: number): number {
  if (section === 'chorus') {
    const choice = draw.range(0, 3, 'ohhBeat', bar);
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

/** Whether the section uses an independent foot hi-hat pulse. */
export function shouldUseFootHiHat(section: SectionType, role: DrumRole): boolean {
  if (role === 'fxOnly') {
    return false;
  }
  switch (section) {
    case 'intro':
    case 'bridge':
    case 'outro':
      return true;
    default:
      return role === 'ambient' || role === 'minimal';
  }
}

/**
 * The hi-hat articulation a section leans on.
 *
 * This shapes dynamics only: the note a timekeeping hat actually sounds comes
 * from {@link roleHiHatInstrument}, which follows the voicing role, and from
 * the per-onset open-hat decisions. Feeding this into {@link hiHatNote} instead
 * would let the section override the role's own kit choice.
 */
export function sectionHiHatType(section: SectionType, role: DrumRole): HiHatType {
  if (role === 'ambient') {
    return 'ride';
  }
  if (role === 'minimal') {
    return 'pedal';
  }
  switch (section) {
    case 'intro':
    case 'a':
      return 'pedal';
    case 'b':
      return 'closed';
    case 'chorus':
      return 'open';
    case 'bridge':
      return 'ride';
    case 'outro':
      return 'halfOpen';
  }
}

/** GM note for a hi-hat articulation. */
export function hiHatNote(type: HiHatType): number {
  switch (type) {
    case 'pedal':
      return GM.FHH;
    case 'open':
      return GM.OHH;
    case 'ride':
      return GM.RIDE;
    default:
      return GM.CHH;
  }
}

/**
 * Velocity multiplier for a hi-hat articulation — the only effect
 * {@link sectionHiHatType} has on the output.
 */
export function hiHatTypeVelocityMultiplier(type: HiHatType): number {
  switch (type) {
    case 'halfOpen':
      return 0.75;
    case 'pedal':
      return 0.65;
    case 'open':
      return 1.0;
    case 'ride':
      return 0.9;
    default:
      return 0.85;
  }
}

/** Whether to accent with an open hi-hat at a given beat. */
export function shouldAddOpenHHAccent(
  section: SectionType,
  beat: number,
  bar: number,
  draw: Draw,
): boolean {
  if (section !== 'chorus' && section !== 'b') {
    return false;
  }
  if (section === 'chorus') {
    if (beat === 1 || beat === 3) {
      return draw.prob(0.6, 'ohhAccent', bar, beat);
    }
    return false;
  }
  if (beat === 3 && bar % 2 === 1) {
    return draw.prob(0.4, 'ohhAccent', bar, beat);
  }
  return false;
}

/** Foot hi-hat velocity with slight humanization, drawn for its own position. */
export function footHiHatVelocity(draw: Draw, bar: number, beat: number): number {
  return draw.range(FHH_VEL_MIN, FHH_VEL_MAX, 'fhhVelocity', bar, beat);
}

/**
 * Whether a style writes its open hi-hats off the beat.
 *
 * A four-on-the-floor kick already occupies every downbeat, so the open hat
 * that answers it belongs on the "and". Letting the generic accent rule speak
 * for the same beat put two rules on one decision, and the open hat that
 * defines the style then sounded only when both agreed.
 */
export function usesOffbeatOpenHiHat(style: DrumStyle): boolean {
  return style === 'fourOnFloor';
}

/** Chance an off-beat open hi-hat is taken, slower tempos opening more often. */
export function offbeatOpenHiHatChance(bpm: number): number {
  return Math.max(0.15, Math.min(0.8, 45 / bpm));
}

/** Whether the section uses a ride cymbal instead of hi-hats. */
export function shouldUseRideForSection(section: SectionType, style: DrumStyle): boolean {
  if (style === 'rock' && section === 'chorus') {
    return true;
  }
  if (style === 'sparse') {
    return false;
  }
  return section === 'bridge';
}
