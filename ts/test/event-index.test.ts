import { describe, expect, it } from 'vitest';
import { createNoteEventIndex, sortedNoteEvents } from '../src/core/event-index/index.js';

describe('note event timeline index', () => {
  it('orders notes for a reader that asks the index nothing', () => {
    const source = [
      { pitch: 64, startBeat: 2, durationBeat: 2 },
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
    ];
    const sorted = sortedNoteEvents(source);
    // The order is the index's own, so a pass may read either and see the same
    // notes in the same places.
    expect(sorted.map((note) => note.pitch)).toEqual(
      createNoteEventIndex(source).notes.map(({ note }) => note.pitch),
    );
    // Copies, so the sequence is the caller's and two entries that arrived as
    // one shared object stay two.
    expect(sorted[0]).not.toBe(source[1]);
    expect(sorted[0]).toEqual(source[1]);
    const shared = { pitch: 60, startBeat: 0, durationBeat: 1 };
    const twice = sortedNoteEvents([shared, shared]);
    expect(twice).toHaveLength(2);
    expect(twice[0]).not.toBe(twice[1]);
  });
});
