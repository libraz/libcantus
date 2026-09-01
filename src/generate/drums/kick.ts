/**
 * The kick vocabulary, as data on a sixteenth grid.
 *
 * The grid is sixteenths rather than eighths because most of what belongs in a
 * kick dictionary cannot be written on eighths at all: the funk and modern-pop
 * basics live on the sixteenths between the beats. The eighth-note patterns map
 * onto the even steps of the same grid, so they read exactly as before.
 */

import type { Draw } from '../context/index.js';
import { deepFreeze } from '../vocabulary/freeze.js';
import { BAR_STEPS, BEAT_STEPS } from '../vocabulary/transform.js';
import {
  type DrumStyle,
  leanedBy,
  mapSection,
  type Section,
  type SectionType,
} from './internal.js';

/** Sixteenth steps in one bar of 4/4; the grid a kick pattern is written on. */
export const KICK_STEPS = BAR_STEPS;

/**
 * Kick presence flags across the sixteen 16th-note slots of a bar.
 *
 * Index `n` is the `n`-th sixteenth from the downbeat, so beat 3 is index 8 and
 * the "and" of 2 is index 6.
 */
export type KickPattern = readonly boolean[];

/** The sixteenth index of a beat's downbeat. */
function beatStep(beat: number): number {
  return beat * BEAT_STEPS;
}

/**
 * One onset of a kick figure.
 *
 * A slot with no probability is part of the figure itself and always sounds.
 * One with a probability is where the rhythmic dial reaches the kick: the draw
 * is fixed by position and leaned on by the dial, so raising the dial fills
 * slots in without emptying any that were already there.
 */
export type KickSlot = {
  /** Sixteenth index within the bar, 0..15. */
  step: number;
  /** Chance the slot is taken before the dial leans on it. */
  probability?: number;
  /** Draw address for the slot; slots that may sound must name one. */
  slot?: string;
  /** Restrict the slot to bars of one parity, for a two-bar figure. */
  barParity?: 0 | 1;
  /** Sections the slot is added in; absent means every section. */
  sections?: Section[];
};

/** A style's kick figure: the slots it always plays, plus the ones it may. */
export type KickFigure = readonly KickSlot[];

const BEAT_1 = beatStep(0);
const BEAT_2 = beatStep(1);
const BEAT_3 = beatStep(2);
const BEAT_4 = beatStep(3);
const AND_2 = beatStep(1) + 2;
const AND_4 = beatStep(3) + 2;

/**
 * The kick a section plays whatever the style: two half notes, so the phrase
 * ends without pushing.
 */
const OUTRO_FIGURE: KickFigure = [{ step: BEAT_1 }, { step: BEAT_3 }];

/** The figure a style with no entry of its own plays. */
const DEFAULT_FIGURE: KickFigure = [
  { step: BEAT_1 },
  { step: BEAT_3 },
  { step: AND_2, probability: 0.5, slot: 'beat2and', sections: ['prechorus'] },
  { step: AND_2, probability: 0.55, slot: 'beat2and', sections: ['chorus'] },
  { step: AND_4, probability: 0.35, slot: 'beat4and', sections: ['chorus'] },
];

/**
 * The kick dictionary, keyed by internal style.
 *
 * Provenance: each figure is the plain pulse of its style — the four-on-the-
 * floor dance kick, the backbeat-answering "and" of two, the clave-leaning
 * latin figure — none of them traceable to a particular record.
 */
export const KICK_FIGURES: Readonly<Record<DrumStyle, KickFigure>> = deepFreeze({
  sparse: [{ step: BEAT_1 }, { step: BEAT_3, sections: ['chorus'], barParity: 1 }],
  fourOnFloor: [
    { step: BEAT_1 },
    { step: BEAT_2 },
    { step: BEAT_3 },
    { step: BEAT_4 },
    { step: AND_2, probability: 0.2, slot: 'beat2and', sections: ['chorus'] },
  ],
  upbeat: [
    { step: BEAT_1 },
    { step: BEAT_3 },
    { step: AND_2, probability: 0.7, slot: 'beat2and', sections: ['prechorus', 'chorus'] },
    { step: AND_4, probability: 0.6, slot: 'beat4and', sections: ['chorus'] },
  ],
  rock: [
    { step: BEAT_1 },
    { step: BEAT_3 },
    { step: AND_2, probability: 0.65, slot: 'beat2and', sections: ['chorus'] },
    { step: AND_4, probability: 0.4, slot: 'beat4and', sections: ['chorus'] },
    { step: AND_2, probability: 0.3, slot: 'beat2and', sections: ['prechorus'] },
  ],
  synth: [
    { step: BEAT_1 },
    { step: BEAT_3 },
    { step: AND_2, probability: 0.75, slot: 'beat2and', sections: ['prechorus', 'chorus'] },
    { step: AND_4, probability: 0.65, slot: 'beat4and', sections: ['chorus'] },
  ],
  trap: [
    { step: BEAT_1 },
    { step: AND_2, probability: 0.8, slot: 'beat2and' },
    { step: BEAT_3, probability: 0.3, slot: 'beat3' },
    { step: AND_4, probability: 0.7, slot: 'beat4and' },
  ],
  latin: [
    { step: BEAT_1 },
    { step: AND_2 },
    { step: BEAT_3 },
    { step: AND_4, probability: 0.5, slot: 'beat4and' },
  ],
  standard: DEFAULT_FIGURE,
});

/** An empty bar of the grid. */
function emptyPattern(): boolean[] {
  return Array.from({ length: KICK_STEPS }, () => false);
}

/**
 * Whether a pre-chorus bar sits in the two-bar lift into the chorus.
 *
 * @param section Current section.
 * @param bar Bar index within the section.
 * @param sectionBars Total bars in the section.
 * @param nextIsChorus Whether the following section is a chorus.
 */
export function isInPreChorusLift(
  section: SectionType,
  bar: number,
  sectionBars: number,
  nextIsChorus: boolean,
): boolean {
  if (section !== 'b' || !nextIsChorus || sectionBars < 3) {
    return false;
  }
  return bar >= sectionBars - 2;
}

/**
 * Realise a kick figure for one bar.
 *
 * @param figure The figure to play.
 * @param section Current section, matched against each slot's own sections.
 * @param bar Bar index, which addresses the draws and decides slot parity.
 * @param draw Position-addressed draws for the kick.
 * @param rhythmic Rhythmic dial in [0, 1].
 * @returns The bar's onsets on the sixteenth grid.
 */
export function realiseKickFigure(
  figure: KickFigure,
  section: SectionType,
  bar: number,
  draw: Draw,
  rhythmic: number,
): KickPattern {
  const pattern = emptyPattern();
  for (const slot of figure) {
    if (slot.step < 0 || slot.step >= KICK_STEPS) {
      continue;
    }
    if (slot.sections && !slot.sections.some((name) => mapSection(name) === section)) {
      continue;
    }
    if (slot.barParity !== undefined && bar % 2 !== slot.barParity) {
      continue;
    }
    if (slot.probability === undefined) {
      pattern[slot.step] = true;
      continue;
    }
    if (draw.prob(leanedBy(slot.probability, rhythmic), 'kick', bar, slot.slot ?? slot.step)) {
      pattern[slot.step] = true;
    }
  }
  return pattern;
}

/**
 * Build a section- and style-aware kick pattern.
 *
 * @param section Current section.
 * @param style Internal drum style.
 * @param bar Bar index (drives variation for a few styles).
 * @param draw Position-addressed draws for the kick.
 * @param rhythmic Rhythmic dial in [0, 1].
 */
export function getKickPattern(
  section: SectionType,
  style: DrumStyle,
  bar: number,
  draw: Draw,
  rhythmic: number,
): KickPattern {
  const figure = section === 'outro' ? OUTRO_FIGURE : (KICK_FIGURES[style] ?? DEFAULT_FIGURE);
  return realiseKickFigure(figure, section, bar, draw, rhythmic);
}
