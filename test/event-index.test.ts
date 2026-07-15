import { describe, expect, it } from 'vitest';
import { createNoteEventIndex } from '../src/core/event-index/index.js';

describe('note event timeline index', () => {
  it('stable-sorts once and resolves attacks and overlaps by latest onset', () => {
    const index = createNoteEventIndex([
      { pitch: 64, startBeat: 2, durationBeat: 2 },
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
    ]);
    expect(index.notes.map(({ note }) => note.pitch)).toEqual([60, 64, 67]);
    expect(index.at(1)?.note.pitch).toBe(60);
    expect(index.at(2)?.note.pitch).toBe(67);
    expect(index.attacksAt(2)).toBe(true);
    expect(index.onsetsBetween(0, 4)).toEqual([2]);
  });

  it('handles 100k notes without a quadratic query path', () => {
    const notes = Array.from({ length: 100_000 }, (_, index) => ({
      pitch: 60 + (index % 12),
      startBeat: index * 0.25,
      durationBeat: 0.5,
    }));
    const timeline = createNoteEventIndex(notes);
    for (let index = 0; index < notes.length; index += 100) {
      expect(timeline.at(index * 0.25)?.note.pitch).toBe(60 + (index % 12));
    }
  });
});
