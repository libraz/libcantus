import { describe, expect, it } from 'vitest';
import type { ArrangementTrack } from '../src/analyze/arrange/index.js';
import { analyzeArrangement, createArrangementSession } from '../src/analyze/arrange/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { majorKey } from '../src/theory/scale/index.js';

/** A small linear congruential generator, so every case here is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A two-track piece: block chords under a running eighth-note line. */
function piece(bars: number, seed: number): ArrangementTrack[] {
  const rand = seeded(seed);
  const harmony: NoteEvent[] = [];
  const melody: NoteEvent[] = [];
  const degrees = [0, 5, 7, 9, 2, 4, 5, 7];
  for (let bar = 0; bar < bars; bar += 1) {
    const root = 48 + (degrees[bar % degrees.length] ?? 0);
    for (const offset of [0, 4, 7]) {
      harmony.push({ pitch: root + offset, startBeat: bar * 4, durationBeat: 4 });
    }
    for (let eighth = 0; eighth < 8; eighth += 1) {
      melody.push({
        pitch: root + 24 + Math.floor(rand() * 12),
        startBeat: bar * 4 + eighth * 0.5,
        durationBeat: 0.5,
      });
    }
  }
  return [
    { name: 'keys', role: 'harmony', notes: harmony },
    { name: 'lead', role: 'melody', notes: melody },
  ];
}

/**
 * The analysis as plain data, so an incremental result and a full one are
 * compared on every number they report rather than on a summary of them.
 */
function shape(analysis: ReturnType<typeof analyzeArrangement>): string {
  return JSON.stringify({
    keys: analysis.keys,
    prevailingKey: analysis.prevailingKey,
    segments: analysis.timeline.segments,
    segmentConfidence: analysis.segmentConfidence,
    cadences: analysis.cadences,
    tracks: analysis.tracks,
    conflicts: analysis.conflicts,
  });
}

const C_MAJOR = majorKey(0);

describe('createArrangementSession', () => {
  it('leaves the analysis untouched when an edit changes nothing', () => {
    const tracks = piece(6, 23);
    const session = createArrangementSession(tracks);
    // The same notes in the same places: nothing the analysis reads has moved,
    // so the previous answer stands.
    const same = [...(tracks[1]?.notes ?? [])];
    const next = session.update([{ trackIndex: 1, notes: same }]);
    expect(next.analysis).toBe(session.analysis);
  });

  it('re-splices a segment when a single note is moved inside one bar', () => {
    // C, F, G, C; the third bar's third is dropped a semitone, which turns G
    // major into G minor. Only that bar's chord may change, and the bars the
    // edit cannot reach must come back untouched.
    const bars: number[][] = [
      [60, 64, 67],
      [65, 69, 72],
      [67, 71, 74],
      [60, 64, 67],
    ];
    const harmony: NoteEvent[] = bars.flatMap((pitches, bar) =>
      pitches.map((pitch) => ({ pitch, startBeat: bar * 4, durationBeat: 4 })),
    );
    const tracks: ArrangementTrack[] = [{ role: 'harmony', notes: harmony }];
    const session = createArrangementSession(tracks, { key: C_MAJOR });
    expect(session.analysis.timeline.segments[2]?.chord.quality).toBe('maj');

    const edited = harmony.map((note, index) =>
      index === 7 ? { ...note, pitch: 70 } : { ...note },
    );
    const next = session.update([{ trackIndex: 0, notes: edited }]);
    expect(next.analysis.timeline.segments[2]?.chord.quality).toBe('min');
    expect(next.analysis.timeline.segments[0]).toEqual(session.analysis.timeline.segments[0]);
    // Chord inference builds a fresh chord per span, so the untouched bar
    // carrying the very same object is what proves the update spliced rather
    // than quietly re-ran the whole piece and happened to agree.
    expect(next.analysis.timeline.segments[0]?.chord).toBe(
      session.analysis.timeline.segments[0]?.chord,
    );
    expect(shape(next.analysis)).toBe(
      shape(analyzeArrangement([{ role: 'harmony', notes: edited }], { key: C_MAJOR })),
    );
  });
});
