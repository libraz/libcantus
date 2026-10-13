import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeTimeline } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';

/**
 * What a call retains in typed-array memory, in bytes.
 *
 * `arrayBuffers` is the one memory figure here that does not depend on when the
 * collector happens to run: the search tables are typed arrays, so what they
 * cost shows up in it directly, while a heap reading would mostly report
 * whatever garbage the run left behind. The result is held across the
 * measurement so that what is reported is what the call kept, and the bounds
 * asserted against it are order-of-magnitude rather than tight, since another
 * suite's leftovers can only push the figure up.
 */
function retainedArrayBuffers(run: () => unknown): number {
  const before = process.memoryUsage().arrayBuffers;
  const held = run();
  const after = process.memoryUsage().arrayBuffers;
  expect(held).toBeDefined();
  return after - before;
}

const MIB = 1024 * 1024;

/** A block chord every `every` beats, over `beats` beats. */
function chordedPiece(beats: number, every = 4): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let beat = 0; beat < beats; beat += every) {
    for (const pitch of [60, 64, 67]) {
      notes.push({ pitch, startBeat: beat, durationBeat: every });
    }
  }
  return notes;
}

describe('the timeline budget bounds what the boundary search allocates', () => {
  it('keeps an accepted analysis inside a few megabytes of tables', () => {
    // The largest span the default budget admits under the default resolution.
    const notes = chordedPiece(6_900, 4);
    const retained = retainedArrayBuffers(() => analyzeTimeline(notes).evidence);
    expect(retained).toBeLessThan(100 * MIB);
  });

  it('reuses the carried-over table rather than allocating one per edit', () => {
    const notes = chordedPiece(2_000, 4);
    const first = analyzeTimeline(notes);
    const edited = [...notes, { pitch: 65, startBeat: 8, durationBeat: 4 }];
    // The table the first analysis left behind is the table the second runs on,
    // so an edit costs no allocation the size of the piece.
    const retained = retainedArrayBuffers(
      () => analyzeTimeline(edited, {}, first.evidence, { from: 1, to: 4 }).evidence,
    );
    expect(retained).toBeLessThan(1 * MIB);
  });

  it('gives the answer a full analysis gives when the table was already lent', () => {
    // A host holding a session for undo may update either branch; the evidence
    // whose table moved on lends nothing and the analysis re-derives it.
    const notes = chordedPiece(64, 4);
    const first = analyzeTimeline(notes);
    const one = [...notes, { pitch: 65, startBeat: 8, durationBeat: 4 }];
    const two = [...notes, { pitch: 62, startBeat: 20, durationBeat: 4 }];
    const dirty = { from: 0, to: 8 };
    const branchOne = analyzeTimeline(one, {}, first.evidence, dirty);
    const branchTwo = analyzeTimeline(two, {}, first.evidence, dirty);
    expect(branchOne.result.timeline.segments).toEqual(
      analyzeTimeline(one).result.timeline.segments,
    );
    expect(branchTwo.result.timeline.segments).toEqual(
      analyzeTimeline(two).result.timeline.segments,
    );
  });
});

describe('grid segmentation pays for no search', () => {
  it('analyses twenty thousand slots without a search table', () => {
    const notes = chordedPiece(20_000, 4);
    const run = analyzeTimeline(notes, { segmentation: 'grid', harmonicRhythm: 1 });
    expect(run.evidence.slotCount).toBe(20_000);
    // The evidence keeps its shape; what it does not keep is a row per slot.
    expect(run.evidence.tables?.scores.length).toBe(0);
    expect(run.evidence.tables?.back.length).toBe(0);
    expect(run.result.timeline.segments.length).toBeGreaterThan(0);
  });

  it('holds a grid analysis under a few megabytes', () => {
    const notes = chordedPiece(20_000, 4);
    const retained = retainedArrayBuffers(
      () => analyzeTimeline(notes, { segmentation: 'grid', harmonicRhythm: 1 }).evidence,
    );
    expect(retained).toBeLessThan(5 * MIB);
  });
});

describe('the timeline pass builds only what it queries', () => {
  it('reads its notes in order rather than through an event index', () => {
    // The analysis asks nothing positional of its notes — no `at`, no
    // `attacksAt`, no `onsetsBetween` — so building an index for them would
    // charge every call for a segment tree and a wrapper per note that nothing
    // reads. Stated against the source because the cost is a structure that is
    // never queried, which no output can show.
    const source = readFileSync(
      fileURLToPath(new URL('../src/analyze/timeline/index.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/createNoteEventIndex/);
    expect(source).toMatch(/sortedNoteEvents/);
  });

  it('analyses two hundred thousand notes', () => {
    const notes: NoteEvent[] = [];
    for (let index = 0; index < 200_000; index += 1) {
      notes.push({ pitch: 48 + (index % 24), startBeat: Math.floor(index / 100), durationBeat: 1 });
    }
    const run = analyzeTimeline(notes);
    expect(run.evidence.slotCount).toBe(2_000);
    expect(run.result.timeline.segments.length).toBeGreaterThan(0);
  });
});
