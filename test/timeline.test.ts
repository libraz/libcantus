import { describe, expect, it } from 'vitest';
import { detectChordBest } from '../src/analyze/detect/index.js';
import {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord, spanFromChord } from '../src/theory/chord/index.js';
import { MAJOR_MASK, majorKey, minorKey, scaleOf } from '../src/theory/scale/index.js';

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
  it('does not invent a slash bass when the actual bass was filtered as noise', () => {
    const result = chordTimelineFromNotes(
      [
        { pitch: 36, startBeat: 0, durationBeat: 4, velocity: 10 },
        { pitch: 64, startBeat: 0, durationBeat: 4, velocity: 100 },
        { pitch: 67, startBeat: 0, durationBeat: 4, velocity: 100 },
      ],
      { key: majorKey(0) },
    );
    expect(result.timeline.segments[0]?.chord.bassPc).toBeUndefined();
  });

  it('reads a triad over a foreign bass as the slash chord it is written as', () => {
    // F/G, G/A and C/D: the bass sounds nowhere above the triad, so the ninth an
    // extended reading would name it was never voiced. These are core pop
    // vocabulary, and naming them `Fadd9/G` empties a chart of them.
    const cases: [number[], number, number][] = [
      [[43, 65, 69, 72], 5, 7], // G2 + F A C -> F/G
      [[45, 67, 71, 74], 7, 9], // A2 + G B D -> G/A
      [[50, 72, 76, 79], 0, 2], // D3 + C E G -> C/D
    ];
    for (const [pitches, rootPc, bassPc] of cases) {
      const chord = chordTimelineFromNotes(blockChord(pitches, 0)).timeline.segments[0]?.chord;
      expect(chord?.rootPc).toBe(rootPc);
      expect(chord?.quality).toBe('maj');
      expect(chord?.bassPc).toBe(bassPc);
    }
  });

  it('still names the extension when the extension is actually voiced', () => {
    // The same bass with a G inside the upper structure: now a ninth sounds
    // above the chord, and the reading that names it is the right one.
    const chord = chordTimelineFromNotes(blockChord([43, 65, 67, 69, 72], 0)).timeline.segments[0]
      ?.chord;
    expect(chord?.rootPc).toBe(5);
    expect(chord?.quality).toBe('add9');
    expect(chord?.bassPc).toBe(7);
  });

  it('leaves an inversion an inversion when the bass is a chord tone', () => {
    // The fifth in the bass is a chord tone, not a pedal: C/G stays C/G.
    const chord = chordTimelineFromNotes(blockChord([55, 72, 76], 0)).timeline.segments[0]?.chord;
    expect(chord?.rootPc).toBe(0);
    expect(chord?.quality).toBe('maj');
    expect(chord?.bassPc).toBe(7);
  });

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
    expect(result.prevailingKey.scale.rootPc).toBe(0);
    expect(result.prevailingKey.scale.modeMask12).toBe(MAJOR_MASK);
  });

  it('respects an explicitly given key', () => {
    const aMinor = minorKey(9);
    const result = chordTimelineFromNotes(cfgcNotes(), { key: aMinor });
    expect(result.prevailingKey.scale.rootPc).toBe(9);
    expect(result.prevailingKey.scale.modeMask12).toBe(aMinor.modeMask12);
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

  it('names a voicing without its fifth by the seventh it plays', () => {
    // C E Bb: a dominant seventh voiced as a shell. The Bb is chromatic in C
    // major, and the reading that drops it — a plain C triad — is the diatonic
    // one, so the key must not be allowed to buy that trade: it would discard
    // the tritone the chord exists for and assert a G nobody sounded.
    for (const key of [undefined, majorKey(0)]) {
      const result = chordTimelineFromNotes(blockChord([60, 64, 70], 0), key && { key });
      expect(result.timeline.segments).toHaveLength(1);
      expect(result.timeline.segments[0]?.chord).toMatchObject({ rootPc: 0, quality: 'dom7' });
    }
  });

  it('reads a fifth-omitted voicing as the chord detection reads the same pitches', () => {
    // The segment inference and `detectChordBest` are two paths to one answer,
    // so a pitch set that names a chord on its own names the same chord here.
    const voicings = [
      [60, 64, 70], // C7
      [60, 64, 70, 74], // C9
      [60, 64, 70, 74, 81], // C13
      [60, 64, 70, 75], // C7#9
      [60, 63, 70], // Cm7
      [60, 64, 71], // Cmaj7
      [60, 63, 71], // CmMaj7
      [60, 64, 67, 70], // C7, fifth included
    ];
    for (const pitches of voicings) {
      const segment = chordTimelineFromNotes(blockChord(pitches, 0)).timeline.segments[0];
      const expected = detectChordBest(pitches);
      expect(segment?.chord.rootPc).toBe(expected?.rootPc);
      expect(segment?.chord.quality).toBe(expected?.quality);
    }
  });

  it('names a fifth-omitted dominant on every root', () => {
    for (let root = 0; root < 12; root += 1) {
      const segment = chordTimelineFromNotes(blockChord([60 + root, 64 + root, 70 + root], 0))
        .timeline.segments[0];
      expect(segment?.chord).toMatchObject({ rootPc: root, quality: 'dom7' });
    }
  });

  it('keeps a chromatic seventh the key does not contain', () => {
    // The seventh is what the key argues against, so pinning the key to the one
    // that excludes it is the case the reading has to survive.
    const segment = chordTimelineFromNotes(blockChord([60, 64, 67, 70], 0), {
      key: majorKey(0),
    }).timeline.segments[0];
    expect(segment?.chord).toMatchObject({ rootPc: 0, quality: 'dom7' });
  });

  it('roots a shell voicing on its bass rather than on its loudest tone', () => {
    // C E Bb with the seventh carrying the weight. The loud Bb pulls the
    // inferred key onto Bb major, where a Bb chord is the diatonic reading and
    // the loudest pitch class looks like the root — but the root is the note
    // underneath, and it stays the root down to the point where the noise
    // threshold stops admitting it as a sounding tone at all.
    for (const velocity of [90, 60, 30]) {
      const segment = chordTimelineFromNotes([
        { pitch: 60, startBeat: 0, durationBeat: 4, velocity },
        { pitch: 64, startBeat: 0, durationBeat: 4, velocity },
        { pitch: 70, startBeat: 0, durationBeat: 4, velocity: 127 },
      ]).timeline.segments[0];
      expect(segment?.chord).toMatchObject({ rootPc: 0, quality: 'dom7' });
    }
  });

  it('still reads a chord voiced in inversion against its own bass', () => {
    // The bass speaks for the root, but it does not overrule a pitch class that
    // carries the window: F A C over an A bass is F major in first inversion,
    // not a chord rooted on the A underneath it.
    const segment = chordTimelineFromNotes(blockChord([57, 60, 65], 0), {
      key: majorKey(0),
    }).timeline.segments[0];
    expect(segment?.chord).toMatchObject({ rootPc: 5, quality: 'maj', bassPc: 9 });
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
    expect(noisy.prevailingKey).toEqual(clean.prevailingKey);
    expect(noisy.prevailingKey.scale.rootPc).toBe(0);
    expect(noisy.prevailingKey.scale.modeMask12).toBe(MAJOR_MASK);
    expect(noisy.timeline.segments).toEqual(clean.timeline.segments);
    expect(noisy.segmentConfidence).toEqual(clean.segmentConfidence);
  });
});

describe('detectCadences', () => {
  it('finds the half and authentic cadences in C-F-G-C', () => {
    const { timeline } = chordTimelineFromNotes(cfgcNotes(), { key: majorKey(0) });
    const hits = detectCadences(timeline, majorKey(0));
    expect(hits.map((hit) => ({ atBeat: hit.atBeat, type: hit.cadence.type }))).toEqual([
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

  it('takes the key straight off the analysis result', () => {
    // The pairing the documented entry point makes: the result names its keys
    // as `keys` and `prevailingKey`, and the latter is what a caller wanting
    // one key hands to the cadence scan.
    const result = chordTimelineFromNotes(cfgcNotes());
    expect(Object.keys(result).sort()).toEqual([
      'keys',
      'prevailingKey',
      'segmentConfidence',
      'timeline',
    ]);
    const { timeline, prevailingKey } = result;
    expect(detectCadences(timeline, scaleOf(prevailingKey)).map((hit) => hit.cadence.type)).toEqual(
      ['half', 'authentic'],
    );
  });

  it('reads a cadential six-four as the start of one cadence, not a cadence of its own', () => {
    // I I64 V7 I. The six-four is a tonic triad standing on the dominant's own
    // bass, so the dominant was already sounding under it: the passage holds
    // one cadence, arriving on the final tonic, and the six-four is where it
    // began rather than a half cadence in its own right.
    const timeline = chordTimelineFromChords(
      [
        spanFromChord(makeChord(0, 'maj'), 0),
        spanFromChord(makeChord(0, 'maj', 7), 4),
        spanFromChord(makeChord(7, 'dom7'), 8),
        spanFromChord(makeChord(0, 'maj'), 12),
      ],
      16,
    );
    const hits = detectCadences(timeline, majorKey(0));
    expect(hits.map((hit) => ({ atBeat: hit.atBeat, type: hit.cadence.type }))).toEqual([
      { atBeat: 12, type: 'authentic' },
    ]);
    expect(hits[0]?.cadence.rationale).toContain('six-four');
  });

  it('leaves a passing six-four reading as it was', () => {
    // IV I64 IV V7 I. The six-four does not run into the dominant, so it is
    // passing rather than cadential and every cadence around it stands.
    const timeline = chordTimelineFromChords(
      [
        spanFromChord(makeChord(5, 'maj'), 0),
        spanFromChord(makeChord(0, 'maj', 7), 4),
        spanFromChord(makeChord(5, 'maj'), 8),
        spanFromChord(makeChord(7, 'dom7'), 12),
        spanFromChord(makeChord(0, 'maj'), 16),
      ],
      20,
    );
    expect(
      detectCadences(timeline, majorKey(0)).map((hit) => ({
        atBeat: hit.atBeat,
        type: hit.cadence.type,
      })),
    ).toEqual([
      { atBeat: 4, type: 'plagal' },
      { atBeat: 12, type: 'half' },
      { atBeat: 16, type: 'authentic' },
    ]);
  });

  it('does not read a six-four across a rest as the approach', () => {
    // I64, the players breathe, then V7 I. Nothing was still sounding when the
    // dominant arrived, so the six-four is not what the cadence began on and
    // the dominant-to-tonic pair is read on its own.
    const timeline = chordTimelineFromChords(
      [
        spanFromChord(makeChord(0, 'maj', 7), 0),
        spanFromChord(makeChord(7, 'dom7'), 4),
        spanFromChord(makeChord(0, 'maj'), 8),
      ],
      12,
    );
    const gapped = {
      at: timeline.at,
      segments: timeline.segments.map((segment) =>
        segment.startBeat === 0 ? { ...segment, endBeat: 3 } : segment,
      ),
    };
    const hits = detectCadences(gapped, majorKey(0));
    expect(hits.map((hit) => ({ atBeat: hit.atBeat, type: hit.cadence.type }))).toEqual([
      { atBeat: 8, type: 'authentic' },
    ]);
    expect(hits[0]?.cadence.rationale).not.toContain('six-four');
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

  it('builds exactly the chord a span without a template always built', () => {
    const timeline = chordTimelineFromChords(
      [{ rootPc: 5, quality: 'maj', startBeat: 0, bassPc: 7 }],
      4,
    );
    expect(timeline.segments[0]?.chord).toEqual(makeChord(5, 'maj', 7));
  });

  it('carries a custom interval template into the segment and back out', () => {
    const span: ChordSpan = { rootPc: 0, quality: 'maj7', startBeat: 0, intervals: [0, 4, 11, 18] };
    const timeline = chordTimelineFromChords([span], 4);
    const segment = timeline.segments[0];
    expect(segment?.chord.intervals).toEqual([0, 4, 11, 18]);
    expect(timeline.at(2)?.intervals).toEqual([0, 4, 11, 18]);
    expect(segment && spanFromChord(segment.chord, segment.startBeat)).toEqual(span);
    // The segment holds its own template, not the caller's array.
    segment?.chord.intervals.push(21);
    expect(span.intervals).toEqual([0, 4, 11, 18]);
  });
});
