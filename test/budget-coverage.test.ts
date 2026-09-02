import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { createArrangementSession } from '../src/analyze/arrange/session.js';
import { tensionCurve } from '../src/analyze/arrange/tension.js';
import { hypermeter } from '../src/analyze/form/hypermeter.js';
import { phrasesFromTimeline } from '../src/analyze/form/phrase.js';
import { sectionsFromNotes } from '../src/analyze/form/section.js';
import { extractMotifs } from '../src/analyze/melody/index.js';
import { spellLine } from '../src/analyze/spelling/index.js';
import type { ChordTimeline } from '../src/analyze/timeline/index.js';
import { chordTimelineFromChords, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { beatsToTiedDurations } from '../src/core/duration/index.js';
import { BudgetExceededError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { DEFAULT_GENERATION_BUDGET } from '../src/core/validation/index.js';
import { generateBassLine } from '../src/generate/bass/index.js';
import { placeLicks } from '../src/generate/bass/licks.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { placeDrumPattern } from '../src/generate/drums/vocabulary.js';
import { applyGrooveTemplate } from '../src/generate/groove/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { developMotif, generateMotif } from '../src/generate/motif/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { Score } from '../src/model/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { scalesForChanges } from '../src/theory/chordscale/index.js';
import type { SafetyQuery } from '../src/theory/safety/index.js';
import { evaluateSafety } from '../src/theory/safety/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { voiceChord, voiceProgression } from '../src/theory/voicing/satb.js';
import { filesUnder, SRC, TESTS } from './support/source-files.js';

/**
 * The budget guards, derived from the sources rather than listed by hand.
 *
 * A guard that is moved behind the allocation it was meant to precede, dropped
 * in a refactor, or renamed still leaves the library compiling and every other
 * test passing — the failure it prevents is a host freezing on an imported
 * file, which no unit test sees unless one asks for it. What makes that
 * catchable is that the subject is read out of the tree: a guard added later is
 * in the check the moment it is written, and one whose label has drifted from
 * what a test names is a guard nothing reaches any more.
 */

/** Every literal label an `assertGenerationBudget` call names, with its module. */
function budgetLabels(): { label: string; rel: string }[] {
  const found: { label: string; rel: string }[] = [];
  for (const file of filesUnder(SRC, '.ts')) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    for (const match of source.matchAll(/assertGenerationBudget\(([\s\S]*?)\);/g)) {
      const call = match[1] ?? '';
      // The label is the second argument. A call whose label is built from a
      // name the caller passed in carries no literal to look for, and the
      // guard it belongs to is reached through whichever entry point supplies
      // that name — those are covered under the entry point's own label.
      const label = call.match(/,\s*'([^']+)'/);
      if (label?.[1] !== undefined) {
        found.push({ label: label[1], rel });
      }
    }
  }
  return found;
}

/**
 * Guards whose label no test names, and why that is what it should be.
 *
 * An entry here is a statement that the guard cannot be reached with an input
 * a test can build, not that nobody has got round to it. Everything else
 * belongs in a test that gives the guard an estimate over its own cap and reads
 * the label back out of the refusal.
 */
const NOT_REACHED_BY_A_TEST: Readonly<Record<string, string>> = {
  'progression chords': 'the bar count is checked as a positive integer against the same cap first',
  'countermelody pitch candidates':
    'the register is clamped to the MIDI range first, so the widest one is 128 pitches',
  'safe pitch candidates':
    'both bounds are MIDI pitches, so the widest span enumerated is 128 pitches',
  'euclidean pattern steps':
    'the step count is checked as a positive integer against the same cap first',
  'groove template slots':
    'the slot count is checked as a positive integer against the same cap first',
};

describe('every budget guard is reached by a test', () => {
  const labels = budgetLabels();
  const suite = filesUnder(TESTS, '.ts')
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('finds the guards to check', () => {
    // The scan reads sources rather than a list, so a parser that stopped
    // matching would leave the check below passing over nothing.
    expect(labels.length).toBeGreaterThan(30);
    expect(new Set(labels.map(({ label }) => label)).size).toBeGreaterThan(30);
  });

  it('names every label somewhere in the suite', () => {
    const unreached = [...new Set(labels.map(({ label }) => label))]
      .filter((label) => !(label in NOT_REACHED_BY_A_TEST))
      .filter((label) => !suite.includes(label))
      .sort();
    expect(unreached).toEqual([]);
  });

  it('lists nothing as unreachable that no guard names any more', () => {
    const live = new Set(labels.map(({ label }) => label));
    expect(Object.keys(NOT_REACHED_BY_A_TEST).filter((label) => !live.has(label))).toEqual([]);
  });
});

/**
 * An array of `count` holes.
 *
 * Every guard here reads a length before it reads an element, which is what
 * makes the check worth having: the request is refused before the array it
 * describes is walked. A sparse array measures exactly that, and costs nothing
 * to build — a million records allocated only to be rejected would be the very
 * thing the guard exists to prevent.
 */
function holes<T>(count: number): T[] {
  return new Array(count) as T[];
}

/** One note per beat, `count` of them. */
function run(count: number): NoteEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    pitch: 60 + (index % 12),
    startBeat: index,
    durationBeat: 1,
  }));
}

const OVER = DEFAULT_GENERATION_BUDGET + 1;
const C_MAJOR = majorKey(0);
const C_TRIAD = makeChord(0, 'maj');

/** `count` notes an even `per` to the beat, so a piece is dense but short. */
function dense(count: number, per: number): NoteEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    pitch: 48 + (index % 24),
    startBeat: Math.floor(index / per),
    durationBeat: 1,
  }));
}

/** `voices` notes struck on each of `beats` beats. */
function stacked(beats: number, voices: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let beat = 0; beat < beats; beat += 1) {
    for (let voice = 0; voice < voices; voice += 1) {
      notes.push({ pitch: 20 + voice, startBeat: beat, durationBeat: 1 });
    }
  }
  return notes;
}

/** A timeline of `count` bar-long chords, built without a search. */
function chordRun(count: number): ChordTimeline {
  return chordTimelineFromChords(
    Array.from({ length: count }, (_, index) => ({
      rootPc: (index * 5) % 12,
      quality: 'maj' as const,
      startBeat: index * 4,
    })),
    count * 4,
  );
}

/** Read a melody for phrases against a timeline cut from the melody itself. */
function phraseRun(notes: NoteEvent[]): unknown {
  const { timeline } = chordTimelineFromNotes(notes, { segmentation: 'grid' });
  return phrasesFromTimeline(timeline, notes);
}

/** A safety query around the given voices, with everything else valid. */
function safetyQuery(otherVoices: { pitch: number }[]): SafetyQuery {
  return {
    profile: 'pop',
    candidatePitch: 60,
    chord: C_TRIAD,
    key: C_MAJOR,
    otherVoices,
    strongBeat: true,
  };
}

/**
 * Each guard, and a call that gives it more than its own cap.
 *
 * Written as a table rather than as a test each, so that adding a guard to the
 * library is met by adding a row here — the scan above is what says a row is
 * missing, and the row is what says the guard still refuses.
 */
const REACHES: readonly { label: string; run: () => unknown }[] = [
  { label: 'arrangement tracks', run: () => analyzeArrangement(holes(OVER)) },
  {
    // Two short tracks against a budget that admits either alone: what the
    // pooled analysis works on is both of them.
    label: 'arrangement notes',
    run: () => analyzeArrangement([{ notes: run(10) }, { notes: run(10) }], { budget: 15 }),
  },
  {
    label: 'arrangement note-voice comparisons',
    run: () =>
      analyzeArrangement(
        Array.from({ length: 60 }, () => ({ notes: run(400) })),
        { budget: 100_000 },
      ),
  },
  {
    label: 'arrangement edits',
    run: () => createArrangementSession([{ notes: run(4) }]).update(holes(OVER)),
  },
  {
    label: 'tension samples',
    // The harmony is handed in, so what the budget is left bounding is the
    // sampling: ten notes over ten beats, sampled twice a beat.
    run: () =>
      tensionCurve([{ notes: run(10) }], {
        step: 0.5,
        budget: 10,
        timeline: chordRun(4),
        key: C_MAJOR,
      }),
  },
  {
    label: 'tension sample-voice comparisons',
    run: () =>
      tensionCurve(
        Array.from({ length: 40 }, () => ({ notes: run(200) })),
        { budget: 100_000 },
      ),
  },
  {
    label: 'polyphony note-voice comparisons',
    // A hundred voices on each of two hundred beats: the notes alone sit well
    // inside the budget, and every one of them is read against every voice.
    run: () => Score.of(stacked(200, 100)).voices(),
  },
  { label: 'timeline chords', run: () => chordTimelineFromChords(holes(OVER), 16) },
  {
    label: 'chord-scale changes',
    run: () => scalesForChanges(holes(OVER)),
  },
  { label: 'motif windows', run: () => extractMotifs(run(200_000)) },
  {
    label: 'line spelling states',
    run: () => spellLine(run(200_000), null, C_MAJOR),
  },
  {
    label: 'form bars',
    run: () => hypermeter(run(4), '4/4', { totalBeats: 8_000_000 }),
  },
  {
    label: 'form note-to-bar memberships',
    // Two notes each held over six hundred thousand bars: the bars themselves
    // are inside the budget, and each note belongs to every one of them.
    run: () =>
      hypermeter(
        [
          { pitch: 60, startBeat: 0, durationBeat: 2_400_000 },
          { pitch: 64, startBeat: 0, durationBeat: 2_400_000 },
        ],
        '4/4',
      ),
  },
  {
    label: 'form phrase boundary pairs',
    // Eight notes spread over ten thousand bars of chords: nothing about the
    // melody is large, and the boundaries the phrase search pairs off are.
    run: () =>
      phrasesFromTimeline(
        chordRun(10_000),
        Array.from({ length: 8 }, (_, index) => ({
          pitch: 60 + index,
          startBeat: index * 5_000,
          durationBeat: 1,
        })),
      ),
  },
  {
    label: 'form repetition comparisons',
    run: () => phraseRun(run(4000)),
  },
  {
    label: 'form repetition melody comparisons',
    // Four thousand notes over eight bars: the slices times the notes sit
    // inside the budget, and the two windows either side of the middle bar
    // hold two thousand notes each.
    run: () => phraseRun(dense(4_000, 125)),
  },
  {
    label: 'form section comparisons',
    run: () => sectionsFromNotes(run(40_000), { unitBars: 4 }),
  },
  {
    label: 'form section unit notes',
    run: () => sectionsFromNotes(dense(40_000, 100), { unitBars: 2 }),
  },
  {
    label: 'form section melody comparisons',
    run: () => sectionsFromNotes(dense(40_000, 100), { unitBars: 4 }),
  },
  {
    label: 'hypermeter readings',
    run: () => hypermeter(run(4), '4/4', { totalBeats: 200_000, budget: 100_000 }),
  },
  { label: 'bass segments', run: () => generateBassLine({ segments: holes(OVER), key: C_MAJOR }) },
  {
    label: 'bass notes',
    run: () =>
      generateBassLine({
        segments: [{ startBeat: 0, endBeat: 4_000_000, chord: C_TRIAD }],
        key: C_MAJOR,
        style: 'walking',
      }),
  },
  {
    label: 'lick segments',
    run: () => placeLicks(holes(OVER), C_MAJOR, { genre: 'motown' }),
  },
  {
    label: 'rhythm grid slots',
    run: () => generateRhythm('4/4', { bars: 1000, subdivision: 1000 }),
  },
  { label: 'motif notes', run: () => generateMotif({ key: C_MAJOR, bars: 600_000 }) },
  { label: 'drum hits', run: () => generateDrums({ bars: 10_000, genre: 'rock' }) },
  {
    label: 'drum pattern hits',
    run: () => placeDrumPattern({ bars: 20_000, genre: 'rock' }),
  },
  {
    label: 'template slots',
    run: () =>
      applyGrooveTemplate(run(4), { subdivision: 4, slotsPerBar: 16, slots: holes(OVER) }, '4/4'),
  },
  { label: 'other voices', run: () => evaluateSafety(safetyQuery(holes(OVER))) },
  { label: 'voice ranges', run: () => voiceChord(C_TRIAD, { ranges: holes(129) }) },
  {
    label: 'voiced progression chords',
    run: () => voiceProgression(holes(OVER)),
  },
  {
    label: 'harmonic segments',
    // One note held over a million beats, cut on the harmonic rhythm.
    run: () =>
      harmonizeMelody({
        melody: [{ pitch: 60, startBeat: 0, durationBeat: 8_000_000 }],
        key: C_MAJOR,
      }),
  },
  {
    label: 'note-to-segment memberships',
    // Two hundred notes each held across the whole line: the segments and the
    // notes both sit inside the budget, and every note belongs to every segment.
    run: () =>
      harmonizeMelody({
        melody: Array.from({ length: 200 }, (_, index) => ({
          pitch: 60 + (index % 12),
          startBeat: index,
          durationBeat: 8_000,
        })),
        key: C_MAJOR,
        budget: 200_000,
      }),
  },
  {
    label: 'harmonization placement search',
    // The placement search visits every pair of candidate chords in every slot
    // for every transposition, which is the one stage a long line cannot pay
    // for out of the counts the earlier checks bound.
    run: () =>
      harmonizeMelody({
        melody: run(2_000),
        key: C_MAJOR,
        placement: { transposeSearch: true, octaveSearch: true },
      }),
  },
  {
    label: 'countermelody grid',
    // One note held over a million beats: the counter line is written on a grid
    // of half beats across the melody's whole span.
    run: () =>
      generateCounterMelody({
        melody: [{ pitch: 60, startBeat: 0, durationBeat: 4_000_000 }],
        key: C_MAJOR,
        chordAt: () => C_TRIAD,
      }),
  },
  {
    label: 'chord change beats',
    run: () =>
      generateCounterMelody({
        melody: run(4),
        key: C_MAJOR,
        chordAt: () => C_TRIAD,
        chordChangeBeats: holes(OVER),
      }),
  },
  {
    label: 'developed motif notes',
    // A four-note cell tiled over a million bars.
    run: () => developMotif({ notes: run(4) }, chordRun(4), C_MAJOR, 400_000, '4/4'),
  },
  {
    label: 'tie chain length',
    run: () => beatsToTiedDurations(8_000_000),
  },
];

describe('every budget guard refuses what it is there to refuse', () => {
  it.each(REACHES)('$label', ({ label, run: call }) => {
    expect(call).toThrow(BudgetExceededError);
    expect(call).toThrow(new RegExp(label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
  });
});
