import { describe, expect, it, vi } from 'vitest';
import type { ArrangementTrack } from '../src/analyze/arrange/index.js';
import { analyzeArrangement, tensionCurve } from '../src/analyze/arrange/index.js';
import { detectChord } from '../src/analyze/detect/index.js';
import { romanToChord } from '../src/analyze/functional/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type * as errors from '../src/core/errors/index.js';
import {
  BudgetExceededError,
  InvalidInputError,
  isLibcantusError,
  NoSolutionError,
} from '../src/core/errors/index.js';
import { createNoteEventIndex } from '../src/core/event-index/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateBassLine, placeLicks } from '../src/generate/bass/index.js';
import { generateCounterMelody, imitate } from '../src/generate/countermelody/index.js';
import { generateDrums, placeDrumPattern } from '../src/generate/drums/index.js';
import { ornament } from '../src/generate/ornament/index.js';
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

  it('honours the budget at the entry points the guides send callers to', () => {
    // A caller who hits BUDGET_EXCEEDED is told to raise the entry point's own
    // budget, so every searching entry point has to have one and use it.
    expect(() =>
      generateDrums({ bars: 8, style: 'standard', section: 'verse', budget: 16 }),
    ).toThrow(BudgetExceededError);
    expect(
      generateDrums({ bars: 1, style: 'standard', section: 'verse', budget: 200 }).length,
    ).toBeGreaterThan(0);

    expect(() => placeDrumPattern({ bars: 8, genre: 'funk', budget: 16 })).toThrow(
      BudgetExceededError,
    );
    expect(placeDrumPattern({ bars: 1, genre: 'funk', budget: 100 }).length).toBeGreaterThan(0);

    const segments = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
      { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
    ];
    const key = majorKey(0);
    expect(() => generateBassLine({ segments, key, budget: 1 })).toThrow(BudgetExceededError);
    expect(generateBassLine({ segments, key, budget: 8 }).length).toBeGreaterThan(0);

    expect(() => placeLicks(segments, key, { genre: 'motown', budget: 1 })).toThrow(
      BudgetExceededError,
    );
    expect(placeLicks(segments, key, { genre: 'motown', budget: 8 }).length).toBeGreaterThan(0);
  });

  it('says which chord of a progression could not be voiced', () => {
    // Two voices pinned to C and E: a chord is voiceable here only if its bass
    // is C and it holds E. `Db` is neither, and where it stands in the
    // progression is what the error has to name — a host highlighting the bar
    // reads `at`, and an index off by one points at the wrong bar while the
    // suite reports the error as working.
    const failsAt = (symbols: string[]): NoSolutionError => {
      const error = thrown(() =>
        voiceProgression(
          symbols.map((symbol) => parseChordSymbol(symbol)),
          {
            ranges: [
              { min: 60, max: 60 },
              { min: 64, max: 64 },
            ],
          },
        ),
      );
      if (!(error instanceof NoSolutionError)) {
        throw new Error('expected a NoSolutionError');
      }
      return error;
    };
    const middle = failsAt(['C', 'Db', 'D']);
    expect(middle.at).toBe(1);
    expect(middle.message).toMatch(/Db at index 1/);
    // The two ends, so an index read from the wrong side of the search — the
    // chord it looked ahead to rather than the one it was voicing — cannot pass
    // by landing on a neighbour that happens to be right.
    expect(failsAt(['Db', 'C', 'D']).at).toBe(0);
    expect(failsAt(['C', 'Cmaj7', 'Db']).at).toBe(2);
  });

  it('keeps the built-in error types a caller already catches', () => {
    expect(thrown(() => romanToChord('nonsense', majorKey(0)))).toBeInstanceOf(RangeError);
    expect(thrown(() => detectChord([Number.NaN]))).toBeInstanceOf(RangeError);
    expect(isLibcantusError(new Error('plain'))).toBe(false);
  });

  it('reports a caller mistake at a generate or analyze entry point with a code, never as a built-in', () => {
    // Every one of these is the caller's own argument problem: a missing
    // required option, a reversed span, a name that is not in the vocabulary.
    // A bare TypeError here would leave a host unable to tell "fix your input"
    // from a bug in the library.
    const mistakes: [string, () => unknown][] = [
      [
        'countermelody without a chord source',
        () =>
          generateCounterMelody({
            melody: [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
            key: majorKey(0),
          } as Parameters<typeof generateCounterMelody>[0]),
      ],
      [
        'imitate with a reversed span',
        () =>
          imitate([{ pitch: 60, startBeat: 0, durationBeat: 1 }], {
            atBeat: 4,
            interval: 'P5',
            key: majorKey(0),
            from: 4,
            to: 1,
          }),
      ],
      [
        'ornament with an unknown style',
        () => ornament([{ pitch: 60, startBeat: 0, durationBeat: 1 }], { style: 'nope' as never }),
      ],
      [
        'progression with an unknown style',
        () => generateProgression({ key: majorKey(0), style: 'nope' as never, bars: 1 }),
      ],
      [
        'arrangement analysis of a track without notes',
        () => analyzeArrangement([{ role: 'melody' }] as unknown as ArrangementTrack[]),
      ],
      [
        'tension curve of a track without notes',
        () => tensionCurve([{ role: 'melody' }] as unknown as ArrangementTrack[]),
      ],
    ];
    for (const [what, call] of mistakes) {
      const error = thrown(call);
      expect(isLibcantusError(error), what).toBe(true);
      expect(isLibcantusError(error) && error.code, what).toBe('INVALID_INPUT');
    }
  });

  it('recognizes the coded error contract across a second module copy', async () => {
    // A CommonJS build without shared chunks emits the error classes twice, once
    // for the root entry and once for a subpath. Resetting the registry gives the
    // same two identities here: `instanceof` cannot answer across them, so the
    // structural check is the only thing a host can catch by.
    vi.resetModules();
    const other = (await import('../src/core/errors/index.js')) as typeof errors;
    expect(other.NoSolutionError).not.toBe(NoSolutionError);

    const foreign = thrown(() => {
      throw new other.NoSolutionError('no voicing satisfies the constraints', { at: 2 });
    });
    expect(foreign).not.toBeInstanceOf(NoSolutionError);
    expect(foreign).toBeInstanceOf(other.NoSolutionError);
    expect(isLibcantusError(foreign)).toBe(true);
    expect(isLibcantusError(foreign) && foreign.code).toBe('NO_SOLUTION');
    expect(isLibcantusError(foreign) && foreign.code === 'NO_SOLUTION' && foreign.at).toBe(2);

    // The check stays a structural one in both directions: this copy's error is
    // recognized by the other copy's predicate too.
    const mine = new NoSolutionError('no voicing satisfies the constraints');
    expect(mine).not.toBeInstanceOf(other.NoSolutionError);
    expect(other.isLibcantusError(mine)).toBe(true);
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
