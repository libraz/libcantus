/**
 * Boundary validation for {@link CompositionPlan}: a caller can hand this a
 * value restored from JSON, a config file, or a plugin host, and every field
 * is checked before a generator or evaluator reads it. A violation names the
 * path to the offending field, so a malformed document is diagnosed at the
 * field that is wrong rather than wherever the first bad read happens to land.
 */

import { CADENCE_TYPES } from '../../analyze/functional/cadence.js';
import { romanToChord } from '../../analyze/functional/roman.js';
import { MELODIC_CONTOUR_SHAPES } from '../../analyze/melody/contour.js';
import { MOTIF_RELATION_KINDS, type MotifRelationSummary } from '../../analyze/melody/relation.js';
import { RHYTHM_IOI_BINS } from '../../analyze/rhythm/index.js';
import { InvalidInputError } from '../../core/errors/index.js';
import { BEAT_EPS, type MeterMap } from '../../core/meter/index.js';
import { ALGORITHM_VERSION, MIN_ALGORITHM_VERSION } from '../../core/random/version.js';
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
  describeRejected,
} from '../../core/validation/index.js';
import { type ResolvedKey, resolveKey } from '../../theory/scale/index.js';
import {
  COMPOSITION_PLAN_VERSION,
  type CompositionPlan,
  type PlannedChord,
  type PlannedMotif,
  type PlannedPhrase,
  type PlannedRhythm,
  type PlannedSection,
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

/** Require a fixed-length distribution of non-negative mass summing to 1. */
function assertMassDistribution(value: unknown, length: number, name: string): number[] {
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
  if (Math.abs(sum - 1) > MASS_TOLERANCE) {
    throw new InvalidInputError(`${name} must sum to 1; received ${sum}`);
  }
  return shares as number[];
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

/** Validate one planned section. */
function assertPlannedSection(value: unknown, name: string): PlannedSection {
  const read = assertRecord<PlannedSection>(value, name);
  assertString(read.label, `${name}.label`);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  return read;
}

/**
 * Validate one planned phrase, bounding its section and motif indices by the
 * arrays they point into.
 */
function assertPlannedPhrase(
  value: unknown,
  name: string,
  sectionCount: number,
  motifCount: number,
): PlannedPhrase {
  const read = assertRecord<PlannedPhrase>(value, name);
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertNullable(read.section, `${name}.section`, (v, n) =>
    assertInteger(v as number, n, 0, Math.max(sectionCount - 1, 0)),
  );
  assertNullable(read.cadence, `${name}.cadence`, (v, n) => assertOneOf(v, CADENCE_TYPES, n));
  assertOneOf(read.shape, MELODIC_CONTOUR_SHAPES, `${name}.shape`);
  assertRange(read.peakPosition, 0, 1, `${name}.peakPosition`);
  const register = assertRecord<{ low: number; high: number; mean: number }>(
    read.register,
    `${name}.register`,
  );
  assertMidiPitch(register.low, `${name}.register.low`);
  assertMidiPitch(register.high, `${name}.register.high`);
  assertRange(register.mean, 0, 127, `${name}.register.mean`);
  assertRange(read.onsetDensity, 0, Number.MAX_SAFE_INTEGER, `${name}.onsetDensity`);
  const motifs = assertArray<number>(read.motifs, `${name}.motifs`);
  for (let index = 0; index < motifs.length; index += 1) {
    assertInteger(
      motifs[index] as number,
      `${name}.motifs[${index}]`,
      0,
      Math.max(motifCount - 1, 0),
    );
  }
  return read;
}

/**
 * Validate one planned chord, bounding its key index by the key array it
 * points into and checking that its numeral is one {@link romanToChord} can
 * read against that key.
 */
function assertPlannedChord(
  value: unknown,
  name: string,
  keys: readonly ResolvedKey[],
): PlannedChord {
  const read = assertRecord<PlannedChord>(value, name);
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
  return read;
}

/**
 * Validate the named transformation a motif derivation carries, requiring
 * `degrees` when the transformation is `'tonalTransposition'` — the one kind
 * a generator cannot replay from `semitones` alone.
 */
function assertPlannedMotifRelation(value: unknown, name: string): MotifRelationSummary {
  const read = assertRecord<MotifRelationSummary>(value, name);
  assertOneOf(read.kind, MOTIF_RELATION_KINDS, `${name}.kind`);
  assertFlag(read.sequence, `${name}.sequence`);
  assertFiniteNumber(read.semitones, `${name}.semitones`);
  if (read.kind === 'tonalTransposition') {
    assertFiniteNumber(read.degrees as number, `${name}.degrees`);
  } else if (read.degrees !== undefined) {
    assertFiniteNumber(read.degrees, `${name}.degrees`);
  }
  const timeRatio = assertFiniteNumber(read.timeRatio, `${name}.timeRatio`);
  if (timeRatio <= 0) {
    throw new InvalidInputError(`${name}.timeRatio must be positive; received ${timeRatio}`);
  }
  return read;
}

/**
 * Validate one planned motif statement: its phrase index, its derivation
 * source (bounded by the motif array and required to precede it, the way a
 * derivation forest never points backward or sideways), and its relation.
 */
function assertPlannedMotif(
  value: unknown,
  name: string,
  ownIndex: number,
  motifCount: number,
  phraseCount: number,
): PlannedMotif {
  const read = assertRecord<PlannedMotif>(value, name);
  assertInteger(read.phrase, `${name}.phrase`, 0, Math.max(phraseCount - 1, 0));
  const startBeat = assertFiniteNumber(read.startBeat, `${name}.startBeat`);
  const endBeat = assertFiniteNumber(read.endBeat, `${name}.endBeat`);
  assertSpanOrder(startBeat, endBeat, name);
  assertPositiveInt(read.notes, `${name}.notes`);
  const from = assertNullable(read.from, `${name}.from`, (v, n) =>
    assertInteger(v as number, n, 0, Math.max(motifCount - 1, 0)),
  );
  if (from !== null && from >= ownIndex) {
    throw new InvalidInputError(
      `${name}.from must be less than this motif's own index (${ownIndex}); received ${from}`,
    );
  }
  const relation = assertNullable(read.relation, `${name}.relation`, assertPlannedMotifRelation);
  if (from === null && relation !== null) {
    throw new InvalidInputError(
      `${name}.relation must be null for a root motif (from = null); received a relation`,
    );
  }
  const rhythm = assertNullable(read.rhythm, `${name}.rhythm`, (v, n) => assertArray<number>(v, n));
  if (rhythm !== null) {
    if (from !== null) {
      throw new InvalidInputError(`${name}.rhythm must be null for a derived statement`);
    }
    if (rhythm.length !== read.notes - 1) {
      throw new InvalidInputError(
        `${name}.rhythm must hold notes - 1 (${read.notes - 1}) gaps; received ${rhythm.length}`,
      );
    }
    let total = 0;
    for (let index = 0; index < rhythm.length; index += 1) {
      const gap = assertFiniteNumber(rhythm[index] as number, `${name}.rhythm[${index}]`);
      if (gap <= 0) {
        throw new InvalidInputError(`${name}.rhythm[${index}] must be positive; received ${gap}`);
      }
      total += gap;
    }
    if (total >= endBeat - startBeat - BEAT_EPS) {
      throw new InvalidInputError(
        `${name}.rhythm must sum to less than the statement's length (${endBeat - startBeat}); received ${total}`,
      );
    }
  }
  return read;
}

/** Validate the rhythmic target: two fixed-length distributions and a syncopation figure, all in [0, 1] mass or range. */
function assertPlannedRhythm(value: unknown, name: string): PlannedRhythm {
  const read = assertRecord<PlannedRhythm>(value, name);
  assertMassDistribution(read.onsetLevels, 6, `${name}.onsetLevels`);
  assertMassDistribution(read.interOnsetShares, RHYTHM_IOI_BINS.length, `${name}.interOnsetShares`);
  assertRange(read.syncopation, 0, 1, `${name}.syncopation`);
  return read;
}

/**
 * Reject a value that is not a {@link CompositionPlan}.
 *
 * A plan is the shape a caller's stored JSON, a config file, or a plugin host
 * most plausibly hands back malformed: a missing field, a distribution that no
 * longer sums to 1, an index a later edit left dangling, a numeral no reader
 * can parse, a derivation that points at itself or at a later motif. Every
 * field is checked before a generator or evaluator reads it, and a violation
 * names the path to the field that is wrong.
 *
 * @param value The value to check.
 * @param name What the value is, for the error message.
 * @returns The same plan.
 * @throws {InvalidInputError} If the value is not a valid composition plan.
 * @example
 * ```ts
 * import { assertCompositionPlan } from '@libraz/libcantus';
 * import { resolveKey } from '@libraz/libcantus';
 * const plan = {
 *   planVersion: 1, seed: 0, algorithmVersion: 1,
 *   keys: [resolveKey('C major')],
 *   meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
 *   span: { startBeat: 0, endBeat: 4, bars: 1 },
 *   sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
 *   phrases: [],
 *   harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
 *   motifs: [],
 *   rhythm: { onsetLevels: [1, 0, 0, 0, 0, 0], interOnsetShares: new Array(17).fill(0).fill(1, 8, 9), syncopation: 0 },
 * };
 * assertCompositionPlan(plan); // the plan, unchanged
 * ```
 * @category Composition
 */
export function assertCompositionPlan(value: unknown, name = 'composition plan'): CompositionPlan {
  const read = assertRecord<CompositionPlan>(value, name);
  if (read.planVersion !== COMPOSITION_PLAN_VERSION) {
    throw new InvalidInputError(
      `${name}.planVersion must be ${COMPOSITION_PLAN_VERSION}; received ${describeRejected(read.planVersion)}`,
    );
  }
  assertInteger(read.seed, `${name}.seed`, 0, 0xffffffff);
  assertInteger(
    read.algorithmVersion,
    `${name}.algorithmVersion`,
    MIN_ALGORITHM_VERSION,
    ALGORITHM_VERSION,
  );
  const keys = assertArray<ResolvedKey>(read.keys, `${name}.keys`);
  if (keys.length === 0) {
    throw new InvalidInputError(`${name}.keys must hold at least one key; received an empty array`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    assertResolvedKeyField(keys[index], `${name}.keys[${index}]`);
  }
  assertMeterMap(read.meters as MeterMap, `${name}.meters`);
  const span = assertRecord<{ startBeat: number; endBeat: number; bars: number }>(
    read.span,
    `${name}.span`,
  );
  const spanStart = assertFiniteNumber(span.startBeat, `${name}.span.startBeat`);
  const spanEnd = assertFiniteNumber(span.endBeat, `${name}.span.endBeat`);
  assertSpanOrder(spanStart, spanEnd, `${name}.span`);
  assertRange(span.bars, 0, Number.MAX_SAFE_INTEGER, `${name}.span.bars`);

  const sections = assertArray<PlannedSection>(read.sections, `${name}.sections`);
  for (let index = 0; index < sections.length; index += 1) {
    assertPlannedSection(sections[index], `${name}.sections[${index}]`);
  }

  const phrases = assertArray<PlannedPhrase>(read.phrases, `${name}.phrases`);
  const motifs = assertArray<PlannedMotif>(read.motifs, `${name}.motifs`);
  for (let index = 0; index < phrases.length; index += 1) {
    assertPlannedPhrase(
      phrases[index],
      `${name}.phrases[${index}]`,
      sections.length,
      motifs.length,
    );
  }

  const harmony = assertArray<PlannedChord>(read.harmony, `${name}.harmony`);
  for (let index = 0; index < harmony.length; index += 1) {
    assertPlannedChord(harmony[index], `${name}.harmony[${index}]`, keys as readonly ResolvedKey[]);
  }

  for (let index = 0; index < motifs.length; index += 1) {
    assertPlannedMotif(
      motifs[index],
      `${name}.motifs[${index}]`,
      index,
      motifs.length,
      phrases.length,
    );
  }

  assertPlannedRhythm(read.rhythm, `${name}.rhythm`);

  return read;
}
