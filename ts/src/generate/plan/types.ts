/**
 * A composition plan: what a piece is going to be, before any note is chosen.
 *
 * Where a {@link ReferenceProfile} records what an existing piece did, a plan
 * records what a new one will do — the same structural dimensions (form,
 * harmony, motif derivation, rhythm), stated as targets a generator can hit
 * exactly rather than as a reading to approximate. A plan is plain data,
 * JSON-serializable end to end, and it carries the seed and algorithm version
 * a generator needs to reproduce the piece it describes: the plan is the
 * recipe, not a cache of one run of it.
 */

import type { CadenceType } from '../../analyze/functional/cadence.js';
import type { MelodicContourShape } from '../../analyze/melody/contour.js';
import type { MotifRelationSummary } from '../../analyze/melody/relation.js';
import type { MeterMap } from '../../core/meter/index.js';
import type { ResolvedKey } from '../../theory/scale/index.js';

/**
 * Schema version {@link CompositionPlan} is written at.
 *
 * {@link assertCompositionPlan} rejects any other value outright rather than
 * guess at an older shape a caller's stored JSON might be in.
 *
 * @category Composition
 */
export const COMPOSITION_PLAN_VERSION = 1;

/**
 * What a new piece is going to be: its keys, meter and span, the sections and
 * phrases it is built from, the harmony and motif derivations a generator
 * fills those phrases with, and the rhythmic target it aims for.
 *
 * @category Composition
 */
export type CompositionPlan = {
  /** Schema version this record is written at; see {@link COMPOSITION_PLAN_VERSION}. */
  planVersion: number;
  /** The project seed a generator following this plan draws from. */
  seed: number;
  /** The algorithm version a generator following this plan runs under. */
  algorithmVersion: number;
  /** Keys the piece passes through; index 0 is the home key harmony is read against by default. */
  keys: ResolvedKey[];
  /** The piece's meter across the planned span. */
  meters: MeterMap;
  /** The planned span. */
  span: { startBeat: number; endBeat: number; bars: number };
  /** Sections, in time order. */
  sections: PlannedSection[];
  /** Phrases, in time order. */
  phrases: PlannedPhrase[];
  /** The harmonic progression, as a partition of the span. */
  harmony: PlannedChord[];
  /** Motifs and how they derive from one another. */
  motifs: PlannedMotif[];
  /** The rhythmic target a generator's onset placement aims for. */
  rhythm: PlannedRhythm;
};

/**
 * One planned section: a labelled span of the piece.
 *
 * @category Composition
 */
export type PlannedSection = {
  /** The section's label. */
  label: string;
  /** First beat of the section. */
  startBeat: number;
  /** End of the section, exclusive. */
  endBeat: number;
};

/**
 * One planned phrase: its span, the section it opens in, the cadence and
 * melodic shape it targets, and the motifs it carries.
 *
 * @category Composition
 */
export type PlannedPhrase = {
  /** First beat of the phrase. */
  startBeat: number;
  /** End of the phrase, exclusive. */
  endBeat: number;
  /** Index into `plan.sections` of the section this phrase's start beat falls in. */
  section: number | null;
  /** The cadence the phrase is to end on, or null for none. */
  cadence: CadenceType | null;
  /** The phrase's targeted melodic shape. */
  shape: MelodicContourShape;
  /** Onset of the phrase's targeted peak, as a fraction of the phrase's length, in [0, 1]. */
  peakPosition: number;
  /** The phrase's targeted pitch range and mean, as absolute MIDI pitches. */
  register: { low: number; high: number; mean: number };
  /** Targeted onsets per bar within the phrase; see {@link RhythmAnalysis.onsetDensity}. */
  onsetDensity: number;
  /** Indices into `plan.motifs` of every motif statement placed in this phrase. */
  motifs: number[];
};

/**
 * One planned chord, placed against one of the plan's keys.
 *
 * @category Composition
 */
export type PlannedChord = {
  /** First beat of the chord. */
  startBeat: number;
  /** End of the chord, exclusive. */
  endBeat: number;
  /** Index into `plan.keys` of the key this chord is named against. */
  key: number;
  /** The chord, as a Roman numeral in that key. */
  roman: string;
};

/**
 * One planned motif statement: a root the generator writes new notes for, or a
 * derivation the generator obtains from an earlier statement by a named
 * transformation.
 *
 * @category Composition
 */
export type PlannedMotif = {
  /** Index into `plan.phrases` of the phrase this statement is placed in. */
  phrase: number;
  /** First beat of the statement. */
  startBeat: number;
  /** End of the statement, exclusive. */
  endBeat: number;
  /** How many notes the statement carries; a root's generated length, a derivation's inherited from its source. */
  notes: number;
  /**
   * A root's onset-to-onset gaps in beats, `notes - 1` of them, summing to
   * less than the statement's length: its reference motif's ratios times
   * {@link ReferenceMotif.unitBeats}. The first note sounds at `startBeat`
   * and the last lasts to `endBeat`. Null for a root whose onsets a generator
   * draws from `plan.rhythm`; always null for a derivation, whose rhythm is
   * its source's under the named transformation.
   */
  rhythm: number[] | null;
  /** Index into `plan.motifs` of the statement this one derives from; null for a root. Always less than this statement's own index. */
  from: number | null;
  /**
   * The named transformation from `from`, or null for a root, or for a
   * derivation with no named transformation (a variation). Its `semitones`
   * and `degrees` are the preferred pitch level: a generator may place the
   * derivation at another level to keep it inside the register and the harmony.
   */
  relation: MotifRelationSummary | null;
};

/**
 * The rhythmic target a generator's onset placement aims for.
 *
 * @category Composition
 */
export type PlannedRhythm = {
  /** Targeted distribution of onsets across metric levels; see {@link RhythmAnalysis.onsetLevels}. */
  onsetLevels: number[];
  /** Targeted distribution of inter-onset intervals; see {@link RhythmAnalysis.interOnsetShares}. */
  interOnsetShares: number[];
  /** Targeted syncopation, in [0, 1]; see {@link RhythmAnalysis.syncopation}. */
  syncopation: number;
};

/** A tent over [0, 1] rising from -1 to +1 at `apex` and falling back. */
function tent(t: number, apex: number): number {
  if (t <= apex) {
    return apex === 0 ? 1 : -1 + (2 * t) / apex;
  }
  return apex === 1 ? 1 : 1 - (2 * (t - apex)) / (1 - apex);
}

/**
 * The contour a planned phrase asks for at relative position `t` in [0, 1], in
 * [-1, 1] around its register mean: a tent peaking at `peakPosition` for
 * `'arch'`, a line for `'ascending'` and `'descending'`, two tents peaking at
 * 0.25 and 0.75 for `'wave'`, and flat for `'static'`.
 *
 * @param shape The phrase's planned shape.
 * @param peakPosition Where an arch peaks, as a share of the phrase.
 * @param t Position within the phrase, as a share of its length.
 * @returns The target, from -1 at the register floor to +1 at its ceiling.
 */
export function plannedContourAt(
  shape: PlannedPhrase['shape'],
  peakPosition: number,
  t: number,
): number {
  switch (shape) {
    case 'arch':
      return tent(t, peakPosition);
    case 'ascending':
      return -1 + 2 * t;
    case 'descending':
      return 1 - 2 * t;
    case 'wave':
      return t < 0.5 ? tent(2 * t, 0.5) : tent(2 * t - 1, 0.5);
    case 'static':
      return 0;
  }
}
