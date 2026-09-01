import { describe, expect, it, vi } from 'vitest';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Score } from '../src/model/score.js';

/**
 * What a score does with the readings it makes: the expensive ones are made
 * once per score, and the key it names is read from the same weighting whether
 * it is asked as a ranking or as a chord timeline.
 */

vi.mock('../src/analyze/timeline/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/analyze/timeline/index.js')>();
  return { ...actual, chordTimelineFromNotes: vi.fn(actual.chordTimelineFromNotes) };
});

/** Two bars of a cadence, enough for phrases and voices to have something to read. */
const CADENTIAL: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 2 },
  { pitch: 64, startBeat: 0, durationBeat: 2 },
  { pitch: 67, startBeat: 0, durationBeat: 2 },
  { pitch: 65, startBeat: 2, durationBeat: 2 },
  { pitch: 69, startBeat: 2, durationBeat: 2 },
  { pitch: 72, startBeat: 2, durationBeat: 2 },
  { pitch: 67, startBeat: 4, durationBeat: 2 },
  { pitch: 71, startBeat: 4, durationBeat: 2 },
  { pitch: 74, startBeat: 4, durationBeat: 2 },
  { pitch: 60, startBeat: 6, durationBeat: 2 },
  { pitch: 64, startBeat: 6, durationBeat: 2 },
  { pitch: 67, startBeat: 6, durationBeat: 2 },
];

/** The same music with velocity recorded for one part and not the other. */
const MIXED_VELOCITY: NoteEvent[] = CADENTIAL.map((note, index) =>
  index % 3 === 0 ? { ...note, velocity: 96 } : note,
);

describe('reading a score once', () => {
  it('infers the chords once across the analyses that read them', () => {
    const inference = vi.mocked(chordTimelineFromNotes);
    inference.mockClear();
    const score = Score.of(CADENTIAL);
    score.phrases();
    score.structuralCadences();
    score.voices();
    expect(inference).toHaveBeenCalledTimes(1);
    // A member that takes its own options is a different question each time, so
    // it is answered afresh rather than from the kept reading.
    score.timeline();
    expect(inference).toHaveBeenCalledTimes(2);
    // And the kept reading belongs to the score that made it.
    inference.mockClear();
    Score.of(CADENTIAL).phrases();
    expect(inference).toHaveBeenCalledTimes(1);
  });
});

describe('weighing the notes', () => {
  it('names the same key from the ranking and from the chord timeline', () => {
    const score = Score.of(MIXED_VELOCITY);
    const ranked = score.detectKeys()[0]?.key;
    const prevailing = score.timeline().key;
    expect(ranked).toBeDefined();
    expect(prevailing).toBeDefined();
    expect(prevailing === undefined ? undefined : ranked?.equals(prevailing)).toBe(true);
  });

  it('counts a note carrying no velocity at full weight', () => {
    const silent = Score.of(CADENTIAL).detectKeys();
    const loud = Score.of(CADENTIAL.map((note) => ({ ...note, velocity: 127 }))).detectKeys();
    expect(silent.map((match) => match.score)).toEqual(loud.map((match) => match.score));
  });
});
