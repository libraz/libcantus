import { describe, expect, it } from 'vitest';
import type { ChordTimelineResult } from '../src/analyze/timeline/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { majorKey } from '../src/theory/scale/index.js';

/** Build a block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat = 4): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/** Build a melodic run: one note per pitch, back to back from `startBeat`. */
function run(pitches: number[], startBeat: number, durationBeat: number): NoteEvent[] {
  return pitches.map((pitch, i) => ({
    pitch,
    startBeat: startBeat + i * durationBeat,
    durationBeat,
  }));
}

/** The `[startBeat, endBeat]` pair of every segment, for boundary assertions. */
function bounds(result: ChordTimelineResult): number[][] {
  return result.timeline.segments.map((seg) => [seg.startBeat, seg.endBeat]);
}

/** The root pitch class of every segment, in time order. */
function roots(result: ChordTimelineResult): number[] {
  return result.timeline.segments.map((seg) => seg.chord.rootPc);
}

const C_MAJOR = majorKey(0);

describe('chordTimelineFromNotes dynamic segmentation', () => {
  it('splits a bar that holds two chords into two segments', () => {
    // C major over the first half of the bar, G7 over the second: the change is
    // unambiguous, and it falls in the middle of one harmonic-rhythm window.
    const notes = [
      ...blockChord([60, 64, 67], 0, 2), // C E G
      ...blockChord([55, 59, 62, 65], 2, 2), // G B D F
    ];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(bounds(result)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(roots(result)).toEqual([0, 7]);
    expect(result.timeline.segments[0]?.chord.quality).toBe('maj');
    expect(result.timeline.segments[1]?.chord.quality).toBe('dom7');
  });

  it('reports the same two-chord bar as one segment under grid segmentation', () => {
    // The fixed grid cuts one window per harmonic rhythm, so a bar-long window
    // averages the two chords into a single segment. Both sides are pinned so
    // neither the dynamic default nor the grid fallback drifts.
    const notes = [...blockChord([60, 64, 67], 0, 2), ...blockChord([55, 59, 62, 65], 2, 2)];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR, segmentation: 'grid' });
    expect(result.timeline.segments).toHaveLength(1);
    expect(bounds(result)).toEqual([[0, 4]]);
  });

  it('holds one chord across an arpeggiation instead of one per note', () => {
    // Two bars of broken-chord eighths. Every note is a chord tone of the bar it
    // sits in, so the only harmonic event is the bar line at beat 4.
    const notes = [
      ...run([60, 64, 67, 72, 64, 67, 64, 60], 0, 0.5), // C E G C E G E C
      ...run([53, 57, 60, 65, 57, 60, 57, 53], 4, 0.5), // F A C F A C A F
    ];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(bounds(result)).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(roots(result)).toEqual([0, 5]);
  });

  it('does not split a sustained chord for a passing tone', () => {
    // C major held for the bar under a C-D-E-F melody. D and F are non-chord
    // tones on beats 2 and 4, but neither establishes a chord of its own.
    const notes = [...blockChord([60, 64, 67], 0, 4), ...run([72, 74, 76, 77], 0, 1)];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(bounds(result)).toEqual([[0, 4]]);
    expect(roots(result)).toEqual([0]);
  });

  it('places an ambiguous boundary on the strong beat rather than a beat early', () => {
    // C major on beat 0, a bare G sustained over beats 1 and 2, then G7 on beat
    // 3. The sustained G belongs to both chords, so those two beats are
    // genuinely ambiguous, and a lone G fits a G chord better than it fits an
    // incomplete C: note fit alone would put the change on beat 1. Landing it on
    // beat 2, the bar's secondary accent, can only come from the metric
    // preference built into the change cost.
    const notes = [
      ...blockChord([60, 64, 67], 0, 1), // C E G
      { pitch: 55, startBeat: 1, durationBeat: 2 }, // G, common to both chords
      ...blockChord([55, 59, 62, 65], 3, 1), // G B D F
    ];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR, harmonicRhythm: 3 });
    expect(bounds(result)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(roots(result)).toEqual([0, 7]);

    // The same notes and the same prior read in 3/4: the strongest position in
    // the ambiguous span is now the bar line at beat 3, and the boundary follows
    // it there.
    const inThreeFour = chordTimelineFromNotes(notes, {
      key: C_MAJOR,
      harmonicRhythm: 3,
      ts: parseTimeSignature('3/4'),
    });
    expect(bounds(inThreeFour)).toEqual([
      [0, 3],
      [3, 4],
    ]);
    expect(roots(inThreeFour)).toEqual([0, 7]);
  });

  it('resolves an off-beat change only as finely as minChordBeats allows', () => {
    // The real change is at beat 1.5. At the default one-beat resolution the
    // search can only report a whole beat, so it must round to one of the two
    // beats bracketing the change; at a half-beat resolution it must find it.
    const notes = [...blockChord([60, 64, 67], 0, 1.5), ...blockChord([55, 59, 62, 65], 1.5, 2.5)];
    const coarse = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(coarse.timeline.segments).toHaveLength(2);
    const coarseBoundary = coarse.timeline.segments[1]?.startBeat ?? Number.NaN;
    expect(Number.isInteger(coarseBoundary)).toBe(true);
    expect([1, 2]).toContain(coarseBoundary);
    expect(roots(coarse)).toEqual([0, 7]);

    const fine = chordTimelineFromNotes(notes, { key: C_MAJOR, minChordBeats: 0.5 });
    expect(bounds(fine)).toEqual([
      [0, 1.5],
      [1.5, 4],
    ]);
    expect(roots(fine)).toEqual([0, 7]);
  });

  it('absorbs a rest shorter than one expected chord', () => {
    // C major, a half-beat breath, then C major again. The players stopped; the
    // harmony did not, so the whole bar is one chord.
    const notes = [...blockChord([60, 64, 67], 0, 1.5), ...blockChord([60, 64, 67], 2, 2)];
    const result = chordTimelineFromNotes(notes, {
      key: C_MAJOR,
      harmonicRhythm: 4,
      // Half-beat slots, so the breath really occupies a silent slot of its own
      // rather than hiding inside a slot the chord also sounds in.
      minChordBeats: 0.5,
    });
    expect(bounds(result)).toEqual([[0, 4]]);
    expect(roots(result)).toEqual([0]);
  });

  it('ends a chord at a rest as long as one expected chord', () => {
    // A bar of C, a bar of silence, a bar of C. Nothing sounds across the middle
    // bar, so nothing may be merged across it either.
    const notes = [...blockChord([60, 64, 67], 0, 4), ...blockChord([60, 64, 67], 8, 4)];
    const result = chordTimelineFromNotes(notes, {
      key: C_MAJOR,
      harmonicRhythm: 4,
      totalBeats: 12,
    });
    expect(bounds(result)).toEqual([
      [0, 4],
      [8, 12],
    ]);
    expect(result.timeline.at(6)).toBeNull();
  });

  it('reads the same boundaries however fine the resolution is', () => {
    // minChordBeats decides where a boundary *may* fall, not how much evidence
    // placing one takes. Every change here is on a whole beat, so asking for
    // quarter-beat slots must find the same segmentation rather than a
    // more — or less — eager one.
    const notes = [
      ...blockChord([60, 64, 67], 0, 2),
      ...blockChord([55, 59, 62, 65], 2, 2),
      ...blockChord([53, 57, 60], 4, 4),
    ];
    const coarse = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(bounds(coarse)).toEqual([
      [0, 2],
      [2, 4],
      [4, 8],
    ]);
    for (const minChordBeats of [0.5, 0.25]) {
      const fine = chordTimelineFromNotes(notes, { key: C_MAJOR, minChordBeats });
      expect(bounds(fine)).toEqual(bounds(coarse));
      expect(roots(fine)).toEqual(roots(coarse));
    }
  });

  it('needs more evidence to change when a longer chord is expected', () => {
    // harmonicRhythm is a prior, not a window: raising it past the span makes
    // the same notes read as one slow harmony rather than two chords.
    const notes = [...blockChord([60, 64, 67], 0, 2), ...blockChord([55, 59, 62, 65], 2, 2)];
    expect(bounds(chordTimelineFromNotes(notes, { key: C_MAJOR, harmonicRhythm: 2 }))).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(
      chordTimelineFromNotes(notes, { key: C_MAJOR, harmonicRhythm: 32 }).timeline.segments,
    ).toHaveLength(1);
  });

  it('returns the same segmentation for the same input every time', () => {
    const notes = [
      ...blockChord([60, 64, 67], 0, 2),
      ...blockChord([55, 59, 62, 65], 2, 2),
      ...run([53, 57, 60, 65, 57, 60, 57, 53], 4, 0.5),
      ...blockChord([48, 52, 55], 8, 4),
    ];
    const first = chordTimelineFromNotes(notes, { key: C_MAJOR });
    const second = chordTimelineFromNotes(notes, { key: C_MAJOR });
    expect(second.timeline.segments).toEqual(first.timeline.segments);
    expect(second.segmentConfidence).toEqual(first.segmentConfidence);
  });

  it('throws on a non-positive minChordBeats', () => {
    const notes = blockChord([60, 64, 67], 0, 4);
    expect(() => chordTimelineFromNotes(notes, { minChordBeats: 0 })).toThrow();
    expect(() => chordTimelineFromNotes(notes, { minChordBeats: -1 })).toThrow();
  });
});

describe('chordTimelineFromNotes dynamic segmentation on degenerate input', () => {
  const cases: { name: string; notes: NoteEvent[] }[] = [
    { name: 'a single sustained note', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] },
    { name: 'two notes a semitone apart', notes: blockChord([60, 61], 0, 4) },
    {
      name: 'a full chromatic cluster',
      notes: blockChord([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71], 0, 4),
    },
    { name: 'one note repeated', notes: run([60, 60, 60, 60], 0, 1) },
  ];

  for (const { name, notes } of cases) {
    it(`yields well-formed, non-overlapping segments for ${name}`, () => {
      // Downstream generators reject a zero-length or overlapping segment, so
      // input that barely implies a chord must still produce a clean timeline.
      const result = chordTimelineFromNotes(notes, { key: C_MAJOR });
      expect(result.segmentConfidence).toHaveLength(result.timeline.segments.length);
      let previousEnd = Number.NEGATIVE_INFINITY;
      for (const segment of result.timeline.segments) {
        expect(Number.isFinite(segment.startBeat)).toBe(true);
        expect(Number.isFinite(segment.endBeat)).toBe(true);
        expect(segment.endBeat).toBeGreaterThan(segment.startBeat);
        expect(segment.startBeat).toBeGreaterThanOrEqual(previousEnd);
        previousEnd = segment.endBeat;
      }
      for (const confidence of result.segmentConfidence) {
        expect(Number.isFinite(confidence)).toBe(true);
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    });
  }
});
