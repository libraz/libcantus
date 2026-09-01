import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { ALGORITHM_VERSION, deriveSeed, MIN_ALGORITHM_VERSION } from '../src/core/random/index.js';
import type { NoteEvent } from '../src/core/types.js';
import type { BassSegment } from '../src/generate/bass/index.js';
import { generateBassLine, placeLicks } from '../src/generate/bass/index.js';
import type { GenerationContext, GenerationContextInput } from '../src/generate/context/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { generateDrums, placeDrumPattern } from '../src/generate/drums/index.js';
import { humanize } from '../src/generate/groove/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { ornament } from '../src/generate/ornament/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

/**
 * Generated output recorded per algorithm version.
 *
 * A generator is a pure function of its inputs, so comparing one call against a
 * second call of the same build says nothing about whether the music moved.
 * Only a value held in the repository can say that. If a literal below has to
 * be edited to make the suite pass, then the same seed at the same version now
 * yields a different piece: that is never invisible, and it is only ever right
 * to edit one when the notes it recorded were themselves wrong. Correcting one
 * belongs in the changelog beside the fix that moved it.
 */

const SEED = 42;
const cMajor = majorKey(0);
const ts = parseTimeSignature('4/4');

const melody: readonly NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 64, startBeat: 1, durationBeat: 1 },
  { pitch: 67, startBeat: 2, durationBeat: 1 },
  { pitch: 65, startBeat: 3, durationBeat: 1 },
];

const timeline = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
  { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj7') },
  { startBeat: 8, endBeat: 12, chord: makeChord(7, 'dom7') },
  { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj7') },
];

const segments: readonly BassSegment[] = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
  { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
  { startBeat: 8, endBeat: 12, chord: makeChord(9, 'min') },
  { startBeat: 12, endBeat: 16, chord: makeChord(5, 'maj') },
];

/**
 * One call per generator that takes a generation context, with everything but
 * the seed and the algorithm version fixed here.
 */
const CASES: readonly {
  readonly name: string;
  /** Whether the seed reaches this generator at these settings. */
  readonly seeded: boolean;
  readonly run: (ctx: GenerationContextInput) => unknown;
}[] = [
  {
    name: 'generateDrums',
    seeded: true,
    run: (ctx) => generateDrums({ bars: 1, style: 'funk', section: 'chorus', ctx }),
  },
  {
    name: 'placeDrumPattern',
    seeded: true,
    run: (ctx) => placeDrumPattern({ bars: 1, genre: 'funk', ctx }),
  },
  {
    name: 'placeLicks',
    seeded: true,
    run: (ctx) => placeLicks(timeline, cMajor, { genre: 'motown', ctx }),
  },
  { name: 'generateRhythm', seeded: true, run: (ctx) => generateRhythm(ts, { bars: 2, ctx }) },
  {
    name: 'generateBassLine',
    seeded: true,
    run: (ctx) => generateBassLine({ segments, key: cMajor, style: 'walking', ctx }),
  },
  {
    name: 'generateMotif',
    seeded: true,
    run: (ctx) => generateMotif({ key: cMajor, bars: 2, jitter: 0.5, ctx }),
  },
  {
    // The harmonizer searches rather than draws: its result is settled by the
    // melody, the key and the dials alone. Its output is recorded all the same,
    // because a change to that search moves the chords under a saved seed just
    // as a change to a draw path would.
    name: 'harmonizeMelody',
    seeded: false,
    run: (ctx) => harmonizeMelody({ melody, key: cMajor, harmonicRhythm: 1, ctx }),
  },
  {
    name: 'generateCounterMelody',
    seeded: true,
    run: (ctx) =>
      generateCounterMelody({
        melody,
        key: cMajor,
        rhythm: 'complement',
        chordAt: (beat) => timeline[Math.floor(beat / 4)]?.chord ?? null,
        ctx,
      }),
  },
  { name: 'ornament', seeded: true, run: (ctx) => ornament(melody, { style: 'drag', ctx }) },
  {
    name: 'generateProgression',
    seeded: true,
    run: (ctx) => generateProgression({ key: cMajor, style: 'dance', bars: 4, ctx }),
  },
  { name: 'humanize', seeded: true, run: (ctx) => humanize(melody, { timing: 0.04, ctx }) },
];

/** The context every case runs under, at one algorithm version. */
function contextAt(algorithmVersion: number): GenerationContext {
  return {
    seed: SEED,
    bpm: 120,
    algorithmVersion,
    complexity: { rhythmic: 0.9, ornament: 0.6, harmonic: 0.5 },
  } as GenerationContext;
}

/** Every algorithm version this build still produces. */
const VERSIONS = Array.from(
  { length: ALGORITHM_VERSION - MIN_ALGORITHM_VERSION + 1 },
  (_, index) => MIN_ALGORITHM_VERSION + index,
);

/**
 * What each generator returned at seed 42, by algorithm version.
 *
 * `MIN_ALGORITHM_VERSION` and `ALGORITHM_VERSION` are the same number today, so
 * the table holds one block. Raising `ALGORITHM_VERSION` adds a block for the
 * new number, and the older block is then what that number draws.
 */
const GOLDEN: Record<number, Record<string, unknown>> = {
  1: {
    generateDrums: [
      {
        pitch: 36,
        startBeat: 0,
        durationBeat: 0.5,
        velocity: 99,
      },
      {
        pitch: 42,
        startBeat: 0,
        durationBeat: 0.125,
        velocity: 109,
      },
      {
        pitch: 49,
        startBeat: 0,
        durationBeat: 0.5,
        velocity: 111,
      },
      {
        pitch: 82,
        startBeat: 0,
        durationBeat: 0.25,
        velocity: 69,
      },
      {
        pitch: 42,
        startBeat: 0.25,
        durationBeat: 0.125,
        velocity: 59,
      },
      {
        pitch: 82,
        startBeat: 0.25,
        durationBeat: 0.25,
        velocity: 40,
      },
      {
        pitch: 42,
        startBeat: 0.5,
        durationBeat: 0.125,
        velocity: 85,
      },
      {
        pitch: 82,
        startBeat: 0.5,
        durationBeat: 0.25,
        velocity: 58,
      },
      {
        pitch: 42,
        startBeat: 0.75,
        durationBeat: 0.125,
        velocity: 58,
      },
      {
        pitch: 38,
        startBeat: 1,
        durationBeat: 0.5,
        velocity: 104,
      },
      {
        pitch: 39,
        startBeat: 1,
        durationBeat: 0.5,
        velocity: 90,
      },
      {
        pitch: 46,
        startBeat: 1,
        durationBeat: 0.25,
        velocity: 99,
      },
      {
        pitch: 54,
        startBeat: 1,
        durationBeat: 0.5,
        velocity: 70,
      },
      {
        pitch: 82,
        startBeat: 1,
        durationBeat: 0.25,
        velocity: 67,
      },
      {
        pitch: 42,
        startBeat: 1.25,
        durationBeat: 0.125,
        velocity: 56,
      },
      {
        pitch: 82,
        startBeat: 1.25,
        durationBeat: 0.25,
        velocity: 39,
      },
      {
        pitch: 36,
        startBeat: 1.5,
        durationBeat: 0.5,
        velocity: 75,
      },
      {
        pitch: 42,
        startBeat: 1.5,
        durationBeat: 0.125,
        velocity: 72,
      },
      {
        pitch: 82,
        startBeat: 1.5,
        durationBeat: 0.25,
        velocity: 57,
      },
      {
        pitch: 42,
        startBeat: 1.75,
        durationBeat: 0.125,
        velocity: 48,
      },
      {
        pitch: 82,
        startBeat: 1.75,
        durationBeat: 0.25,
        velocity: 42,
      },
      {
        pitch: 36,
        startBeat: 2,
        durationBeat: 0.5,
        velocity: 94,
      },
      {
        pitch: 42,
        startBeat: 2,
        durationBeat: 0.125,
        velocity: 97,
      },
      {
        pitch: 82,
        startBeat: 2,
        durationBeat: 0.25,
        velocity: 70,
      },
      {
        pitch: 42,
        startBeat: 2.25,
        durationBeat: 0.125,
        velocity: 56,
      },
      {
        pitch: 82,
        startBeat: 2.25,
        durationBeat: 0.25,
        velocity: 42,
      },
      {
        pitch: 42,
        startBeat: 2.5,
        durationBeat: 0.125,
        velocity: 81,
      },
      {
        pitch: 82,
        startBeat: 2.5,
        durationBeat: 0.25,
        velocity: 51,
      },
      {
        pitch: 38,
        startBeat: 2.75,
        durationBeat: 0.25,
        velocity: 45,
      },
      {
        pitch: 42,
        startBeat: 2.75,
        durationBeat: 0.125,
        velocity: 52,
      },
      {
        pitch: 82,
        startBeat: 2.75,
        durationBeat: 0.25,
        velocity: 39,
      },
      {
        pitch: 38,
        startBeat: 3,
        durationBeat: 0.5,
        velocity: 104,
      },
      {
        pitch: 39,
        startBeat: 3,
        durationBeat: 0.5,
        velocity: 100,
      },
      {
        pitch: 46,
        startBeat: 3,
        durationBeat: 0.25,
        velocity: 106,
      },
      {
        pitch: 54,
        startBeat: 3,
        durationBeat: 0.5,
        velocity: 70,
      },
      {
        pitch: 82,
        startBeat: 3,
        durationBeat: 0.25,
        velocity: 60,
      },
      {
        pitch: 42,
        startBeat: 3.25,
        durationBeat: 0.125,
        velocity: 56,
      },
      {
        pitch: 82,
        startBeat: 3.25,
        durationBeat: 0.25,
        velocity: 38,
      },
      {
        pitch: 36,
        startBeat: 3.5,
        durationBeat: 0.5,
        velocity: 75,
      },
      {
        pitch: 42,
        startBeat: 3.5,
        durationBeat: 0.125,
        velocity: 74,
      },
      {
        pitch: 82,
        startBeat: 3.5,
        durationBeat: 0.25,
        velocity: 49,
      },
      {
        pitch: 42,
        startBeat: 3.75,
        durationBeat: 0.125,
        velocity: 51,
      },
      {
        pitch: 82,
        startBeat: 3.75,
        durationBeat: 0.25,
        velocity: 40,
      },
    ],
    placeDrumPattern: [
      {
        pitch: 36,
        startBeat: 0,
        durationBeat: 0.25,
        velocity: 100,
      },
      {
        pitch: 42,
        startBeat: 0,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 0.25,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 0.5,
        durationBeat: 0.25,
        velocity: 32,
        articulation: 'ghost',
      },
      {
        pitch: 42,
        startBeat: 0.5,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 36,
        startBeat: 0.75,
        durationBeat: 0.25,
        velocity: 80,
      },
      {
        pitch: 38,
        startBeat: 0.75,
        durationBeat: 0.25,
        velocity: 75,
      },
      {
        pitch: 42,
        startBeat: 0.75,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 1,
        durationBeat: 0.25,
        velocity: 100,
      },
      {
        pitch: 42,
        startBeat: 1,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 1.25,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 36,
        startBeat: 1.5,
        durationBeat: 0.25,
        velocity: 85,
      },
      {
        pitch: 42,
        startBeat: 1.5,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 1.75,
        durationBeat: 0.25,
        velocity: 32,
        articulation: 'ghost',
      },
      {
        pitch: 42,
        startBeat: 1.75,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 2,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 2.25,
        durationBeat: 0.25,
        velocity: 32,
        articulation: 'ghost',
      },
      {
        pitch: 42,
        startBeat: 2.25,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 36,
        startBeat: 2.5,
        durationBeat: 0.25,
        velocity: 80,
      },
      {
        pitch: 42,
        startBeat: 2.5,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 2.75,
        durationBeat: 0.25,
        velocity: 75,
      },
      {
        pitch: 42,
        startBeat: 2.75,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 38,
        startBeat: 3,
        durationBeat: 0.25,
        velocity: 100,
      },
      {
        pitch: 42,
        startBeat: 3,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 3.25,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 3.5,
        durationBeat: 0.25,
        velocity: 55,
      },
      {
        pitch: 42,
        startBeat: 3.75,
        durationBeat: 0.25,
        velocity: 55,
      },
    ],
    placeLicks: [
      { pitch: 36, startBeat: 0, durationBeat: 0.75, velocity: 100 },
      { pitch: 48, startBeat: 0.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 48, startBeat: 1, durationBeat: 0.75, velocity: 68 },
      { pitch: 47, startBeat: 1.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 47, startBeat: 2, durationBeat: 0.5, velocity: 85 },
      { pitch: 45, startBeat: 2.5, durationBeat: 0.25, velocity: 64 },
      { pitch: 43, startBeat: 2.75, durationBeat: 0.25, velocity: 54 },
      { pitch: 43, startBeat: 3, durationBeat: 0.5, velocity: 72 },
      { pitch: 40, startBeat: 3.5, durationBeat: 0.5, velocity: 64 },
      { pitch: 41, startBeat: 4, durationBeat: 0.75, velocity: 100 },
      { pitch: 53, startBeat: 4.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 53, startBeat: 5, durationBeat: 0.75, velocity: 68 },
      { pitch: 52, startBeat: 5.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 52, startBeat: 6, durationBeat: 0.5, velocity: 85 },
      { pitch: 50, startBeat: 6.5, durationBeat: 0.25, velocity: 64 },
      { pitch: 48, startBeat: 6.75, durationBeat: 0.25, velocity: 54 },
      { pitch: 44, startBeat: 7, durationBeat: 0.5, velocity: 72 },
      { pitch: 45, startBeat: 7.5, durationBeat: 0.5, velocity: 64 },
      { pitch: 43, startBeat: 8, durationBeat: 1, velocity: 100 },
      { pitch: 55, startBeat: 9, durationBeat: 0.75, velocity: 68 },
      { pitch: 53, startBeat: 9.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 53, startBeat: 10, durationBeat: 0.5, velocity: 85 },
      { pitch: 52, startBeat: 10.5, durationBeat: 0.25, velocity: 64 },
      { pitch: 50, startBeat: 10.75, durationBeat: 0.25, velocity: 54 },
      { pitch: 38, startBeat: 11, durationBeat: 0.5, velocity: 72 },
      { pitch: 47, startBeat: 11.5, durationBeat: 0.5, velocity: 64 },
      { pitch: 36, startBeat: 12, durationBeat: 0.75, velocity: 100 },
      { pitch: 48, startBeat: 12.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 48, startBeat: 13, durationBeat: 0.75, velocity: 68 },
      { pitch: 47, startBeat: 13.75, durationBeat: 0.25, velocity: 51 },
      { pitch: 47, startBeat: 14, durationBeat: 0.5, velocity: 85 },
      { pitch: 45, startBeat: 14.5, durationBeat: 0.5, velocity: 64 },
      { pitch: 43, startBeat: 15, durationBeat: 0.5, velocity: 72 },
      { pitch: 40, startBeat: 15.5, durationBeat: 0.5, velocity: 64 },
    ],
    generateRhythm: [
      {
        position: 0,
        duration: 1,
      },
      {
        position: 1,
        duration: 1,
      },
      {
        position: 2,
        duration: 1,
      },
      {
        position: 3,
        duration: 1,
      },
      {
        position: 4,
        duration: 0.5,
      },
      {
        position: 4.5,
        duration: 1.5,
      },
      {
        position: 6,
        duration: 1,
      },
      {
        position: 7,
        duration: 1,
      },
    ],
    generateBassLine: [
      { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 },
      { pitch: 40, startBeat: 1, durationBeat: 1, velocity: 80 },
      { pitch: 43, startBeat: 2, durationBeat: 1, velocity: 100 },
      { pitch: 42, startBeat: 3, durationBeat: 1, velocity: 80 },
      { pitch: 43, startBeat: 4, durationBeat: 1, velocity: 100 },
      { pitch: 47, startBeat: 5, durationBeat: 1, velocity: 80 },
      { pitch: 38, startBeat: 6, durationBeat: 1, velocity: 100 },
      { pitch: 44, startBeat: 7, durationBeat: 1, velocity: 80 },
      { pitch: 45, startBeat: 8, durationBeat: 1, velocity: 100 },
      { pitch: 48, startBeat: 9, durationBeat: 1, velocity: 80 },
      { pitch: 40, startBeat: 10, durationBeat: 1, velocity: 100 },
      { pitch: 43, startBeat: 11, durationBeat: 1, velocity: 80 },
      { pitch: 41, startBeat: 12, durationBeat: 1, velocity: 100 },
      { pitch: 45, startBeat: 13, durationBeat: 1, velocity: 80 },
      { pitch: 36, startBeat: 14, durationBeat: 1, velocity: 100 },
      { pitch: 41, startBeat: 15, durationBeat: 1, velocity: 80 },
    ],
    generateMotif: {
      notes: [
        {
          pitch: 59,
          startBeat: 0,
          durationBeat: 2,
        },
        {
          pitch: 62,
          startBeat: 2,
          durationBeat: 2,
        },
        {
          pitch: 64,
          startBeat: 4,
          durationBeat: 2,
        },
        {
          pitch: 62,
          startBeat: 6,
          durationBeat: 2,
        },
      ],
    },
    harmonizeMelody: {
      transposeSemitones: 0,
      key: {
        rootPc: 0,
        modeMask12: 2741,
      },
      chords: [
        {
          rootPc: 0,
          quality: 'maj',
          startBeat: 0,
          degree: 1,
        },
        {
          rootPc: 5,
          quality: 'maj',
          startBeat: 3,
          degree: 4,
        },
      ],
      melodyRoles: [
        {
          noteIndex: 0,
          role: 'root',
        },
        {
          noteIndex: 1,
          role: 'third',
        },
        {
          noteIndex: 2,
          role: 'fifth',
        },
        {
          noteIndex: 3,
          role: 'root',
        },
      ],
    },
    generateCounterMelody: [
      {
        pitch: 52,
        startBeat: 0,
        durationBeat: 2,
        velocity: 80,
      },
      {
        pitch: 52,
        startBeat: 2,
        durationBeat: 2,
        velocity: 80,
      },
    ],
    ornament: [
      {
        pitch: 60,
        startBeat: 0,
        durationBeat: 1,
      },
      {
        pitch: 64,
        startBeat: 1,
        durationBeat: 1,
        articulation: 'drag',
      },
      {
        pitch: 67,
        startBeat: 2,
        durationBeat: 1,
      },
      {
        pitch: 65,
        startBeat: 3,
        durationBeat: 1,
      },
    ],
    generateProgression: [
      {
        rootPc: 0,
        quality: 'maj',
        startBeat: 0,
        degree: 1,
      },
      {
        rootPc: 7,
        quality: 'maj',
        startBeat: 4,
        degree: 5,
      },
      {
        rootPc: 9,
        quality: 'min',
        startBeat: 8,
        degree: 6,
      },
      {
        rootPc: 4,
        quality: 'min',
        startBeat: 12,
        degree: 3,
      },
    ],
    humanize: [
      {
        pitch: 60,
        startBeat: -0.0168360217474401,
        durationBeat: 1,
        velocity: 94,
      },
      {
        pitch: 64,
        startBeat: 1.0057660282030703,
        durationBeat: 1,
        velocity: 83,
      },
      {
        pitch: 67,
        startBeat: 2.0144069980457426,
        durationBeat: 1,
        velocity: 92,
      },
      {
        pitch: 65,
        startBeat: 2.978436439558864,
        durationBeat: 1,
        velocity: 79,
      },
    ],
  },
};

describe('generated output is recorded per algorithm version', () => {
  it.each(VERSIONS)('version %i has a recorded output for every generator', (version) => {
    // An accepted version with nothing recorded under it is the gap this table
    // closes, so the missing entry is itself the failure.
    expect(Object.keys(GOLDEN[version] ?? {}).sort()).toEqual(
      CASES.map((entry) => entry.name).sort(),
    );
  });

  it.each(CASES)('$name answers to the seed as recorded', ({ run, seeded }) => {
    // A recorded output only guards a draw path if the seed reaches it, so
    // which generators draw is stated rather than assumed: a generator that
    // starts or stops drawing is a change to what a saved seed reopens as.
    const current = contextAt(ALGORITHM_VERSION);
    const other = run({ ...current, seed: SEED + 1 });
    if (seeded) {
      expect(other).not.toEqual(run(current));
    } else {
      expect(other).toEqual(run(current));
    }
  });

  for (const version of VERSIONS) {
    it.each(CASES)(
      `$name reproduces its recorded output at version ${version}`,
      ({ name, run }) => {
        expect(run(contextAt(version)), name).toEqual(GOLDEN[version]?.[name]);
      },
    );
  }
});

describe('the seeds a generator draws under are recorded', () => {
  it('keeps the part and section paths on their recorded seeds', () => {
    // These are the stream addresses the generators ask for. Renaming a path
    // moves every note drawn under it, so the numbers are recorded here rather
    // than recomputed from the same mixing function they come from.
    const paths: [readonly (string | number)[], number][] = [
      [['drums'], 1945151523],
      [['bass'], 4120415844],
      [['chorus'], 1591854960],
      [['drums', 0], 3935576705],
      [['drums', 1], 4275500962],
      [['bass', 3], 1913094],
      [['chorus', 7], 779078705],
    ];
    for (const [path, expected] of paths) {
      expect(deriveSeed(SEED, ...path), path.join('/')).toBe(expected);
    }
  });
});
