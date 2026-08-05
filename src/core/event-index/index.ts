import type { NoteEvent } from '../types.js';
import { assertNoteEvents } from '../validation/index.js';

/**
 * A validated note retaining its position in the caller's original array.
 *
 * @category Core
 */
export type IndexedNoteEvent = {
  note: Readonly<NoteEvent>;
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
  notes: readonly IndexedNoteEvent[];
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

function upperBound(values: readonly IndexedNoteEvent[], beat: number): number {
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
  const notes = Object.freeze(
    events
      .map((note, originalIndex) => ({
        note: Object.freeze({ ...note }),
        originalIndex,
        endBeat: note.startBeat + note.durationBeat,
      }))
      .sort((a, b) => a.note.startBeat - b.note.startBeat || a.originalIndex - b.originalIndex),
  );
  // Segment-tree maxima find the latest active onset in logarithmic time even
  // when an early, very long note would defeat a prefix-max backwards scan.
  let treeSize = 1;
  while (treeSize < notes.length) treeSize *= 2;
  const maxEndTree = new Array<number>(treeSize * 2).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < notes.length; index += 1) {
    maxEndTree[treeSize + index] = notes[index]?.endBeat ?? Number.NEGATIVE_INFINITY;
  }
  for (let index = treeSize - 1; index > 0; index -= 1) {
    maxEndTree[index] = Math.max(
      maxEndTree[index * 2] ?? Number.NEGATIVE_INFINITY,
      maxEndTree[index * 2 + 1] ?? Number.NEGATIVE_INFINITY,
    );
  }
  const latestActiveIndex = (exclusive: number, beat: number): number => {
    const find = (node: number, start: number, end: number): number => {
      if (start >= exclusive || (maxEndTree[node] ?? Number.NEGATIVE_INFINITY) <= beat + EPS) {
        return -1;
      }
      if (end - start === 1) return start < notes.length ? start : -1;
      const mid = Math.floor((start + end) / 2);
      const right = find(node * 2 + 1, mid, end);
      return right >= 0 ? right : find(node * 2, start, mid);
    };
    return find(1, 0, treeSize);
  };

  return {
    notes,
    at(beat) {
      const index = latestActiveIndex(upperBound(notes, beat + EPS), beat);
      if (index < 0) return undefined;
      const onset = notes[index]?.note.startBeat;
      let best: IndexedNoteEvent | undefined;
      for (let candidateIndex = index; candidateIndex >= 0; candidateIndex -= 1) {
        const indexed = notes[candidateIndex];
        if (indexed !== undefined && indexed.note.startBeat !== onset) break;
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
          continue;
        }
        if (tieBreak === 'last') continue;
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
