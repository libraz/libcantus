import { describe, expect, it } from 'vitest';
import { analyzeArrangement, createArrangementSession } from '../src/analyze/arrange/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import { createNoteEventIndex } from '../src/core/event-index/index.js';
import { createPositionalRng, createRng } from '../src/core/random/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { resolveContext } from '../src/generate/context/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { humanize } from '../src/generate/groove/index.js';

/** What a host does to a value on its way into a project file and back out. */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const notes: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
  { pitch: 65, startBeat: 4, durationBeat: 4 },
  { pitch: 69, startBeat: 4, durationBeat: 4 },
  { pitch: 72, startBeat: 4, durationBeat: 4 },
];

describe('results are plain data', () => {
  it('serializes a generation result and reads it back unchanged', () => {
    const drums = generateDrums({ bars: 2, style: 'standard', section: 'verse', ctx: 7 });
    expect(roundTrip(drums)).toEqual(drums);
    const humanized = humanize(notes, { ctx: 7 });
    expect(roundTrip(humanized)).toEqual(humanized);
  });

  it('serializes every reported field of an analysis and reads it back unchanged', () => {
    const analysis = analyzeArrangement([{ role: 'harmony', notes }]);
    const reported = {
      keys: analysis.keys,
      prevailingKey: analysis.prevailingKey,
      segments: analysis.timeline.segments,
      segmentConfidence: analysis.segmentConfidence,
      cadences: analysis.cadences,
      tracks: analysis.tracks,
      conflicts: analysis.conflicts,
    };
    expect(roundTrip(reported)).toEqual(reported);
  });

  it('rebuilds the chord lookup from the segments that were stored', () => {
    // `ChordTimeline.at` is a lookup over the segments, not data of its own, so
    // it is the one field of an analysis that a project file cannot hold. The
    // segments carry everything it reads.
    const analysis = analyzeArrangement([{ role: 'harmony', notes }]);
    const stored = roundTrip(analysis.timeline.segments);
    expect(roundTrip(analysis).timeline.at).toBeUndefined();
    const totalBeats = stored[stored.length - 1]?.endBeat ?? 0;
    const rebuilt = chordTimelineFromChords(
      stored.map((segment) => ({ ...segment.chord, startBeat: segment.startBeat })),
      totalBeats,
    );
    for (let beat = 0; beat < totalBeats; beat += 0.5) {
      expect(rebuilt.at(beat), `beat ${beat}`).toEqual(analysis.timeline.at(beat));
    }
  });
});

describe('handles are live objects, not values to store', () => {
  /** Each handle, a method it answers with, and how a host builds it again. */
  const handles: { name: string; make: () => object; method: string }[] = [
    { name: 'createNoteEventIndex', make: () => createNoteEventIndex(notes), method: 'at' },
    {
      name: 'createArrangementSession',
      make: () => createArrangementSession([{ notes }]),
      method: 'update',
    },
    { name: 'createRng', make: () => createRng(7), method: 'float' },
    { name: 'createPositionalRng', make: () => createPositionalRng(7), method: 'at' },
    { name: 'resolveContext', make: () => resolveContext({ seed: 7 }), method: 'part' },
  ];

  it.each(handles)(
    '$name returns methods that do not survive the round trip',
    ({ make, method }) => {
      const handle = make() as Record<string, unknown>;
      expect(typeof handle[method]).toBe('function');
      expect(roundTrip(handle)[method]).toBeUndefined();
    },
  );

  it('resolves a context again from the fields that were stored', () => {
    // The documented recipe: keep the input, not the handle.
    const saved = { seed: 7, algorithmVersion: 1, complexity: { rhythmic: 0.4 } };
    const context = resolveContext(saved);
    const reopened = resolveContext(roundTrip(saved));
    expect(reopened.seed).toBe(context.seed);
    expect(reopened.algorithmVersion).toBe(context.algorithmVersion);
    expect(reopened.rhythmic).toBe(context.rhythmic);
    expect(reopened.part('drums').at('ghost', 1)).toBe(context.part('drums').at('ghost', 1));
  });

  it('opens a session again from the tracks that were stored', () => {
    const tracks = [{ notes }];
    const session = createArrangementSession(tracks);
    const reopened = createArrangementSession(roundTrip(tracks));
    expect(reopened.analysis.conflicts).toEqual(session.analysis.conflicts);
    expect(typeof reopened.update).toBe('function');
  });
});
