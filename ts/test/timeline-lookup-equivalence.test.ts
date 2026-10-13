import { describe, expect, it } from 'vitest';
import type { ArrangementTrack } from '../src/analyze/arrange/index.js';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import type { ChordSegment } from '../src/analyze/timeline/index.js';
import { chordTimelineFromChords, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Arrangement } from '../src/model/arrangement.js';
import { Timeline } from '../src/model/timeline.js';
import type { ChordSpan } from '../src/theory/chord/index.js';

/**
 * "The chord sounding at this beat" is asked of a timeline through a function
 * and through a class, and the two must answer alike. The comparison is swept
 * over every boundary the segments have rather than over a handful of beats,
 * because a boundary is the one place two half-open searches can disagree by a
 * whole segment while agreeing everywhere else.
 */

/** `I - IV - V7 - I`, one chord per bar. */
const SPANS: readonly ChordSpan[] = [
  { rootPc: 0, quality: 'maj', startBeat: 0 },
  { rootPc: 5, quality: 'maj', startBeat: 4 },
  { rootPc: 7, quality: 'dom7', startBeat: 8 },
  { rootPc: 0, quality: 'maj', startBeat: 12 },
];

const TOTAL_BEATS = 16;

/** The same progression played as block chords, for the inferred path. */
const NOTES: readonly NoteEvent[] = [
  [60, 64, 67],
  [65, 69, 72],
  [67, 71, 74, 77],
  [60, 64, 67],
].flatMap((pitches, bar) =>
  pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
);

/** How far either side of an edge the sweep looks, in beats. */
const NUDGE = 1 / 64;

/** Every beat two lookups could part company on, in ascending order. */
function probeBeats(segments: readonly ChordSegment[]): number[] {
  // Outside the whole span at both ends, where the answer is null and a search
  // that ran off its array would say otherwise.
  const beats = new Set<number>([-1, TOTAL_BEATS + 1]);
  for (const segment of segments) {
    for (const edge of [segment.startBeat, segment.endBeat]) {
      beats.add(edge - NUDGE);
      beats.add(edge);
      beats.add(edge + NUDGE);
    }
    beats.add((segment.startBeat + segment.endBeat) / 2);
  }
  return [...beats].sort((a, b) => a - b);
}

describe('the chord sounding at a beat', () => {
  it('answers alike for placed chords, at every edge and in between', () => {
    const lookup = chordTimelineFromChords(SPANS, TOTAL_BEATS);
    const timeline = Timeline.fromChords(SPANS, TOTAL_BEATS);
    const probes = probeBeats(lookup.segments);
    // The sweep is worth reading only if it covers more than the onsets.
    expect(probes.length).toBeGreaterThan(SPANS.length);
    for (const beat of probes) {
      expect(timeline.at(beat)?.toJSON() ?? null, `beat ${beat}`).toEqual(lookup.at(beat));
      expect(timeline.chordTimeline.at(beat), `beat ${beat}`).toEqual(lookup.at(beat));
    }
  });

  it('answers alike for a timeline inferred from notes', () => {
    const { timeline: lookup } = chordTimelineFromNotes(NOTES);
    const timeline = Timeline.fromNotes(NOTES);
    // A sweep over one segment would find every edge of the timeline on the
    // same chord, which is the one shape that proves nothing.
    expect(lookup.segments.length).toBeGreaterThan(1);
    for (const beat of probeBeats(lookup.segments)) {
      expect(timeline.at(beat)?.toJSON() ?? null, `beat ${beat}`).toEqual(lookup.at(beat));
    }
  });

  it('answers alike whether an arrangement is read as a class or as a function', () => {
    // `Arrangement.analysis` drops the lookup the analysis built and rebuilds
    // one from its own timeline, which is exactly where the two could drift.
    const tracks: ArrangementTrack[] = [{ name: 'piano', notes: [...NOTES] }];
    const analysis = analyzeArrangement(tracks, { key: 'C major' });
    const classSide = Arrangement.of(tracks, { key: 'C major' }).analysis.timeline;
    expect(classSide.segments).toEqual(analysis.timeline.segments);
    expect(analysis.timeline.segments.length).toBeGreaterThan(1);
    for (const beat of probeBeats(analysis.timeline.segments)) {
      expect(classSide.at(beat), `beat ${beat}`).toEqual(analysis.timeline.at(beat));
    }
  });
});
