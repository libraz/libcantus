import type { Draw } from '../context/index.js';
import { sustainsStrokes } from '../context/index.js';
import { type SectionCtx, swing16 } from './beat.js';
import { HH_16TH_BPM_THRESHOLD } from './hihat.js';
import type { HitList } from './hit.js';
import type { DrumRole, SectionType } from './internal.js';
import {
  backbeatBeats,
  EIGHTH,
  GM,
  PercMoodCategory,
  SIXTEENTH,
  sectionIndex,
} from './internal.js';

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

/**
 * Emit one bar of auxiliary percussion (tambourine/shaker/handclap).
 *
 * The shaker's off-16ths are where the rhythmic dial reaches this voice: each
 * has its own draw, so turning the dial up fills the subdivision in one
 * position at a time rather than switching the whole bar between two patterns.
 *
 * These voices are an overdub layer rather than strokes the kit player has a
 * hand free for: a tambourine and a hand-clap on the backbeat sound over a
 * snare and a hi-hat that already take both hands.
 */
export function generateAuxPercussionForBar(
  track: HitList,
  barStart: number,
  config: PercussionConfig,
  role: DrumRole,
  densityMult: number,
  draw: Draw,
  bpm: number,
  sec: SectionCtx,
  swingAmount: number,
  barBeats = 4,
): void {
  if (role === 'minimal') {
    return;
  }

  // Tambourine and hand-claps reinforce the backbeat, so they land where the
  // section says the backbeat is: a style that moves it to beat 3 would
  // otherwise have two voices naming two different backbeats in one bar.
  const backbeats = backbeatBeats(sec.snareBeat3, barBeats);

  if (config.tambourine) {
    for (const beat of backbeats) {
      const raw = 70 * densityMult * draw.float(0.9, 1.1, 'tambourine', barStart, beat);
      track.add(GM.TAMBOURINE, barStart + beat, EIGHTH, Math.max(40, Math.min(90, raw)));
    }
  }

  if (config.shaker) {
    const use16th =
      config.shaker16th &&
      bpm < HH_16TH_BPM_THRESHOLD &&
      sustainsStrokes(SIXTEENTH, bpm, sec.difficulty);
    if (use16th) {
      const velCurve = [0.75, 0.45, 0.6, 0.45];
      for (let beat = 0; beat < barBeats; beat += 1) {
        for (let sub = 0; sub < 4; sub += 1) {
          // The on-beat and mid-beat shakes carry the pattern; the two between
          // them are the dial's to add.
          if (sub % 2 === 1 && !draw.prob(sec.rhythmic, 'shaker16', barStart, beat, sub)) {
            continue;
          }
          const raw =
            80 *
            (velCurve[sub] ?? 0.5) *
            densityMult *
            draw.float(0.9, 1.1, 'shaker', barStart, beat, sub);
          track.add(
            GM.SHAKER,
            swing16(barStart + beat + sub * SIXTEENTH, sec, swingAmount),
            SIXTEENTH,
            Math.max(25, Math.min(85, raw)),
          );
        }
      }
    } else {
      const velCurve = [0.75, 0.55];
      for (let beat = 0; beat < barBeats; beat += 1) {
        for (let sub = 0; sub < 2; sub += 1) {
          const raw =
            80 *
            (velCurve[sub] ?? 0.6) *
            densityMult *
            draw.float(0.9, 1.1, 'shaker', barStart, beat, sub);
          track.add(
            GM.SHAKER,
            swing16(barStart + beat + sub * EIGHTH, sec, swingAmount),
            EIGHTH,
            Math.max(25, Math.min(85, raw)),
          );
        }
      }
    }
  }

  if (config.handclap) {
    for (const beat of backbeats) {
      const raw = 85 * densityMult * draw.float(0.9, 1.1, 'handclap', barStart, beat);
      track.add(GM.HANDCLAP, barStart + beat, EIGHTH, Math.max(50, Math.min(100, raw)));
    }
  }
}
