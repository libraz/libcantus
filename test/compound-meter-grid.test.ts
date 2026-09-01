import { describe, expect, it } from 'vitest';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { metricGridUnit, metricWeight, pulseBeats } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { majorKey } from '../src/theory/scale/index.js';

/** Build a block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat: number): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/** The `[startBeat, endBeat]` pair of every segment, for boundary assertions. */
function bounds(segments: { startBeat: number; endBeat: number }[]): number[][] {
  return segments.map((segment) => [segment.startBeat, segment.endBeat]);
}

const C_MAJOR = majorKey(0);

/** C, F, C, G — one triad per pulse, so every change falls on a felt beat. */
function pulsePerChord(pulse: number, count: number): NoteEvent[] {
  const triads = [
    [60, 64, 67], // C
    [60, 65, 69], // F
    [60, 64, 67], // C
    [59, 62, 67], // G
  ];
  const notes: NoteEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    notes.push(...blockChord(triads[i % triads.length] ?? [], i * pulse, pulse));
  }
  return notes;
}

describe('the metric grid a meter states', () => {
  it('steps by one main pulse, whatever the pulse is', () => {
    for (const ts of ['4/4', '3/4', '6/8', '9/8', '12/8', '2+2+3/8']) {
      expect(metricGridUnit(ts), ts).toBe(pulseBeats(ts));
    }
  });

  it('steps by a whole division of every signature a map names', () => {
    const changes = [
      { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
      { startBeat: 8, ts: { numerator: 6, denominator: 8 } },
    ];
    // A quarter and a dotted quarter share a half-beat step, and nothing longer.
    expect(metricGridUnit(changes)).toBe(0.5);
  });
});

describe('chord segmentation in compound meters', () => {
  it('finds a chord change on every pulse of a 6/8 bar', () => {
    // C F C G, one triad per dotted-quarter pulse over two 6/8 bars. Two of the
    // changes are inside a bar, and a grid counted in quarters would step over
    // all four.
    const result = chordTimelineFromNotes(pulsePerChord(1.5, 4), { key: C_MAJOR, ts: '6/8' });
    expect(bounds(result.timeline.segments)).toEqual([
      [0, 1.5],
      [1.5, 3],
      [3, 4.5],
      [4.5, 6],
    ]);
    expect(result.timeline.segments.map((segment) => segment.chord.rootPc)).toEqual([0, 5, 0, 7]);
    for (const confidence of result.segmentConfidence) {
      expect(confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it.each([
    ['9/8', 1.5, 6],
    ['12/8', 1.5, 8],
    ['6/4', 3, 4],
  ])('finds a chord change on every pulse of %s', (ts, pulse, count) => {
    const result = chordTimelineFromNotes(pulsePerChord(pulse, count), {
      key: C_MAJOR,
      ts,
      // The prior is the harmonic rhythm the material actually has, so what is
      // under test is where a boundary may fall rather than how much evidence
      // moving one takes.
      harmonicRhythm: pulse,
    });
    expect(bounds(result.timeline.segments)).toEqual(
      Array.from({ length: count }, (_, i) => [i * pulse, (i + 1) * pulse]),
    );
    for (const confidence of result.segmentConfidence) {
      expect(confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it.each([['12/8', 6]])('finds an in-bar change of %s under the default prior', (ts, barBeats) => {
    // Two chords to the bar, so every change but the first is inside a bar the
    // default expects to hold one chord. A grid counted in quarters reports the
    // whole span as one segment naming a chord that never sounded.
    const half = barBeats / 2;
    const result = chordTimelineFromNotes(pulsePerChord(half, 4), { key: C_MAJOR, ts });
    expect(bounds(result.timeline.segments)).toEqual([
      [0, half],
      [half, barBeats],
      [barBeats, barBeats + half],
      [barBeats + half, barBeats * 2],
    ]);
    for (const confidence of result.segmentConfidence) {
      expect(confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('puts every pulse of the span on the grid at every resolution', () => {
    // The invariant behind the segmentation: a boundary can only be reported
    // where a slot ends, so a pulse that is not a slot boundary is a change the
    // search cannot see however much evidence there is for it.
    for (const ts of ['4/4', '3/4', '6/8', '9/8', '12/8']) {
      const pulse = pulseBeats(ts);
      const notes = pulsePerChord(pulse, 4);
      let coarse: number[][] | undefined;
      for (const minChordBeats of [undefined, 0.25, 0.5, 0.6, 1, 1.5, 2, 4]) {
        const result = chordTimelineFromNotes(notes, {
          key: C_MAJOR,
          ts,
          // The prior is the harmonic rhythm the material has, so a change is
          // missed only where the grid has no boundary to report it at.
          harmonicRhythm: pulse,
          ...(minChordBeats === undefined ? {} : { minChordBeats }),
        });
        const at = `${ts} minChordBeats=${minChordBeats}`;
        for (const segment of result.timeline.segments) {
          for (const beat of [segment.startBeat, segment.endBeat]) {
            const pulses = beat / pulse;
            expect(Math.abs(pulses - Math.round(pulses)), `${at} at ${beat}`).toBeLessThan(1e-9);
          }
        }
        // The resolution decides where a boundary may fall and nothing else, so
        // every setting reads the same changes the default read.
        coarse ??= bounds(result.timeline.segments);
        expect(bounds(result.timeline.segments), at).toEqual(coarse);
      }
    }
  });

  it('reads a compound bar as one chord when the harmony does not change', () => {
    // The finer grid is a resolution, not a sensitivity: a bar of one chord is
    // still one segment.
    const notes = [...blockChord([60, 64, 67], 0, 3), ...blockChord([59, 62, 65, 67], 3, 3)];
    const result = chordTimelineFromNotes(notes, { key: C_MAJOR, ts: '6/8' });
    expect(bounds(result.timeline.segments)).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });
});

describe('4/4 segmentation is what it was', () => {
  it('reports the default 4/4 grid at one quarter', () => {
    expect(metricGridUnit('4/4')).toBe(1);
  });

  it('splits a bar holding two chords and holds a bar that holds one', () => {
    const twoChords = [...blockChord([60, 64, 67], 0, 2), ...blockChord([55, 59, 62, 65], 2, 2)];
    expect(bounds(chordTimelineFromNotes(twoChords, { key: C_MAJOR }).timeline.segments)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    const oneChord = [...blockChord([60, 64, 67], 0, 4), ...blockChord([72, 74, 76, 77], 0, 4)];
    expect(chordTimelineFromNotes(oneChord, { key: C_MAJOR }).timeline.segments).toHaveLength(1);
  });

  it('weighs the pulses of a compound bar where the grid steps', () => {
    // The weights the search discounts by and the grid it steps on come from the
    // same reading of the meter: every grid step is a weighted position.
    for (const ts of ['4/4', '3/4', '6/8', '12/8']) {
      const unit = metricGridUnit(ts);
      for (let step = 0; step < 8; step += 1) {
        expect(metricWeight(step * unit, ts), `${ts} step ${step}`).toBeGreaterThan(0);
      }
    }
  });
});
