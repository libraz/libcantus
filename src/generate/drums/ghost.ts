import type { BackingDensity, SectionType } from './internal.js';
import { MoodCategory, sectionIndex } from './internal.js';

/** Ghost-note position within a beat: the "e" (1st 16th) or "a" (3rd 16th). */
export type GhostPosition = 'e' | 'a';

/** Ghost density level ordinal (0 = none, 3 = heavy). */
type GhostDensityLevel = 0 | 1 | 2 | 3;

// Ghost density level per [section index][mood category].
const GHOST_DENSITY_TABLE: GhostDensityLevel[][] = [
  /* intro     */ [0, 1, 1],
  /* a         */ [0, 1, 2],
  /* b         */ [1, 2, 2],
  /* chorus    */ [1, 2, 3],
  /* bridge    */ [1, 1, 2],
  /* interlude */ [0, 1, 1],
  /* outro     */ [0, 1, 1],
];

function levelToProbability(level: GhostDensityLevel): number {
  switch (level) {
    case 0:
      return 0;
    case 1:
      return 0.15;
    case 2:
      return 0.3;
    case 3:
      return 0.45;
  }
}

function clampLevel(level: number): GhostDensityLevel {
  return Math.max(0, Math.min(3, level)) as GhostDensityLevel;
}

function adjustForBpm(level: GhostDensityLevel, bpm: number): GhostDensityLevel {
  if (bpm >= 160 && level !== 0) {
    return clampLevel(level - 1);
  }
  if (bpm <= 90 && level !== 3) {
    return clampLevel(level + 1);
  }
  return level;
}

/** Ghost-note trigger probability for a section, mood, density, and tempo. */
export function getGhostDensity(
  mood: MoodCategory,
  section: SectionType,
  backingDensity: BackingDensity,
  bpm: number,
): number {
  const row = GHOST_DENSITY_TABLE[sectionIndex(section)] ?? GHOST_DENSITY_TABLE[1];
  const level = adjustForBpm((row?.[mood] ?? 0) as GhostDensityLevel, bpm);

  if (backingDensity === 'thin' && level !== 0) {
    return levelToProbability(clampLevel(level - 1));
  }
  if (backingDensity === 'thick' && level !== 3) {
    return levelToProbability(clampLevel(level + 1));
  }
  return levelToProbability(level);
}

/** Ghost-note velocity multiplier for a section and metric position. */
export function getGhostVelocity(section: SectionType, beatPosition: number): number {
  let base = 0.4;
  const even = beatPosition % 2 === 0 ? 0.05 : 0;
  switch (section) {
    case 'a':
      base = 0.35 + even;
      break;
    case 'chorus':
      base = 0.5 + even;
      break;
    case 'bridge':
      base = 0.25 + even;
      break;
    case 'b':
      base = 0.4 + even;
      break;
    case 'intro':
    case 'outro':
      base = 0.38;
      break;
  }
  return Math.max(0.25, Math.min(0.65, base));
}

/**
 * Probability of a ghost at a specific 16th position, higher when the ghost
 * leads straight into the backbeat.
 *
 * Ghosts are only placed on beats 1 and 3 (indices 0 and 2), so those are the
 * positions this answers for; the "a" of each is the one that anticipates the
 * snare.
 */
export function getGhostProbabilityAtPosition(beat: number, sixteenthInBeat: number): number {
  const leadsIntoBackbeat = (beat === 0 || beat === 2) && sixteenthInBeat === 3;
  return leadsIntoBackbeat ? 0.6 : 0.25;
}

/** Choose which ghost positions a groove favours. */
export function selectGhostPositions(mood: MoodCategory): GhostPosition[] {
  if (mood === MoodCategory.Energetic) {
    return ['e', 'a'];
  }
  return ['e'];
}
