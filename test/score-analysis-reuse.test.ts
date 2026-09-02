import { describe, expect, it, vi } from 'vitest';
import { keyTimelineFromNotes } from '../src/analyze/keys/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Score } from '../src/model/score.js';

/**
 * What a score does with the readings it makes: the expensive ones are made
 * once per score, and the key it names is read from the same weighting whether
 * it is asked as a ranking or as a chord timeline.
 */

vi.mock('../src/analyze/keys/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/analyze/keys/index.js')>();
  return { ...actual, keyTimelineFromNotes: vi.fn(actual.keyTimelineFromNotes) };
});

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
    // Asked without options, the public timeline is the score's own question
    // and reads the same answer: the documented order — timeline, phrases,
    // keys, key — is what the kept reading exists for, and it used to infer the
    // harmony afresh for two of those members.
    score.timeline();
    score.timeline();
    expect(inference).toHaveBeenCalledTimes(1);
    // Options name a different question, so it is answered afresh — and the
    // answer does not become the one the score keeps.
    score.timeline({ harmonicRhythm: 1 });
    expect(inference).toHaveBeenCalledTimes(2);
    score.phrases();
    expect(inference).toHaveBeenCalledTimes(2);
    // And the kept reading belongs to the score that made it.
    inference.mockClear();
    Score.of(CADENTIAL).phrases();
    expect(inference).toHaveBeenCalledTimes(1);
  });

  it('searches for the key regions once across the members that read them', () => {
    const search = vi.mocked(keyTimelineFromNotes);
    search.mockClear();
    const score = Score.of(CADENTIAL);
    score.keys();
    score.keys();
    score.key();
    expect(search).toHaveBeenCalledTimes(1);
    // Options are a question of their own here too.
    score.keys({ minKeyBeats: 2 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('hands out regions a caller can write to without changing the score', () => {
    const score = Score.of(CADENTIAL);
    const first = score.keys();
    const region = first[0];
    expect(region).toBeDefined();
    if (region !== undefined) {
      region.startBeat = -999;
      region.confidence = 0;
    }
    expect(score.keys()[0]?.startBeat).not.toBe(-999);
    expect(score.keys()[0]?.confidence).not.toBe(0);
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
