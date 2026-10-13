/**
 * The per-dimension measures two structural readings are compared by.
 *
 * Each measure takes the plain parts of a reading it needs rather than a whole
 * profile, so a composition plan can be measured against a profile with the
 * same code. Every measure answers in [0, 1], is symmetric in its arguments,
 * and answers `null` only when neither side has anything to measure; when one
 * side has material and the other has none, it answers 0.
 *
 * Four families: aligned sequences (a graded edit distance normalised by the
 * longer sequence), mass distributions (histogram intersection after
 * normalising each to unit mass), ratios (`min / max`), and differences
 * (`1 − |x − y|`).
 */

import type { NoteEvent } from '../../core/types.js';
import { assertGenerationBudget } from '../../core/validation/index.js';
import type { ResolvedKey } from '../../theory/scale/index.js';
import type { CadenceType } from '../functional/cadence.js';
import { HARMONIC_FUNCTIONS } from '../functional/function.js';
import type { MotifGraph, MotifGraphEdge } from '../melody/graph.js';
import { MOTIF_RELATION_KINDS, type MotifRelationKind } from '../melody/relation.js';
import { compareMelodies } from '../melody/similarity.js';
import type { RhythmAnalysis } from '../rhythm/index.js';
import { distanceToSimilarity, gradedEditDistance } from '../sequence.js';
import type { ReferenceChord, ReferenceMotif, ReferencePhraseMelody } from './types.js';

/** Gap cost of the progression alignment: skipping a chord is cheaper than a wrong one. */
const PROGRESSION_GAP = 0.75;
/** Substitution cost between two chords on the same degree that differ in quality or inversion. */
const SAME_DEGREE_COST = 0.25;
/** Substitution cost between two chords on different degrees that share a function. */
const SAME_FUNCTION_COST = 0.5;
/** Substitution cost between a half and a Phrygian cadence, the latter being a kind of the former. */
const HALF_PHRYGIAN_COST = 0.5;
/** Substitution cost between two keys a matching tonic distance apart but in different modes. */
const MODE_CHANGE_COST = 0.5;
/** Added to a contour substitution when the two phrases' overall shapes differ. */
const SHAPE_MISMATCH_COST = 0.25;
/** Semitones of register offset plus range difference that cost a whole register substitution. */
const REGISTER_SPAN = 24;
/** Weight of the peak-position difference in a register substitution. */
const PEAK_POSITION_WEIGHT = 0.5;
/** Family sizes are binned 1, 2, 3, 4, and 5 or more. */
const FAMILY_SIZE_BINS = 5;
/** Derivation depths are binned 0, 1, 2, and 3 or more. */
const DEPTH_BINS = 4;
/** Names the Neapolitan and augmented sixths are written with; each is its own degree token. */
const NAMED_CHORDS = ['Ger', 'It', 'Fr', 'N'] as const;
/** Relation kinds that leave pitch unchanged, and so do not deepen a derivation. */
const PITCH_PRESERVING: ReadonlySet<MotifRelationKind> = new Set([
  'repetition',
  'augmentation',
  'diminution',
]);
/** Pitch a synthesised motif cell starts on. */
const CELL_START_PITCH = 60;

/**
 * Apply the null rule: `null` when neither side has material, 0 when only one
 * does, and otherwise the measure itself.
 */
function whenBoth(hasA: boolean, hasB: boolean, measure: () => number): number | null {
  if (!hasA && !hasB) {
    return null;
  }
  if (!hasA || !hasB) {
    return 0;
  }
  return measure();
}

/** Aligned likeness of two non-empty sequences. */
function aligned<T>(
  a: readonly T[],
  b: readonly T[],
  cost: (x: T, y: T) => number,
  gap = 1,
): number {
  return distanceToSimilarity(gradedEditDistance(a, b, cost, gap), a.length, b.length);
}

/** Aligned-sequence likeness, under the null rule on empty sequences. */
function alignedSimilarity<T>(
  a: readonly T[],
  b: readonly T[],
  cost: (x: T, y: T) => number,
  gap = 1,
): number | null {
  return whenBoth(a.length > 0, b.length > 0, () => aligned(a, b, cost, gap));
}

/** Sum of the entries of a histogram. */
function massOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/**
 * Intersection of two histograms of the same bins, each first normalised to
 * unit mass. Both must carry mass.
 */
function intersection(a: readonly number[], b: readonly number[]): number {
  const massA = massOf(a);
  const massB = massOf(b);
  let shared = 0;
  for (let i = 0; i < a.length; i += 1) {
    shared += Math.min((a[i] ?? 0) / massA, (b[i] ?? 0) / massB);
  }
  return Math.min(1, shared);
}

/** Histogram intersection, under the null rule on massless histograms. */
function distributionSimilarity(a: readonly number[], b: readonly number[]): number | null {
  return whenBoth(massOf(a) > 0, massOf(b) > 0, () => intersection(a, b));
}

/** `min / max` of two non-negative values; 1 when both are 0. */
function ratio(a: number, b: number): number {
  const larger = Math.max(a, b);
  return larger === 0 ? 1 : Math.min(a, b) / larger;
}

/**
 * Likeness of two section-label sequences.
 *
 * @param a Section labels in time order.
 * @param b The other reading's section labels.
 * @returns The aligned likeness, substitution and gap both costing 1.
 */
export function sectionSequenceSimilarity(
  a: readonly string[],
  b: readonly string[],
): number | null {
  return alignedSimilarity(a, b, (x, y) => (x === y ? 0 : 1));
}

/**
 * Likeness of two phrase-length sequences.
 *
 * @param a Phrase lengths in bars, in time order.
 * @param b The other reading's phrase lengths.
 * @returns The aligned likeness; a substitution costs the relative length
 *   difference, capped at 1.
 */
export function phraseLengthSimilarity(a: readonly number[], b: readonly number[]): number | null {
  return alignedSimilarity(a, b, (x, y) => {
    const longer = Math.max(x, y);
    return longer === 0 ? 0 : Math.min(Math.abs(x - y) / longer, 1);
  });
}

/** Degree token of a numeral with no applied part. */
function simpleDegreeToken(roman: string): string {
  for (const name of NAMED_CHORDS) {
    if (roman.startsWith(name)) {
      return name;
    }
  }
  const match = roman.match(/^([b#]*)([IV]+)/i);
  return match ? `${match[1]}${(match[2] as string).toUpperCase()}` : roman;
}

/**
 * The degree a Roman numeral stands on, with its quality and inversion dropped.
 *
 * The leading accidentals and the numeral, case-insensitively; an applied
 * chord keeps both halves (`V7/ii` → `V/II`), so it never matches the bare
 * numeral; the Neapolitan and the augmented sixths are tokens of their own
 * (`N`, `It`, `Fr`, `Ger`).
 *
 * @param roman A numeral as `chordToRoman` writes it.
 * @returns The degree token.
 */
export function romanDegreeToken(roman: string): string {
  const slash = roman.indexOf('/');
  if (slash < 0) {
    return simpleDegreeToken(roman);
  }
  return `${simpleDegreeToken(roman.slice(0, slash))}/${simpleDegreeToken(roman.slice(slash + 1))}`;
}

/** The part of a reduced chord the progression alignment reads. */
export type ProgressionChord = Pick<ReferenceChord, 'roman' | 'function'>;

/** Substitution cost of one chord for another in the progression alignment. */
function chordCost(x: ProgressionChord, y: ProgressionChord): number {
  if (x.roman === y.roman) {
    return 0;
  }
  if (romanDegreeToken(x.roman) === romanDegreeToken(y.roman)) {
    return SAME_DEGREE_COST;
  }
  return x.function === y.function ? SAME_FUNCTION_COST : 1;
}

/**
 * Likeness of two structural progressions.
 *
 * @param a Structural chords in time order.
 * @param b The other reading's structural chords.
 * @param budget Upper bound on the alignment cells.
 * @returns The aligned likeness under the graded chord cost and a gap of 0.75.
 * @throws {BudgetExceededError} If the alignment would exceed the budget.
 */
export function progressionSimilarity(
  a: readonly ProgressionChord[],
  b: readonly ProgressionChord[],
  budget?: number,
): number | null {
  assertGenerationBudget(a.length * b.length, 'reference progression alignment', budget);
  return alignedSimilarity(a, b, chordCost, PROGRESSION_GAP);
}

/** The part of a reduced chord the function distribution reads. */
export type TimedFunction = Pick<ReferenceChord, 'startBeat' | 'endBeat' | 'function'>;

/** Beats each function holds across a chord list. */
function functionMass(chords: readonly TimedFunction[]): number[] {
  const mass = HARMONIC_FUNCTIONS.map(() => 0);
  for (const chord of chords) {
    const bin = HARMONIC_FUNCTIONS.indexOf(chord.function);
    mass[bin] = (mass[bin] ?? 0) + Math.max(0, chord.endBeat - chord.startBeat);
  }
  return mass;
}

/**
 * Likeness of how long two readings hold each harmonic function.
 *
 * @param a Chords, each weighted by its length.
 * @param b The other reading's chords.
 * @returns The intersection of the two function distributions.
 */
export function functionSimilarity(
  a: readonly TimedFunction[],
  b: readonly TimedFunction[],
): number | null {
  return distributionSimilarity(functionMass(a), functionMass(b));
}

/**
 * Likeness of two cadence sequences.
 *
 * @param a The cadence each phrase closes on, in phrase order; null for none.
 * @param b The other reading's cadences.
 * @returns The aligned likeness; a half cadence answered by a Phrygian one
 *   costs 0.5, any other mismatch 1.
 */
export function cadenceSimilarity(
  a: readonly (CadenceType | null)[],
  b: readonly (CadenceType | null)[],
): number | null {
  return alignedSimilarity(a, b, (x, y) => {
    if (x === y) {
      return 0;
    }
    const halfAndPhrygian =
      (x === 'half' && y === 'phrygian') || (x === 'phrygian' && y === 'half');
    return halfAndPhrygian ? HALF_PHRYGIAN_COST : 1;
  });
}

/** A key read relative to the first key of its plan. */
type KeyToken = { distance: number; mask: number };

/** Each key as its tonic's distance above the first key's, with its mode mask. */
function keyTokens(keys: readonly ResolvedKey[]): KeyToken[] {
  const home = keys[0]?.scale.rootPc ?? 0;
  return keys.map((key) => ({
    distance: (((key.scale.rootPc - home) % 12) + 12) % 12,
    mask: key.scale.modeMask12,
  }));
}

/**
 * Likeness of two key plans, read relative to each plan's first key.
 *
 * @param a Key regions in time order.
 * @param b The other reading's key regions.
 * @returns The aligned likeness; a matching tonic distance in another mode
 *   costs 0.5, any other mismatch 1.
 */
export function keyPlanSimilarity(
  a: readonly ResolvedKey[],
  b: readonly ResolvedKey[],
): number | null {
  return alignedSimilarity(keyTokens(a), keyTokens(b), (x, y) => {
    if (x.distance !== y.distance) {
      return 1;
    }
    return x.mask === y.mask ? 0 : MODE_CHANGE_COST;
  });
}

/** The part of a rhythm reading the onset-placement measure reads. */
export type OnsetPlacement = Pick<RhythmAnalysis, 'onsets' | 'onsetLevels' | 'barPositions'>;

/**
 * Likeness of where two rhythms place their onsets.
 *
 * @param a A rhythm reading.
 * @param b The other rhythm reading.
 * @returns The bar-position intersection of every meter both share, weighted
 *   by the onsets both place in it; the onset-level intersection when they
 *   share no meter.
 */
export function onsetSimilarity(a: OnsetPlacement, b: OnsetPlacement): number | null {
  return whenBoth(a.onsets > 0, b.onsets > 0, () => {
    let weighted = 0;
    let weight = 0;
    for (const left of a.barPositions) {
      for (const right of b.barPositions) {
        const shared =
          left.ts.numerator === right.ts.numerator &&
          left.ts.denominator === right.ts.denominator &&
          left.onsets > 0 &&
          right.onsets > 0;
        if (shared) {
          const w = left.onsets + right.onsets;
          weighted += w * intersection(left.shares, right.shares);
          weight += w;
        }
      }
    }
    return weight > 0 ? weighted / weight : intersection(a.onsetLevels, b.onsetLevels);
  });
}

/**
 * Likeness of two onset densities.
 *
 * @param a A rhythm reading.
 * @param b The other rhythm reading.
 * @returns `min / max` of the two onsets-per-bar figures.
 */
export function densitySimilarity(
  a: Pick<RhythmAnalysis, 'onsets' | 'onsetDensity'>,
  b: Pick<RhythmAnalysis, 'onsets' | 'onsetDensity'>,
): number | null {
  return whenBoth(a.onsets > 0, b.onsets > 0, () => ratio(a.onsetDensity, b.onsetDensity));
}

/**
 * Likeness of two inter-onset-interval distributions.
 *
 * @param a A rhythm reading.
 * @param b The other rhythm reading.
 * @returns The intersection of the two distributions.
 */
export function durationSimilarity(
  a: Pick<RhythmAnalysis, 'onsets' | 'interOnsetShares'>,
  b: Pick<RhythmAnalysis, 'onsets' | 'interOnsetShares'>,
): number | null {
  return whenBoth(a.onsets > 0, b.onsets > 0, () =>
    intersection(a.interOnsetShares, b.interOnsetShares),
  );
}

/**
 * Likeness of two syncopation figures.
 *
 * @param a A rhythm reading.
 * @param b The other rhythm reading.
 * @returns `1 − |sa − sb|`.
 */
export function syncopationSimilarity(
  a: Pick<RhythmAnalysis, 'onsets' | 'syncopation'>,
  b: Pick<RhythmAnalysis, 'onsets' | 'syncopation'>,
): number | null {
  return whenBoth(a.onsets > 0, b.onsets > 0, () => 1 - Math.abs(a.syncopation - b.syncopation));
}

/** The part of a motif the surface measure reads. */
export type SurfaceMotif = Pick<ReferenceMotif, 'intervals' | 'rhythm' | 'occurrences'>;

/**
 * A motif cell as notes: pitches accumulate its intervals from middle C, moved
 * only as far as keeps the cell inside the MIDI range; onsets accumulate its
 * rhythm ratios, and the last note lasts one beat.
 */
function cellNotes(motif: SurfaceMotif): NoteEvent[] {
  const notes: NoteEvent[] = [];
  let low = 0;
  let high = 0;
  let offset = 0;
  for (const interval of motif.intervals) {
    offset += interval;
    low = Math.min(low, offset);
    high = Math.max(high, offset);
  }
  let pitch = Math.min(127 - high, Math.max(-low, CELL_START_PITCH));
  let beat = 0;
  for (let i = 0; i <= motif.intervals.length; i += 1) {
    const step = motif.rhythm[i] ?? 1;
    notes.push({ pitch, startBeat: beat, durationBeat: i < motif.intervals.length ? step : 1 });
    pitch += motif.intervals[i] ?? 0;
    beat += step;
  }
  return notes;
}

/** Occurrence-weighted mean, over `from`'s cells, of each one's best pitch likeness among `to`'s. */
function bestMatchMean(
  from: readonly { cell: NoteEvent[]; occurrences: number }[],
  to: readonly { cell: NoteEvent[] }[],
): number {
  let weighted = 0;
  let weight = 0;
  for (const motif of from) {
    let best = 0;
    for (const other of to) {
      best = Math.max(best, compareMelodies(motif.cell, other.cell).pitchSimilarity);
    }
    weighted += motif.occurrences * best;
    weight += motif.occurrences;
  }
  return weighted / weight;
}

/**
 * Likeness of two motif vocabularies' interval content: the one measure that
 * reads what the melody sounds like rather than how it is built.
 *
 * @param a Motifs of one reading.
 * @param b Motifs of the other.
 * @returns The mean of the two directions' occurrence-weighted best-match
 *   pitch likeness. Rhythm is left out; the structural measures carry it.
 */
export function surfaceSimilarity(
  a: readonly SurfaceMotif[],
  b: readonly SurfaceMotif[],
): number | null {
  return whenBoth(a.length > 0, b.length > 0, () => {
    const left = a.map((motif) => ({ cell: cellNotes(motif), occurrences: motif.occurrences }));
    const right = b.map((motif) => ({ cell: cellNotes(motif), occurrences: motif.occurrences }));
    return (bestMatchMean(left, right) + bestMatchMean(right, left)) / 2;
  });
}

/** The part of a reading the motif-structure measure reads. */
export type MotifStructure = {
  /** The derivation forest over motif statements. */
  graph: MotifGraph;
  /** Length of the span the statements are read over, in beats. */
  spanBeats: number;
};

/** The four terms a motif graph is summarised by. */
type GraphSummary = {
  kinds: number[];
  families: number[];
  depths: number[];
  coverage: number;
};

/** Share of the span covered by the union of the statements' intervals. */
function coverageOf(graph: MotifGraph, spanBeats: number): number {
  if (!(spanBeats > 0) || graph.nodes.length === 0) {
    return 0;
  }
  const spans = graph.nodes
    .map((node) => [node.startBeat, node.endBeat] as const)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let covered = 0;
  let [runStart, runEnd] = spans[0] as readonly [number, number];
  for (const [start, end] of spans) {
    if (start > runEnd) {
      covered += runEnd - runStart;
      runStart = start;
      runEnd = end;
    } else {
      runEnd = Math.max(runEnd, end);
    }
  }
  covered += runEnd - runStart;
  return Math.min(1, covered / spanBeats);
}

/** Add one to a histogram bin. */
function bump(histogram: number[], bin: number): void {
  histogram[bin] = (histogram[bin] ?? 0) + 1;
}

/**
 * Relation kinds, family sizes, derivation depths and coverage of a graph.
 * Every edge runs from an earlier node to a later one, so one pass in node
 * order reaches each parent before its children.
 */
function summarise({ graph, spanBeats }: MotifStructure): GraphSummary {
  const kinds = new Array<number>(MOTIF_RELATION_KINDS.length + 1).fill(0);
  const parentEdge = new Map<number, MotifGraphEdge>();
  for (const edge of graph.edges) {
    const kind = edge.relation?.kind;
    bump(
      kinds,
      kind === undefined ? MOTIF_RELATION_KINDS.length : MOTIF_RELATION_KINDS.indexOf(kind),
    );
    parentEdge.set(edge.to, edge);
  }
  const depth = new Array<number>(graph.nodes.length).fill(0);
  const root = graph.nodes.map((_, i) => i);
  for (let node = 0; node < graph.nodes.length; node += 1) {
    const edge = parentEdge.get(node);
    if (edge !== undefined) {
      const kind = edge.relation?.kind;
      const keepsPitch = kind !== undefined && PITCH_PRESERVING.has(kind);
      depth[node] = (depth[edge.from] ?? 0) + (keepsPitch ? 0 : 1);
      root[node] = root[edge.from] ?? edge.from;
    }
  }
  const familySize = new Map<number, number>();
  for (const r of root) {
    familySize.set(r, (familySize.get(r) ?? 0) + 1);
  }
  const families = new Array<number>(FAMILY_SIZE_BINS).fill(0);
  for (const size of familySize.values()) {
    bump(families, Math.min(size, FAMILY_SIZE_BINS) - 1);
  }
  const depths = new Array<number>(DEPTH_BINS).fill(0);
  for (const d of depth) {
    bump(depths, Math.min(d, DEPTH_BINS - 1));
  }
  return { kinds, families, depths, coverage: coverageOf(graph, spanBeats) };
}

/**
 * Likeness of how two readings' motifs derive from one another.
 *
 * The mean of four terms: the relation-kind distribution (the eight named
 * kinds plus unexplained variants), the family-size distribution (statements
 * per root), the derivation-depth distribution (depth grows only across edges
 * that change pitch), and `1 − |ca − cb|` of the share of the span the
 * statements cover. A term both sides have no mass in drops out of the mean; a
 * term only one side has mass in counts 0.
 *
 * @param a One reading's motif graph and span.
 * @param b The other's.
 * @returns The mean of the terms that remain, or null when none does.
 */
export function motifStructureSimilarity(a: MotifStructure, b: MotifStructure): number | null {
  const left = summarise(a);
  const right = summarise(b);
  const terms = [
    distributionSimilarity(left.kinds, right.kinds),
    distributionSimilarity(left.families, right.families),
    distributionSimilarity(left.depths, right.depths),
    whenBoth(
      left.coverage > 0,
      right.coverage > 0,
      () => 1 - Math.abs(left.coverage - right.coverage),
    ),
  ].filter((term): term is number => term !== null);
  return terms.length === 0 ? null : massOf(terms) / terms.length;
}

/** Substitution cost between two phrases, either of which may have no melody. */
function nullableCost<T>(cost: (x: T, y: T) => number): (x: T | null, y: T | null) => number {
  return (x, y) => {
    if (x === null || y === null) {
      return x === y ? 0 : 1;
    }
    return cost(x, y);
  };
}

/** Aligned likeness of two phrase sequences, null only when no phrase on either side has a melody. */
function phraseSimilarity<T>(
  a: readonly (T | null)[],
  b: readonly (T | null)[],
  cost: (x: T, y: T) => number,
): number | null {
  const hasA = a.some((phrase) => phrase !== null);
  const hasB = b.some((phrase) => phrase !== null);
  return whenBoth(hasA, hasB, () => aligned(a, b, nullableCost(cost)));
}

/** The part of a phrase's melody the contour measure reads. */
export type ContourPhrase = Pick<ReferencePhraseMelody, 'shape' | 'low' | 'high' | 'outline'>;

/** An outline centred on its own mean and scaled by its phrase's own range. */
function normalisedOutline(phrase: ContourPhrase): number[] {
  const mean = massOf(phrase.outline) / (phrase.outline.length || 1);
  const range = phrase.high - phrase.low || 1;
  return phrase.outline.map((point) => (point - mean) / range);
}

/** Contour substitution cost: mean outline difference, plus a shape mismatch, capped at 1. */
function contourCost(x: ContourPhrase, y: ContourPhrase): number {
  const left = normalisedOutline(x);
  const right = normalisedOutline(y);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
  }
  const outlineCost = Math.min(1, difference / (left.length || 1));
  return Math.min(1, outlineCost + (x.shape === y.shape ? 0 : SHAPE_MISMATCH_COST));
}

/**
 * Likeness of two phrase-by-phrase contour sequences.
 *
 * @param a Each phrase's melody in phrase order, or null where it has none.
 * @param b The other reading's.
 * @returns The aligned likeness; a substitution costs the mean absolute
 *   difference of the normalised outlines, plus 0.25 when the shapes differ,
 *   capped at 1; a phrase without a melody matches only another without one.
 */
export function contourSimilarity(
  a: readonly (ContourPhrase | null)[],
  b: readonly (ContourPhrase | null)[],
): number | null {
  return phraseSimilarity(a, b, contourCost);
}

/** The part of a phrase's melody the register measure reads. */
export type RegisterPhrase = Pick<ReferencePhraseMelody, 'low' | 'high' | 'mean' | 'peakPosition'>;

/** One reading's phrase registers and the piece's overall melodic mean. */
export type RegisterPlan = {
  /** Each phrase's melody in phrase order, or null where it has none. */
  phrases: readonly (RegisterPhrase | null)[];
  /** The piece's overall melodic mean pitch; null when no note sounds. */
  mean: number | null;
};

/**
 * Likeness of two phrase-by-phrase register sequences, each phrase read
 * relative to its own piece's melodic mean.
 *
 * @param a One reading's phrase registers.
 * @param b The other's.
 * @returns The aligned likeness; a substitution costs the offset and range
 *   differences over 24 semitones plus half the peak-position difference,
 *   capped at 1; a phrase without a melody matches only another without one.
 */
export function registerSimilarity(a: RegisterPlan, b: RegisterPlan): number | null {
  const meanA = a.mean ?? 0;
  const meanB = b.mean ?? 0;
  return phraseSimilarity(a.phrases, b.phrases, (x: RegisterPhrase, y: RegisterPhrase) => {
    const offset = Math.abs(x.mean - meanA - (y.mean - meanB));
    const range = Math.abs(x.high - x.low - (y.high - y.low));
    const peak = Math.abs(x.peakPosition - y.peakPosition);
    return Math.min(1, (offset + range) / REGISTER_SPAN + PEAK_POSITION_WEIGHT * peak);
  });
}
