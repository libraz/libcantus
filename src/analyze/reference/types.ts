/**
 * A structural fingerprint of a piece: form, phrase shape, harmonic function
 * and rhythm, and how its motifs derive from one another — everything
 * `compareReferences` needs to measure two pieces against each other,
 * dimension by dimension, without carrying the note sequence itself.
 *
 * A profile is plain data, JSON-serializable end to end: nothing in it is a
 * class instance or a function. `profileVersion` gates the shape this file
 * declares, not the analysis behind it — a schema change bumps it, a reading
 * that changes only because the analyzer improved does not.
 */

import type { MeterMap } from '../../core/meter/index.js';
import type { ResolvedKey } from '../../theory/scale/index.js';
import type { FormSection } from '../form/index.js';
import type { CadenceType } from '../functional/cadence.js';
import type { HarmonicFunction } from '../functional/function.js';
import type { MelodicContourShape } from '../melody/contour.js';
import type { MotifGraph } from '../melody/graph.js';
import type { ReductionLevel } from '../reduction/index.js';
import type { RhythmAnalysis } from '../rhythm/index.js';

/**
 * Schema version {@link ReferenceProfile} is written at.
 *
 * {@link assertReferenceProfile} rejects any other value outright rather than
 * guess at an older shape a caller's stored JSON might be in.
 *
 * @category Arrangement & Analysis
 */
export const REFERENCE_PROFILE_VERSION = 1;

/**
 * A structural fingerprint of a piece, recovered from its notes and held
 * without the notes themselves.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceProfile = {
  /** Schema version this record is written at; see {@link REFERENCE_PROFILE_VERSION}. */
  profileVersion: number;
  /** The analysed span. */
  span: { startBeat: number; endBeat: number; bars: number };
  /** The piece's meter across the analysed span. */
  meters: MeterMap;
  /** Sections, phrases and the hypermetric grouping they sit in. */
  form: ReferenceForm;
  /** Keys, structural harmony, and harmonic rhythm. */
  harmony: ReferenceHarmony;
  /** Register, contour, motifs and their derivations, and melodic rhythm. */
  melody: ReferenceMelody;
};

/**
 * The formal reading of a profiled piece: its hypermetric grouping, the
 * sections that grouping and repetition reveal, and the phrases within them.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceForm = {
  /** The hyperbar grouping the phrase and section boundaries are read against. */
  hypermeter: { groupBars: number; confidence: number };
  /** Sections, labelled by which earlier section they restate. */
  sections: FormSection[];
  /** Phrases, in time order. */
  phrases: ReferencePhrase[];
};

/**
 * One phrase: its span, the section it opens in, how it cadences, and the
 * melodic and motivic content within it.
 *
 * @category Arrangement & Analysis
 */
export type ReferencePhrase = {
  /** First beat of the phrase. */
  startBeat: number;
  /** End of the phrase, exclusive. */
  endBeat: number;
  /** The phrase's length in bars. */
  bars: number;
  /** Index into `form.sections` of the section this phrase's start beat falls in. */
  section: number | null;
  /** Confidence of the phrase boundary, in [0, 1]. */
  confidence: number;
  /** The cadence the phrase ends on, or null when it closes on none. */
  cadence: ReferenceCadence | null;
  /** The phrase's melodic descriptors, or null when fewer than two notes sound within it. */
  melody: ReferencePhraseMelody | null;
  /** Indices into `melody.graph.nodes` of every motif statement that starts within this phrase. */
  motifNodes: number[];
};

/**
 * How a melodic line reads within one phrase.
 *
 * @category Arrangement & Analysis
 */
export type ReferencePhraseMelody = {
  /** The phrase's overall shape. */
  shape: MelodicContourShape;
  /** Lowest pitch sounding in the phrase. */
  low: number;
  /** Highest pitch sounding in the phrase. */
  high: number;
  /** Duration-weighted mean pitch, truncated to the phrase's span. */
  mean: number;
  /** Pitch of the phrase's highest note (the first, when several tie). */
  peakPitch: number;
  /** Onset of the phrase's peak note, as a fraction of the phrase's length, in [0, 1]. */
  peakPosition: number;
  /**
   * Eight sampled points across the phrase, each the sounding pitch at that
   * point minus the piece's overall melodic mean, in semitones.
   */
  outline: number[];
  /** Onsets per bar within the phrase; see {@link RhythmAnalysis.onsetDensity}. */
  onsetDensity: number;
  /** Share of the phrase during which nothing sounds. */
  restRatio: number;
};

/**
 * A cadence read at a structural boundary.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceCadence = {
  /** Beat the cadence arrives at. */
  atBeat: number;
  /** The cadence type. */
  type: CadenceType;
  /** How strongly the cadence closes the boundary it sits at, in [0, 1]. */
  weight: number;
};

/**
 * The harmonic reading of a profiled piece: its key regions, its structural
 * chords, and how densely those chords change.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceHarmony = {
  /** Key regions across the analysed span. */
  keys: ReferenceKeyRegion[];
  /** Chords reduced from the piece's harmony. */
  chords: ReferenceChord[];
  /** Onset placement of chord changes, read the way a melodic line's onsets are. */
  rhythm: RhythmAnalysis;
};

/**
 * One span of the piece read in a single key.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceKeyRegion = {
  /** First beat of the region. */
  startBeat: number;
  /** End of the region, exclusive. */
  endBeat: number;
  /** The key the region is read in. */
  key: ResolvedKey;
  /** Confidence of the key reading, in [0, 1]. */
  confidence: number;
};

/**
 * One reduced chord, named against the key region it falls in.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceChord = {
  /** First beat of the chord. */
  startBeat: number;
  /** End of the chord, exclusive. */
  endBeat: number;
  /** Index into `harmony.keys` of the region this chord is read against. */
  key: number;
  /** The chord, as a Roman numeral in the region's key. */
  roman: string;
  /** The chord's harmonic function. */
  function: HarmonicFunction;
  /** How the chord survived harmonic reduction. */
  level: ReductionLevel;
};

/**
 * The melodic reading of a profiled piece: register and contour, its motifs
 * and how they derive from one another, and its rhythm.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceMelody = {
  /** The melodic line's pitch range and mean, or null when no note sounds. */
  register: { low: number; high: number; mean: number } | null;
  /** The melodic line's overall shape, or null when fewer than two notes sound. */
  shape: MelodicContourShape | null;
  /** Motifs found in the melodic line. */
  motifs: ReferenceMotif[];
  /** How the motifs' statements derive from one another. */
  graph: MotifGraph;
  /** Onset placement of the melodic line. */
  rhythm: RhythmAnalysis;
};

/**
 * One motif, held as the interval and rhythm ratios it repeats under
 * transformation rather than as the notes of any one statement.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceMotif = {
  /** Semitones between consecutive notes of the first statement (`MotifData.intervals`). */
  intervals: number[];
  /** Onset-to-onset ratios of the first statement (`MotifData.rhythm`). */
  rhythm: number[];
  /** Length of the first statement, in beats. */
  spanBeats: number;
  /** How many statements of this motif were found. */
  occurrences: number;
};
