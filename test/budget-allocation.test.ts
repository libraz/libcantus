import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { phrasesFromTimeline } from '../src/analyze/form/phrase.js';
import { sectionsFromNotes } from '../src/analyze/form/section.js';
import { motifFromNotes } from '../src/analyze/melody/index.js';
import { analyzeTimeline, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { BudgetExceededError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { DEFAULT_GENERATION_BUDGET } from '../src/core/validation/index.js';
import { Arrangement, Motif, Score } from '../src/model/index.js';

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
  it('refuses a span whose search table would dwarf the budget', () => {
    // Two notes, a million beats apart: the slot count alone sits inside the
    // budget, while the table the search would fill is 144 times it.
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 999_998, durationBeat: 1 },
    ];
    expect(() => chordTimelineFromNotes(notes)).toThrow(BudgetExceededError);
    expect(() => chordTimelineFromNotes(notes)).toThrow(/timeline windows/);
  });

  it('refuses the same span through a finer chord resolution', () => {
    // `minChordBeats` multiplies the slot count without touching the note
    // count, so it is the other way to ask for a table nothing bounded.
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 10, durationBeat: 1 },
    ];
    expect(() => chordTimelineFromNotes(notes, { minChordBeats: 0.00004 })).toThrow(
      BudgetExceededError,
    );
  });

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

  it('reports the segments it reported before', () => {
    // One bar each of C, F, G, C, cut on the grid: what the search would have
    // scored the slots for changes none of it.
    const notes: NoteEvent[] = [
      ...[60, 64, 67].map((pitch) => ({ pitch, startBeat: 0, durationBeat: 4 })),
      ...[53, 57, 60].map((pitch) => ({ pitch, startBeat: 4, durationBeat: 4 })),
      ...[55, 59, 62].map((pitch) => ({ pitch, startBeat: 8, durationBeat: 4 })),
      ...[48, 52, 55].map((pitch) => ({ pitch, startBeat: 12, durationBeat: 4 })),
    ];
    const grid = chordTimelineFromNotes(notes, { segmentation: 'grid', harmonicRhythm: 4 });
    expect(grid.timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 4, 8, 12]);
    expect(grid.timeline.segments.map((segment) => segment.chord.rootPc)).toEqual([0, 5, 7, 0]);
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

describe('the form budget bounds the melodic comparisons', () => {
  /** Forty thousand notes over a hundred bars of 4/4. */
  function densePiece(): NoteEvent[] {
    const notes: NoteEvent[] = [];
    for (let index = 0; index < 40_000; index += 1) {
      notes.push({
        pitch: 48 + (index % 24),
        startBeat: Math.floor(index / 100),
        durationBeat: 1,
      });
    }
    return notes;
  }

  it('refuses sections whose unit comparisons run for seconds', () => {
    // The pair count and the unit-notes product are both inside the budget; the
    // edit distances the pairs actually run are not.
    expect(() => sectionsFromNotes(densePiece(), { unitBars: 4 })).toThrow(BudgetExceededError);
    expect(() => sectionsFromNotes(densePiece(), { unitBars: 4 })).toThrow(/melody comparisons/);
  });

  it('refuses phrases over a piece of that size', () => {
    const notes = densePiece();
    const { timeline } = chordTimelineFromNotes(notes, { segmentation: 'grid' });
    expect(() => phrasesFromTimeline(timeline, notes)).toThrow(BudgetExceededError);
  });

  it('refuses repetition comparisons the coarser counts admit', () => {
    // Four thousand notes over eight bars: the slices times the notes — the
    // count the pass checked before — is a thirtieth of the budget, while the
    // two windows either side of the middle bar hold two thousand notes each
    // and the distance between them is four times it.
    const notes: NoteEvent[] = [];
    for (let index = 0; index < 4_000; index += 1) {
      notes.push({
        pitch: 48 + (index % 24),
        startBeat: Math.floor(index / 125),
        durationBeat: 1,
      });
    }
    const { timeline } = chordTimelineFromNotes(notes, { segmentation: 'grid' });
    expect(() => phrasesFromTimeline(timeline, notes)).toThrow(BudgetExceededError);
    expect(() => phrasesFromTimeline(timeline, notes)).toThrow(/repetition melody comparisons/);
  });

  it('leaves an ordinary piece alone', () => {
    const notes: NoteEvent[] = [];
    for (let bar = 0; bar < 8; bar += 1) {
      for (let beat = 0; beat < 4; beat += 1) {
        notes.push({ pitch: 60 + ((bar + beat) % 5), startBeat: bar * 4 + beat, durationBeat: 1 });
      }
    }
    const sections = sectionsFromNotes(notes, { unitBars: 2 });
    expect(sections.length).toBeGreaterThan(0);
    const { timeline } = chordTimelineFromNotes(notes);
    expect(phrasesFromTimeline(timeline, notes).length).toBeGreaterThan(0);
  });
});

/**
 * The class API is the same engine, so it is held to the same bound.
 *
 * A class that keeps a caller's array as what it is made of — the notes of a
 * score, of a motif cell, of an arrangement track — has taken on exactly the
 * allocation the function API caps. Refusing in one and not the other would
 * make the choice between them a choice about how much memory a document can
 * spend, which is not what picking a class is for.
 */
describe('the class construction paths hold the note-event budget the functions hold', () => {
  /**
   * One note past the budget, without the notes.
   *
   * The count is what the budget caps and it is read before the elements are,
   * so a sparse array of that length measures the bound without allocating a
   * million records to be rejected.
   */
  const overBudget = () => new Array(DEFAULT_GENERATION_BUDGET + 1) as NoteEvent[];

  /** A track short enough that only a named budget can refuse it. */
  const shortTrack: NoteEvent[] = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 62, startBeat: 1, durationBeat: 1 },
    { pitch: 64, startBeat: 2, durationBeat: 1 },
  ];

  it('refuses through a class where the function refuses', () => {
    expect(() => analyzeArrangement([{ notes: overBudget() }])).toThrow(BudgetExceededError);
    expect(() => Arrangement.of([{ notes: overBudget() }])).toThrow(BudgetExceededError);
    expect(() => motifFromNotes(overBudget())).toThrow(BudgetExceededError);
    expect(() => Motif.fromNotes(overBudget())).toThrow(BudgetExceededError);
    expect(() => Score.of(overBudget())).toThrow(BudgetExceededError);
  });

  it('names the same cap in the refusal', () => {
    const cap = new RegExp(`exceeds the generation budget ${DEFAULT_GENERATION_BUDGET}`);
    expect(() => Score.of(overBudget())).toThrow(cap);
    expect(() => Motif.fromNotes(overBudget())).toThrow(cap);
    expect(() => Arrangement.of([{ notes: overBudget() }])).toThrow(cap);
  });

  it('takes the budget the settings name, as the analysis takes it', () => {
    expect(() => analyzeArrangement([{ notes: shortTrack }], { budget: 2 })).toThrow(
      BudgetExceededError,
    );
    expect(() => Arrangement.of([{ notes: shortTrack }], { budget: 2 })).toThrow(
      BudgetExceededError,
    );
    // At the count the budget allows, both take the track on.
    expect(Arrangement.of([{ notes: shortTrack }], { budget: 3 }).tracks[0]?.notes).toHaveLength(3);
  });
});
