import { describe, expect, it } from 'vitest';
import { type NoteEvent, Score } from '../src/index.js';

/**
 * The timed and physical classes answer everything their functional
 * counterparts answer. Each case here holds a method against the function it
 * delegates to on the same input, passes an option through it, and names the
 * input it refuses, so a method that quietly stops delegating — or stops
 * offering an option — is caught rather than merely being present.
 */

/** A phrase of tonic, dominant, tonic, long enough to close on a cadence. */
const CADENTIAL: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 2, velocity: 96 },
  { pitch: 64, startBeat: 2, durationBeat: 2, velocity: 80 },
  { pitch: 67, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 71, startBeat: 6, durationBeat: 2, velocity: 72 },
  { pitch: 62, startBeat: 8, durationBeat: 4, velocity: 90 },
  { pitch: 60, startBeat: 12, durationBeat: 4, velocity: 100 },
];

describe('Score.voiceNotes', () => {
  it('ids the notes in the score own time order', () => {
    // The score holds its notes in time order whatever order they arrived in,
    // so the id a voice note carries points at the note the analysis names.
    const score = Score.of([...CADENTIAL].reverse());
    expect(score.voiceNotes().map((note) => note.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(score.voiceNotes().map((note) => note.startBeat)).toEqual([0, 2, 4, 6, 8, 12]);
    expect(score.voiceNotes()).not.toBe(score.voiceNotes());
  });
});
