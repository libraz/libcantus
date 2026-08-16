import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { BASS_4_STRING, LIMBS, type PercussionProfile } from '../src/core/instrument/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import {
  ALGORITHM_VERSION,
  createPositionalRng,
  MIN_ALGORITHM_VERSION,
} from '../src/core/random/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { type BassSegment, generateBassLine, placeLicks } from '../src/generate/bass/index.js';
import {
  type GenerationContext,
  type GenerationContextInput,
  resolveContext,
  sustainsStrokes,
} from '../src/generate/context/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import {
  DRUM_NOTES,
  type DrumsOptions,
  generateDrums,
  placeDrumPattern,
} from '../src/generate/drums/index.js';
import { humanize } from '../src/generate/groove/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { ornament } from '../src/generate/ornament/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const ts = parseTimeSignature('4/4');

const segments: BassSegment[] = [
  { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
  { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
];

const drums: DrumsOptions = {
  bars: 2,
  style: 'standard',
  section: 'chorus',
  ctx: { seed: 5 },
};

/** Onsets as `pitch@beat`, which is what "the same note sounds" means here. */
function onsets(hits: readonly { pitch: number; startBeat: number }[]): string[] {
  return hits.map((hit) => `${hit.pitch}@${hit.startBeat}`).sort();
}

/**
 * Onset positions alone. Thinning a hi-hat can hand the same instant to another
 * voice — an open hat becomes a closed one — so "nothing was added" is a claim
 * about when the kit is struck, not about which drum takes the stroke.
 */
function onsetBeats(hits: readonly { startBeat: number }[]): number[] {
  return [...new Set(hits.map((hit) => hit.startBeat))].sort((a, b) => a - b);
}

describe('the seed alone is a context', () => {
  it('accepts a bare number wherever a context goes', () => {
    const bare = generateRhythm(ts, { ctx: 9, bars: 2 });
    expect(bare).toEqual(generateRhythm(ts, { ctx: { seed: 9 }, bars: 2 }));
    expect(bare).toEqual(generateRhythm(ts, { ctx: { seed: 9 }, bars: 2 }));
  });

  it('keeps every generator on the same seed vocabulary', () => {
    for (const seed of [0, 1, 4096]) {
      expect(generateMotif({ key: cMajor, bars: 2, jitter: 0.5, ctx: seed })).toEqual(
        generateMotif({ key: cMajor, bars: 2, jitter: 0.5, ctx: { seed: seed } }),
      );
      expect(generateProgression({ key: cMajor, style: 'dance', bars: 4, ctx: seed })).toEqual(
        generateProgression({ key: cMajor, style: 'dance', bars: 4, ctx: { seed: seed } }),
      );
    }
  });

  it('rejects a seed the derivation cannot address', () => {
    expect(() => resolveContext({ seed: -1 })).toThrow(RangeError);
    expect(() => resolveContext({ seed: 1.5 })).toThrow();
  });
});

describe('the seed resolves like every other context field', () => {
  const melody: NoteEvent[] = [
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

  /** Every entry point that draws on the context's seed. */
  const entries: {
    name: string;
    /** What every call is given besides the seed under test. */
    ctx: GenerationContext;
    run: (opts: { ctx: GenerationContextInput }) => unknown;
  }[] = [
    {
      name: 'generateDrums',
      ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 0.6 } } as GenerationContext,
      run: (opts) => generateDrums({ bars: 2, style: 'funk', section: 'chorus', ...opts }),
    },
    {
      name: 'placeDrumPattern',
      ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 0.6 } } as GenerationContext,
      run: (opts) => placeDrumPattern({ bars: 2, genre: 'funk', ...opts }),
    },
    {
      name: 'placeLicks',
      ctx: { bpm: 120, complexity: { rhythmic: 0.7 } } as GenerationContext,
      run: (opts) => placeLicks(timeline, cMajor, { genre: 'motown', ...opts }),
    },
    {
      name: 'generateRhythm',
      ctx: { complexity: { rhythmic: 0.5 } } as GenerationContext,
      run: (opts) => generateRhythm(ts, { bars: 4, ...opts }),
    },
    {
      name: 'generateBassLine',
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 } } as GenerationContext,
      run: (opts) => generateBassLine({ segments, key: cMajor, style: 'pop', ...opts }),
    },
    {
      name: 'generateMotif',
      ctx: { bpm: 120 } as GenerationContext,
      run: (opts) => generateMotif({ key: cMajor, bars: 2, jitter: 0.5, ...opts }),
    },
    {
      name: 'harmonizeMelody',
      ctx: { bpm: 120, complexity: { harmonic: 0.5 } } as GenerationContext,
      run: (opts) => harmonizeMelody({ melody, key: cMajor, harmonicRhythm: 1, ...opts }),
    },
    {
      name: 'generateCounterMelody',
      ctx: { bpm: 120 } as GenerationContext,
      run: (opts) =>
        generateCounterMelody({
          melody,
          key: cMajor,
          rhythm: 'complement',
          chordAt: (beat) => timeline[Math.floor(beat / 4)]?.chord ?? null,
          ...opts,
        }),
    },
    {
      name: 'ornament',
      ctx: { bpm: 120, complexity: { ornament: 0.5 } } as GenerationContext,
      run: (opts) => ornament(melody, { style: 'ghost', ...opts }),
    },
    {
      name: 'generateProgression',
      ctx: { bpm: 120 } as GenerationContext,
      run: (opts) => generateProgression({ key: cMajor, style: 'dance', bars: 4, ...opts }),
    },
    {
      name: 'humanize',
      ctx: { bpm: 120 } as GenerationContext,
      run: (opts) => humanize(melody, { timing: 0.04, ...opts }),
    },
  ];

  it.each(entries)('$name reads its seed from the context', ({ ctx, run }) => {
    // The context is the only place a seed can be named, so a context that
    // names none has to mean the default seed rather than an absent one — a
    // host that builds one transport for the whole piece passes a tempo and
    // dials without always naming a seed.
    expect(run({ ctx })).toEqual(run({ ctx: { ...ctx, seed: 0 } }));
    // And a seed that is named settles the part, the same way every time.
    expect(run({ ctx: { ...ctx, seed: 12345 } })).toEqual(run({ ctx: { ...ctx, seed: 12345 } }));
  });

  it('reaches a generator the seed actually moves', () => {
    // The check above holds vacuously for a generator that ignores its seed at
    // these settings, so one that does not is named here: if the seed stopped
    // reaching the drums, the whole table above would still pass.
    const drumsAt = (seed: number) =>
      generateDrums({
        bars: 2,
        style: 'funk',
        section: 'chorus',
        ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 0.6 }, seed },
      });
    expect(onsets(drumsAt(12345))).not.toEqual(onsets(drumsAt(0)));
  });
});

describe('the tempo lives in the context', () => {
  it('reaches the bass line, which had no tempo of its own', () => {
    const line = (ctx: Record<string, unknown>) =>
      generateBassLine({ segments, key: cMajor, style: 'pop', ctx: ctx as never });
    const unhurried = line({ seed: 2, bpm: 60, complexity: { rhythmic: 1, difficulty: 5 } });
    const hurried = line({ seed: 2, bpm: 240, complexity: { rhythmic: 1, difficulty: 1 } });
    // Same onsets either way: the tempo decides which note is within reach, not
    // whether the pickup happens at all.
    expect(hurried.map((note) => note.startBeat)).toEqual(unhurried.map((note) => note.startBeat));
    const leap = (notes: typeof unhurried) =>
      Math.max(
        ...notes.slice(1).map((note, index) => Math.abs(note.pitch - (notes[index]?.pitch ?? 0))),
      );
    // Given the time, the pickup takes the octave below; at 240 BPM the hand
    // cannot get there, so the fifth stands in.
    expect(leap(unhurried)).toBeGreaterThanOrEqual(12);
    expect(leap(hurried)).toBeLessThan(12);
  });

  it('defaults to a stated tempo rather than demanding one', () => {
    // A context may name a seed and no tempo; the generator writes at the
    // stated default instead of refusing, and says which default that is.
    expect(() => generateDrums(drums)).not.toThrow();
    expect(onsets(generateDrums(drums))).toEqual(
      onsets(generateDrums({ ...drums, ctx: { seed: 5, bpm: 120 } })),
    );
  });
});

describe('difficulty is a ceiling, not a strength', () => {
  const dense: DrumsOptions = {
    bars: 2,
    ctx: { bpm: 170, complexity: { rhythmic: 1 }, seed: 3 },
    style: 'funk',
    section: 'chorus',
  };

  it('never adds anything the dials did not propose', () => {
    const uncapped = new Set(onsetBeats(generateDrums(dense)));
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const capped = onsetBeats(
        generateDrums({ ...dense, ctx: { seed: 3, bpm: 170, complexity: { difficulty } } }),
      );
      for (const beat of capped) {
        expect(uncapped.has(beat), `difficulty ${difficulty} invented beat ${beat}`).toBe(true);
      }
    }
  });

  it('takes candidates away as it falls', () => {
    const count = (difficulty: number) =>
      generateDrums({
        ...dense,
        ctx: { seed: 3, bpm: 170, complexity: { rhythmic: 1, difficulty } },
      }).length;
    expect(count(1)).toBeLessThan(count(5));
    expect(count(1)).toBeLessThanOrEqual(count(3));
    expect(count(3)).toBeLessThanOrEqual(count(5));
  });

  it('leaves an explicitly named pattern alone however hard it is', () => {
    const hits = generateDrums({
      bars: 1,
      style: 'standard',
      section: 'chorus',
      euclideanKick: { pulses: 16, steps: 16 },
      ctx: { seed: 1, bpm: 300, complexity: { difficulty: 1 } },
    });
    expect(hits.filter((hit) => hit.pitch === DRUM_NOTES.kick)).toHaveLength(16);
  });

  it('holds every voice to the ceiling, fill bar and pre-chorus lift included', () => {
    // The fill and the lift are the most exposed bars a part has, so a ceiling
    // that governs the groove and not those two governs nothing a player would
    // notice. Every style, tempo and ceiling is swept, because "a beginner's
    // part" is a request the whole output has to answer.
    for (const style of ['standard', 'funk', 'breakbeat', 'halftime', 'house'] as const) {
      for (const bpm of [90, 140, 180, 200]) {
        for (const difficulty of [1, 2, 3]) {
          const ctx = { seed: 3, bpm, complexity: { rhythmic: 1, ornament: 1, difficulty } };
          const passages: DrumsOptions[] = [
            // The final bar is a fill, leaving a chorus.
            { bars: 4, style, section: 'chorus', nextSection: 'verse', fills: true, ctx },
            // The last two bars are the lift into a chorus, fill suppressed.
            { bars: 4, style, section: 'prechorus', nextSection: 'chorus', fills: true, ctx },
          ];
          for (const passage of passages) {
            const byVoice = new Map<number, number[]>();
            for (const hit of generateDrums(passage)) {
              const onsets = byVoice.get(hit.pitch);
              if (onsets) {
                onsets.push(hit.startBeat);
              } else {
                byVoice.set(hit.pitch, [hit.startBeat]);
              }
            }
            for (const [pitch, onsets] of byVoice) {
              const distinct = [...new Set(onsets)].sort((a, b) => a - b);
              for (let i = 1; i < distinct.length; i += 1) {
                const gap = (distinct[i] ?? 0) - (distinct[i - 1] ?? 0);
                expect(
                  sustainsStrokes(gap, bpm, difficulty),
                  `${style} ${passage.section} at ${bpm} difficulty ${difficulty}: voice ${pitch} repeats after ${gap} beats`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('is not the axis that decides whether a note exists', () => {
    // The lowest string is E1; the ceiling is the highest there is, and the
    // instrument still wins, because skill does not add frets.
    const notes = generateBassLine({
      segments,
      key: cMajor,
      octave: 0,
      ctx: {
        seed: 1,
        bpm: 90,
        complexity: { difficulty: 5 },
        instruments: { bass: BASS_4_STRING },
      },
    });
    for (const note of notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(28);
    }
  });
});

describe('instruments named in the context', () => {
  it('write the bass line for the instrument, as the bass option does', () => {
    const viaOption = generateBassLine({
      segments,
      key: cMajor,
      octave: 0,
      style: 'walking',
      ctx: { seed: 6 },
      instrument: BASS_4_STRING,
    });
    const viaContext = generateBassLine({
      segments,
      key: cMajor,
      octave: 0,
      style: 'walking',
      ctx: { seed: 6, instruments: { bass: BASS_4_STRING } },
    });
    expect(viaContext).toEqual(viaOption);
  });

  it('keep the drums to the voices the kit has', () => {
    const stripped: PercussionProfile = {
      kind: 'percussion',
      name: 'kick and snare',
      limbs: LIMBS,
      reach: { [DRUM_NOTES.kick]: ['rightFoot'], [DRUM_NOTES.snare]: ['leftHand'] },
      articulations: ['accent', 'ghost'],
      polyphony: 2,
    };
    const hits = generateDrums({
      ...drums,

      ctx: { seed: 5, bpm: 120, instruments: { drums: stripped }, complexity: { rhythmic: 0.9 } },
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect([DRUM_NOTES.kick, DRUM_NOTES.snare]).toContain(hit.pitch);
    }
  });
});

describe('the algorithm version is part of the address', () => {
  it('generates under the current version when the caller pins none', () => {
    expect(onsets(generateDrums(drums))).toEqual(
      onsets(generateDrums({ ...drums, ctx: { seed: 5, algorithmVersion: ALGORITHM_VERSION } })),
    );
    expect(resolveContext({ seed: 0 }).algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it('reproduces a pinned version exactly', () => {
    for (let version = MIN_ALGORITHM_VERSION; version <= ALGORITHM_VERSION; version += 1) {
      const ctx = { seed: 11, bpm: 120, algorithmVersion: version };
      expect(onsets(generateDrums({ ...drums, ctx }))).toEqual(
        onsets(generateDrums({ ...drums, ctx })),
      );
      expect(generateRhythm(ts, { ctx, bars: 2 })).toEqual(generateRhythm(ts, { ctx, bars: 2 }));
    }
  });

  it('refuses a version this build does not produce', () => {
    for (const version of [MIN_ALGORITHM_VERSION - 1, ALGORITHM_VERSION + 1]) {
      expect(() => resolveContext({ seed: 0, algorithmVersion: version })).toThrow(/algorithm/);
      expect(() => generateRhythm(ts, { ctx: { seed: 0, algorithmVersion: version } })).toThrow();
    }
  });

  it('addresses draws under the version they were generated at', () => {
    const draw = resolveContext({ seed: 4 }).part('drums');
    const other = resolveContext({ seed: 4, algorithmVersion: ALGORITHM_VERSION }).part('drums');
    expect(draw.at('kick', 0)).toBe(other.at('kick', 0));
  });
});

describe('every part draws from its own address space', () => {
  it('gives different parts different numbers under one project seed', () => {
    const ctx = resolveContext({ seed: 77 });
    expect(ctx.part('drums').at('x', 1)).not.toBe(ctx.part('bass').at('x', 1));
  });

  it('takes a caller-supplied source without letting parts collide', () => {
    const rng = createPositionalRng(123);
    const ctx = resolveContext({ seed: 0, rng });
    expect(ctx.part('drums').at('x', 1)).not.toBe(ctx.part('bass').at('x', 1));
    // The supplied source is what is actually drawn from: the same source and
    // the same path give the same answer twice.
    expect(ctx.part('drums').at('x', 1)).toBe(
      resolveContext({ seed: 0, rng }).part('drums').at('x', 1),
    );
  });

  it('leaves the rest of the piece alone when one part is rerolled', () => {
    const bass = generateBassLine({ segments, key: cMajor, style: 'pop', ctx: { seed: 12 } });
    const same = generateBassLine({ segments, key: cMajor, style: 'pop', ctx: { seed: 12 } });
    expect(same).toEqual(bass);
    const rerolled = generateBassLine({ segments, key: cMajor, style: 'pop', ctx: { seed: 13 } });
    expect(rerolled).not.toEqual(bass);
  });
});

describe('drawing by position rather than by call order', () => {
  it('leaves earlier bars untouched when the piece grows', () => {
    const short = generateRhythm(ts, { ctx: { seed: 21, complexity: { rhythmic: 0.7 } }, bars: 2 });
    const long = generateRhythm(ts, { ctx: { seed: 21, complexity: { rhythmic: 0.7 } }, bars: 6 });
    const firstTwoBars = long.filter((event) => event.position < 8).map((event) => event.position);
    expect(firstTwoBars).toEqual(short.map((event) => event.position));
  });

  it('leaves every other bar untouched when one bar changes', () => {
    const plain = generateDrums({ ...drums, bars: 4, ctx: { bpm: 120 } });
    const filled = generateDrums({ ...drums, bars: 4, ctx: { bpm: 120 }, fills: true });
    const earlyBars = (hits: typeof plain) => onsets(hits.filter((hit) => hit.startBeat < 12));
    expect(earlyBars(filled)).toEqual(earlyBars(plain));
  });
});

describe('a caller-supplied positional source', () => {
  /** Every sampler, so no single exit path can skip the check. */
  const samplers: { name: string; run: (rng: { at: () => number }) => unknown }[] = [
    { name: 'at', run: (rng) => resolveContext({ seed: 1, rng }).part('x').at('p') },
    { name: 'prob', run: (rng) => resolveContext({ seed: 1, rng }).part('x').prob(0.5, 'p') },
    { name: 'range', run: (rng) => resolveContext({ seed: 1, rng }).part('x').range(0, 5, 'p') },
    { name: 'float', run: (rng) => resolveContext({ seed: 1, rng }).part('x').float(0, 1, 'p') },
  ];

  it.each(samplers)('rejects a draw outside [0, 1) from $name', ({ run }) => {
    // A source is part of the contract, so one returning 1, a negative value or
    // NaN is an input error here rather than an index past the end of a
    // vocabulary, a NaN onset, or a bar quietly dropped much further on.
    for (const draw of [1, 1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => run({ at: () => draw }), `${draw}`).toThrow(InvalidInputError);
    }
    expect(() => run({ at: () => 0 })).not.toThrow();
    expect(() => run({ at: () => 0.999 })).not.toThrow();
  });

  it('keeps range inside the bounds it documents', () => {
    // What the missing guard produced: `range(0, 5)` answering 6.
    const rng = { at: () => 0.999999 };
    const value = resolveContext({ seed: 1, rng }).part('x').range(0, 5, 'p');
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(5);
  });
});
