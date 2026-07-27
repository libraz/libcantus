import type { NoteEvent } from '../types.js';
import { assertNoteEvents } from '../validation/index.js';

/**
 * A validated note retaining its position in the caller's original array.
 *
 * @category Core
 */
export type IndexedNoteEvent = {
  note: NoteEvent;
  originalIndex: number;
  endBeat: number;
};

/**
 * Which note wins when several sound from the same onset.
 *
 * `'highest'` and `'lowest'` name a voice, so the answer does not depend on the
 * order the caller happened to store the chord in; `'last'` takes the one
 * latest in the input array.
 *
 * @category Core
 */
export type OnsetTieBreak = 'highest' | 'lowest' | 'last';

/**
 * Binary-searchable, stable-sorted index over note onsets and active spans.
 *
 * @category Core
 */
export type NoteEventIndex = {
  notes: IndexedNoteEvent[];
  /**
   * Latest-onset note sounding at `beat`. Simultaneous onsets are resolved by
   * the index's {@link OnsetTieBreak}.
   */
  at: (beat: number) => IndexedNoteEvent | undefined;
  /** Whether one or more sounding notes attack at `beat`. */
  attacksAt: (beat: number) => boolean;
  /** Unique sounding-note attack beats strictly inside `(startBeat, endBeat)`. */
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
 *
 * @category Core
 */
export function createNoteEventIndex(
  events: readonly NoteEvent[],
  options: {
    allowNonPositiveDuration?: boolean;
    tieBreak?: OnsetTieBreak;
    budget?: number;
    /** What the events are, for the validation error message. */
    name?: string;
  } = {},
): NoteEventIndex {
  assertNoteEvents(events, options.name ?? 'note events', options);
  const tieBreak = options.tieBreak ?? 'highest';
  const notes = events
    .map((note, originalIndex) => ({
      note,
      originalIndex,
      endBeat: note.startBeat + note.durationBeat,
    }))
    .sort((a, b) => a.note.startBeat - b.note.startBeat || a.originalIndex - b.originalIndex);
  // Built on the first `at` call rather than up front: several callers use this
  // only to validate and sort, and never ask what sounds at a beat.
  let prefixMaxEnd: number[] | undefined;
  const maxEndUpTo = (index: number): number => {
    if (prefixMaxEnd === undefined) {
      const prefix: number[] = [];
      let maxEnd = Number.NEGATIVE_INFINITY;
      for (const indexed of notes) {
        maxEnd = Math.max(maxEnd, indexed.endBeat);
        prefix.push(maxEnd);
      }
      prefixMaxEnd = prefix;
    }
    return prefixMaxEnd[index] ?? Number.NEGATIVE_INFINITY;
  };

  return {
    notes,
    at(beat) {
      let index = upperBound(notes, beat + EPS) - 1;
      let best: IndexedNoteEvent | undefined;
      while (index >= 0) {
        if (maxEndUpTo(index) <= beat + EPS) {
          break;
        }
        const indexed = notes[index];
        index -= 1;
        if (
          indexed === undefined ||
          indexed.note.durationBeat <= 0 ||
          indexed.note.startBeat - EPS > beat ||
          beat >= indexed.endBeat - EPS
        ) {
          continue;
        }
        if (best === undefined) {
          best = indexed;
          if (tieBreak === 'last') {
            break;
          }
          continue;
        }
        // Only notes from the same onset compete: a later onset always wins.
        if (Math.abs(indexed.note.startBeat - best.note.startBeat) >= EPS) {
          break;
        }
        const higher = indexed.note.pitch > best.note.pitch;
        if (tieBreak === 'highest' ? higher : !higher) {
          best = indexed;
        }
      }
      return best;
    },
    attacksAt(beat) {
      // Only a sounding note attacks: a zero-length artefact must not make
      // `attacksAt(b)` true on a beat where `at(b)` finds nothing.
      let index = upperBound(notes, beat + EPS) - 1;
      while (index >= 0) {
        const candidate = notes[index];
        if (candidate === undefined || Math.abs(candidate.note.startBeat - beat) >= EPS) {
          return false;
        }
        if (candidate.note.durationBeat > 0) {
          return true;
        }
        index -= 1;
      }
      return false;
    },
    onsetsBetween(startBeat, endBeat) {
      const result: number[] = [];
      let index = upperBound(notes, startBeat + EPS);
      while (index < notes.length) {
        const indexed = notes[index];
        const onset = indexed?.note.startBeat;
        if (indexed === undefined || onset === undefined || onset >= endBeat - EPS) {
          break;
        }
        index += 1;
        if (indexed.note.durationBeat <= 0) {
          continue;
        }
        const previous = result[result.length - 1];
        if (previous === undefined || Math.abs(previous - onset) >= EPS) {
          result.push(onset);
        }
      }
      return result;
    },
  };
}
