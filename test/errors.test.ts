import { describe, expect, it } from 'vitest';
import { detectChord } from '../src/analyze/detect/index.js';
import { romanToChord } from '../src/analyze/functional/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import {
  BudgetExceededError,
  InvalidInputError,
  isLibcantusError,
  NoSolutionError,
} from '../src/core/errors/index.js';
import { createNoteEventIndex } from '../src/core/event-index/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateProgression } from '../src/generate/progression/index.js';
import type { ChordQuality } from '../src/theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { formatChordSymbol, parseChordSymbol } from '../src/theory/symbol/index.js';
import { voiceChord, voiceProgression } from '../src/theory/voicing/index.js';

/** Run `fn` and return whatever it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('failures are told apart by code, not by message', () => {
  it('separates a bad argument from an unsatisfiable request', () => {
    // Both used to be a bare Error, so the only way to tell "fix your input"
    // from "loosen your constraints" was to match on the message text.
    const badInput = thrown(() => voiceChord(parseChordSymbol('C'), { ranges: [] }));
    expect(badInput).toBeInstanceOf(InvalidInputError);
    expect(isLibcantusError(badInput) && badInput.code).toBe('INVALID_INPUT');

    // A single voice confined to C#, which C major does not contain.
    const noSolution = thrown(() =>
      voiceChord(parseChordSymbol('C'), { ranges: [{ min: 61, max: 61 }] }),
    );
    expect(noSolution).toBeInstanceOf(NoSolutionError);
    expect(isLibcantusError(noSolution) && noSolution.code).toBe('NO_SOLUTION');
  });

  it('marks a budget overrun as its own kind', () => {
    const notes: NoteEvent[] = Array.from({ length: 40 }, (_, i) => ({
      pitch: 60,
      startBeat: i,
      durationBeat: 1,
    }));
    const budget = thrown(() => chordTimelineFromNotes(notes, { budget: 8 }));
    expect(budget).toBeInstanceOf(BudgetExceededError);
    expect(isLibcantusError(budget) && budget.code).toBe('BUDGET_EXCEEDED');
  });

  it('says which chord of a progression could not be voiced', () => {
    // C fits two voices pinned to C and E; Db, the next chord, contains neither.
    const chords = [parseChordSymbol('C'), parseChordSymbol('Db'), parseChordSymbol('D')];
    const error = thrown(() =>
      voiceProgression(chords, {
        ranges: [
          { min: 60, max: 60 },
          { min: 64, max: 64 },
        ],
      }),
    );
    expect(error).toBeInstanceOf(NoSolutionError);
    if (!(error instanceof NoSolutionError)) {
      throw new Error('expected a NoSolutionError');
    }
    expect(error.at).toBeTypeOf('number');
    expect(error.message).toMatch(/index \d/);
  });

  it('keeps the built-in error types a caller already catches', () => {
    expect(thrown(() => romanToChord('nonsense', majorKey(0)))).toBeInstanceOf(RangeError);
    expect(thrown(() => detectChord([Number.NaN]))).toBeInstanceOf(RangeError);
    expect(isLibcantusError(new Error('plain'))).toBe(false);
  });
});

describe('chord data cannot be malformed silently', () => {
  it('rejects a non-finite root instead of naming it C', () => {
    expect(() => makeChord(Number.NaN, 'maj')).toThrow(InvalidInputError);
    expect(() => makeChord(0, 'maj', Number.NaN)).toThrow(InvalidInputError);
    expect(() =>
      formatChordSymbol({ rootPc: Number.NaN, quality: 'maj', intervals: [0, 4, 7] }),
    ).toThrow(InvalidInputError);
  });

  it('rejects an unknown quality on both the build and the format path', () => {
    expect(() => makeChord(0, 'bogus' as ChordQuality)).toThrow(InvalidInputError);
    expect(() =>
      formatChordSymbol({ rootPc: 0, quality: 'bogus' as ChordQuality, intervals: [0, 4, 7] }),
    ).toThrow(InvalidInputError);
  });

  it('rejects an unknown progression style and preset by name', () => {
    expect(() =>
      generateProgression({ key: majorKey(0), style: 'nope' as never, bars: 1 }),
    ).toThrow(InvalidInputError);
    expect(() =>
      generateProgression({ key: majorKey(0), style: 'dance', bars: 1, presetId: 'nope' }),
    ).toThrow(InvalidInputError);
  });
});

describe('a slash bass belongs to the chord', () => {
  it('reports the bass among the chord pitch classes', () => {
    const slash = parseChordSymbol('F/G');
    expect(chordPitchClasses(slash)).toEqual([0, 5, 7, 9]);
    expect(chordPitchClasses(slash, { includeBass: false })).toEqual([0, 5, 9]);
    // The set now re-detects as the chord it came from.
    const best = detectChord(chordPitchClasses(slash))[0];
    expect(best?.exact).toBe(true);
  });
});

describe('simultaneous onsets resolve to a named voice', () => {
  it('does not depend on the order a chord was stored in', () => {
    const ascending: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 0, durationBeat: 1 },
      { pitch: 67, startBeat: 0, durationBeat: 1 },
    ];
    const descending = [...ascending].reverse();
    for (const notes of [ascending, descending]) {
      expect(createNoteEventIndex(notes).at(0)?.note.pitch).toBe(67);
      expect(createNoteEventIndex(notes, { tieBreak: 'lowest' }).at(0)?.note.pitch).toBe(60);
    }
    // The input-order reading stays available for a caller that wants it.
    expect(createNoteEventIndex(ascending, { tieBreak: 'last' }).at(0)?.note.pitch).toBe(67);
    expect(createNoteEventIndex(descending, { tieBreak: 'last' }).at(0)?.note.pitch).toBe(60);
  });

  it('still prefers a later onset over any simultaneous one', () => {
    const notes: NoteEvent[] = [
      { pitch: 72, startBeat: 0, durationBeat: 4 },
      { pitch: 60, startBeat: 2, durationBeat: 1 },
    ];
    expect(createNoteEventIndex(notes).at(2)?.note.pitch).toBe(60);
  });
});
