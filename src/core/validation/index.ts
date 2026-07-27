import { BudgetExceededError, InvalidInputError } from '../errors/index.js';
import type { TimeSignature } from '../meter/index.js';
import { isCompoundNumerator } from '../meter/internal.js';
import type { NoteEvent } from '../types.js';

/**
 * Default upper bound for synchronous event/window/candidate generation.
 *
 * @category Core
 */
export const DEFAULT_GENERATION_BUDGET = 1_000_000;

/**
 * Require a finite JavaScript number and return it unchanged.
 *
 * @category Core
 */
export function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new InvalidInputError(`${name} must be finite; received ${value}`);
  }
  return value;
}

/**
 * Require an integer in the inclusive range `[min, max]`.
 *
 * @category Core
 */
export function assertInteger(
  value: number,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  assertFiniteNumber(value, name);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidInputError(
      `${name} must be an integer in [${min}, ${max}]; received ${value}`,
    );
  }
  return value;
}

/**
 * Drop the notes that never sound.
 *
 * A MIDI or DAW import routinely carries zero-length artefacts. Every entry
 * point in this library ignores them, but a caller holding such an array still
 * has to decide what to do with it before comparing note counts or indices;
 * this is the one filter to apply.
 *
 * @param events The note events to filter.
 * @returns A new array containing only the notes with a positive duration.
 * @example
 * ```ts
 * import { dropSilentNotes } from '@libraz/libcantus';
 * dropSilentNotes([{ pitch: 60, startBeat: 0, durationBeat: 0 }]); // []
 * ```
 * @category Core
 */
export function dropSilentNotes(events: readonly NoteEvent[]): NoteEvent[] {
  return events.filter((event) => event !== undefined && event.durationBeat > 0);
}

/**
 * Require a value to be one of a fixed set of names.
 *
 * TypeScript checks string-union options at compile time only, so a value that
 * arrives from JSON, a config file, or a JavaScript caller reaches the engine
 * unchecked and is then read against a table that has no entry for it —
 * producing a silent `undefined`, a NaN velocity, or a crash far from the call.
 *
 * @param value The value to check.
 * @param allowed Every accepted name.
 * @param name What the value is, for the error message.
 * @returns The value, narrowed to the allowed union.
 * @throws If the value is not one of `allowed`.
 *
 * @category Core
 */
export function assertOneOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidInputError(
      `${name} must be one of ${allowed.join(', ')}; received ${JSON.stringify(value)}`,
    );
  }
  return value as T;
}

/**
 * Require a positive safe integer, optionally capped by `max`.
 *
 * @category Core
 */
export function assertPositiveInt(
  value: number,
  name: string,
  max = DEFAULT_GENERATION_BUDGET,
): number {
  return assertInteger(value, name, 1, max);
}

/**
 * Require a finite number in the inclusive range `[min, max]`.
 *
 * @category Core
 */
export function assertRange(value: number, min: number, max: number, name: string): number {
  assertFiniteNumber(value, name);
  if (value < min || value > max) {
    throw new InvalidInputError(`${name} must be in [${min}, ${max}]; received ${value}`);
  }
  return value;
}

/**
 * Reject work estimates that would exceed a synchronous generation budget.
 *
 * @category Core
 */
export function assertGenerationBudget(
  estimated: number,
  name: string,
  limit: number | undefined = DEFAULT_GENERATION_BUDGET,
): number {
  const cap = limit ?? DEFAULT_GENERATION_BUDGET;
  assertFiniteNumber(estimated, name);
  assertPositiveInt(cap, `${name} limit`, Number.MAX_SAFE_INTEGER);
  if (estimated < 0) {
    throw new InvalidInputError(`${name} must not be negative; received ${estimated}`);
  }
  if (estimated > cap) {
    throw new BudgetExceededError(
      `${name} exceeds the generation budget ${cap}; received ${estimated}`,
    );
  }
  return estimated;
}

/**
 * Validate a time signature, including additive grouping, before any early return.
 *
 * @category Core
 */
export function assertTimeSignature(ts: TimeSignature, name = 'time signature'): TimeSignature {
  assertPositiveInt(ts.numerator, `${name}.numerator`);
  assertPositiveInt(ts.denominator, `${name}.denominator`);
  if (ts.grouping !== undefined) {
    if (ts.grouping.length === 0) {
      throw new InvalidInputError(`${name}.grouping must not be empty`);
    }
    let sum = 0;
    for (let index = 0; index < ts.grouping.length; index += 1) {
      sum += assertPositiveInt(ts.grouping[index] ?? Number.NaN, `${name}.grouping[${index}]`);
    }
    // A compound numerator accepts either reading: grouping its dotted pulses
    // (9/8 as [1, 1, 1]) or grouping its denominator units additively (9/8 as
    // [2, 2, 2, 3]), which is how aksak and other additive metres are written.
    const pulses = isCompoundNumerator(ts.numerator) ? ts.numerator / 3 : ts.numerator;
    if (sum !== pulses && sum !== ts.numerator) {
      const accepted =
        pulses === ts.numerator ? `${pulses}` : `${pulses} (pulses) or ${ts.numerator} (units)`;
      throw new InvalidInputError(`${name}.grouping must sum to ${accepted}; received ${sum}`);
    }
  }
  return ts;
}

/**
 * How strictly {@link assertNoteEvent} and {@link assertNoteEvents} read an
 * event array.
 *
 * @category Core
 */
export type NoteEventAssertOptions = {
  /**
   * Accept notes that never sound. The analysis side does, so an array from a
   * MIDI import can be validated before the zero-length artefacts are dropped.
   */
  allowNonPositiveDuration?: boolean;
  /** Upper bound on the event count; defaults to the generation budget. */
  budget?: number;
};

/**
 * Validate the finite fields of one timeline note event.
 *
 * @category Core
 */
export function assertNoteEvent(
  event: NoteEvent,
  name = 'note event',
  options: NoteEventAssertOptions = {},
): NoteEvent {
  assertInteger(event.pitch, `${name}.pitch`, 0, 127);
  assertRange(event.startBeat, 0, Number.MAX_SAFE_INTEGER, `${name}.startBeat`);
  // The positivity check comes first so the common failure — a zero-length note
  // from a MIDI import — reads as such instead of naming a denormal lower bound.
  assertFiniteNumber(event.durationBeat, `${name}.durationBeat`);
  if (!options.allowNonPositiveDuration && event.durationBeat <= 0) {
    throw new InvalidInputError(
      `${name}.durationBeat must be positive; received ${event.durationBeat}`,
    );
  }
  assertRange(
    event.durationBeat,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    `${name}.durationBeat`,
  );
  if (event.velocity !== undefined) {
    assertRange(event.velocity, 0, 127, `${name}.velocity`);
  }
  return event;
}

/**
 * Validate an event array and its allocation budget without copying it.
 *
 * @category Core
 */
export function assertNoteEvents(
  events: readonly NoteEvent[],
  name = 'note events',
  options: NoteEventAssertOptions = {},
): NoteEvent[] {
  if (!Array.isArray(events)) {
    throw new TypeError(`${name} must be an array; received ${typeof events}`);
  }
  assertGenerationBudget(events.length, `${name} count`, options.budget);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    // A hole in a sparse array and an explicit undefined are both rejected
    // here: letting either through only moves the failure to a later
    // TypeError, or drops the note silently.
    if (event === undefined) {
      throw new InvalidInputError(`${name}[${index}] must be a note event; received undefined`);
    }
    assertNoteEvent(event, `${name}[${index}]`, options);
  }
  return events;
}
