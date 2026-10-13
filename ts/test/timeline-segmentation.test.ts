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

  it('finds the same chords at every resolution, dividing the expected chord or not', () => {
    // C and G7 alternating every two beats, six chords over three bars. The
    // resolution decides where a boundary may fall and nothing else, so every
    // setting must find all six — including the ones that do not divide the
    // four-beat expected chord, which used to step over the beats a change is
    // discounted on and report two segments naming a chord that never sounded.
    const notes: NoteEvent[] = [];
    for (let i = 0; i < 6; i += 1) {
      notes.push(
        ...(i % 2 === 0
          ? blockChord([60, 64, 67], i * 2, 2) // C E G
          : blockChord([55, 59, 62, 65], i * 2, 2)), // G B D F
      );
    }
    const changes = [0, 2, 4, 6, 8, 10];
    for (const minChordBeats of [
      0.25,
      0.4,
      0.5,
      0.6,
      0.75,
      0.8,
      0.9,
      1,
      1.2,
      1.25,
      4 / 3,
      1.5,
      2,
    ]) {
      const at = `minChordBeats=${minChordBeats}`;
      const result = chordTimelineFromNotes(notes, { key: C_MAJOR, minChordBeats });
      expect(roots(result), at).toEqual([0, 7, 0, 7, 0, 7]);
      expect(
        result.timeline.segments.map((segment) => segment.chord.quality),
        at,
      ).toEqual(['maj', 'dom7', 'maj', 'dom7', 'maj', 'dom7']);
      // Each boundary lands within the resolution that was asked for, which is
      // as close to the change as a grid of that size can put it.
      result.timeline.segments.forEach((segment, i) => {
        expect(
          Math.abs(segment.startBeat - (changes[i] ?? 0)),
          `${at} segment ${i}`,
        ).toBeLessThanOrEqual(minChordBeats + 1e-9);
      });
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

describe('chordTimelineFromNotes exact output', () => {
  /** A reproducible eight-bar piece: block sevenths under a random line. */
  function pseudoPiece(bars: number, seed: number): NoteEvent[] {
    let state = seed >>> 0;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const notes: NoteEvent[] = [];
    const degrees = [0, 5, 7, 9, 2, 4, 5, 7];
    for (let bar = 0; bar < bars; bar += 1) {
      const root = 48 + (degrees[bar % degrees.length] ?? 0);
      notes.push(...blockChord([root, root + 4, root + 7, root + 11], bar * 4));
      for (let eighth = 0; eighth < 8; eighth += 1) {
        notes.push({
          pitch: root + 24 + Math.floor(rand() * 12),
          startBeat: bar * 4 + eighth * 0.5,
          durationBeat: 0.5,
        });
      }
    }
    return notes;
  }

  it('places the same boundaries and reports the same confidences', () => {
    // The boundary search weighs every slot against every chord in its lexicon
    // and settles the run by shortest path, so a change in how the cost table is
    // held — or in which candidate a tie hands the run to — moves a boundary
    // without breaking any of the qualitative expectations above. This pins the
    // numbers themselves on a piece long enough for the search to have room.
    const result = chordTimelineFromNotes(pseudoPiece(8, 12345), {
      key: C_MAJOR,
      minChordBeats: 0.5,
    });
    expect(bounds(result)).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 16],
      [16, 20],
      [20, 24],
      [24, 28],
      [28, 32],
    ]);
    expect(roots(result)).toEqual([0, 5, 7, 9, 2, 4, 5, 7]);
    for (const segment of result.timeline.segments) {
      expect(segment.chord.quality).toBe('maj7');
    }
    expect(result.segmentConfidence).toEqual([
      0.9147982062780268, 0.9417040358744395, 0.968609865470852, 0.8744394618834082,
      0.8968609865470851, 0.9417040358744395, 0.7318385650224214, 0.8968609865470853,
    ]);
  });
});

describe('a note that weighs nothing', () => {
  it('does not become the bass of the window it sounds in', () => {
    // A velocity of zero is a note event this library accepts — a note-off
    // written as one, a muted ghost layer — and it weighs nothing in the
    // histogram. Taken as the window's lowest note all the same, it named a
    // pitch class the histogram had never counted, so the reading found no bass
    // among the pitches it selected and dropped the inversion with it.
    const firstInversion = blockChord([64, 67, 72], 0, 4);
    const silent: NoteEvent = { pitch: 60, startBeat: 0, durationBeat: 4, velocity: 0 };
    const read = (notes: NoteEvent[]) =>
      chordTimelineFromNotes(notes, { key: C_MAJOR }).timeline.segments[0]?.chord;
    const plain = read(firstInversion);
    expect(plain?.bassPc).toBe(4);
    expect(read([silent, ...firstInversion])).toEqual(plain);
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
