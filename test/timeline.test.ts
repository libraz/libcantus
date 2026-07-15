import { describe, expect, it } from 'vitest';
import {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { MAJOR_MASK, majorKey, minorKey } from '../src/theory/scale/index.js';

/** Build a block chord: every pitch sounding for the same span. */
function blockChord(pitches: number[], startBeat: number, durationBeat = 4): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat }));
}

/** One bar each of C, F, G, C as root-position block triads (4/4). */
function cfgcNotes(): NoteEvent[] {
  return [
    ...blockChord([60, 64, 67], 0), // C E G
    ...blockChord([53, 57, 60], 4), // F A C
    ...blockChord([55, 59, 62], 8), // G B D
    ...blockChord([48, 52, 55], 12), // C E G
  ];
}

describe('chordTimelineFromNotes', () => {
  it('recovers a C-F-G-C progression, one chord per bar', () => {
    const result = chordTimelineFromNotes(cfgcNotes());
    const roots = result.timeline.segments.map((seg) => seg.chord.rootPc);
    expect(roots).toEqual([0, 5, 7, 0]);
    for (const seg of result.timeline.segments) {
      expect(seg.chord.quality).toBe('maj');
    }
    expect(result.timeline.segments.map((seg) => seg.startBeat)).toEqual([0, 4, 8, 12]);
    expect(result.timeline.segments.map((seg) => seg.endBeat)).toEqual([4, 8, 12, 16]);
    expect(result.timeline.at(5)?.rootPc).toBe(5);
    expect(result.timeline.at(16)).toBeNull();
  });

  it('infers the key when omitted', () => {
    const result = chordTimelineFromNotes(cfgcNotes());
    expect(result.key.rootPc).toBe(0);
    expect(result.key.modeMask12).toBe(MAJOR_MASK);
  });

  it('respects an explicitly given key', () => {
    const aMinor = minorKey(9);
    const result = chordTimelineFromNotes(cfgcNotes(), { key: aMinor });
    expect(result.key.rootPc).toBe(9);
    expect(result.key.modeMask12).toBe(aMinor.modeMask12);
    // The diatonic block chords are still recovered under the relative minor.
    expect(result.timeline.segments.map((seg) => seg.chord.rootPc)).toEqual([0, 5, 7, 0]);
  });

  it('reports near-full confidence for clean block chords', () => {
    const result = chordTimelineFromNotes(cfgcNotes(), { key: majorKey(0) });
    expect(result.segmentConfidence).toHaveLength(result.timeline.segments.length);
    for (const confidence of result.segmentConfidence) {
      expect(confidence).toBeGreaterThan(0.95);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('lowers confidence for a noisy window', () => {
    const key = majorKey(0);
    const clean = chordTimelineFromNotes(blockChord([60, 64, 67], 0), { key });
    const noisy = chordTimelineFromNotes(
      [...blockChord([60, 64, 67], 0), { pitch: 61, startBeat: 1, durationBeat: 1.5 }],
      { key },
    );
    expect(clean.timeline.segments[0]?.chord.rootPc).toBe(0);
    expect(noisy.timeline.segments[0]?.chord.rootPc).toBe(0);
    const cleanConfidence = clean.segmentConfidence[0] ?? 0;
    const noisyConfidence = noisy.segmentConfidence[0] ?? 0;
    expect(cleanConfidence).toBeGreaterThan(0.95);
    expect(noisyConfidence).toBeLessThan(cleanConfidence - 0.1);
    expect(noisyConfidence).toBeGreaterThan(0.5);
  });

  it('merges adjacent windows carrying the identical chord', () => {
    const notes = [
      ...blockChord([60, 64, 67], 0),
      ...blockChord([60, 64, 67], 4),
      ...blockChord([53, 57, 60], 8),
    ];
    const result = chordTimelineFromNotes(notes, { key: majorKey(0) });
    expect(result.timeline.segments).toHaveLength(2);
    expect(result.timeline.segments[0]).toMatchObject({ startBeat: 0, endBeat: 8 });
    expect(result.timeline.segments[0]?.chord.rootPc).toBe(0);
    expect(result.timeline.segments[1]?.chord.rootPc).toBe(5);
    expect(result.segmentConfidence).toHaveLength(2);
  });

  it('does not merge identical chords across an empty window', () => {
    const notes = [...blockChord([60, 64, 67], 0), ...blockChord([60, 64, 67], 8)];
    const result = chordTimelineFromNotes(notes, { key: majorKey(0), totalBeats: 12 });
    expect(result.timeline.segments).toHaveLength(2);
    expect(result.timeline.at(5)).toBeNull();
  });

  it('honors a shorter harmonic rhythm', () => {
    const notes = [...blockChord([60, 64, 67], 0, 2), ...blockChord([55, 59, 62], 2, 2)];
    const result = chordTimelineFromNotes(notes, { key: majorKey(0), harmonicRhythm: 2 });
    expect(result.timeline.segments.map((seg) => seg.chord.rootPc)).toEqual([0, 7]);
    expect(result.timeline.segments.map((seg) => seg.endBeat)).toEqual([2, 4]);
  });

  it('returns an empty timeline for no notes', () => {
    const result = chordTimelineFromNotes([]);
    expect(result.timeline.segments).toHaveLength(0);
    expect(result.segmentConfidence).toHaveLength(0);
    expect(result.timeline.at(0)).toBeNull();
  });

  it('throws on a non-positive harmonic rhythm', () => {
    expect(() => chordTimelineFromNotes(cfgcNotes(), { harmonicRhythm: 0 })).toThrow();
  });

  it('ignores zero- and negative-length notes at ingest', () => {
    // Silent events must affect neither the inferred key, the segments, nor
    // the confidences — including the span (the beat-20 ghost adds no windows).
    const ghosts: NoteEvent[] = [
      { pitch: 66, startBeat: 0, durationBeat: 0 },
      { pitch: 66, startBeat: 1, durationBeat: 0 },
      { pitch: 66, startBeat: 2, durationBeat: 0 },
      { pitch: 61, startBeat: 3, durationBeat: -1 },
      { pitch: 60, startBeat: 20, durationBeat: 0 },
    ];
    const clean = chordTimelineFromNotes(blockChord([60, 64, 67], 0));
    const noisy = chordTimelineFromNotes([...blockChord([60, 64, 67], 0), ...ghosts]);
    expect(noisy.key).toEqual(clean.key);
    expect(noisy.key.rootPc).toBe(0);
    expect(noisy.key.modeMask12).toBe(MAJOR_MASK);
    expect(noisy.timeline.segments).toEqual(clean.timeline.segments);
    expect(noisy.segmentConfidence).toEqual(clean.segmentConfidence);
  });
});

describe('detectCadences', () => {
  it('finds the half and authentic cadences in C-F-G-C', () => {
    const { timeline } = chordTimelineFromNotes(cfgcNotes(), { key: majorKey(0) });
    const hits = detectCadences(timeline, majorKey(0));
    expect(hits.map((hit) => ({ atBeat: hit.atBeat, type: hit.type }))).toEqual([
      { atBeat: 8, type: 'half' },
      { atBeat: 12, type: 'authentic' },
    ]);
    const authentic = hits[1];
    expect(authentic?.from.rootPc).toBe(7);
    expect(authentic?.to.rootPc).toBe(0);
  });

  it('returns no hits for a single-segment timeline', () => {
    const { timeline } = chordTimelineFromNotes(blockChord([60, 64, 67], 0));
    expect(detectCadences(timeline, majorKey(0))).toEqual([]);
  });

  it('does not pair segments separated by a rest', () => {
    // G major, a bar of silence, then C major: V-(rest)-I is not a cadence.
    const notes = [...blockChord([55, 59, 62], 0), ...blockChord([48, 52, 55], 8)];
    const { timeline } = chordTimelineFromNotes(notes, { key: majorKey(0), totalBeats: 12 });
    expect(timeline.segments.map((seg) => [seg.startBeat, seg.endBeat])).toEqual([
      [0, 4],
      [8, 12],
    ]);
    expect(detectCadences(timeline, majorKey(0))).toEqual([]);
  });
});

describe('chordTimelineFromChords', () => {
  it('spans each chord to the next onset and answers at()', () => {
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'dom7', startBeat: 4 },
      ],
      8,
    );
    expect(timeline.segments).toHaveLength(2);
    expect(timeline.segments[0]).toMatchObject({ startBeat: 0, endBeat: 4 });
    expect(timeline.at(5)?.rootPc).toBe(7);
    expect(timeline.at(5)?.quality).toBe('dom7');
    expect(timeline.at(8)).toBeNull();
  });

  it('caps segments at totalBeats and excludes later chord onsets', () => {
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'maj', startBeat: 8 },
      ],
      4,
    );
    expect(timeline.segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
    ]);
    expect(timeline.at(6)).toBeNull();
  });
});
