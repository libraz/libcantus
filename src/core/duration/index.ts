/**
 * Note values: the written durations a score shows — a base value, its
 * augmentation dots, and an optional tuplet ratio — and the conversion between
 * them and the quarter-note beats the rest of the library measures in.
 *
 * The base values are named the American way (whole, half, quarter, eighth),
 * matching the library's "quarter-note beat" convention and the vocabulary of
 * the MIDI and DAW world this engine reads events from.
 */

import { InvalidInputError, NoSolutionError } from '../errors/index.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertInteger,
  assertOneOf,
  assertPositiveInt,
  describeRejected,
} from '../validation/index.js';

/**
 * A written base note value, from the whole note down to the sixty-fourth.
 *
 * Longer values (the breve and beyond) are written as tied notes; see
 * {@link beatsToTiedDurations}.
 *
 * @category Rhythm & Meter
 */
export type NoteValue =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirtySecond'
  | 'sixtyFourth';

/**
 * Every base note value, longest first.
 *
 * @category Rhythm & Meter
 */
export const NOTE_VALUES: readonly NoteValue[] = Object.freeze([
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtySecond',
  'sixtyFourth',
] as const);

/**
 * A tuplet ratio: `actual` written notes played in the time of `normal` ones —
 * `{ actual: 3, normal: 2 }` for a triplet, `{ actual: 5, normal: 4 }` for a
 * quintuplet.
 *
 * @category Rhythm & Meter
 */
export type Tuplet = {
  /** How many notes are written. */
  actual: number;
  /** How many of the same base value they occupy. */
  normal: number;
};

/**
 * A written duration: a base value, optional augmentation dots, and an optional
 * tuplet ratio. Its length is `base * (2 - 2^-dots) * normal / actual`.
 *
 * @category Rhythm & Meter
 */
export type DurationData = {
  base: NoteValue;
  /** Augmentation dots, 0 when absent; up to four are accepted. */
  dots?: number;
  tuplet?: Tuplet;
};

/**
 * A duration as {@link beatsToDuration} spells it, with the dot count always
 * stated.
 *
 * @category Rhythm & Meter
 */
export type SpelledDuration = {
  base: NoteValue;
  dots: number;
  tuplet?: Tuplet;
};

/** Length of each base value in quarter notes. */
const NOTE_VALUE_QUARTERS: Readonly<Record<NoteValue, number>> = Object.freeze({
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirtySecond: 0.125,
  sixtyFourth: 0.0625,
});

/**
 * Match tolerance in quarter-note beats. Wide enough to read a seven-digit
 * decimal such as 0.3333333 as a triplet, and still far below one tick at
 * PPQ 960 (≈ 0.00104 beats), so no two spellings a sequencer can distinguish
 * collapse into one.
 */
const EPS = 1e-6;

/** Most dots {@link beatsToDuration} will spell; more is never the reading. */
const MAX_SPELLED_DOTS = 2;

/** Most dots {@link durationToBeats} will read; triple dots occur, four is the ceiling. */
const MAX_DOTS = 4;

/** Upper bound on either side of a tuplet ratio. */
const MAX_TUPLET = 64;

/**
 * The tuplet families {@link beatsToDuration} spells, in preference order, with
 * the plain (non-tuplet) reading first. Quintuplets and septuplets are taken in
 * the time of four, the reading that fills one beat of their base value.
 */
const SPELLED_TUPLETS: readonly (Tuplet | undefined)[] = Object.freeze([
  undefined,
  { actual: 3, normal: 2 },
  { actual: 5, normal: 4 },
  { actual: 7, normal: 4 },
]);

/** Length in quarter notes of a base value with dots and an optional tuplet. */
function quartersOfParts(base: NoteValue, dots: number, tuplet: Tuplet | undefined): number {
  const dotted = NOTE_VALUE_QUARTERS[base] * (2 - 2 ** -dots);
  return tuplet === undefined ? dotted : (dotted * tuplet.normal) / tuplet.actual;
}

/** Validate a duration, accepting the bare base value as shorthand. */
function assertDuration(value: NoteValue | DurationData, name: string): DurationData {
  if (typeof value === 'string') {
    return { base: assertOneOf(value, NOTE_VALUES, name), dots: 0 };
  }
  if (typeof value !== 'object' || value === null) {
    throw new InvalidInputError(
      `${name} must be a note value or a duration; received ${describeRejected(value)}`,
    );
  }
  const base = assertOneOf(value.base, NOTE_VALUES, `${name}.base`);
  const dots =
    value.dots === undefined ? 0 : assertInteger(value.dots, `${name}.dots`, 0, MAX_DOTS);
  if (value.tuplet === undefined) {
    return { base, dots };
  }
  // A duration restored from a file can carry a null where the tuplet is, and
  // reading a field off it would report the library's own TypeError rather than
  // the malformed input it is.
  if (typeof value.tuplet !== 'object' || value.tuplet === null) {
    throw new InvalidInputError(
      `${name}.tuplet must be a tuplet; received ${describeRejected(value.tuplet)}`,
    );
  }
  const tuplet = {
    actual: assertPositiveInt(value.tuplet.actual, `${name}.tuplet.actual`, MAX_TUPLET),
    normal: assertPositiveInt(value.tuplet.normal, `${name}.tuplet.normal`, MAX_TUPLET),
  };
  return { base, dots, tuplet };
}

/** Length of a validated duration in quarter notes. */
function quartersOf(duration: DurationData): number {
  return quartersOfParts(duration.base, duration.dots ?? 0, duration.tuplet);
}

/** Length of the beat unit in quarter notes; a quarter note unless overridden. */
function beatQuarters(options: { beatUnit?: NoteValue | DurationData }): number {
  if (options.beatUnit === undefined) {
    return NOTE_VALUE_QUARTERS.quarter;
  }
  return quartersOf(assertDuration(options.beatUnit, 'beatUnit'));
}

/** The conventional spelling of a length in quarter notes, if it has one. */
function spellQuarters(quarters: number): SpelledDuration | undefined {
  for (const tuplet of SPELLED_TUPLETS) {
    for (let dots = 0; dots <= MAX_SPELLED_DOTS; dots += 1) {
      for (const base of NOTE_VALUES) {
        if (Math.abs(quartersOfParts(base, dots, tuplet) - quarters) <= EPS) {
          return tuplet === undefined
            ? { base, dots }
            : { base, dots, tuplet: { actual: tuplet.actual, normal: tuplet.normal } };
        }
      }
    }
  }
  return undefined;
}

/** The undotted values a tie chain is built from, longest first. */
const PLAIN_VALUES: readonly { base: NoteValue; quarters: number }[] = Object.freeze(
  NOTE_VALUES.map((base) => ({ base, quarters: NOTE_VALUE_QUARTERS[base] })),
);

/** Require a positive, finite beat count. */
function assertPositiveBeats(beats: number, name: string): number {
  assertFiniteNumber(beats, name);
  if (beats <= 0) {
    throw new InvalidInputError(`${name} must be positive; received ${beats}`);
  }
  return beats;
}

/**
 * Length of a written duration in beats.
 *
 * @param duration The duration, or a bare base value as shorthand for an
 *   undotted one.
 * @param options `beatUnit` sets what one beat is; a quarter note by default,
 *   so a dotted quarter reads as 1.5. Pass `{ base: 'quarter', dots: 1 }` to
 *   count in the felt beats of a compound meter.
 * @returns The length in beats.
 * @throws If the base value is unknown, the dot count is not an integer in
 *   0..4, or a tuplet side is not a positive integer.
 * @example
 * ```ts
 * import { durationToBeats } from '@libraz/libcantus';
 * durationToBeats('quarter'); // 1
 * durationToBeats({ base: 'quarter', dots: 1 }); // 1.5
 * durationToBeats({ base: 'eighth', tuplet: { actual: 3, normal: 2 } }) * 3; // 1 — three
 * // eighth-note triplets fill the beat two eighths would
 * ```
 * @category Rhythm & Meter
 */
export function durationToBeats(
  duration: NoteValue | DurationData,
  options: { beatUnit?: NoteValue | DurationData } = {},
): number {
  const quarters = quartersOf(assertDuration(duration, 'duration'));
  return quarters / beatQuarters(options);
}

/**
 * Spell a length in beats as the note value a score would show.
 *
 * The spelling is the conventional one, not merely an arithmetically valid one:
 * 1.5 beats is a dotted quarter rather than a quarter tied to an eighth, and a
 * third of a beat is an eighth triplet rather than a twenty-fourth note. Plain
 * values are preferred to dotted ones and both to tuplets, and within the
 * tuplets triplets come before quintuplets and septuplets.
 *
 * Lengths are matched within 1e-6 quarter notes, so a rounded decimal such as
 * 0.3333333 still reads as a triplet. The tolerance is measured in quarter
 * notes whatever `beatUnit` names, so a longer beat unit narrows it in
 * proportion: under `{ beatUnit: 'whole' }` it is 2.5e-7 of a beat.
 *
 * @param beats The length in beats.
 * @param options `beatUnit` sets what one beat is; a quarter note by default.
 * @returns The base value, its dot count, and its tuplet when it has one.
 * @throws If `beats` is not positive, or — as a `NoSolutionError` — if no single
 *   note value spells it, as for 5 beats in 4/4. Use
 *   {@link beatsToTiedDurations} for those.
 * @example
 * ```ts
 * import { beatsToDuration } from '@libraz/libcantus';
 * beatsToDuration(1.5); // { base: 'quarter', dots: 1 }
 * beatsToDuration(1 / 3); // { base: 'eighth', dots: 0, tuplet: { actual: 3, normal: 2 } }
 * ```
 * @category Rhythm & Meter
 */
export function beatsToDuration(
  beats: number,
  options: { beatUnit?: NoteValue | DurationData } = {},
): SpelledDuration {
  assertPositiveBeats(beats, 'beats');
  const spelled = spellQuarters(beats * beatQuarters(options));
  if (spelled === undefined) {
    throw new NoSolutionError(`no single note value spells ${beats} beats`);
  }
  return spelled;
}

/**
 * Spell a length in beats as a chain of tied note values.
 *
 * A length with a single spelling comes back as a one-element chain. Anything
 * else is broken into undotted values, longest first, and a value immediately
 * followed by its own half is then written as a dot instead: 5 beats reads as a
 * whole note tied to a quarter, and 1.9375 beats as a double-dotted quarter tied
 * to a dotted thirty-second. The dot is only written where it leaves the chain
 * in longest-first order, so 10 beats reads as two whole notes tied to a half
 * rather than as a whole note tied to a longer dotted whole. The chain knows
 * nothing of barlines or beat grouping — an engraver splits further at those —
 * and it uses no tuplets, so a length off the plain grid and with no single
 * spelling has no chain either.
 *
 * @param beats The length in beats.
 * @param options `beatUnit` sets what one beat is; a quarter note by default.
 * @returns The tied durations, longest first, summing to `beats`.
 * @throws If `beats` is not positive, if the chain would exceed the generation
 *   budget, or — as a `NoSolutionError` — if no chain of plain and dotted values
 *   sums to it.
 * @example
 * ```ts
 * import { beatsToTiedDurations } from '@libraz/libcantus';
 * beatsToTiedDurations(5); // [{ base: 'whole', dots: 0 }, { base: 'quarter', dots: 0 }]
 * ```
 * @category Rhythm & Meter
 */
export function beatsToTiedDurations(
  beats: number,
  options: { beatUnit?: NoteValue | DurationData } = {},
): SpelledDuration[] {
  assertPositiveBeats(beats, 'beats');
  const quarters = beats * beatQuarters(options);
  const single = spellQuarters(quarters);
  if (single !== undefined) {
    return [single];
  }
  assertGenerationBudget(
    Math.ceil(quarters / NOTE_VALUE_QUARTERS.whole) + PLAIN_VALUES.length,
    'tie chain length',
  );
  const chain: SpelledDuration[] = [];
  let remaining = quarters;
  let previousQuarters = 0;
  while (remaining > EPS) {
    const next = PLAIN_VALUES.find((candidate) => candidate.quarters <= remaining + EPS);
    if (next === undefined) {
      throw new NoSolutionError(`no chain of tied note values sums to ${beats} beats`);
    }
    const last = chain[chain.length - 1];
    const before = chain[chain.length - 2];
    // A value followed by exactly its own half is one dotted note, not a tie —
    // but the dot lengthens a value already written, so it is only taken where
    // the result still fits under the value it is tied after. Dotting the
    // second whole note of 10 beats would make it outlast the first.
    const dotted =
      last === undefined || last.dots >= MAX_SPELLED_DOTS
        ? undefined
        : quartersOfParts(last.base, last.dots + 1, undefined);
    const staysInOrder =
      dotted !== undefined && (before === undefined || dotted <= quartersOf(before) + EPS);
    if (
      last !== undefined &&
      staysInOrder &&
      Math.abs(next.quarters * 2 - previousQuarters) <= EPS
    ) {
      last.dots += 1;
    } else {
      chain.push({ base: next.base, dots: 0 });
    }
    previousQuarters = next.quarters;
    remaining -= next.quarters;
  }
  return chain;
}
