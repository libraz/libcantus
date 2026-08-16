import type { TimeSignature } from '../core/meter/index.js';
import { midiToNote, pitchClassOf as mod12, type Note as NoteData } from '../core/pitch/index.js';
import type { NoteEvent } from '../core/types.js';
import { assertTimeSignature } from '../core/validation/index.js';

export { pitchClassOf as mod12 } from '../core/pitch/index.js';

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
  assertTimeSignature(ts, name);
  const copy: TimeSignature = { numerator: ts.numerator, denominator: ts.denominator };
  if (ts.grouping !== undefined) {
    copy.grouping = [...ts.grouping];
  }
  return copy;
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
