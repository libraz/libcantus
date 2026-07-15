import { HH_16TH_BPM_THRESHOLD } from './hihat.js';
import type { HitList } from './hit.js';
import type { DrumRole, SectionType } from './internal.js';
import { EIGHTH, GM, PercMoodCategory, SIXTEENTH, sectionIndex } from './internal.js';
import type { DrumRng } from './rng.js';

/** Enabled auxiliary percussion voices for a section. */
export type PercussionConfig = {
  tambourine: boolean;
  shaker: boolean;
  handclap: boolean;
  shaker16th: boolean;
};

type PercActivation = [tambourine: boolean, shaker: boolean, handclap: boolean];

// Percussion activation per [mood category][section index]. Columns:
// intro, a, b, chorus, bridge, interlude, outro, chant, mixbreak.
const F: PercActivation = [false, false, false];
const PERC_TABLE: PercActivation[][] = [
  /* calm */ [F, F, F, F, F, F, F, F, F],
  /* std  */ [F, F, [false, true, false], [true, false, true], F, F, F, F, [true, false, true]],
  /* ener */ [
    F,
    [false, true, false],
    [false, true, false],
    [true, true, true],
    F,
    F,
    F,
    F,
    [true, true, true],
  ],
  /* idol */ [
    F,
    [false, true, false],
    [false, true, false],
    [true, true, true],
    F,
    F,
    F,
    F,
    [true, true, true],
  ],
  /* rock */ [F, F, F, [false, false, true], F, F, F, F, [false, false, true]],
];

/** Resolve which auxiliary percussion voices play for a section. */
export function getPercussionConfig(
  mood: PercMoodCategory,
  section: SectionType,
): PercussionConfig {
  const row = PERC_TABLE[mood] ?? PERC_TABLE[PercMoodCategory.Standard];
  const act = row?.[sectionIndex(section)] ?? F;
  return {
    tambourine: act[0],
    shaker: act[1],
    handclap: act[2],
    shaker16th: act[1],
  };
}

/** Emit one bar of auxiliary percussion (tambourine/shaker/handclap). */
export function generateAuxPercussionForBar(
  track: HitList,
  barStart: number,
  config: PercussionConfig,
  role: DrumRole,
  densityMult: number,
  rng: DrumRng,
  bpm: number,
): void {
  if (role === 'minimal') {
    return;
  }

  if (config.tambourine) {
    for (let beat = 1; beat <= 3; beat += 2) {
      const raw = 70 * densityMult * rng.float(0.9, 1.1);
      track.add(GM.TAMBOURINE, barStart + beat, EIGHTH, Math.max(40, Math.min(90, raw)));
    }
  }

  if (config.shaker) {
    const use16th = config.shaker16th && bpm < HH_16TH_BPM_THRESHOLD;
    if (use16th) {
      const velCurve = [0.75, 0.45, 0.6, 0.45];
      for (let beat = 0; beat < 4; beat += 1) {
        for (let sub = 0; sub < 4; sub += 1) {
          const raw = 80 * (velCurve[sub] ?? 0.5) * densityMult * rng.float(0.9, 1.1);
          track.add(
            GM.SHAKER,
            barStart + beat + sub * SIXTEENTH,
            SIXTEENTH,
            Math.max(25, Math.min(85, raw)),
          );
        }
      }
    } else {
      const velCurve = [0.75, 0.55];
      for (let beat = 0; beat < 4; beat += 1) {
        for (let sub = 0; sub < 2; sub += 1) {
          const raw = 80 * (velCurve[sub] ?? 0.6) * densityMult * rng.float(0.9, 1.1);
          track.add(
            GM.SHAKER,
            barStart + beat + sub * EIGHTH,
            EIGHTH,
            Math.max(25, Math.min(85, raw)),
          );
        }
      }
    }
  }

  if (config.handclap) {
    for (let beat = 1; beat <= 3; beat += 2) {
      const raw = 85 * densityMult * rng.float(0.9, 1.1);
      track.add(GM.HANDCLAP, barStart + beat, EIGHTH, Math.max(50, Math.min(100, raw)));
    }
  }
}
