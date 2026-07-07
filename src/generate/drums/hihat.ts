import type { DrumRole, DrumStyle, SectionType } from './internal.js';
import { GM } from './internal.js';
import type { DrumRng } from './rng.js';

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

/** Choose the hi-hat subdivision for a section/style/density/BPM. */
export function getHiHatLevel(
  section: SectionType,
  style: DrumStyle,
  backingDensity: 'thin' | 'normal' | 'thick',
  bpm: number,
  rng: DrumRng,
): HiHatLevel {
  const allow16th = bpm < HH_16TH_BPM_THRESHOLD;
  let base: HiHatLevel = 'eighth';

  if (style === 'sparse') {
    base = section === 'chorus' ? 'eighth' : 'quarter';
  } else if (style === 'fourOnFloor') {
    if (allow16th && section === 'chorus' && rng.prob(0.25)) {
      return 'sixteenth';
    }
    return 'eighth';
  } else if (style === 'synth') {
    if (!allow16th) {
      return 'eighth';
    }
    if (section === 'a' && rng.prob(0.2)) {
      return 'eighth';
    }
    return 'sixteenth';
  } else if (style === 'trap') {
    return allow16th ? 'sixteenth' : 'eighth';
  } else if (style === 'latin') {
    if (allow16th && section === 'chorus' && rng.prob(0.3)) {
      return 'sixteenth';
    }
    return 'eighth';
  } else {
    switch (section) {
      case 'intro':
        base = 'quarter';
        break;
      case 'outro':
        base = 'eighth';
        break;
      case 'a':
        base = rng.prob(0.3) ? 'quarter' : 'eighth';
        break;
      case 'b':
        base = allow16th && rng.prob(0.25) ? 'sixteenth' : 'eighth';
        break;
      case 'chorus':
        base = allow16th && rng.prob(0.35) ? 'sixteenth' : 'eighth';
        break;
      case 'bridge':
        base = 'eighth';
        break;
    }
  }

  if (backingDensity === 'thin') {
    base = sparser(base);
  } else if (backingDensity === 'thick') {
    base = denser(base);
  }

  if (!allow16th && base === 'sixteenth') {
    base = 'eighth';
  }
  return base;
}

/** Metric velocity multiplier for a 16th position within a beat. */
export function hiHatVelocityMultiplier(sixteenth: number, rng: DrumRng): number {
  let baseValue: number;
  switch (sixteenth) {
    case 0:
      baseValue = 0.95;
      break;
    case 2:
      baseValue = 0.75;
      break;
    case 1:
      baseValue = 0.55;
      break;
    default:
      baseValue = 0.5;
      break;
  }
  return baseValue * rng.float(0.95, 1.05);
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
export function openHiHatBeat(section: SectionType, rng: DrumRng): number {
  if (section === 'chorus') {
    const choice = rng.range(0, 3);
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

/** Primary hi-hat articulation for a section. */
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

/** Velocity multiplier for a hi-hat articulation. */
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
  rng: DrumRng,
): boolean {
  if (section !== 'chorus' && section !== 'b') {
    return false;
  }
  if (section === 'chorus') {
    if (beat === 1 || beat === 3) {
      return rng.prob(0.6);
    }
    return false;
  }
  if (beat === 3 && bar % 2 === 1) {
    return rng.prob(0.4);
  }
  return false;
}

/** Foot hi-hat velocity with slight humanization. */
export function footHiHatVelocity(rng: DrumRng): number {
  return rng.range(FHH_VEL_MIN, FHH_VEL_MAX);
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

/** Whether a bridge beat is carried by a cross-stick instead of the hi-hat. */
export function shouldUseBridgeCrossStick(section: SectionType, beat: number): boolean {
  return section === 'bridge' && (beat === 1 || beat === 3);
}
