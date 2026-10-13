import { describe, expect, it } from 'vitest';
import { chordAtBeat, segmentStartingAt } from '../src/analyze/timeline/index.js';
import { makeChord } from '../src/theory/chord/index.js';

describe('the two questions a timeline is asked at a beat', () => {
  const segments = [
    { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
    { startBeat: 4, endBeat: 6, chord: makeChord(5, 'maj') },
    { startBeat: 6, endBeat: 12, chord: makeChord(7, 'dom7') },
  ];

  it('tells what is sounding from what arrives', () => {
    // One search answers both: what covers a beat, and what begins on it. The
    // phrase reader asks the second once per cadence to find how long an
    // arrival holds, and a scan of the segments made that the square of a piece
    // whose every chord change cadences — a ii-V-I loop, which is what the
    // generators write.
    expect(chordAtBeat(segments, 5)?.rootPc).toBe(5);
    expect(segmentStartingAt(segments, 5)).toBeUndefined();
    expect(segmentStartingAt(segments, 4)?.endBeat).toBe(6);
    expect(segmentStartingAt(segments, 0)?.endBeat).toBe(4);
    expect(segmentStartingAt(segments, 12)).toBeUndefined();
    expect(segmentStartingAt([], 0)).toBeUndefined();
  });

  it('reads a beat named a hair off the boundary as the boundary', () => {
    // Beats arrive from a performance as well as from a grid, and the arrival
    // of a cadence is the beat a chord starts on however it was written down.
    expect(segmentStartingAt(segments, 4 + 1e-12)?.endBeat).toBe(6);
    expect(segmentStartingAt(segments, 4 - 1e-12)?.endBeat).toBe(6);
    expect(segmentStartingAt(segments, 4.5)).toBeUndefined();
  });
});
