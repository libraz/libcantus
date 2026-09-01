import { BudgetExceededError, InvalidInputError } from '../errors/index.js';
// The table itself rather than the instrument barrel: the barrel reaches back
// into this module, and an articulation name is a bare list with no such tie.
import { ARTICULATIONS } from '../instrument/articulation.js';
import type { MeterMap, TimeSignature } from '../meter/index.js';
import {
  isCompoundNumerator,
  isValidatedMeterMap,
  rememberValidatedMeterMap,
} from '../meter/internal.js';
import type { NoteEvent } from '../types.js';

/**
 * Default upper bound for synchronous event/window/candidate generation.
 *
 * @category Core
 */
export const DEFAULT_GENERATION_BUDGET = 1_000_000;

/**
 * Upper bound on the number of changes one meter map may declare.
 *
 * A meter map is read on every slot of an analysis pass, so an unbounded map is
 * an unbounded per-slot cost the way an unbounded event array is an unbounded
 * pass. The bound is far above any notated piece — a change on every bar of a
 * hundred thousand bars — and rejects the map rather than the work built on it.
 */
const MAX_METER_CHANGES = 100_000;

/**
 * Longest echo of a rejected value an error message carries.
 *
 * A message is shown to a person and written to a log, so it names what was
 * given without reprinting it: a validated field can hold a pasted document,
 * and repeating that back turns one bad keystroke into a megabyte of log.
 */
const MAX_ECHOED_LENGTH = 64;

/**
 * Describe a rejected value for an error message, without ever throwing.
 *
 * The value reaching a validator is untyped by definition — it arrives from
 * JSON, a config file, or a plugin host — so it may be circular, a BigInt, or a
 * pasted document. Only a string is echoed, and only its head; anything else is
 * named by its type, which is the part a caller can act on.
 *
 * Exported for the other modules that build the same kind of message. It is not
 * re-exported from `./core`, because it describes how this library words an
 * error rather than anything a caller decides.
 */
export function describeRejected(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value !== 'string') {
    return typeof value;
  }
  return value.length <= MAX_ECHOED_LENGTH
    ? JSON.stringify(value)
    : `${JSON.stringify(value.slice(0, MAX_ECHOED_LENGTH))} (truncated from ${value.length} characters)`;
}

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

/** Require an integer MIDI pitch in the inclusive range 0..127. */
export function assertMidiPitch(value: number, name = 'MIDI pitch'): number {
  return assertInteger(value, name, 0, 127);
}

/** Clamp an integer MIDI pitch to the inclusive range 0..127. */
export function clampToMidi(value: number, name = 'MIDI pitch'): number {
  assertInteger(value, name);
  return Math.min(127, Math.max(0, value));
}

/**
 * Require a bounded scale/chord degree, counted from 1 the way musicians count
 * degrees: 1 is the tonic, 5 the dominant. Zero and negative degrees name no
 * degree at all and are rejected.
 */
export function assertDegree(value: number, name = 'degree'): number {
  return assertInteger(value, name, 1, 1000);
}

/** Require a finite semitone offset before pitch-class reduction. */
export function assertFiniteSemitones(value: number, name = 'semitones'): number {
  return assertFiniteNumber(value, name);
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

/** Alias that makes the shared positive-duration policy explicit at API entrances. */
export const soundingNotesOnly = dropSilentNotes;

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
 * @throws If the value is not one of `allowed`. The message names the value by
 *   its type unless it is a string, and echoes at most the head of that string,
 *   so building it cannot itself fail on a circular object and cannot grow with
 *   the size of what was pasted into the field.
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
      `${name} must be one of ${allowed.join(', ')}; received ${describeRejected(value)}`,
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
  // The shape is checked before any field is read: a value from JSON or a
  // plugin host may be null or a number, and reading a numerator off it would
  // report the library's own TypeError instead of the caller's bad input.
  if (typeof ts !== 'object' || ts === null) {
    throw new InvalidInputError(
      `${name} must be a time signature; received ${describeRejected(ts)}`,
    );
  }
  assertPositiveInt(ts.numerator, `${name}.numerator`);
  assertPositiveInt(ts.denominator, `${name}.denominator`);
  if (ts.grouping !== undefined) {
    if (!Array.isArray(ts.grouping)) {
      throw new InvalidInputError(
        `${name}.grouping must be an array of group lengths; received ${describeRejected(ts.grouping)}`,
      );
    }
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
 * Validate a meter map: a non-empty run of time signatures, each with the beat
 * it takes effect at, in strictly increasing beat order.
 *
 * The first entry also governs everything before it, so a map need not start at
 * beat 0 — that is what lets a pickup at a negative beat be read in the
 * signature the piece opens in. Where the first entry is written does not move
 * the bar lines: the opening signature counts its bars from beat 0 either way,
 * so beat 0 is the downbeat of bar 0 and the pickup before it is bar -1.
 *
 * The map is also bounded, the way an event array is: a map is consulted once
 * per analysed slot, so its length is a per-slot cost and not only a one-time
 * one.
 *
 * @category Core
 */
export function assertMeterMap(meters: MeterMap, name = 'meters'): MeterMap {
  if (!Array.isArray(meters)) {
    throw new InvalidInputError(`${name} must be an array; received ${typeof meters}`);
  }
  if (meters.length === 0) {
    throw new InvalidInputError(`${name} must not be empty`);
  }
  assertGenerationBudget(meters.length, `${name} count`, MAX_METER_CHANGES);
  // A map is re-validated on every positional question asked of it, so a pass
  // over a long piece pays for the whole map per slot unless a map it has
  // already read is recognized as one.
  if (isValidatedMeterMap(meters)) {
    return meters;
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < meters.length; index += 1) {
    const entry = meters[index];
    // A hole in a sparse array, an explicit null, and a number are all rejected
    // here rather than at the first field read, which would surface as the
    // library's own TypeError instead of as the malformed input it is.
    if (typeof entry !== 'object' || entry === null) {
      throw new InvalidInputError(
        `${name}[${index}] must be a meter change; received ${describeRejected(entry)}`,
      );
    }
    assertFiniteNumber(entry.startBeat, `${name}[${index}].startBeat`);
    if (index > 0 && entry.startBeat <= previous) {
      throw new InvalidInputError(
        `${name}[${index}].startBeat must be greater than ${previous}; received ${entry.startBeat}`,
      );
    }
    previous = entry.startBeat;
    assertTimeSignature(entry.ts, `${name}[${index}].ts`);
  }
  rememberValidatedMeterMap(meters);
  return meters;
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
  /**
   * Earliest accepted onset. Onsets are unbounded below by default, because a
   * pickup sounds before the downbeat and the downbeat is beat 0; pass
   * `-pickupBeats` to reject a note starting earlier than the pickup a caller
   * has declared.
   *
   * @defaultValue `-Number.MAX_SAFE_INTEGER`
   */
  minStartBeat?: number;
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
  // The shape is checked before any field is read, so a null or a number from a
  // JSON import is reported as the malformed event it is rather than as the
  // library's own TypeError.
  if (typeof event !== 'object' || event === null) {
    throw new InvalidInputError(
      `${name} must be a note event; received ${describeRejected(event)}`,
    );
  }
  assertMidiPitch(event.pitch, `${name}.pitch`);
  // An onset is not bounded below: the downbeat is beat 0, so a pickup sounds
  // at a negative beat. A nonsensical onset is still rejected — the bound is
  // finite, and a caller that knows its pickup narrows it further.
  const minStartBeat = options.minStartBeat ?? -Number.MAX_SAFE_INTEGER;
  assertFiniteNumber(minStartBeat, 'minStartBeat');
  assertRange(event.startBeat, minStartBeat, Number.MAX_SAFE_INTEGER, `${name}.startBeat`);
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
    // The same domain as the pitch beside it, and checked the same way: both
    // are documented as MIDI quantities in [0, 127], and a MIDI byte has no
    // fractional value to carry. A velocity that arrives at 63.7 is a rounding
    // left undone upstream, and admitting it here hands the writer a note the
    // format cannot hold rather than the caller an error where it was made.
    assertInteger(event.velocity, `${name}.velocity`, 0, 127);
  }
  // Both optional fields carry a closed domain, so both are checked here. A
  // technique outside the table is a misspelt or unmapped name, and passing it
  // on turns an input error into the musical claim that the instrument cannot
  // play it — a statement about a technique that does not exist.
  if (event.articulation !== undefined) {
    assertOneOf(event.articulation, ARTICULATIONS, `${name}.articulation`);
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
    throw new InvalidInputError(`${name} must be an array; received ${typeof events}`);
  }
  assertGenerationBudget(events.length, `${name} count`, options.budget);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    // A hole in a sparse array, an explicit undefined, and a null are all
    // rejected here: letting any of them through only moves the failure to a
    // later TypeError, or drops the note silently.
    if (typeof event !== 'object' || event === null) {
      throw new InvalidInputError(
        `${name}[${index}] must be a note event; received ${describeRejected(event)}`,
      );
    }
    assertNoteEvent(event, `${name}[${index}]`, options);
  }
  return events;
}
