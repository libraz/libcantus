import { chordTimelineFromNotes } from '@libraz/libcantus/analyze';
import type { NoteEvent } from '@libraz/libcantus/core';
import { describe, expect, it } from 'vitest';

/** Short chord stabs on the given beats, each a sixteenth long. */
function stabs(pitches: number[], beats: number[]): NoteEvent[] {
  return beats.flatMap((startBeat) =>
    pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 0.25 })),
  );
}

/** A bass note held through one whole bar. */
function held(pitch: number, bar: number): NoteEvent {
  return { pitch, startBeat: bar * 4, durationBeat: 4 };
}

/** Root and quality of every segment, in order. */
function readings(notes: NoteEvent[]): string[] {
  return chordTimelineFromNotes(notes).timeline.segments.map(
    (segment) => `${segment.chord.rootPc}:${segment.chord.quality}`,
  );
}

describe('a held bass does not hide the chord struck above it', () => {
  it('reads the triad of short stabs over a whole-note bass', () => {
    expect(readings([held(36, 0), ...stabs([60, 64, 67], [1, 3])])).toEqual(['0:maj']);
  });

  it('reads a progression of stabs over a moving whole-note bass', () => {
    const notes = [
      held(36, 0),
      ...stabs([60, 64, 67], [1, 3]),
      held(41, 1),
      ...stabs([60, 65, 69], [5, 7]),
      held(43, 2),
      ...stabs([62, 67, 71], [9, 11]),
      held(36, 3),
      ...stabs([60, 64, 67], [13, 15]),
    ];
    expect(readings(notes)).toEqual(['0:maj', '5:maj', '7:maj', '0:maj']);
  });

  it('keeps the segment when a sounding pitch class is doubled underneath', () => {
    const upper = stabs([60, 64, 67], [0, 2]);
    expect(readings(upper)).toEqual(['0:maj']);
    expect(readings([...upper, held(36, 0)])).toEqual(['0:maj']);
    expect(readings([...upper, held(36, 0), held(24, 0)])).toEqual(['0:maj']);
  });

  it('keeps the segment when the bass is held for only half the bar', () => {
    const notes = [{ pitch: 36, startBeat: 0, durationBeat: 2 }, ...stabs([60, 64, 67], [0, 2])];
    expect(readings(notes)).toEqual(['0:maj']);
  });
});
