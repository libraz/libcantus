/**
 * Shared construction of {@link PartWritingViolation} records.
 *
 * The four-part checker and the species checker report the same violation type,
 * so they build it and name intervals the same way.
 */

import type { PartWritingViolation, PartWritingViolationKind } from './index.js';

/**
 * Diatonic names of the interval numbers a line can span.
 *
 * Compound numbers are named too, because a leap of a ninth or a tenth is a
 * leap a rule fires on and the number is the whole of what the rationale is
 * saying: the fallback was the bare noun `interval`, which named nothing and
 * read as `The leap of a interval` where the sentence supplies the article.
 */
const INTERVAL_WORDS = [
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
] as const;

/**
 * Name an interval number.
 *
 * Past the range the words cover the number itself is written, as the sibling
 * rules that report a leap already do: `a 17th` names the interval, where a
 * noun that stands for every interval names none of them.
 */
export function intervalWord(numberValue: number): string {
  return INTERVAL_WORDS[numberValue - 1] ?? `${numberValue}th`;
}

/**
 * The article an interval name takes.
 *
 * Read from the name rather than from the number, so a name added to the list
 * carries its own article: `an octave`, `an eleventh`, `a ninth`.
 */
export function intervalArticle(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
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
