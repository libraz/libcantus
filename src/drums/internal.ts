/** General MIDI percussion note numbers used across the drum engine. */
export const GM = {
  BD: 36,
  SD: 38,
  SIDESTICK: 37,
  HANDCLAP: 39,
  CHH: 42,
  FHH: 44,
  OHH: 46,
  CRASH: 49,
  RIDE: 51,
  TAMBOURINE: 54,
  TOM_H: 50,
  TOM_M: 47,
  TOM_L: 45,
  SHAKER: 82,
} as const;

/** One beat and one sixteenth expressed as fractions of a beat. */
export const EIGHTH = 0.5;
export const SIXTEENTH = 0.25;

/** Internal drum style selected by the public groove style. */
export type DrumStyle =
  | 'sparse'
  | 'standard'
  | 'fourOnFloor'
  | 'upbeat'
  | 'rock'
  | 'synth'
  | 'trap'
  | 'latin';

/** Groove feel controlling off-beat swing. */
export type Feel = 'straight' | 'swing' | 'shuffle';

/** Reduced section set the engine reasons about. */
export type SectionType = 'intro' | 'a' | 'b' | 'chorus' | 'bridge' | 'outro';

/** Backing density bucket derived from the public density knob. */
export type BackingDensity = 'thin' | 'normal' | 'thick';

/** Section energy level, used to shape fills. */
export type SectionEnergy = 'low' | 'medium' | 'high' | 'peak';

/** Ghost-note mood category for the density table. */
export enum MoodCategory {
  Calm = 0,
  Standard = 1,
  Energetic = 2,
}

/** Percussion mood category for the activation table. */
export enum PercMoodCategory {
  Calm = 0,
  Standard = 1,
  Energetic = 2,
  Idol = 3,
  RockDark = 4,
}

/** Public groove style identifiers. */
export type GrooveStyle =
  | 'standard'
  | 'funk'
  | 'shuffle'
  | 'bossa'
  | 'trap'
  | 'halftime'
  | 'breakbeat';

/** Public role identifiers gating which voices are present. */
export type DrumRole = 'full' | 'ambient' | 'minimal' | 'fxOnly';

/** Public section identifiers. */
export type PublicSection = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'bridge' | 'outro';

/** Resolved internal parameters for a public groove style. */
export type StyleMapping = {
  style: DrumStyle;
  feel: Feel;
  ghostBoost: boolean;
  snareBeat3: boolean;
};

const STYLE_MAP: Record<GrooveStyle, StyleMapping> = {
  // Standard pop pulse: kick on beats 1 and 3, backbeat snare on 2 and 4.
  standard: { style: 'standard', feel: 'straight', ghostBoost: false, snareBeat3: false },
  funk: { style: 'upbeat', feel: 'straight', ghostBoost: true, snareBeat3: false },
  shuffle: { style: 'standard', feel: 'shuffle', ghostBoost: false, snareBeat3: false },
  bossa: { style: 'latin', feel: 'straight', ghostBoost: false, snareBeat3: false },
  trap: { style: 'trap', feel: 'straight', ghostBoost: false, snareBeat3: true },
  halftime: { style: 'sparse', feel: 'straight', ghostBoost: false, snareBeat3: true },
  breakbeat: { style: 'rock', feel: 'straight', ghostBoost: false, snareBeat3: false },
};

/** Resolve the internal style/feel parameters for a public groove style. */
export function mapStyle(style: GrooveStyle): StyleMapping {
  return STYLE_MAP[style];
}

/** Map a public section to the internal section type. */
export function mapSection(section: PublicSection): SectionType {
  switch (section) {
    case 'intro':
      return 'intro';
    case 'verse':
      return 'a';
    case 'prechorus':
      return 'b';
    case 'chorus':
      return 'chorus';
    case 'bridge':
      return 'bridge';
    case 'outro':
      return 'outro';
  }
}

/** Bucket the 0..1 density knob into a backing-density level. */
export function mapDensity(density: number): BackingDensity {
  if (density < 0.34) {
    return 'thin';
  }
  if (density < 0.67) {
    return 'normal';
  }
  return 'thick';
}

/** Swing amount (0..1) implied by a groove feel. */
export function feelSwingAmount(feel: Feel): number {
  if (feel === 'swing') {
    return 0.33;
  }
  if (feel === 'shuffle') {
    return 0.5;
  }
  return 0;
}

/** Ghost-note mood category derived from the internal style. */
export function ghostMoodCategory(style: DrumStyle): MoodCategory {
  if (style === 'sparse') {
    return MoodCategory.Calm;
  }
  if (style === 'trap' || style === 'upbeat') {
    return MoodCategory.Energetic;
  }
  return MoodCategory.Standard;
}

/** Percussion mood category derived from the internal style. */
export function percMoodCategory(style: DrumStyle): PercMoodCategory {
  switch (style) {
    case 'sparse':
      return PercMoodCategory.Calm;
    case 'upbeat':
    case 'latin':
      return PercMoodCategory.Energetic;
    case 'fourOnFloor':
      return PercMoodCategory.Idol;
    case 'trap':
    case 'rock':
      return PercMoodCategory.RockDark;
    default:
      return PercMoodCategory.Standard;
  }
}

/** Zero-based section index shared by the ghost and percussion tables. */
export function sectionIndex(section: SectionType): number {
  switch (section) {
    case 'intro':
      return 0;
    case 'a':
      return 1;
    case 'b':
      return 2;
    case 'chorus':
      return 3;
    case 'bridge':
      return 4;
    case 'outro':
      return 6;
  }
}

/** Section energy used to size fills. */
export function sectionEnergy(section: SectionType): SectionEnergy {
  switch (section) {
    case 'intro':
    case 'outro':
      return 'low';
    case 'a':
    case 'bridge':
      return 'medium';
    case 'b':
      return 'high';
    case 'chorus':
      return 'peak';
  }
}

/** Section velocity multiplier applied to the base drum velocity. */
export function sectionVelocityMultiplier(section: SectionType): number {
  switch (section) {
    case 'intro':
    case 'outro':
      return 0.8;
    case 'a':
      return 0.9;
    case 'b':
      return 1.0;
    case 'chorus':
      return 1.1;
    case 'bridge':
      return 0.85;
  }
}

/** Section density multiplier before backing-density scaling. */
export function sectionDensityMultiplier(section: SectionType): number {
  switch (section) {
    case 'intro':
      return 0.5;
    case 'a':
      return 0.7;
    case 'b':
      return 0.85;
    case 'chorus':
      return 1.0;
    case 'bridge':
      return 0.6;
    case 'outro':
      return 0.6;
  }
}

/** Base drum velocity for a section beat (downbeats accented). */
export function calculateVelocity(section: SectionType, beat: number): number {
  const base = 80;
  const beatAdj = beat === 0 ? 10 : beat === 2 ? 5 : 0;
  const velocity = (base + beatAdj) * sectionVelocityMultiplier(section);
  return clampVel(velocity);
}

/** Round and clamp a velocity into the valid MIDI range. */
export function clampVel(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity)));
}
