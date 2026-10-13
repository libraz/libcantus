import {
  analyzeArrangement,
  analyzeReference,
  analyzeRhythm,
  type ChordTimeline,
  chordTimelineFromChords,
  chordTimelineFromNotes,
  compareReferences,
  createArrangementSession,
  extractMotifs,
  hypermeter,
  motifFromNotes,
  motifGraph,
  phrasesFromTimeline,
  sectionsFromNotes,
  spellLine,
  tensionCurve,
} from '@libraz/libcantus/analyze';
import {
  BudgetExceededError,
  beatsToTiedDurations,
  DEFAULT_GENERATION_BUDGET,
  type NoteEvent,
} from '@libraz/libcantus/core';
import {
  applyGrooveTemplate,
  type CompositionPlan,
  deriveCompositionPlan,
  developMotif,
  evaluateComposition,
  generateBassLine,
  generateCounterMelody,
  generateDrums,
  generateMelody,
  generateMotif,
  generateRhythm,
  harmonizeMelody,
  placeDrumPattern,
  placeLicks,
} from '@libraz/libcantus/generate';
import { Score } from '@libraz/libcantus/model';
import {
  evaluateSafety,
  majorKey,
  makeChord,
  resolveKey,
  type SafetyQuery,
  scalesForChanges,
  voiceChord,
  voiceProgression,
} from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';
import { SOURCE_SONG } from './support/reference-fixtures.js';

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

/** The source song's reference profile, as the plan guards read it. */
function sourceReference(): ReturnType<typeof analyzeReference> {
  return analyzeReference(SOURCE_SONG.notes, {
    meters: SOURCE_SONG.meters,
    key: SOURCE_SONG.key,
    melody: SOURCE_SONG.melody,
  });
}

/** A one-phrase, motif-free plan over eight bars of C major in the given register. */
function freePlan(register: { low: number; high: number }, onsetDensity: number): CompositionPlan {
  return {
    planVersion: 1,
    seed: 0,
    algorithmVersion: 1,
    keys: [resolveKey('C major')],
    meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
    span: { startBeat: 0, endBeat: 32, bars: 8 },
    sections: [{ label: 'A', startBeat: 0, endBeat: 32 }],
    phrases: [
      {
        startBeat: 0,
        endBeat: 32,
        section: 0,
        cadence: null,
        shape: 'arch',
        peakPosition: 0.6,
        register: { ...register, mean: (register.low + register.high) / 2 },
        onsetDensity,
        motifs: [],
      },
    ],
    harmony: [{ startBeat: 0, endBeat: 32, key: 0, roman: 'I' }],
    motifs: [],
    rhythm: {
      onsetLevels: [0, 1, 2, 3, 4, 5].map((level) => level / 15),
      interOnsetShares: new Array(17).fill(1 / 17),
      syncopation: 0,
    },
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
  {
    label: 'drum hits',
    run: () => generateDrums({ bars: 10_000, style: 'standard', section: 'chorus' }),
  },
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
  {
    label: 'rhythm analysis slots',
    // A million-beat span at 48 slots a bar, against a budget of ten.
    run: () =>
      analyzeRhythm([{ pitch: 60, startBeat: 0, durationBeat: 1 }], {
        totalBeats: 1_000_000,
        budget: 10,
      }),
  },
  {
    label: 'motif graph comparisons',
    // Fifty statements of the same three-note cell: cheap to read as notes,
    // but the 50x50 comparisons the graph builds from them are not.
    run: () => {
      const melody = Array.from({ length: 50 }, (_, i) =>
        [60, 62, 67].map((pitch, j) => ({ pitch, startBeat: i * 4 + j, durationBeat: 1 })),
      ).flat();
      const motifs = Array.from({ length: 50 }, (_, i) => {
        const data = motifFromNotes(
          [60, 62, 67].map((pitch, j) => ({ pitch, startBeat: i * 4 + j, durationBeat: 1 })),
        );
        return { ...data, occurrences: data.occurrences.map((o) => ({ ...o, noteIndex: i * 3 })) };
      });
      return motifGraph(melody, motifs, { budget: 500 });
    },
  },
  {
    label: 'reference progression alignment',
    // The source song's structural chords against themselves; a budget of one
    // cell admits none of the alignment.
    run: () => {
      const profile = sourceReference();
      return compareReferences(profile, profile, { budget: 1 });
    },
  },
  {
    label: 'plan motif selection',
    // The source song's graph nodes against its phrases; a budget of one pair
    // admits none of them.
    run: () => deriveCompositionPlan(sourceReference(), { budget: 1 }),
  },
  {
    label: 'melody pitch search',
    // Thirty-two searched notes over a three-octave register.
    run: () => generateMelody(freePlan({ low: 48, high: 84 }, 4), { budget: 100 }),
  },
  {
    label: 'melody onset slots',
    // One searched note on one pitch (9 states) but 128 sixteenth slots to draw from.
    run: () => generateMelody(freePlan({ low: 60, high: 60 }, 0.1), { budget: 100 }),
  },
  {
    label: 'evaluated melody count',
    // Two notes against a budget of one: the melody is refused before it is read.
    run: () => evaluateComposition(run(2), freePlan({ low: 60, high: 72 }, 1), { budget: 1 }),
  },
];

describe('every budget guard refuses what it is there to refuse', () => {
  it.each(REACHES)('$label', ({ label, run: call }) => {
    expect(call).toThrow(BudgetExceededError);
    expect(call).toThrow(new RegExp(label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
  });
});
