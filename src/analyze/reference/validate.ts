/**
 * Boundary validation for {@link ReferenceProfile}: a caller can hand this a
 * value restored from JSON, a config file, or a plugin host, and every field
 * is checked before anything downstream reads it. A violation names the path
 * to the offending field, so a malformed document is diagnosed at the field
 * that is wrong rather than wherever the first bad read happens to land.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { MeterMap } from '../../core/meter/index.js';
import {
  assertArray,
  assertFiniteNumber,
  assertFlag,
  assertInteger,
  assertMeterMap,
  assertMidiPitch,
  assertOneOf,
  assertPositiveInt,
  assertRange,
  assertRecord,
  assertTimeSignature,
  describeRejected,
} from '../../core/validation/index.js';
import { type ResolvedKey, resolveKey } from '../../theory/scale/index.js';
import type { FormSection } from '../form/index.js';
import { CADENCE_TYPES } from '../functional/cadence.js';
import { HARMONIC_FUNCTIONS } from '../functional/function.js';
import { romanToChord } from '../functional/roman.js';
import { MELODIC_CONTOUR_SHAPES } from '../melody/contour.js';
import type { MotifGraph, MotifGraphEdge, MotifGraphNode } from '../melody/graph.js';
import { MOTIF_RELATION_KINDS, type MotifRelationSummary } from '../melody/relation.js';
import { REDUCTION_LEVELS } from '../reduction/index.js';
import { type BarPositionProfile, RHYTHM_IOI_BINS, type RhythmAnalysis } from '../rhythm/index.js';
import {
  REFERENCE_PROFILE_VERSION,
  type ReferenceCadence,
  type ReferenceChord,
  type ReferenceForm,
  type ReferenceHarmony,
  type ReferenceKeyRegion,
  type ReferenceMelody,
  type ReferenceMotif,
  type ReferencePhrase,
  type ReferencePhraseMelody,
  type ReferenceProfile,
} from './types.js';

/** Tolerance a mass distribution's shares may sum away from 1 by. */
const MASS_TOLERANCE = 1e-9;

/** Require a string, before it is read as one. */
function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new InvalidInputError(`${name} must be a string; received ${describeRejected(value)}`);
  }
  return value;
}

/**
 * Require `endBeat` not to precede `startBeat`, once both are already known
 * finite.
 */
function assertSpanOrder(startBeat: number, endBeat: number, name: string): void {
  if (endBeat < startBeat) {
    throw new InvalidInputError(
      `${name}.endBeat must be at least ${name}.startBeat; received ${endBeat} < ${startBeat}`,
    );
  }
}

/**
 * Read a field that is required to be present but may validly be `null`,
 * distinguishing a missing key (a caller's malformed document) from an
 * explicit `null` (this field's "nothing to report" answer).
 */
function assertNullable<T>(
  value: unknown,
  name: string,
  validate: (v: unknown, name: string) => T,
): T | null {
  if (value === undefined) {
    throw new InvalidInputError(`${name} must be present; received undefined`);
  }
  return value === null ? null : validate(value, name);
}

/**
 * Require a fixed-length distribution of non-negative mass summing to 1,
 * except when `allowAllZero` holds and every share is 0 — the reading for an
 * onset count of zero, which has no mass to distribute.
 */
function assertMassDistribution(
  value: unknown,
  length: number,
  name: string,
  allowAllZero: boolean,
): number[] {
  const shares = assertArray<number>(value, name);
  if (shares.length !== length) {
    throw new InvalidInputError(`${name} must have length ${length}; received ${shares.length}`);
  }
  let sum = 0;
  for (let index = 0; index < shares.length; index += 1) {
    const share = assertFiniteNumber(shares[index] as number, `${name}[${index}]`);
    if (share < 0) {
      throw new InvalidInputError(`${name}[${index}] must be at least 0; received ${share}`);
    }
    sum += share;
  }
  if (allowAllZero && sum === 0) {
    return shares as number[];
  }
  if (Math.abs(sum - 1) > MASS_TOLERANCE) {
    throw new InvalidInputError(`${name} must sum to 1; received ${sum}`);
  }
  return shares as number[];
}

/** Validate one time-signature's onset placement profile. */
function assertBarPositionProfile(value: unknown, name: string): BarPositionProfile {
  const read = assertRecord<BarPositionProfile>(value, name);
  assertTimeSignature(read.ts, `${name}.ts`);
  const slotsPerBar = assertPositiveInt(read.slotsPerBar, `${name}.slotsPerBar`);
  const onsets = assertInteger(read.onsets, `${name}.onsets`, 0);
  assertMassDistribution(read.shares, slotsPerBar, `${name}.shares`, onsets === 0);
  return read;
}

/**
 * Validate a {@link RhythmAnalysis}, reused unchanged from `analyze/rhythm` for
 * both a melodic line's onsets and a chord timeline's.
 */
function assertRhythmAnalysis(value: unknown, name: string): RhythmAnalysis {
  const read = assertRecord<RhythmAnalysis>(value, name);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertRange(read.bars, 0, Number.MAX_SAFE_INTEGER, `${name}.bars`);
  const onsets = assertInteger(read.onsets, `${name}.onsets`, 0);
  assertRange(read.onsetDensity, 0, Number.MAX_SAFE_INTEGER, `${name}.onsetDensity`);
  const barOnsets = assertArray<number>(read.barOnsets, `${name}.barOnsets`);
  for (let index = 0; index < barOnsets.length; index += 1) {
    assertRange(
      barOnsets[index] as number,
      0,
      Number.MAX_SAFE_INTEGER,
      `${name}.barOnsets[${index}]`,
    );
  }
  assertMassDistribution(read.onsetLevels, 6, `${name}.onsetLevels`, onsets === 0);
  const barPositions = assertArray<BarPositionProfile>(read.barPositions, `${name}.barPositions`);
  for (let index = 0; index < barPositions.length; index += 1) {
    assertBarPositionProfile(barPositions[index], `${name}.barPositions[${index}]`);
  }
  assertMassDistribution(
    read.interOnsetShares,
    RHYTHM_IOI_BINS.length,
    `${name}.interOnsetShares`,
    onsets === 0,
  );
  assertRange(read.restRatio, 0, 1, `${name}.restRatio`);
  assertRange(read.syncopation, 0, 1, `${name}.syncopation`);
  assertRange(read.offGridRatio, 0, 1, `${name}.offGridRatio`);
  assertString(read.rationale, `${name}.rationale`);
  return read;
}

/** Validate one {@link FormSection}, bounding `firstOccurrence` by the section array it sits in. */
function assertFormSection(value: unknown, name: string, sectionCount: number): FormSection {
  const read = assertRecord<FormSection>(value, name);
  assertString(read.label, `${name}.label`);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertRange(read.bars, 0, Number.MAX_SAFE_INTEGER, `${name}.bars`);
  assertInteger(read.firstOccurrence, `${name}.firstOccurrence`, 0, Math.max(sectionCount - 1, 0));
  assertRange(read.similarity, 0, 1, `${name}.similarity`);
  assertString(read.rationale, `${name}.rationale`);
  return read;
}

/** Validate a cadence read at a phrase or structural boundary. */
function assertReferenceCadence(value: unknown, name: string): ReferenceCadence {
  const read = assertRecord<ReferenceCadence>(value, name);
  assertFiniteNumber(read.atBeat, `${name}.atBeat`);
  assertOneOf(read.type, CADENCE_TYPES, `${name}.type`);
  assertRange(read.weight, 0, 1, `${name}.weight`);
  return read;
}

/** Validate a phrase's melodic descriptors. */
function assertReferencePhraseMelody(value: unknown, name: string): ReferencePhraseMelody {
  const read = assertRecord<ReferencePhraseMelody>(value, name);
  assertOneOf(read.shape, MELODIC_CONTOUR_SHAPES, `${name}.shape`);
  assertMidiPitch(read.low, `${name}.low`);
  assertMidiPitch(read.high, `${name}.high`);
  assertRange(read.mean, 0, 127, `${name}.mean`);
  assertRange(read.peakPitch, 0, 127, `${name}.peakPitch`);
  assertRange(read.peakPosition, 0, 1, `${name}.peakPosition`);
  const outline = assertArray<number>(read.outline, `${name}.outline`);
  if (outline.length !== 8) {
    throw new InvalidInputError(`${name}.outline must have length 8; received ${outline.length}`);
  }
  for (let index = 0; index < outline.length; index += 1) {
    assertFiniteNumber(outline[index] as number, `${name}.outline[${index}]`);
  }
  assertRange(read.onsetDensity, 0, Number.MAX_SAFE_INTEGER, `${name}.onsetDensity`);
  assertRange(read.restRatio, 0, 1, `${name}.restRatio`);
  return read;
}

/** Validate one phrase, bounding its section and motif-node indices by the arrays they point into. */
function assertReferencePhrase(
  value: unknown,
  name: string,
  sectionCount: number,
  nodeCount: number,
): ReferencePhrase {
  const read = assertRecord<ReferencePhrase>(value, name);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertRange(read.bars, 0, Number.MAX_SAFE_INTEGER, `${name}.bars`);
  assertNullable(read.section, `${name}.section`, (v, n) =>
    assertInteger(v as number, n, 0, Math.max(sectionCount - 1, 0)),
  );
  assertRange(read.confidence, 0, 1, `${name}.confidence`);
  assertNullable(read.cadence, `${name}.cadence`, assertReferenceCadence);
  assertNullable(read.melody, `${name}.melody`, assertReferencePhraseMelody);
  const motifNodes = assertArray<number>(read.motifNodes, `${name}.motifNodes`);
  for (let index = 0; index < motifNodes.length; index += 1) {
    assertInteger(
      motifNodes[index] as number,
      `${name}.motifNodes[${index}]`,
      0,
      Math.max(nodeCount - 1, 0),
    );
  }
  return read;
}

/** Validate the form reading: hypermeter, sections, and the phrases within them. */
function assertReferenceForm(value: unknown, name: string, nodeCount: number): ReferenceForm {
  const read = assertRecord<ReferenceForm>(value, name);
  const hypermeter = assertRecord<{ groupBars: number; confidence: number }>(
    read.hypermeter,
    `${name}.hypermeter`,
  );
  assertRange(hypermeter.groupBars, 0, Number.MAX_SAFE_INTEGER, `${name}.hypermeter.groupBars`);
  assertRange(hypermeter.confidence, 0, 1, `${name}.hypermeter.confidence`);
  const sections = assertArray<FormSection>(read.sections, `${name}.sections`);
  for (let index = 0; index < sections.length; index += 1) {
    assertFormSection(sections[index], `${name}.sections[${index}]`, sections.length);
  }
  const phrases = assertArray<ReferencePhrase>(read.phrases, `${name}.phrases`);
  for (let index = 0; index < phrases.length; index += 1) {
    assertReferencePhrase(phrases[index], `${name}.phrases[${index}]`, sections.length, nodeCount);
  }
  return read;
}

/**
 * Validate a {@link ResolvedKey}, by handing it to {@link resolveKey} — the
 * same reader every other key-shaped argument in the library is checked
 * through — without replacing the value the caller passed in.
 */
function assertResolvedKeyField(value: unknown, name: string): ResolvedKey {
  const read = assertRecord<ResolvedKey>(value, name);
  try {
    resolveKey(read);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw new InvalidInputError(`${name} must be a valid key: ${error.message}`);
    }
    throw error;
  }
  return read;
}

/** Validate one key region. */
function assertReferenceKeyRegion(value: unknown, name: string): ReferenceKeyRegion {
  const read = assertRecord<ReferenceKeyRegion>(value, name);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertResolvedKeyField(read.key, `${name}.key`);
  assertRange(read.confidence, 0, 1, `${name}.confidence`);
  return read;
}

/**
 * Validate one reduced chord, bounding its key index by the key-region array
 * it points into and checking that its numeral is one {@link romanToChord} can
 * read against that region's key.
 */
function assertReferenceChord(
  value: unknown,
  name: string,
  keys: readonly ResolvedKey[],
): ReferenceChord {
  const read = assertRecord<ReferenceChord>(value, name);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  const keyIndex = assertInteger(read.key, `${name}.key`, 0, Math.max(keys.length - 1, 0));
  const roman = assertString(read.roman, `${name}.roman`);
  try {
    romanToChord(roman, keys[keyIndex] as ResolvedKey);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw new InvalidInputError(
        `${name}.roman must be readable by romanToChord; received ${describeRejected(roman)}: ${error.message}`,
      );
    }
    throw error;
  }
  assertOneOf(read.function, HARMONIC_FUNCTIONS, `${name}.function`);
  assertOneOf(read.level, REDUCTION_LEVELS, `${name}.level`);
  return read;
}

/** Validate the harmonic reading: key regions, structural chords, and harmonic rhythm. */
function assertReferenceHarmony(value: unknown, name: string): ReferenceHarmony {
  const read = assertRecord<ReferenceHarmony>(value, name);
  const keys = assertArray<ReferenceKeyRegion>(read.keys, `${name}.keys`);
  for (let index = 0; index < keys.length; index += 1) {
    assertReferenceKeyRegion(keys[index], `${name}.keys[${index}]`);
  }
  const resolvedKeys = keys.map((region) => (region as ReferenceKeyRegion).key);
  const chords = assertArray<ReferenceChord>(read.chords, `${name}.chords`);
  for (let index = 0; index < chords.length; index += 1) {
    assertReferenceChord(chords[index], `${name}.chords[${index}]`, resolvedKeys);
  }
  assertRhythmAnalysis(read.rhythm, `${name}.rhythm`);
  return read;
}

/** Validate the named transformation a motif-graph edge carries. */
function assertMotifRelationSummary(value: unknown, name: string): MotifRelationSummary {
  const read = assertRecord<MotifRelationSummary>(value, name);
  assertOneOf(read.kind, MOTIF_RELATION_KINDS, `${name}.kind`);
  assertFlag(read.sequence, `${name}.sequence`);
  assertFiniteNumber(read.semitones, `${name}.semitones`);
  if (read.degrees !== undefined) {
    assertFiniteNumber(read.degrees, `${name}.degrees`);
  }
  const timeRatio = assertFiniteNumber(read.timeRatio, `${name}.timeRatio`);
  if (timeRatio <= 0) {
    throw new InvalidInputError(`${name}.timeRatio must be positive; received ${timeRatio}`);
  }
  return read;
}

/** Validate one motif-graph node, bounding its motif and occurrence indices. */
function assertMotifGraphNode(
  value: unknown,
  name: string,
  occurrenceCounts: readonly number[],
): MotifGraphNode {
  const read = assertRecord<MotifGraphNode>(value, name);
  const motif = assertInteger(
    read.motif,
    `${name}.motif`,
    0,
    Math.max(occurrenceCounts.length - 1, 0),
  );
  assertInteger(
    read.occurrence,
    `${name}.occurrence`,
    0,
    Math.max((occurrenceCounts[motif] ?? 1) - 1, 0),
  );
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  return read;
}

/**
 * Validate one motif-graph edge: its endpoints stay within the node array, and
 * `from` precedes `to` — the forest a derivation graph never points backward
 * or sideways in.
 */
function assertMotifGraphEdge(value: unknown, name: string, nodeCount: number): MotifGraphEdge {
  const read = assertRecord<MotifGraphEdge>(value, name);
  const from = assertInteger(read.from, `${name}.from`, 0, Math.max(nodeCount - 1, 0));
  const to = assertInteger(read.to, `${name}.to`, 0, Math.max(nodeCount - 1, 0));
  if (from >= to) {
    throw new InvalidInputError(
      `${name}.from must be less than ${name}.to; received from=${from}, to=${to}`,
    );
  }
  assertNullable(read.relation, `${name}.relation`, assertMotifRelationSummary);
  assertRange(read.similarity, 0, 1, `${name}.similarity`);
  return read;
}

/**
 * Validate the motif graph: every node's motif and occurrence indices, and
 * every edge's endpoints, ordering, and in-degree — a derivation forest gives
 * each node at most one edge into it.
 */
function assertMotifGraph(
  value: unknown,
  name: string,
  occurrenceCounts: readonly number[],
): MotifGraph {
  const read = assertRecord<MotifGraph>(value, name);
  const nodes = assertArray<MotifGraphNode>(read.nodes, `${name}.nodes`);
  for (let index = 0; index < nodes.length; index += 1) {
    assertMotifGraphNode(nodes[index], `${name}.nodes[${index}]`, occurrenceCounts);
  }
  const edges = assertArray<MotifGraphEdge>(read.edges, `${name}.edges`);
  const seenTo = new Set<number>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = assertMotifGraphEdge(edges[index], `${name}.edges[${index}]`, nodes.length);
    if (seenTo.has(edge.to)) {
      throw new InvalidInputError(`${name}.edges: node ${edge.to} has more than one incoming edge`);
    }
    seenTo.add(edge.to);
  }
  return read;
}

/** Validate one motif's interval and rhythm ratios. */
function assertReferenceMotif(value: unknown, name: string): ReferenceMotif {
  const read = assertRecord<ReferenceMotif>(value, name);
  const intervals = assertArray<number>(read.intervals, `${name}.intervals`);
  // The cell has to be writable as MIDI notes: whole semitones spanning at most 127.
  let pitch = 0;
  let low = 0;
  let high = 0;
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = assertFiniteNumber(intervals[index] as number, `${name}.intervals[${index}]`);
    if (!Number.isInteger(interval)) {
      throw new InvalidInputError(
        `${name}.intervals[${index}] must be a whole number of semitones; received ${interval}`,
      );
    }
    pitch += interval;
    low = Math.min(low, pitch);
    high = Math.max(high, pitch);
  }
  if (high - low > 127) {
    throw new InvalidInputError(
      `${name}.intervals must span at most 127 semitones; received ${high - low}`,
    );
  }
  const rhythm = assertArray<number>(read.rhythm, `${name}.rhythm`);
  if (rhythm.length !== intervals.length) {
    throw new InvalidInputError(
      `${name}.rhythm must hold one ratio per interval (${intervals.length}); received ${rhythm.length}`,
    );
  }
  for (let index = 0; index < rhythm.length; index += 1) {
    const ratio = assertFiniteNumber(rhythm[index] as number, `${name}.rhythm[${index}]`);
    if (!(ratio > 0)) {
      throw new InvalidInputError(`${name}.rhythm[${index}] must be positive; received ${ratio}`);
    }
  }
  assertRange(read.spanBeats, 0, Number.MAX_SAFE_INTEGER, `${name}.spanBeats`);
  assertPositiveInt(read.occurrences, `${name}.occurrences`);
  return read;
}

/** Validate the melodic reading: register, shape, motifs, their derivation graph, and rhythm. */
function assertReferenceMelody(value: unknown, name: string): ReferenceMelody {
  const read = assertRecord<ReferenceMelody>(value, name);
  assertNullable(read.register, `${name}.register`, (v, n) => {
    const register = assertRecord<{ low: number; high: number; mean: number }>(v, n);
    assertMidiPitch(register.low, `${n}.low`);
    assertMidiPitch(register.high, `${n}.high`);
    assertRange(register.mean, 0, 127, `${n}.mean`);
    return register;
  });
  assertNullable(read.shape, `${name}.shape`, (v, n) => assertOneOf(v, MELODIC_CONTOUR_SHAPES, n));
  const motifs = assertArray<ReferenceMotif>(read.motifs, `${name}.motifs`);
  const occurrenceCounts: number[] = [];
  for (let index = 0; index < motifs.length; index += 1) {
    assertReferenceMotif(motifs[index], `${name}.motifs[${index}]`);
    occurrenceCounts.push((motifs[index] as ReferenceMotif).occurrences);
  }
  assertMotifGraph(read.graph, `${name}.graph`, occurrenceCounts);
  assertRhythmAnalysis(read.rhythm, `${name}.rhythm`);
  return read;
}

/**
 * Reject a value that is not a {@link ReferenceProfile}.
 *
 * A profile is the shape a caller's stored JSON, a config file, or a plugin
 * host most plausibly hands back malformed: a missing field, a distribution
 * that no longer sums to 1, an index a later edit left dangling, a numeral no
 * reader can parse. Every field is checked before {@link compareReferences} or
 * a caller's own code reads it, and a violation names the path to the field
 * that is wrong.
 *
 * @param value The value to check.
 * @param name What the value is, for the error message.
 * @returns The same profile.
 * @throws {InvalidInputError} If the value is not a valid reference profile.
 * @example
 * ```ts
 * import { assertReferenceProfile } from '@libraz/libcantus';
 * const emptyRhythm = {
 *   startBeat: 0, endBeat: 0, bars: 0, onsets: 0, onsetDensity: 0,
 *   barOnsets: [], onsetLevels: [0, 0, 0, 0, 0, 0], barPositions: [],
 *   interOnsetShares: new Array(17).fill(0), restRatio: 0, syncopation: 0,
 *   offGridRatio: 0, rationale: 'nothing sounds',
 * };
 * const profile = {
 *   profileVersion: 1,
 *   span: { startBeat: 0, endBeat: 0, bars: 0 },
 *   meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
 *   form: { hypermeter: { groupBars: 1, confidence: 0 }, sections: [], phrases: [] },
 *   harmony: { keys: [], chords: [], rhythm: emptyRhythm },
 *   melody: { register: null, shape: null, motifs: [], graph: { nodes: [], edges: [] }, rhythm: emptyRhythm },
 * };
 * assertReferenceProfile(profile); // the profile, unchanged
 * ```
 * @category Arrangement & Analysis
 */
export function assertReferenceProfile(
  value: unknown,
  name = 'reference profile',
): ReferenceProfile {
  const read = assertRecord<ReferenceProfile>(value, name);
  if (read.profileVersion !== REFERENCE_PROFILE_VERSION) {
    throw new InvalidInputError(
      `${name}.profileVersion must be ${REFERENCE_PROFILE_VERSION}; received ${describeRejected(read.profileVersion)}`,
    );
  }
  const span = assertRecord<{ startBeat: number; endBeat: number; bars: number }>(
    read.span,
    `${name}.span`,
  );
  const startBeat = assertFiniteNumber(span.startBeat, `${name}.span.startBeat`);
  const endBeat = assertFiniteNumber(span.endBeat, `${name}.span.endBeat`);
  assertSpanOrder(startBeat, endBeat, `${name}.span`);
  assertRange(span.bars, 0, Number.MAX_SAFE_INTEGER, `${name}.span.bars`);
  assertMeterMap(read.meters as MeterMap, `${name}.meters`);
  const melody = assertReferenceMelody(read.melody, `${name}.melody`);
  assertReferenceForm(read.form, `${name}.form`, melody.graph.nodes.length);
  assertReferenceHarmony(read.harmony, `${name}.harmony`);
  return read;
}
