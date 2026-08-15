/**
 * Shared construction of {@link PartWritingViolation} records.
 *
 * The four-part checker and the species checker report the same violation type,
 * so they build it and name intervals the same way.
 */

import type { PartWritingViolation, PartWritingViolationKind } from './index.js';

/** Diatonic names of the interval numbers a melodic step or leap can span. */
const INTERVAL_WORDS = [
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
] as const;

/** Name an interval number, falling back to a bare noun beyond the octave. */
export function intervalWord(numberValue: number): string {
  return INTERVAL_WORDS[numberValue - 1] ?? 'interval';
}

/** Build one violation record, so the field order is written once. */
export function violation(
  kind: PartWritingViolationKind,
  voices: number[],
  fromIndex: number,
  toIndex: number,
  rationale: string,
): PartWritingViolation {
  return { kind, voices, fromIndex, toIndex, rationale };
}
