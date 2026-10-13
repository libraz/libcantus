import { describe, expect, it } from 'vitest';
import type { ArrangementOptions, ArrangementTrack } from '../src/analyze/arrange/index.js';
import { analyzeArrangement, createArrangementSession } from '../src/analyze/arrange/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
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

/** Apply an edit to a track's notes, returning the new array. */
type Edit = { trackIndex: number; notes: NoteEvent[] };

/** Draw one random edit: a moved pitch, a new note, or a deleted one. */
function randomEdit(tracks: ArrangementTrack[], rand: () => number): Edit {
  const trackIndex = Math.floor(rand() * tracks.length);
  const notes = [...(tracks[trackIndex]?.notes ?? [])];
  if (notes.length === 0) {
    return { trackIndex, notes };
  }
  const at = Math.floor(rand() * notes.length);
  const target = notes[at];
  if (target === undefined) {
    return { trackIndex, notes };
  }
  const kind = rand();
  if (kind < 0.45) {
    // Transpose one note, leaving its rhythm alone.
    notes[at] = { ...target, pitch: target.pitch + (rand() < 0.5 ? 1 : -2) };
  } else if (kind < 0.8) {
    // Add a note inside the same bar.
    notes.push({
      pitch: target.pitch + 3,
      startBeat: target.startBeat + 0.5,
      durationBeat: 0.5,
    });
  } else {
    notes.splice(at, 1);
  }
  return { trackIndex, notes };
}

const C_MAJOR = majorKey(0);

describe('createArrangementSession', () => {
  it('reports the same analysis as a batch pass before any edit', () => {
    const tracks = piece(8, 11);
    const session = createArrangementSession(tracks);
    expect(shape(session.analysis)).toBe(shape(analyzeArrangement(tracks)));
  });

  it('leaves the analysis untouched when an edit changes nothing', () => {
    const tracks = piece(6, 23);
    const session = createArrangementSession(tracks);
    // The same notes in the same places: nothing the analysis reads has moved,
    // so the previous answer stands.
    const same = [...(tracks[1]?.notes ?? [])];
    const next = session.update([{ trackIndex: 1, notes: same }]);
    expect(next.analysis).toBe(session.analysis);
  });

  it('matches a full re-analysis after a re-ordering, down to originalIndex', () => {
    // Reversing a track's array moves no note, but `originalIndex` reports a
    // note's position in the caller's array, so every annotation and conflict
    // has to come back pointing at the note that now sits there.
    const tracks = piece(6, 23);
    const session = createArrangementSession(tracks);
    const reversed = [...(tracks[1]?.notes ?? [])].reverse();
    const next = session.update([{ trackIndex: 1, notes: reversed }]);
    const edited = tracks.map((track, index) =>
      index === 1 ? { ...track, notes: reversed } : track,
    );
    expect(shape(next.analysis)).toBe(shape(analyzeArrangement(edited)));
    // The reversal has to be visible in the result, or the comparison above
    // would hold just as well for a session that ignored it.
    const indices = (analysis: ReturnType<typeof analyzeArrangement>) =>
      (analysis.tracks[1]?.notes ?? []).map((note) => note.originalIndex);
    expect(indices(next.analysis)).not.toEqual(indices(session.analysis));
  });

  it('rejects an edit naming a track the session does not have', () => {
    const session = createArrangementSession(piece(2, 5));
    expect(() => session.update([{ trackIndex: 7, notes: [] }])).toThrow();
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

  it('carries over every segment an edit cannot reach in a long piece', () => {
    // A one-note edit in bar 2 of sixteen: the segments far from it must be the
    // same objects, or nothing was carried over.
    const tracks = piece(16, 55);
    const session = createArrangementSession(tracks, { key: C_MAJOR });
    const notes = [...(tracks[1]?.notes ?? [])];
    const target = notes[9];
    if (target !== undefined) {
      notes[9] = { ...target, pitch: target.pitch + 1 };
    }
    const next = session.update([{ trackIndex: 1, notes }]);
    const before = session.analysis.timeline.segments;
    const after = next.analysis.timeline.segments;
    const carried = after.filter((segment) =>
      before.some((earlier) => earlier.chord === segment.chord),
    );
    expect(carried.length).toBeGreaterThan(after.length / 2);
  });

  const optionCases: { name: string; opts: ArrangementOptions }[] = [
    { name: 'inferred keys', opts: {} },
    { name: 'a given key', opts: { key: C_MAJOR } },
    { name: 'a fixed harmonic rhythm', opts: { key: C_MAJOR, harmonicRhythm: 2 } },
    { name: 'a meter of 3/4', opts: { ts: parseTimeSignature('3/4') } },
  ];

  for (const { name, opts } of optionCases) {
    it(`matches a full re-analysis over a run of random edits with ${name}`, () => {
      const rand = seeded(0x5eed + name.length);
      let tracks = piece(12, 97);
      let session = createArrangementSession(tracks, opts);
      for (let step = 0; step < 12; step += 1) {
        const edit = randomEdit(tracks, rand);
        tracks = tracks.map((track, index) =>
          index === edit.trackIndex ? { ...track, notes: edit.notes } : track,
        );
        session = session.update([edit]);
        expect(shape(session.analysis)).toBe(shape(analyzeArrangement(tracks, opts)));
      }
    });
  }

  it('matches a full re-analysis when several tracks are edited at once', () => {
    const rand = seeded(4242);
    let tracks = piece(10, 31);
    let session = createArrangementSession(tracks);
    for (let step = 0; step < 6; step += 1) {
      const edits = [randomEdit(tracks, rand), randomEdit(tracks, rand)].filter(
        (edit, index, all) => all.findIndex((e) => e.trackIndex === edit.trackIndex) === index,
      );
      tracks = tracks.map((track, index) => {
        const edit = edits.find((e) => e.trackIndex === index);
        return edit === undefined ? track : { ...track, notes: edit.notes };
      });
      session = session.update(edits);
      expect(shape(session.analysis)).toBe(shape(analyzeArrangement(tracks)));
    }
  });

  it('matches a full re-analysis when an edit changes the length of the piece', () => {
    // Appending past the last note moves `totalBeats` and so the whole slot
    // grid; the update has to notice and fall back rather than splice onto a
    // grid that no longer describes the piece.
    const tracks = piece(4, 61);
    const session = createArrangementSession(tracks);
    const extended = [...(tracks[1]?.notes ?? []), { pitch: 72, startBeat: 16, durationBeat: 4 }];
    const next = session.update([{ trackIndex: 1, notes: extended }]);
    const edited = tracks.map((track, index) =>
      index === 1 ? { ...track, notes: extended } : track,
    );
    expect(shape(next.analysis)).toBe(shape(analyzeArrangement(edited)));
  });

  it('matches a full re-analysis when an edit adds a pickup before beat 0', () => {
    // A note before the first onset moves the grid origin, the other quantity
    // every carried-over slot row is numbered against.
    const tracks = piece(4, 83);
    const session = createArrangementSession(tracks, { pickupBeats: 2 });
    const withPickup = [{ pitch: 67, startBeat: -1, durationBeat: 1 }, ...(tracks[1]?.notes ?? [])];
    const next = session.update([{ trackIndex: 1, notes: withPickup }]);
    const edited = tracks.map((track, index) =>
      index === 1 ? { ...track, notes: withPickup } : track,
    );
    expect(shape(next.analysis)).toBe(shape(analyzeArrangement(edited, { pickupBeats: 2 })));
  });

  it('matches a full re-analysis when the harmony was supplied by the caller', () => {
    const tracks = piece(6, 17);
    const opts: ArrangementOptions = {
      key: C_MAJOR,
      timeline: analyzeArrangement(tracks, { key: C_MAJOR }).timeline,
    };
    const session = createArrangementSession(tracks, opts);
    const edit = randomEdit(tracks, seeded(9));
    const edited = tracks.map((track, index) =>
      index === edit.trackIndex ? { ...track, notes: edit.notes } : track,
    );
    const next = session.update([edit]);
    expect(shape(next.analysis)).toBe(shape(analyzeArrangement(edited, opts)));
  });

  it('lets the analysis before an edit be updated again', () => {
    // A host holding a session for undo may update either one; each has to give
    // the answer its own tracks imply.
    const tracks = piece(6, 43);
    const session = createArrangementSession(tracks);
    const first = randomEdit(tracks, seeded(2));
    const second = randomEdit(tracks, seeded(3));
    const afterFirst = session.update([first]);
    const afterSecond = session.update([second]);
    for (const [edit, updated] of [
      [first, afterFirst],
      [second, afterSecond],
    ] as const) {
      const edited = tracks.map((track, index) =>
        index === edit.trackIndex ? { ...track, notes: edit.notes } : track,
      );
      expect(shape(updated.analysis)).toBe(shape(analyzeArrangement(edited)));
    }
  });
});

describe('an analysis a host keeps in order to undo', () => {
  // A session hands back a new analysis and leaves the old one valid, which is
  // what makes it an undo state. The span an edit did not touch is not analysed
  // again, though, so its chord is the very object the earlier analysis reported
  // — and a host that writes to what the current timeline hands it, renaming a
  // root for display, would be rewriting the state it is holding in order to go
  // back. The two are the same object by design; what stops the write is that
  // neither analysis hands out anything writable.

  /** Every chord an analysis reports, including the ones inside its keys. */
  function chordsOf(analysis: ReturnType<typeof analyzeArrangement>): unknown[] {
    return analysis.timeline.segments.map((segment) => segment.chord);
  }

  it('shares its chords with the analysis after an edit', () => {
    // Not a requirement, a fact: this is why the freeze below is needed at all,
    // and a test that stopped seeing the sharing would stop testing anything.
    const tracks = piece(8, 11);
    const session = createArrangementSession(tracks, { key: C_MAJOR });
    const next = session.update([randomEdit(tracks, seeded(4))]);
    const before = new Set(chordsOf(session.analysis));
    const shared = chordsOf(next.analysis).filter((chord) => before.has(chord));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('hands out no chord a caller can write to', () => {
    const tracks = piece(8, 11);
    const session = createArrangementSession(tracks, { key: C_MAJOR });
    const next = session.update([randomEdit(tracks, seeded(4))]);
    for (const [label, analysis] of [
      ['before the edit', session.analysis],
      ['after the edit', next.analysis],
    ] as const) {
      for (const chord of chordsOf(analysis) as { intervals: number[] }[]) {
        expect(Object.isFrozen(chord), label).toBe(true);
        expect(Object.isFrozen(chord.intervals), label).toBe(true);
      }
    }
  });

  it('keeps the earlier analysis intact when a caller writes to the later one', () => {
    const tracks = piece(8, 11);
    const session = createArrangementSession(tracks, { key: C_MAJOR });
    const kept = JSON.stringify(session.analysis.timeline.segments);
    const next = session.update([randomEdit(tracks, seeded(4))]);
    for (const chord of next.analysis.timeline.segments.map((segment) => segment.chord)) {
      // A host renaming a root for display, in the one way a frozen object
      // allows a caller to try it.
      expect(() => {
        (chord as { rootPc: number }).rootPc = 11;
      }).toThrow(TypeError);
    }
    expect(JSON.stringify(session.analysis.timeline.segments)).toBe(kept);
  });
});
