import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { createNoteEventIndex, sortedNoteEvents } from '../src/core/event-index/index.js';

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

  it('rejects a query beat that is not a beat', () => {
    // A host wiring a scrub position straight into a query can hand over `NaN`
    // before anything is loaded. `NaN` compares false against both bounds, so
    // an unchecked window reads as an open one and reports every note in the
    // piece as sounding — a wrong answer where an input error is owed.
    const index = createNoteEventIndex([
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 1 },
    ]);
    expect(() => index.onsetsBetween(Number.NaN, Number.NaN)).toThrow(InvalidInputError);
    expect(() => index.onsetsBetween(0, Number.NaN)).toThrow(InvalidInputError);
    expect(() => index.onsetsBetween(Number.NaN, 4)).toThrow(InvalidInputError);
    expect(() => index.onsetsBetween(0, Number.POSITIVE_INFINITY)).toThrow(InvalidInputError);
    expect(() => index.at(Number.NaN)).toThrow(InvalidInputError);
    expect(() => index.at(Number.NEGATIVE_INFINITY)).toThrow(InvalidInputError);
    expect(() => index.attacksAt(Number.NaN)).toThrow(InvalidInputError);
    expect(() => index.attacksAt(Number.POSITIVE_INFINITY)).toThrow(InvalidInputError);
    // A pickup's onset is a beat like any other and is answered, not rejected.
    expect(index.onsetsBetween(-4, 4)).toEqual([0, 2]);
    expect(index.at(-1)).toBeUndefined();
    expect(index.attacksAt(-1)).toBe(false);
  });

  it('answers the same whichever query is asked first', () => {
    // The active-note tree is built when the first `at` asks for it, so the
    // queries that answer without it must not leave it half-built — and must
    // give the same answers whichever order a caller puts them in.
    const notes = [
      { pitch: 48, startBeat: 0, durationBeat: 8 },
      { pitch: 60, startBeat: 2, durationBeat: 1 },
      { pitch: 64, startBeat: 2, durationBeat: 4 },
      { pitch: 67, startBeat: 6, durationBeat: 1 },
    ];
    const onsetsFirst = createNoteEventIndex(notes);
    expect(onsetsFirst.onsetsBetween(0, 8)).toEqual([2, 6]);
    expect(onsetsFirst.attacksAt(6)).toBe(true);
    const atFirst = createNoteEventIndex(notes);
    for (const beat of [0, 1, 2, 3, 5, 6, 7, 8]) {
      expect(atFirst.at(beat)?.note.pitch).toBe(onsetsFirst.at(beat)?.note.pitch);
    }
    expect(atFirst.onsetsBetween(0, 8)).toEqual(onsetsFirst.onsetsBetween(0, 8));
    expect(atFirst.attacksAt(6)).toBe(onsetsFirst.attacksAt(6));
    // Repeated queries read the tree the first one built.
    expect(atFirst.at(2)?.note.pitch).toBe(64);
    expect(atFirst.at(2)?.note.pitch).toBe(64);
  });

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

  it('keeps a defensive snapshot and finds notes after a long held pad', () => {
    const source = [
      { pitch: 48, startBeat: 0, durationBeat: 10_000 },
      { pitch: 72, startBeat: 9_999, durationBeat: 0.5 },
    ];
    const timeline = createNoteEventIndex(source);
    source.push({ pitch: 84, startBeat: 1, durationBeat: 1 });
    expect(timeline.notes).toHaveLength(2);
    expect(timeline.at(9_999)?.note.pitch).toBe(72);
  });
});
