import { describe, expect, it } from 'vitest';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import { GUITAR_STANDARD } from '../src/core/instrument/index.js';
import { isStrongBeat } from '../src/core/meter/index.js';
import { ALGORITHM_VERSION, createPositionalRng } from '../src/core/random/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateBassLine } from '../src/generate/bass/index.js';
import type { GenerationContext } from '../src/generate/context/index.js';
import { resolveContext } from '../src/generate/context/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import type { Vocabulary } from '../src/generate/vocabulary/index.js';
import type { ComposerOptions } from '../src/model/composer.js';
import { Composer } from '../src/model/composer.js';
import { Score } from '../src/model/score.js';
import { Timeline } from '../src/model/timeline.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

/**
 * The settings holder: the contracts every model class holds, and — the point
 * of the class — that every part it writes is exactly what calling the
 * generator with the key, the meter and the context written out by hand
 * returns.
 */

const TS = { numerator: 4, denominator: 4 } as const;

/** The settings under test, with every field of the class filled. */
const OPTIONS: ComposerOptions = {
  key: 'C major',
  meters: TS,
  bpm: 96,
  seed: 7,
  complexity: { rhythmic: 0.6, harmonic: 0.4, ornament: 0.3, difficulty: 3 },
  instruments: { bass: GUITAR_STANDARD },
};

/**
 * The same settings as the generators read them, for the comparisons. The
 * algorithm version is written out because a composer concretises the one it
 * resolved when its settings were named, rather than leaving the parts to be
 * redrawn under whatever version the next build defaults to.
 */
const CTX: GenerationContext = {
  seed: 7,
  bpm: 96,
  algorithmVersion: ALGORITHM_VERSION,
  complexity: { rhythmic: 0.6, harmonic: 0.4, ornament: 0.3, difficulty: 3 },
  instruments: { bass: GUITAR_STANDARD },
};

const KEY = majorKey(0);

const composer = () => Composer.of(OPTIONS);

/** A short melody to harmonize and to answer with a counter line. */
const MELODY: readonly NoteEvent[] = [
  { pitch: 67, startBeat: 0, durationBeat: 2 },
  { pitch: 65, startBeat: 2, durationBeat: 2 },
  { pitch: 64, startBeat: 4, durationBeat: 2 },
  { pitch: 62, startBeat: 6, durationBeat: 1 },
  { pitch: 60, startBeat: 7, durationBeat: 1 },
];

/** Where every number sits inside a plain value, as a path into it. */
function numericPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (typeof value === 'number') {
    return [prefix];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericPaths(item, [...prefix, index]));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => numericPaths(item, [...prefix, key]));
  }
  return [];
}

/** Read the number a path points at. */
function readPath(value: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, step) => (current as Record<string | number, unknown>)?.[step],
    value,
  );
}

/** A copy of a plain value with one of its numbers replaced. */
function withNumberAt(value: unknown, path: (string | number)[], replacement: number): unknown {
  const copy = structuredClone(value);
  const parent = path
    .slice(0, -1)
    .reduce<unknown>((current, step) => (current as Record<string | number, unknown>)[step], copy);
  (parent as Record<string | number, unknown>)[path[path.length - 1] as string | number] =
    replacement;
  return copy;
}

/**
 * A stand-in exposing only an instance's public surface, so an `equals` that
 * reaches for a `#private` field off the other value throws instead of
 * answering — exactly what happens across two copies of the module.
 */
function publicFacade<T extends object>(instance: T): T {
  const facade: Record<PropertyKey, unknown> = {};
  for (
    let proto: object | null = Object.getPrototypeOf(instance) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === 'constructor' || key in facade) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      const getter = descriptor?.get;
      const value = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (getter !== undefined) {
        Object.defineProperty(facade, key, { get: () => getter.call(instance), enumerable: true });
      } else if (typeof value === 'function') {
        Object.defineProperty(facade, key, {
          value: (...args: unknown[]) => value.apply(instance, args),
          enumerable: true,
        });
      }
    }
  }
  return facade as T;
}

describe('plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const held = composer();
    expect(held.data).not.toBe(held.data);
    expect(held.data).toEqual(held.data);
  });

  it('cannot be changed through the value it hands out', () => {
    const held = composer();
    const escaped = held.data;
    escaped.bpm = 200;
    escaped.complexity = { rhythmic: 1 };
    expect(held.data.bpm).toBe(96);
    expect(held.data.complexity).toEqual(OPTIONS.complexity);
  });

  it('round-trips through its plain data', () => {
    const held = composer();
    expect(held.data).toEqual(held.toJSON());
    expect(held.data).toEqual(JSON.parse(JSON.stringify(held)));
    expect(Composer.fromData(held.data).data).toEqual(held.data);
    expect(Composer.fromJSON(JSON.parse(JSON.stringify(held))).data).toEqual(held.data);
  });

  it('normalizes a named key and a bare signature to what the generators read', () => {
    const held = composer();
    // The key crosses over as the plain key/scale every generator takes, and
    // the signature as the meter map the model layer reads.
    expect(held.data.key).toEqual(KEY);
    expect(held.data.meters).toEqual([{ startBeat: 0, ts: TS }]);
    expect(Composer.of({ key: 'A minor' }).data.key).toEqual(minorKey(9));
  });

  it('carries no key of its own until one is named', () => {
    // A composer with no key harmonizes by inferring one, which is a different
    // request from harmonizing in C major, so the two states survive the trip.
    const bare = Composer.of({});
    expect('key' in bare.data).toBe(false);
    expect(Composer.fromData(bare.data).data).toEqual(bare.data);
    expect(bare.data.meters).toEqual([{ startBeat: 0, ts: TS }]);
  });

  it('exposes the context the generators are handed', () => {
    expect(composer().context).toEqual(CTX);
    expect(composer().context).not.toBe(composer().context);
    // A composer naming nothing still hands the generators the seed and the
    // version its parts are drawn under, which is what makes them repeatable.
    expect(Composer.of({}).context).toEqual({ seed: 0, algorithmVersion: ALGORITHM_VERSION });
  });
});

describe('data arriving from outside is checked, not trusted', () => {
  const POISON = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it('rebuilds no value carrying a number it cannot hold', () => {
    const held = composer();
    const paths = numericPaths(held.data);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of POISON) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Composer | undefined;
        try {
          rebuilt = Composer.fromData(withNumberAt(held.data, path, poison) as ComposerOptions);
        } catch (error) {
          expect(error, label).toBeInstanceOf(RangeError);
          continue;
        }
        for (const leaf of numericPaths(rebuilt.data)) {
          expect(Number.isFinite(readPath(rebuilt.data, leaf)), `${label} survived`).toBe(true);
        }
      }
    }
  });

  it('checks a vocabulary entry to whatever depth its material goes', () => {
    const entry: Vocabulary<{ grid: { beat: number; velocity: number }[] }> = {
      id: 'probe',
      genre: 'pop',
      material: { grid: [{ beat: 0, velocity: 100 }] },
      articulations: [],
      difficulty: 2,
      provenance: { basis: 'construction', note: 'a probe' },
    };
    expect(Composer.of({ vocabulary: [entry] }).data.vocabulary).toEqual([entry]);
    expect(() =>
      Composer.of({
        vocabulary: [{ ...entry, material: { grid: [{ beat: 0, velocity: Number.NaN }] } }],
      }),
    ).toThrow(RangeError);
    // The domain checks the generators apply are applied here too, so a figure
    // that would clear every difficulty ceiling never enters the settings.
    expect(() => Composer.of({ vocabulary: [{ ...entry, difficulty: 40 }] })).toThrow(RangeError);
  });

  it('refuses a seed, a tempo or a dial the generators could not hold', () => {
    expect(() => Composer.of({ seed: 1.5 })).toThrow(RangeError);
    expect(() => Composer.of({ bpm: 0 })).toThrow(RangeError);
    expect(() => Composer.of({ complexity: { rhythmic: 2 } })).toThrow(RangeError);
    expect(() => Composer.of({ complexity: { difficulty: 9 } })).toThrow(RangeError);
    expect(() => Composer.of({ key: 'H flat sideways' })).toThrow(RangeError);
  });
});

describe('equality', () => {
  it('compares through the public surface alone', () => {
    const held = composer();
    expect(held.equals(publicFacade(held))).toBe(true);
  });

  it('compares every setting a part is generated under', () => {
    const held = composer();
    expect(held.equals(Composer.of(OPTIONS))).toBe(true);
    // The key arrives named here and as a scale there; both name one key.
    expect(held.equals(Composer.of({ ...OPTIONS, key: KEY }))).toBe(true);
    expect(held.equals(held.withSeed(8))).toBe(false);
    expect(held.equals(held.withKey('A minor'))).toBe(false);
    expect(held.equals(held.with({ bpm: 120 }))).toBe(false);
    expect(held.equals(held.withComplexity({ rhythmic: 0.6 }))).toBe(false);
    expect(Composer.of({}).equals(Composer.of({ meters: TS }))).toBe(true);
  });
});

describe('the parts a composer writes', () => {
  it('is the progression the function writes with the key and the context', () => {
    const chords = generateProgression({ key: KEY, style: 'dance', bars: 4, ctx: CTX });
    expect(composer().progression({ style: 'dance', bars: 4 }).data).toEqual(
      Timeline.fromChords(chords, 16, KEY).data,
    );
  });

  it('passes every progression option the generator takes', () => {
    const opts = { style: 'rock', bars: 3, presetId: 'axis', ext: 'maj7' } as const;
    expect(composer().progression(opts).data).toEqual(
      Timeline.fromChords(generateProgression({ ...opts, key: KEY, ctx: CTX }), 12, KEY).data,
    );
  });

  it('is the drum part the function writes, scored against the meter and tempo', () => {
    const opts = { bars: 2, style: 'standard', section: 'chorus', fills: true } as const;
    const hits = generateDrums({ ...opts, ts: TS, ctx: CTX });
    const drums = composer().drums(opts);
    expect(drums.notes).toEqual(Score.of(hits).notes);
    expect(drums.meterAt(0)).toEqual(TS);
    expect(drums.tempo).toEqual([{ startBeat: 0, bpm: 96 }]);
    // A kit is not in a key, so the score carries none to read its pitches in.
    expect(drums.data.key).toBeUndefined();
  });

  it('is the bass line the function writes under a timeline', () => {
    const held = composer();
    const timeline = held.progression({ style: 'dance', bars: 4 });
    const notes = generateBassLine({
      segments: timeline.segments,
      key: KEY,
      ts: TS,
      style: 'walking',
      ctx: CTX,
    });
    const bass = held.bass(timeline, { style: 'walking' });
    expect(bass.notes).toEqual(Score.of(notes).notes);
    expect(bass.data.key?.scale).toEqual(KEY);
    // The segments a timeline holds are what the generator wants, so passing
    // the timeline and passing its segments are the same request.
    expect(held.bass(timeline.segments, { style: 'walking' }).data).toEqual(bass.data);
  });

  it('is the counter line the function writes against a melody', () => {
    const held = composer();
    const timeline = held.progression({ style: 'dance', bars: 2 });
    const melody = Score.of(MELODY);
    const notes = generateCounterMelody({
      melody: MELODY,
      timeline: timeline.chordTimeline,
      key: KEY,
      ts: TS,
      ctx: CTX,
    });
    const counter = held.counterMelody(melody, { timeline: timeline.chordTimeline });
    expect(counter.notes).toEqual(Score.of(notes).notes);
    expect(counter.data.key?.scale).toEqual(KEY);
    expect(counter.tempo).toEqual([{ startBeat: 0, bpm: 96 }]);
  });

  it('passes a budget on to the harmonizer rather than capping it itself', () => {
    // The composer forwards the options it does not set, so the cap on the work
    // a harmonization may do is reachable from the class as well as the function.
    const long = Array.from({ length: 64 }, (_, index) => ({
      pitch: 60 + (index % 7),
      startBeat: index,
      durationBeat: 1,
    }));
    const held = Composer.of({ key: KEY });
    const melody = Score.of(long);
    expect(() => held.harmonize(melody, { budget: 1 })).toThrow(BudgetExceededError);
    expect(() => held.harmonize(melody)).not.toThrow();
  });

  it('is the harmonization the function returns, melody and all', () => {
    const held = composer();
    const melody = Score.of(MELODY);
    const result = harmonizeMelody({ melody: MELODY, key: KEY, ts: TS, ctx: CTX });
    const harmonized = held.harmonize(melody);
    expect(harmonized.transposeSemitones).toBe(result.transposeSemitones);
    expect(harmonized.chords.segments).toEqual(
      Timeline.fromChords(result.chords, harmonized.chords.totalBeats, result.key).segments,
    );
    // Every chord the harmonizer chose sounds: the span reaches past the last
    // of them rather than stopping on it.
    expect(harmonized.chords.length).toBe(result.chords.length);
    expect(harmonized.melody.notes).toEqual(melody.transpose(result.transposeSemitones).notes);
    expect(harmonized.melody.data.key?.scale).toEqual(result.key.scale);
  });

  it('hands the melody back in the key the chords are in', () => {
    // With the transpose search on, the harmonizer may move the line; the
    // melody returned is the one that sounds against the chords, so the two
    // are read in one key whether or not it moved.
    const held = Composer.of({ seed: 3 });
    const melody = Score.of(MELODY);
    const harmonized = held.harmonize(melody, {
      placement: { transposeSearch: true, octaveSearch: false },
    });
    const result = harmonizeMelody({
      melody: MELODY,
      ts: TS,
      placement: { transposeSearch: true, octaveSearch: false },
      ctx: { seed: 3 },
    });
    expect(harmonized.transposeSemitones).toBe(result.transposeSemitones);
    expect(harmonized.melody.notes.map((note) => note.pitch)).toEqual(
      MELODY.map((note) => note.pitch + result.transposeSemitones),
    );
    expect(harmonized.melody.data.key?.scale).toEqual(result.key.scale);
    expect(harmonized.chords.key?.scale).toEqual(result.key.scale);
  });

  it('infers the key when the composer names none, and states it when it does', () => {
    const melody = Score.of(MELODY);
    const inferred = Composer.of({}).harmonize(melody);
    expect(inferred.chords.key?.scale).toEqual(harmonizeMelody({ melody: MELODY }).key.scale);
    expect(composer().harmonize(melody).chords.key?.scale).toEqual(KEY);
  });
});

describe('one seed, one part each', () => {
  it('gives every part its own stream, so no two parts collide', () => {
    const ctx = resolveContext(composer().context);
    const drums = ctx.part('drums');
    const bass = ctx.part('bass');
    const shared = [0, 1, 2, 3].map((bar) => [drums.at('note', bar), bass.at('note', bar)]);
    for (const [fromDrums, fromBass] of shared) {
      expect(fromDrums).not.toBe(fromBass);
    }
  });

  it('writes the same part twice the same way', () => {
    const held = composer();
    const opts = { bars: 4, style: 'standard', section: 'verse' } as const;
    expect(held.drums(opts).equals(held.drums(opts))).toBe(true);
    expect(
      held
        .progression({ style: 'dance', bars: 4 })
        .equals(held.progression({ style: 'dance', bars: 4 })),
    ).toBe(true);
  });

  it('leaves one part where it was when another is written beside it', () => {
    const held = composer();
    const drums = held.drums({ bars: 4, style: 'standard', section: 'verse' });
    const timeline = held.progression({ style: 'dance', bars: 4 });
    held.bass(timeline);
    held.counterMelody(Score.of(MELODY), { timeline: timeline.chordTimeline });
    expect(held.drums({ bars: 4, style: 'standard', section: 'verse' }).equals(drums)).toBe(true);
  });
});

describe('immutability', () => {
  it('returns a new composer and leaves the original writing what it wrote', () => {
    const held = composer();
    const before = held.progression({ style: 'dance', bars: 4 });
    for (const variation of [held.withSeed(8), held.withKey('A minor'), held.with({ bpm: 120 })]) {
      expect(variation).not.toBe(held);
      expect(variation.equals(held)).toBe(false);
    }
    expect(held.data).toEqual(composer().data);
    expect(held.progression({ style: 'dance', bars: 4 }).equals(before)).toBe(true);
  });

  it('changes only what the patch names', () => {
    const held = composer();
    expect(held.withSeed(8).data).toEqual({ ...held.data, seed: 8 });
    expect(held.withKey('A minor').data).toEqual({ ...held.data, key: minorKey(9) });
    expect(held.withComplexity({ rhythmic: 1 }).data).toEqual({
      ...held.data,
      complexity: { rhythmic: 1 },
    });
    expect(held.with({ bpm: 120, seed: 1 }).data).toEqual({ ...held.data, bpm: 120, seed: 1 });
  });

  it('writes a different part from a different seed', () => {
    const held = composer();
    const opts = { bars: 4, style: 'standard', section: 'chorus', fills: true } as const;
    expect(held.withSeed(8).drums(opts).equals(held.drums(opts))).toBe(false);
  });
});

describe('the bar a progression is laid out on', () => {
  it("spaces the chords by the composer's own bar", () => {
    const waltz = Composer.of({ key: KEY, seed: 7, meters: '3/4' });
    const timeline = waltz.progression({ style: 'dance', bars: 4 });
    expect(timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 3, 6, 9]);
    expect(timeline.totalBeats).toBe(12);
    // The bass accents the same bar lines, which is what the two parts have to
    // agree about: a chord change that never lands on one drifts off the bar.
    for (const segment of timeline.segments) {
      expect(isStrongBeat(segment.startBeat, '3/4'), `beat ${segment.startBeat}`).toBe(true);
    }
  });

  it('spaces the chords by a compound bar in a compound meter', () => {
    const jig = Composer.of({ key: KEY, seed: 7, meters: '6/8' });
    const timeline = jig.progression({ style: 'dance', bars: 4 });
    expect(timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 3, 6, 9]);
    expect(timeline.totalBeats).toBe(12);
  });

  it('lays out a four-beat bar where the composer counts in four', () => {
    expect(composer().progression({ style: 'dance', bars: 4 }).totalBeats).toBe(16);
    expect(composer().progression({ style: 'rock', bars: 3 }).totalBeats).toBe(12);
    expect(
      composer()
        .progression({ style: 'dance', bars: 4 })
        .segments.map((segment) => segment.startBeat),
    ).toEqual([0, 4, 8, 12]);
  });

  it('refuses to lay out bars for a piece that changes meter', () => {
    const changing = Composer.of({
      key: KEY,
      meters: [
        { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
        { startBeat: 8, ts: { numerator: 3, denominator: 4 } },
      ],
    });
    expect(() => changing.progression({ style: 'dance', bars: 4 })).toThrow(InvalidInputError);
  });
});

describe('the reproduction recipe', () => {
  it('generates under the algorithm version it was given', () => {
    const settings = { key: KEY, seed: 7, algorithmVersion: 1 } as const;
    const written = Composer.of(settings).progression({ style: 'dance', bars: 4 });
    const byHand = generateProgression({
      style: 'dance',
      bars: 4,
      key: KEY,
      ts: TS,
      ctx: { seed: 7, algorithmVersion: 1 },
    });
    expect(written.equals(Timeline.fromChords(byHand, 16, KEY))).toBe(true);
    expect(Composer.of(settings).context.algorithmVersion).toBe(1);
    // The recipe survives the round trip a project file makes.
    expect(Composer.fromJSON(Composer.of(settings).toJSON()).data.algorithmVersion).toBe(1);
  });

  it('draws from a source it was handed, keeping it out of the plain data', () => {
    const rng = createPositionalRng(11);
    const written = Composer.of({ key: KEY, rng }).progression({ style: 'dance', bars: 4 });
    const byHand = generateProgression({ style: 'dance', bars: 4, key: KEY, ts: TS, ctx: { rng } });
    expect(written.equals(Timeline.fromChords(byHand, 16, KEY))).toBe(true);
    expect(Composer.of({ key: KEY, rng }).context.rng).toBe(rng);
    // A live source is not settings: it is held by reference and left out of
    // the data a caller may serialize.
    expect(Composer.of({ key: KEY, rng }).data.rng).toBeUndefined();
    expect(Composer.of({ key: KEY, rng }).withSeed(3).context.rng).toBe(rng);
  });
});
