import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
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
