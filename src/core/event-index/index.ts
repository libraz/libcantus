import type { NoteEvent } from '../types.js';
import { assertNoteEvents } from '../validation/index.js';

/** A validated note retaining its position in the caller's original array. */
export type IndexedNoteEvent = {
  note: NoteEvent;
  originalIndex: number;
  endBeat: number;
};

/** Binary-searchable, stable-sorted index over note onsets and active spans. */
export type NoteEventIndex = {
  notes: IndexedNoteEvent[];
  /** Latest-onset note sounding at `beat`, with later input order winning ties. */
  at: (beat: number) => IndexedNoteEvent | undefined;
  /** Whether one or more notes attack at `beat`. */
  attacksAt: (beat: number) => boolean;
  /** Unique attack beats strictly inside `(startBeat, endBeat)`. */
  onsetsBetween: (startBeat: number, endBeat: number) => number[];
};

const EPS = 1e-9;

function upperBound(values: IndexedNoteEvent[], beat: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle]?.note.startBeat ?? Number.POSITIVE_INFINITY) <= beat) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Validate and stable-sort note events once, then expose logarithmic onset and
 * active-note lookups. Non-positive-duration notes may be retained for callers
 * that intentionally filter them later, but never count as sounding.
 */
export function createNoteEventIndex(
  events: NoteEvent[],
  options: { allowNonPositiveDuration?: boolean } = {},
): NoteEventIndex {
  assertNoteEvents(events, 'note events', options);
  const notes = events
    .map((note, originalIndex) => ({
      note,
      originalIndex,
      endBeat: note.startBeat + note.durationBeat,
    }))
    .sort((a, b) => a.note.startBeat - b.note.startBeat || a.originalIndex - b.originalIndex);
  const prefixMaxEnd: number[] = [];
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const indexed of notes) {
    maxEnd = Math.max(maxEnd, indexed.endBeat);
    prefixMaxEnd.push(maxEnd);
  }

  return {
    notes,
    at(beat) {
      let index = upperBound(notes, beat + EPS) - 1;
      while (index >= 0) {
        if ((prefixMaxEnd[index] ?? Number.NEGATIVE_INFINITY) <= beat + EPS) {
          return undefined;
        }
        const indexed = notes[index];
        if (
          indexed &&
          indexed.note.durationBeat > 0 &&
          indexed.note.startBeat - EPS <= beat &&
          beat < indexed.endBeat - EPS
        ) {
          return indexed;
        }
        index -= 1;
      }
      return undefined;
    },
    attacksAt(beat) {
      const firstAfter = upperBound(notes, beat + EPS);
      const candidate = notes[firstAfter - 1];
      return candidate !== undefined && Math.abs(candidate.note.startBeat - beat) < EPS;
    },
    onsetsBetween(startBeat, endBeat) {
      const result: number[] = [];
      let index = upperBound(notes, startBeat + EPS);
      while (index < notes.length) {
        const onset = notes[index]?.note.startBeat;
        if (onset === undefined || onset >= endBeat - EPS) {
          break;
        }
        if (result[result.length - 1] !== onset) {
          result.push(onset);
        }
        index += 1;
      }
      return result;
    },
  };
}
