import { BEAT_EPS } from '../meter/internal.js';
import type { NoteEvent } from '../types.js';
import { assertFiniteNumber, assertNoteEvents } from '../validation/index.js';

/**
 * A validated note retaining its position in the caller's original array.
 *
 * @category Core
 */
export type IndexedNoteEvent = {
  readonly note: Readonly<NoteEvent>;
  readonly originalIndex: number;
  readonly endBeat: number;
};

/**
 * Which note wins when several sound from the same onset.
 *
 * `'highest'` and `'lowest'` name a voice, so the answer does not depend on the
 * order the caller happened to store the chord in; `'last'` takes the one
 * latest in the input array. Two notes of the same pitch name no voice apart,
 * so both voice tie-breaks settle a unison on the lower `originalIndex` and
 * name the same note.
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
   *
   * @throws If `beat` is not finite.
   */
  at: (beat: number) => IndexedNoteEvent | undefined;
  /**
   * Whether one or more sounding notes attack at `beat`.
   *
   * @throws If `beat` is not finite.
   */
  attacksAt: (beat: number) => boolean;
  /**
   * Unique sounding-note attack beats strictly inside `(startBeat, endBeat)`.
   *
   * @throws If either bound is not finite.
   */
  onsetsBetween: (startBeat: number, endBeat: number) => number[];
};

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
 * Copy note events and put them in stable onset order.
 *
 * The order is the one {@link createNoteEventIndex} numbers its notes in, so a
 * pass may read the sequence here and the index there and see the same notes in
 * the same places. What it does not build is the index itself: a caller that
 * only walks the notes in time order would otherwise pay for a segment tree and
 * a wrapper per note that it never queries.
 *
 * The events are copied, so the sequence is the caller's own and two entries
 * that arrived as one shared object stay two.
 *
 * @param events The events to order; already validated by the caller.
 * @returns The copies, earliest onset first, ties in input order.
 */
export function sortedNoteEvents(events: readonly NoteEvent[]): NoteEvent[] {
  const sorted = events.map((note) => ({ ...note }));
  // Array sort is stable, so events sharing an onset keep the order they were
  // given in — the tie-break the index spells out as `originalIndex`.
  sorted.sort((a, b) => a.startBeat - b.startBeat);
  return sorted;
}

/**
 * How an index reads the events it is built from.
 *
 * @category Core
 */
export type NoteEventIndexOptions = {
  allowNonPositiveDuration?: boolean;
  tieBreak?: OnsetTieBreak;
  budget?: number;
  /** What the events are, for the validation error message. */
  name?: string;
};

/**
 * Validate and stable-sort note events once, then expose onset and active-note
 * lookups that cost `O(log n + k)`, where `k` is how many notes share the onset
 * the answer comes from. Non-positive-duration notes may be retained for
 * callers that intentionally filter them later, but never count as sounding.
 *
 * @category Core
 */
export function createNoteEventIndex(
  events: readonly NoteEvent[],
  options: NoteEventIndexOptions = {},
): NoteEventIndex {
  assertNoteEvents(events, options.name ?? 'note events', options);
  const tieBreak = options.tieBreak ?? 'highest';
  // Each wrapper is frozen, not only the array and the note inside it: `endBeat`
  // is what the active-note search is built from, so a host that writes to it
  // would leave the index answering from a span nothing else knows about.
  const notes = Object.freeze(
    events
      .map((note, originalIndex) =>
        Object.freeze({
          note: Object.freeze({ ...note }),
          originalIndex,
          endBeat: note.startBeat + note.durationBeat,
        }),
      )
      .sort((a, b) => a.note.startBeat - b.note.startBeat || a.originalIndex - b.originalIndex),
  );
  // Segment-tree maxima find the latest active onset in logarithmic time even
  // when an early, very long note would defeat a prefix-max backwards scan.
  //
  // It is built on the first `at` query rather than on construction: the onset
  // queries answer from the sorted notes alone, so a caller that never asks
  // which note is sounding would otherwise pay for a structure it never reads.
  let maxEndTree: number[] | undefined;
  let treeSize = 0;
  const endTree = (): number[] => {
    if (maxEndTree !== undefined) {
      return maxEndTree;
    }
    treeSize = 1;
    while (treeSize < notes.length) treeSize *= 2;
    const tree = new Array<number>(treeSize * 2).fill(Number.NEGATIVE_INFINITY);
    for (let index = 0; index < notes.length; index += 1) {
      tree[treeSize + index] = notes[index]?.endBeat ?? Number.NEGATIVE_INFINITY;
    }
    for (let index = treeSize - 1; index > 0; index -= 1) {
      tree[index] = Math.max(
        tree[index * 2] ?? Number.NEGATIVE_INFINITY,
        tree[index * 2 + 1] ?? Number.NEGATIVE_INFINITY,
      );
    }
    maxEndTree = tree;
    return tree;
  };
  const latestActiveIndex = (exclusive: number, beat: number): number => {
    const tree = endTree();
    const find = (node: number, start: number, end: number): number => {
      if (start >= exclusive || (tree[node] ?? Number.NEGATIVE_INFINITY) <= beat + BEAT_EPS) {
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
      // A query beat comes from wherever the host got it — a scrub position, a
      // parsed field — so it is checked like any other entry argument. `NaN`
      // compares false against every bound, which would read as an open window
      // rather than as the missing value it is.
      assertFiniteNumber(beat, 'beat');
      const index = latestActiveIndex(upperBound(notes, beat + BEAT_EPS), beat);
      if (index < 0) return undefined;
      const onset = notes[index]?.note.startBeat;
      let best: IndexedNoteEvent | undefined;
      for (let candidateIndex = index; candidateIndex >= 0; candidateIndex -= 1) {
        const indexed = notes[candidateIndex];
        if (indexed !== undefined && indexed.note.startBeat !== onset) break;
        if (
          indexed === undefined ||
          indexed.note.durationBeat <= 0 ||
          indexed.note.startBeat - BEAT_EPS > beat ||
          beat >= indexed.endBeat - BEAT_EPS
        ) {
          continue;
        }
        if (best === undefined) {
          best = indexed;
          continue;
        }
        if (tieBreak === 'last') continue;
        const difference = indexed.note.pitch - best.note.pitch;
        // Equal pitches name no voice apart, so they are settled on the lower
        // original index rather than on whichever end of the array the scan
        // happens to reach last — otherwise `'highest'` and `'lowest'` would
        // answer a unison differently.
        const wins =
          difference === 0
            ? indexed.originalIndex < best.originalIndex
            : difference > 0 === (tieBreak === 'highest');
        if (wins) {
          best = indexed;
        }
      }
      return best;
    },
    attacksAt(beat) {
      assertFiniteNumber(beat, 'beat');
      // Only a sounding note attacks: a zero-length artefact must not make
      // `attacksAt(b)` true on a beat where `at(b)` finds nothing.
      let index = upperBound(notes, beat + BEAT_EPS) - 1;
      while (index >= 0) {
        const candidate = notes[index];
        if (candidate === undefined || Math.abs(candidate.note.startBeat - beat) >= BEAT_EPS) {
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
      assertFiniteNumber(startBeat, 'startBeat');
      assertFiniteNumber(endBeat, 'endBeat');
      const result: number[] = [];
      let index = upperBound(notes, startBeat + BEAT_EPS);
      while (index < notes.length) {
        const indexed = notes[index];
        const onset = indexed?.note.startBeat;
        if (indexed === undefined || onset === undefined || onset >= endBeat - BEAT_EPS) {
          break;
        }
        index += 1;
        if (indexed.note.durationBeat <= 0) {
          continue;
        }
        const previous = result[result.length - 1];
        if (previous === undefined || Math.abs(previous - onset) >= BEAT_EPS) {
          result.push(onset);
        }
      }
      return result;
    },
  };
}
