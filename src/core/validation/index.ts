import type { TimeSignature } from '../meter/index.js';
import type { NoteEvent } from '../types.js';

/** Default upper bound for synchronous event/window/candidate generation. */
export const DEFAULT_GENERATION_BUDGET = 1_000_000;

/** Require a finite JavaScript number and return it unchanged. */
export function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite; received ${value}`);
  }
  return value;
}

/** Require an integer in the inclusive range `[min, max]`. */
export function assertInteger(
  value: number,
  name: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  assertFiniteNumber(value, name);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]; received ${value}`);
  }
  return value;
}

/** Require a positive safe integer, optionally capped by `max`. */
export function assertPositiveInt(
  value: number,
  name: string,
  max = DEFAULT_GENERATION_BUDGET,
): number {
  return assertInteger(value, name, 1, max);
}

/** Require a finite number in the inclusive range `[min, max]`. */
export function assertRange(value: number, min: number, max: number, name: string): number {
  assertFiniteNumber(value, name);
  if (value < min || value > max) {
    throw new RangeError(`${name} must be in [${min}, ${max}]; received ${value}`);
  }
  return value;
}

/** Reject work estimates that would exceed a synchronous generation budget. */
export function assertGenerationBudget(
  estimated: number,
  name: string,
  limit = DEFAULT_GENERATION_BUDGET,
): number {
  assertFiniteNumber(estimated, name);
  assertPositiveInt(limit, `${name} limit`, Number.MAX_SAFE_INTEGER);
  if (estimated < 0 || estimated > limit) {
    throw new RangeError(`${name} exceeds the generation budget ${limit}; received ${estimated}`);
  }
  return estimated;
}

/** Validate a time signature, including additive grouping, before any early return. */
export function assertTimeSignature(ts: TimeSignature, name = 'time signature'): TimeSignature {
  assertPositiveInt(ts.numerator, `${name}.numerator`);
  assertPositiveInt(ts.denominator, `${name}.denominator`);
  if (ts.grouping !== undefined) {
    if (ts.grouping.length === 0) {
      throw new RangeError(`${name}.grouping must not be empty`);
    }
    let sum = 0;
    for (let index = 0; index < ts.grouping.length; index += 1) {
      sum += assertPositiveInt(ts.grouping[index] ?? Number.NaN, `${name}.grouping[${index}]`);
    }
    const compound = ts.numerator % 3 === 0 && ts.numerator > 3;
    const pulses = compound ? ts.numerator / 3 : ts.numerator;
    if (sum !== pulses) {
      throw new RangeError(`${name}.grouping must sum to ${pulses}; received ${sum}`);
    }
  }
  return ts;
}

/** Validate the finite fields of one timeline note event. */
export function assertNoteEvent(
  event: NoteEvent,
  name = 'note event',
  options: { allowNonPositiveDuration?: boolean } = {},
): NoteEvent {
  assertFiniteNumber(event.pitch, `${name}.pitch`);
  assertRange(event.startBeat, 0, Number.MAX_SAFE_INTEGER, `${name}.startBeat`);
  assertRange(
    event.durationBeat,
    options.allowNonPositiveDuration ? -Number.MAX_SAFE_INTEGER : Number.MIN_VALUE,
    Number.MAX_SAFE_INTEGER,
    `${name}.durationBeat`,
  );
  if (!options.allowNonPositiveDuration && event.durationBeat <= 0) {
    throw new RangeError(`${name}.durationBeat must be positive; received ${event.durationBeat}`);
  }
  if (event.velocity !== undefined) {
    assertRange(event.velocity, 0, 127, `${name}.velocity`);
  }
  return event;
}

/** Validate an event array and its allocation budget without copying it. */
export function assertNoteEvents(
  events: NoteEvent[],
  name = 'note events',
  options: { allowNonPositiveDuration?: boolean; budget?: number } = {},
): NoteEvent[] {
  assertGenerationBudget(events.length, `${name} count`, options.budget);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event !== undefined) {
      assertNoteEvent(event, `${name}[${index}]`, options);
    }
  }
  return events;
}
