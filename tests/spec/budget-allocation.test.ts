import {
  analyzeArrangement,
  analyzePolyphony,
  chordTimelineFromNotes,
  detectModulations,
  keyTimelineFromNotes,
  motifFromNotes,
  phrasesFromTimeline,
  sectionsFromNotes,
} from '@libraz/libcantus/analyze';
import {
  BudgetExceededError,
  DEFAULT_GENERATION_BUDGET,
  type NoteEvent,
} from '@libraz/libcantus/core';
import { generateBassLine, placeLicks } from '@libraz/libcantus/generate';
import { Arrangement, Motif, Score } from '@libraz/libcantus/model';
import { type ChordSegment, majorKey, makeChord } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';
import { growthFactor } from './support/growth.js';

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
});

describe('grid segmentation pays for no search', () => {
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

describe('the key budget bounds the candidate table the search fills', () => {
  /** `count` bar-long chords, I IV V7 I in a tonic that moves every four bars. */
  function modulatingChords(count: number): ChordSegment[] {
    return Array.from({ length: count }, (_, index) => {
      const tonic = (Math.floor(index / 4) * 6) % 12;
      const degree = [0, 5, 7, 0][index % 4] ?? 0;
      return {
        startBeat: index * 4,
        endBeat: (index + 1) * 4,
        chord: makeChord((tonic + degree) % 12, index % 4 === 2 ? 'dom7' : 'maj'),
      };
    });
  }

  it('refuses a span whose candidate rows outweigh its slot count', () => {
    // Two notes a million beats apart: the slots alone sit inside the budget,
    // while the table the search fills — a row of twenty-four keys per slot,
    // kept for the whole call — is six times it.
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 999_998, durationBeat: 1 },
    ];
    expect(() => keyTimelineFromNotes(notes)).toThrow(BudgetExceededError);
    expect(() => keyTimelineFromNotes(notes)).toThrow(/key timeline slots/);
  });

  it('refuses the chord path the same way', () => {
    // Fifty thousand chord segments: a twentieth of the budget by count, and
    // over it by the table those counts stand for.
    const chords = modulatingChords(50_000);
    expect(chords.length).toBeLessThan(DEFAULT_GENERATION_BUDGET);
    expect(() => detectModulations(chords)).toThrow(BudgetExceededError);
    expect(() => detectModulations(chords)).toThrow(/modulation chord segments/);
  });

  it('takes the budget the caller names, on either surface', () => {
    const chords = modulatingChords(16);
    expect(() => detectModulations(chords, { budget: 100 })).toThrow(BudgetExceededError);
    // Sixteen slots against twenty-four keys is the table the search fills, and
    // at that budget it is written.
    expect(detectModulations(chords, { budget: 16 * 24 }).length).toBeGreaterThan(0);
  });

  it('reads every chord of an accepted span once', () => {
    // Forty thousand chords is the largest chord run the default budget admits,
    // and it modulates ten thousand times. Every stage after the search — the
    // shortest-region merge, each region's confidence, each boundary's pivot —
    // once asked its question of the whole chord list, so a span the budget
    // accepted spent thirty times the search on scans whose answer never
    // changed. Only the time says which reading ran, since the regions are the
    // same either way, and only how it grows says it without depending on how
    // busy the machine is: eight times the chords is eight times the work when
    // each is read once, and sixty-four when each is read once per region.
    const regions = detectModulations(modulatingChords(40_000));
    expect(regions.length).toBe(10_000);
    expect(regions[0]?.startBeat).toBe(0);
    expect(regions[regions.length - 1]?.endBeat).toBe(160_000);
    expect(
      growthFactor(8, (scale) => detectModulations(modulatingChords(5_000 * scale))),
    ).toBeLessThan(24);
  }, 30_000);
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

describe('the budget bounds the bars a bass part lays figures over', () => {
  const chord = makeChord(0, 'maj7');

  it('refuses a segment running past the music before laying a single bar', () => {
    // One segment, a loop length wide. The segment count sits inside the budget
    // and always will — it is one — while the bars that one segment holds are
    // hundreds of millions, and each of them lays a figure. A host reading a
    // segment out of a project file or off a DAW's loop markers reaches this
    // with an `endBeat` nobody chose.
    const timeline = [{ startBeat: 0, endBeat: 1e9, chord }];
    expect(() => placeLicks(timeline, majorKey(0), { genre: 'motown' })).toThrow(
      BudgetExceededError,
    );
    expect(() => placeLicks(timeline, majorKey(0), { genre: 'motown' })).toThrow(/lick bars/);
  });

  it('refuses an end beat at the edge of the safe integers', () => {
    const timeline = [{ startBeat: 0, endBeat: Number.MAX_SAFE_INTEGER, chord }];
    expect(() => placeLicks(timeline, majorKey(0), { genre: 'motown' })).toThrow(
      BudgetExceededError,
    );
  });

  it('refuses the same span the phrase-shape styles already refuse', () => {
    // The two surfaces reach the same bar tiling, so a span one of them will not
    // lay is a span the other will not lay either.
    const segments = [{ startBeat: 0, endBeat: 1e9, chord }];
    expect(() => generateBassLine({ segments, key: majorKey(0), style: 'pop' })).toThrow(
      BudgetExceededError,
    );
  });

  it('takes the budget the caller names, on either surface', () => {
    const timeline = [{ startBeat: 0, endBeat: 64, chord }];
    expect(() => placeLicks(timeline, majorKey(0), { genre: 'motown', budget: 4 })).toThrow(
      BudgetExceededError,
    );
    // Sixteen bars of four beats: at the count the budget allows, the figures
    // are written.
    expect(
      placeLicks(timeline, majorKey(0), { genre: 'motown', budget: 16 }).length,
    ).toBeGreaterThan(0);
  });
});

describe('the budget bounds the comparisons a polyphonic reading makes', () => {
  /** A chorale-thick passage: `voices` notes on every beat, for `beats` beats. */
  function stacked(beats: number, voices: number): NoteEvent[] {
    const notes: NoteEvent[] = [];
    for (let beat = 0; beat < beats; beat += 1) {
      for (let voice = 0; voice < voices; voice += 1) {
        notes.push({ pitch: 20 + voice, startBeat: beat, durationBeat: 1 });
      }
    }
    return notes;
  }

  it('refuses a passage whose note-voice product exceeds the budget', () => {
    // The note count alone passes every flat check: 200 voices over 6,000 beats
    // is 1.2 million notes against a budget of a million... so make it fewer
    // notes than that and let the product be what fails.
    const notes = stacked(200, 100);
    expect(notes.length).toBeLessThan(DEFAULT_GENERATION_BUDGET);
    expect(() => analyzePolyphony(notes, () => null, majorKey(0))).toThrow(BudgetExceededError);
    expect(() => analyzePolyphony(notes, () => null, majorKey(0))).toThrow(
      /polyphony note-voice comparisons/,
    );
  });

  it('refuses it through the class surface too', () => {
    expect(() => Score.of(stacked(200, 100)).voices()).toThrow(BudgetExceededError);
  });

  it('reads a passage inside the budget', () => {
    const notes = stacked(8, 4);
    expect(analyzePolyphony(notes, () => null, majorKey(0))).toHaveLength(notes.length);
  });
});
