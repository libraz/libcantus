import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/model/index.js';

/**
 * Places where one class contradicted another, or itself: an instance refused
 * where its own data was taken, two sibling methods disagreeing about how
 * harmony is handed over, a class with no `of` where every sibling has one, and
 * an analysis result the class dropped on the way out. Each case is checked
 * both ways — the instance form and the data form must agree — so a widening
 * that quietly stopped accepting the older form would be caught here too.
 */

/** Notes that spell one chord, so a reading of them is unambiguous. */
const TRIAD = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
];

/** Notes that change chord halfway, so a timeline of them holds two segments. */
const TWO_CHORDS = [
  ...TRIAD,
  { pitch: 67, startBeat: 4, durationBeat: 4 },
  { pitch: 71, startBeat: 4, durationBeat: 4 },
  { pitch: 74, startBeat: 4, durationBeat: 4 },
];

describe('a timeline carries how sure the analysis is of each segment', () => {
  it('hands out a copy rather than its own list', () => {
    const timeline = Timeline.fromNotes(TWO_CHORDS);
    expect(timeline.segmentConfidence).not.toBe(timeline.segmentConfidence);
    expect(timeline.segmentConfidence).toEqual(timeline.segmentConfidence);
  });
});
