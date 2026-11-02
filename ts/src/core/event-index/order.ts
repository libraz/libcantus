import type { NoteEvent } from '../types.js';
import { dropSilentNotes } from '../validation/index.js';

/**
 * Indices of the notes in canonical order: by onset, then by pitch, then by
 * position in the array.
 *
 * Every pass that reads a note against the one before or after it walks the
 * notes in this order, so two listings of the same notes give the same answer.
 *
 * @param notes Validated note events.
 * @returns Every index of `notes`, once.
 */
export function canonicalNoteOrder(notes: readonly NoteEvent[]): number[] {
  return notes
    .map((_, index) => index)
    .sort((a, b) => {
      const left = notes[a];
      const right = notes[b];
      if (!left || !right) {
        return a - b;
      }
      return left.startBeat - right.startBeat || left.pitch - right.pitch || a - b;
    });
}

/**
 * The notes themselves in canonical order.
 *
 * @param notes Validated note events.
 * @returns The same note objects, ordered by {@link canonicalNoteOrder}.
 */
export function inCanonicalOrder<T extends NoteEvent>(notes: readonly T[]): T[] {
  return canonicalNoteOrder(notes).flatMap((index) => {
    const note = notes[index];
    return note === undefined ? [] : [note];
  });
}

/**
 * Indices of the notes {@link dropSilentNotes} keeps, in input order.
 *
 * For a pass that reports one entry per input note and so cannot drop the
 * silent ones from the array itself.
 *
 * @param notes Validated note events.
 * @returns The indices of the notes with a positive duration, ascending.
 */
export function soundingIndices(notes: readonly NoteEvent[]): number[] {
  const sounding = new Set(dropSilentNotes(notes));
  return notes.flatMap((note, index) => (sounding.has(note) ? [index] : []));
}
