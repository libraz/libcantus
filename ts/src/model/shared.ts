import { InvalidInputError } from '../core/errors/index.js';
import type { TimeSignature } from '../core/meter/index.js';
import { midiToNote, pitchClassOf as mod12, type Note as NoteData } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';
import type { NoteEventAssertOptions } from '../core/validation/index.js';
import {
  assertFiniteNumber,
  assertNoteEvents,
  assertTimeSignature,
} from '../core/validation/index.js';

export { pitchClassOf as mod12 } from '../core/pitch/index.js';

/**
 * The confidence a key region carries when the caller stated the key.
 *
 * A stated key is not a measurement, and reporting anything less would make a
 * caller's own answer look like a doubtful reading of the notes. Shared by
 * every class that turns a stated key into a region, so the score and the
 * timeline it hands over do not report the same key with two confidences.
 */
export const STATED_KEY_CONFIDENCE = 1;

/** How a value that failed a shape check is named in the error explaining it. */
function describeShape(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'an array' : typeof value;
}

/**
 * The value as a data record, refused before any field of it is read.
 *
 * A factory rebuilding a class from stored data reads named fields off its
 * argument, and a project file that lost one — or a `null` where the object
 * should be — would otherwise surface as a `TypeError` from inside the
 * library, which is the shape reserved for the library's own faults. Checking
 * here keeps a malformed document an input error, at the field that is wrong.
 *
 * @param value The value a factory was handed.
 * @param name What the value is called in an error message.
 * @returns The value, typed as the record the caller expects.
 * @throws If the value is not a non-null, non-array object.
 */
export function assertDataObject<T>(value: unknown, name: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidInputError(`${name} must be an object; received ${describeShape(value)}`);
  }
  return value as T;
}

/**
 * The value as a data array, refused before it is iterated or spread.
 *
 * @param value The value a factory was handed.
 * @param name What the value is called in an error message.
 * @returns The value, typed as the array the caller expects.
 * @throws If the value is not an array.
 */
export function assertDataArray<T>(value: unknown, name: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new InvalidInputError(`${name} must be an array; received ${describeShape(value)}`);
  }
  return value as readonly T[];
}

/**
 * The value as an array of data records, every element checked.
 *
 * A hole in a sparse array, an explicit `null`, and a bare number in a list of
 * objects are all refused here rather than at whichever field of the element is
 * read first.
 *
 * @param value The value a factory was handed.
 * @param name What the value is called in an error message.
 * @returns The value, typed as the array the caller expects.
 * @throws If the value is not an array, or an element is not a record.
 */
export function assertDataObjects<T>(value: unknown, name: string): readonly T[] {
  const items = assertDataArray<unknown>(value, name);
  for (let index = 0; index < items.length; index += 1) {
    assertDataObject(items[index], `${name}[${index}]`);
  }
  return items as readonly T[];
}

/**
 * The value as an array of note events, checked as a whole before any one of
 * them is read.
 *
 * A class built from a caller's notes keeps that array as what it is: the notes
 * of a score, the notes of a motif cell, the notes of an arrangement track. So
 * the array is held to the same bound the function API holds it to — the count
 * is capped by the generation budget, and it is capped before the pass over the
 * notes begins, since an array too large to hold is refused for its size rather
 * than after every note in it has been read.
 *
 * One reader for all three, rather than a budget check written again beside
 * each loop: the pairing of "cap the count" with "check each note" is what went
 * missing on every class path at once when each of them combined the two for
 * itself.
 *
 * @param notes The notes a class was handed.
 * @param name What the array is called in an error message.
 * @param options What counts as an acceptable note here, and the budget to cap
 *   the count against; see {@link NoteEventAssertOptions}.
 * @returns The notes, unchanged and uncopied.
 * @throws If the value is not an array, if it holds more notes than the budget
 *   allows, or if a note carries a value the library cannot hold.
 */
export function assertNoteEventArray(
  notes: unknown,
  name: string,
  options?: NoteEventAssertOptions,
): readonly NoteEvent[] {
  return assertNoteEvents(assertDataArray<NoteEvent>(notes, name), name, options);
}

/**
 * Refuse anything but a key where a method takes the key first.
 *
 * These methods read a key and then their options, so an options bag passed
 * on its own is taken for the key. Nothing notices until a `scale` is read off
 * it several calls later, and the error names a field of a key the caller
 * never wrote — `modeMask12 must be finite; received undefined` for an object
 * whose only property is `alternatives`. The shape is checked here instead,
 * where the mistake is still the caller's own argument.
 *
 * Every form a key argument accepts passes: a key name, a plain key/scale, and
 * a value carrying key data. The last two are recognised by their fields rather
 * than by their type, the way every other boundary in the library reads a key,
 * so a `Key` built by a second copy of the module passes. What is left is an
 * object that names no key at all, which is the options bag this guards
 * against; resolving the value is the caller's next step and reports anything
 * that is key-shaped without being a key.
 */
export function assertKeyArgument(value: unknown, name: string): void {
  if (value === undefined || typeof value === 'string' || isKeyShaped(value)) {
    return;
  }
  const received =
    value === null ? 'null' : typeof value === 'object' ? 'an object' : `a ${typeof value}`;
  throw new InvalidInputError(
    `${name} must be a Key; received ${received}. A method that also takes options takes them after the key, not in its place`,
  );
}

/** Whether a value carries the fields any of the key forms is read through. */
function isKeyShaped(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return 'scale' in value || 'toJSON' in value || ('rootPc' in value && 'modeMask12' in value);
}

/** Spell a bare pitch class as an octave-less note with a sharp/flat preference. */
export function spellPitchClassBare(pc: number, spelling: 'sharp' | 'flat'): NoteData {
  const spelled = midiToNote(60 + mod12(pc), spelling);
  return { letter: spelled.letter, alter: spelled.alter };
}

/** Zero with its sign dropped, so `-0` never reaches the plain data. */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Where the last of a run of spans ends, and never before beat 0. */
export function spanEnd(...runs: readonly (readonly { endBeat: number }[])[]): number {
  let end = 0;
  for (const run of runs) {
    for (const span of run) {
      end = Math.max(end, span.endBeat);
    }
  }
  return end;
}

/**
 * Defensive copy of one note event, carrying only the fields a note holds.
 *
 * A `-0` onset survives every arithmetic path that produced it but not
 * `JSON.stringify`, so it is dropped here rather than becoming a value that
 * compares unequal to its own serialization.
 *
 * The event is copied as given: the classes that check their input do so
 * before copying, since what counts as an acceptable note differs between
 * written material and an imported track.
 */
export function copyNoteEvent(note: NoteEvent): NoteEvent {
  const copy: NoteEvent = {
    pitch: withoutNegativeZero(note.pitch),
    startBeat: withoutNegativeZero(note.startBeat),
    durationBeat: withoutNegativeZero(note.durationBeat),
  };
  if (note.velocity !== undefined) {
    copy.velocity = withoutNegativeZero(note.velocity);
  }
  if (note.articulation !== undefined) {
    copy.articulation = note.articulation;
  }
  return copy;
}

/**
 * A defensive copy of a plain time signature, checked the way every meter
 * function checks it.
 *
 * Data arriving from a project file, a plugin, or a hand-edited JSON enters
 * here, so it is held to the rules a parsed signature is held to: an unchecked
 * numerator of zero or of `NaN` would divide every bar that reads it.
 *
 * @param name - What the signature is called in an error message.
 */
export function copyTimeSignature(ts: TimeSignature, name?: string): TimeSignature {
  assertDataObject(ts, name ?? 'time signature');
  assertTimeSignature(ts, name);
  const copy: TimeSignature = { numerator: ts.numerator, denominator: ts.denominator };
  if (ts.grouping !== undefined) {
    copy.grouping = [...ts.grouping];
  }
  return copy;
}

/**
 * How far a plain-data copy follows nesting before it calls the value
 * pathological.
 *
 * Nothing the library holds as data is nested anywhere near this deep, so a
 * value that reaches the limit describes a document built to exhaust the stack
 * rather than music.
 */
const MAX_PLAIN_DEPTH = 64;

/**
 * A deep copy of caller data, with every number checked and every absent field
 * left out.
 *
 * The values that reach here are the open-ended ones: the `material` a
 * vocabulary figure is made of, an instrument profile, the records an
 * arrangement's analysis reports. None has a fixed shape, so the only way to
 * promise that nothing non-finite and nothing unserializable reaches a
 * generator — or survives a round trip through a project file — is to walk the
 * value. Dropping `undefined` properties is what keeps the copy equal to its
 * own JSON.
 *
 * A value that refers back to itself, or one nested past
 * {@link MAX_PLAIN_DEPTH} levels, is refused: recursing into either overflows
 * the stack, and a `RangeError` from inside the library is not one of the
 * failures the library documents.
 *
 * @param value The data to copy.
 * @param name What the value is called in an error message.
 * @returns The copy.
 * @throws If a number is not finite, a value is not plain data, or the value
 *   is cyclic or pathologically deep.
 */
export function copyPlain<T>(value: T, name: string): T {
  return copyPlainAt(value, name, new WeakSet<object>(), 0);
}

/** One level of {@link copyPlain}, carrying the ancestors and the depth. */
function copyPlainAt<T>(value: T, name: string, seen: WeakSet<object>, depth: number): T {
  if (typeof value === 'number') {
    return assertFiniteNumber(value, name) as T;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new InvalidInputError(`${name} must be plain data; received ${typeof value}`);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  // Only the ancestors are held, not everything already copied, so a record
  // named twice beside itself is copied twice rather than reported as a cycle.
  if (seen.has(value)) {
    throw new InvalidInputError(`${name} must be plain data; received a value referring to itself`);
  }
  if (depth >= MAX_PLAIN_DEPTH) {
    throw new InvalidInputError(
      `${name} must be plain data; received a value nested more than ${MAX_PLAIN_DEPTH} levels deep`,
    );
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        copyPlainAt(item, `${name}[${index}]`, seen, depth + 1),
      ) as T;
    }
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        copy[key] = copyPlainAt(item, `${name}.${key}`, seen, depth + 1);
      }
    }
    return copy as T;
  } finally {
    seen.delete(value);
  }
}

/**
 * Whether two plain values hold the same data, key order aside.
 *
 * Records, arrays and primitives are all a model class hands out, so one walk
 * answers `equals` for every one of them rather than each class comparing the
 * shapes its own data happens to carry.
 */
export function samePlain(value: unknown, other: unknown): boolean {
  if (Array.isArray(value) || Array.isArray(other)) {
    return (
      Array.isArray(value) &&
      Array.isArray(other) &&
      value.length === other.length &&
      value.every((item, index) => samePlain(item, other[index]))
    );
  }
  if (typeof value === 'object' && value !== null && typeof other === 'object' && other !== null) {
    const mine = Object.entries(value);
    const theirs = other as Record<string, unknown>;
    return (
      mine.length === Object.keys(theirs).length &&
      mine.every(([key, item]) => key in theirs && samePlain(item, theirs[key]))
    );
  }
  return value === other;
}
