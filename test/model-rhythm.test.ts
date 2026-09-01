import { describe, expect, it } from 'vitest';
import {
  beatsPerBar,
  metricWeight,
  parseTimeSignature,
  type TimeSignature,
} from '../src/core/meter/index.js';
import {
  deform,
  doubleTime,
  type GridEvent,
  generateRhythm,
  halfTime,
  ornamentBy,
  type RhythmEvent,
  resolveContext,
  rhythmDensity,
  rhythmToNoteEvents,
  STEP_BEATS,
  syncopate,
  thin,
  withinCeiling,
} from '../src/generate/index.js';
import { Rhythm, type RhythmData } from '../src/model/rhythm.js';
import { Score } from '../src/model/score.js';

/**
 * `Rhythm` is a skin over the rhythm generator and the transforms that deform
 * a figure, so most of what is checked here is equivalence: the class answer
 * must be the answer the underlying functions give for the same onsets, the
 * same meter and the same context. The rest is the contract every model class
 * holds — plain data out, plain data back in, nothing shared with the caller,
 * and no transformation that mutates.
 */

const FOUR_FOUR = parseTimeSignature('4/4');

/** The part name the transforms' draws are addressed under. */
const PART = 'rhythm';

/** A two-bar pattern, dense enough for thinning and syncopation to bite. */
function pattern(): Rhythm {
  return Rhythm.generate(FOUR_FOUR, { bars: 2, ctx: { seed: 42, complexity: { rhythmic: 0.8 } } });
}

/** The onsets a pattern covers, stated independently of the class. */
function spanOf(events: readonly RhythmEvent[]): number {
  return events.reduce((end, event) => Math.max(end, event.position + event.duration), 0);
}

/** The same conversion the class makes on the way into a transform. */
function gridOf(events: readonly RhythmEvent[]): GridEvent[] {
  return events.map((event) => ({ step: event.position / STEP_BEATS, velocity: 1 }));
}

/** The same reading the class makes on the way back out of a transform. */
function eventsOf(grid: readonly GridEvent[], spanBeats: number): RhythmEvent[] {
  const positions = [...new Set(grid.map((event) => event.step * STEP_BEATS))].sort(
    (a, b) => a - b,
  );
  return positions.map((position, index) => ({
    position,
    duration: (positions[index + 1] ?? spanBeats) - position,
  }));
}

/** Every path to a number inside a plain value. */
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

/** A copy of a plain value with the number at one path replaced. */
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
 * A stand-in exposing only an instance's public surface, as the shared model
 * contracts build one: reading a `#private` field off it throws.
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

describe('Rhythm plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const rhythm = pattern();
    expect(rhythm.data).not.toBe(rhythm.data);
    expect(rhythm.data).toEqual(rhythm.data);
    expect(rhythm.data.events[0]).not.toBe(rhythm.data.events[0]);
    expect(rhythm.events).not.toBe(rhythm.events);
    expect(rhythm.ts).not.toBe(rhythm.ts);
  });

  it('cannot be reached through the value it hands out', () => {
    const rhythm = pattern();
    const data = rhythm.data;
    const first = data.events[0] as RhythmEvent;
    first.position = 99;
    data.ts.numerator = 7;
    expect(rhythm.events[0]?.position).toBe(0);
    expect(rhythm.ts.numerator).toBe(4);
  });

  it('does not retain the array it was built from', () => {
    const events: RhythmEvent[] = [{ position: 0, duration: 1 }];
    const rhythm = Rhythm.of(events, FOUR_FOUR);
    events.push({ position: 1, duration: 1 });
    (events[0] as RhythmEvent).position = 3;
    expect(rhythm.events).toEqual([{ position: 0, duration: 1 }]);
  });

  it('reports toJSON as the value .data hands out', () => {
    const rhythm = pattern();
    expect(rhythm.toJSON()).toEqual(rhythm.data);
    expect(JSON.parse(JSON.stringify(rhythm))).toEqual(rhythm.data);
  });

  it('round-trips through fromData and fromJSON', () => {
    const rhythm = pattern();
    expect(Rhythm.fromData(rhythm.data).data).toEqual(rhythm.data);
    expect(Rhythm.fromJSON(JSON.parse(JSON.stringify(rhythm)) as RhythmData).data).toEqual(
      rhythm.data,
    );
    expect(Rhythm.fromData(rhythm.data).equals(rhythm)).toBe(true);
  });

  it('carries an additive grouping through a round trip', () => {
    const ts: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
    const rhythm = Rhythm.of([{ position: 0, duration: 3.5 }], ts);
    expect(rhythm.ts.grouping).toEqual([2, 2, 3]);
    expect(Rhythm.fromData(rhythm.data).equals(rhythm)).toBe(true);
    expect(rhythm.equals(Rhythm.of([{ position: 0, duration: 3.5 }], FOUR_FOUR))).toBe(false);
  });

  it('rebuilds no pattern carrying a number it cannot hold', () => {
    const sample = pattern().data;
    const paths = numericPaths(sample);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Rhythm | undefined;
        try {
          rebuilt = Rhythm.fromData(withNumberAt(sample, path, poison) as RhythmData);
        } catch (error) {
          expect(error, label).toBeInstanceOf(RangeError);
          continue;
        }
        for (const leaf of numericPaths(rebuilt.data)) {
          const value = leaf.reduce<unknown>(
            (current, step) => (current as Record<string | number, unknown>)[step],
            rebuilt.data,
          );
          expect(Number.isFinite(value), `${label} survived`).toBe(true);
        }
      }
    }
  });

  it('refuses an onset no pattern can hold', () => {
    expect(() => Rhythm.of([{ position: -1, duration: 1 }])).toThrow(RangeError);
    expect(() => Rhythm.of([{ position: 0, duration: Number.NaN }])).toThrow(RangeError);
    expect(() =>
      Rhythm.of([{ position: 0, duration: 1 }], { numerator: 0, denominator: 4 }),
    ).toThrow(RangeError);
  });

  it('holds the onsets in time order however they arrive', () => {
    const forward = Rhythm.of([
      { position: 0, duration: 1 },
      { position: 1, duration: 1 },
    ]);
    const backward = Rhythm.of([
      { position: 1, duration: 1 },
      { position: 0, duration: 1 },
    ]);
    expect(forward.equals(backward)).toBe(true);
    expect(backward.events.map((event) => event.position)).toEqual([0, 1]);
  });
});

describe('Rhythm equality', () => {
  it('compares through the public surface only', () => {
    const rhythm = pattern();
    expect(rhythm.equals(publicFacade(rhythm))).toBe(true);
  });

  it('separates patterns differing in their onsets or their meter', () => {
    const rhythm = pattern();
    expect(rhythm.equals(rhythm.thin(0.5))).toBe(false);
    expect(rhythm.equals(Rhythm.of(rhythm.events, parseTimeSignature('3/4')))).toBe(false);
    expect(rhythm.equals(Rhythm.of(rhythm.events, FOUR_FOUR))).toBe(true);
  });
});

describe('Rhythm answers what the functions answer', () => {
  it('generates the pattern the generator generates', () => {
    const opts = { bars: 3, subdivision: 4, ctx: { seed: 11, complexity: { rhythmic: 0.7 } } };
    expect(Rhythm.generate(FOUR_FOUR, opts).events).toEqual(generateRhythm(FOUR_FOUR, opts));
    expect(Rhythm.generate(FOUR_FOUR).events).toEqual(generateRhythm(FOUR_FOUR));
    expect(Rhythm.generate(FOUR_FOUR, opts).ts).toEqual(FOUR_FOUR);
  });

  it('reads its density the way rhythmDensity reads it', () => {
    const rhythm = pattern();
    expect(rhythm.density()).toBe(rhythmDensity(rhythm.events, FOUR_FOUR));
    expect(Rhythm.of([]).density()).toBe(rhythmDensity([], FOUR_FOUR));
  });

  it('thins what thin thins', () => {
    const rhythm = pattern();
    for (const amount of [0, 0.3, 0.6, 1]) {
      expect(rhythm.thin(amount).events, `thin ${amount}`).toEqual(
        eventsOf(thin(gridOf(rhythm.events), amount, '4/4'), rhythm.totalBeats),
      );
    }
  });

  it('syncopates what syncopate syncopates', () => {
    const rhythm = pattern();
    const draw = resolveContext(7).part(PART);
    expect(rhythm.syncopate(0.6, 7).events).toEqual(
      eventsOf(syncopate(gridOf(rhythm.events), 0.6, draw), rhythm.totalBeats),
    );
    // The seed is the only thing that decides which beats are anticipated.
    expect(rhythm.syncopate(0.6, 7).equals(rhythm.syncopate(0.6, { seed: 7 }))).toBe(true);
    expect(rhythm.syncopate(0.6, 7).equals(rhythm.syncopate(0.6, 8))).toBe(false);
  });

  it('halves and doubles the rate the way the transforms do', () => {
    const rhythm = pattern();
    const steps = rhythm.totalBeats / STEP_BEATS;
    expect(rhythm.halfTime().events).toEqual(
      eventsOf(halfTime(gridOf(rhythm.events), steps), rhythm.totalBeats),
    );
    expect(rhythm.doubleTime().events).toEqual(
      eventsOf(doubleTime(gridOf(rhythm.events), steps), rhythm.totalBeats),
    );
  });

  it('keeps the decoration ornamentBy keeps', () => {
    const rhythm = pattern();
    const offbeat = (event: RhythmEvent) => !Number.isInteger(event.position);
    const draw = resolveContext(3).part(PART);
    expect(rhythm.ornamentBy(offbeat, 0.5, 3).events).toEqual(
      eventsOf(
        ornamentBy(
          gridOf(rhythm.events).map((grid, index) => ({
            ...grid,
            keep: offbeat(rhythm.events[index] as RhythmEvent),
          })),
          (grid) => grid.keep,
          0.5,
          draw,
        ),
        rhythm.totalBeats,
      ),
    );
    // Everything the predicate does not claim survives whatever the dial says.
    expect(rhythm.ornamentBy(() => false, 0, 3).equals(rhythm)).toBe(true);
  });

  it('deforms the way deform deforms, with the dials read from the context', () => {
    const rhythm = pattern();
    const ctx = { seed: 5, complexity: { rhythmic: 0.9, ornament: 0.4 } };
    const resolved = resolveContext(ctx);
    const steps = rhythm.totalBeats / STEP_BEATS;
    expect(rhythm.deform(undefined, ctx).events).toEqual(
      eventsOf(
        deform(
          gridOf(rhythm.events),
          { rhythmic: resolved.rhythmic, ornament: resolved.ornament, spanSteps: steps },
          resolved.part(PART),
        ),
        rhythm.totalBeats,
      ),
    );
    expect(rhythm.deform({ rate: 'half' }, ctx).events).toEqual(
      eventsOf(
        deform(
          gridOf(rhythm.events),
          {
            rhythmic: resolved.rhythmic,
            ornament: resolved.ornament,
            rate: 'half',
            spanSteps: steps,
          },
          resolved.part(PART),
        ),
        rhythm.totalBeats,
      ),
    );
    // A context naming no dial leaves the figure as it was written.
    expect(rhythm.deform().equals(rhythm)).toBe(true);
  });

  it('answers the ceiling the way withinCeiling answers it', () => {
    const rhythm = pattern();
    for (const ctx of [
      { bpm: 60, complexity: { difficulty: 1 } },
      { bpm: 240, complexity: { difficulty: 1 } },
      { bpm: 240, complexity: { difficulty: 5 } },
      { bpm: 240 },
      {},
    ]) {
      const resolved = resolveContext(ctx);
      expect(rhythm.withinCeiling(ctx), JSON.stringify(ctx)).toBe(
        withinCeiling(gridOf(rhythm.events), resolved.bpm, resolved.difficulty),
      );
    }
  });

  it('scores the notes rhythmToNoteEvents makes of it', () => {
    const rhythm = pattern();
    expect(rhythm.toScore(38, 100).data).toEqual(
      Score.of(rhythmToNoteEvents(rhythm.events, 38, 100), { meters: FOUR_FOUR }).data,
    );
    expect(rhythm.toScore(38).data).toEqual(
      Score.of(rhythmToNoteEvents(rhythm.events, 38), { meters: FOUR_FOUR }).data,
    );
    expect(rhythm.toScore(38).notes).toHaveLength(rhythm.events.length);
    expect(() => rhythm.toScore(38, 200)).toThrow(RangeError);
  });
});

describe('Rhythm chains', () => {
  it('is the same three functions applied in order', () => {
    const rhythm = pattern();
    const span = rhythm.totalBeats;
    const draw = resolveContext(9).part(PART);
    const chained = rhythm.thin(0.2).syncopate(0.5, 9).halfTime();
    const applied = eventsOf(
      halfTime(syncopate(thin(gridOf(rhythm.events), 0.2, '4/4'), 0.5, draw), span / STEP_BEATS),
      span,
    );
    expect(chained.events).toEqual(applied);
    expect(chained.equals(Rhythm.of(applied, FOUR_FOUR))).toBe(true);
  });

  it('leaves every pattern in the chain untouched', () => {
    const rhythm = pattern();
    const before = rhythm.data;
    const thinned = rhythm.thin(0.4);
    thinned.syncopate(0.5, 1).doubleTime().halfTime();
    expect(rhythm.data).toEqual(before);
    expect(thinned.equals(rhythm.thin(0.4))).toBe(true);
  });

  it('keeps the span and the meter across a transformation', () => {
    const rhythm = pattern();
    for (const transformed of [
      rhythm.thin(0.6),
      rhythm.syncopate(0.8, 2),
      rhythm.doubleTime(),
      rhythm.halfTime(),
      rhythm.deform({ rate: 'double' }, { complexity: { rhythmic: 0.9 } }),
    ]) {
      expect(transformed.totalBeats).toBe(rhythm.totalBeats);
      expect(transformed.ts).toEqual(rhythm.ts);
      // Each onset sounds until the next, as the generator writes them.
      expect(spanOf(transformed.events)).toBe(rhythm.totalBeats);
      for (const [index, event] of transformed.events.entries()) {
        const next = transformed.events[index + 1]?.position ?? rhythm.totalBeats;
        expect(event.position + event.duration).toBeCloseTo(next, 10);
      }
    }
  });

  it('reads one onset per position out of a transform', () => {
    // Compressing to half the length rounds two adjacent sixteenths onto one
    // step, and a rhythm has nothing to tell two onsets in one place apart.
    const dense = Rhythm.of([
      { position: 0, duration: 0.25 },
      { position: 0.25, duration: 0.25 },
      { position: 0.5, duration: 3.5 },
    ]);
    const positions = dense.doubleTime().events.map((event) => event.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('the meter a pattern is counted in', () => {
  /** The positions a pattern holds, in beats. */
  const positionsOf = (rhythm: Rhythm): number[] => rhythm.events.map((event) => event.position);

  /** A dense pattern in one meter, with an onset on every sixteenth. */
  function everySixteenth(ts: string, bars: number): Rhythm {
    const barBeats = beatsPerBar(ts);
    const events: RhythmEvent[] = [];
    for (let step = 0; step * STEP_BEATS < barBeats * bars; step += 1) {
      events.push({ position: step * STEP_BEATS, duration: STEP_BEATS });
    }
    return Rhythm.of(events, ts);
  }

  it('keeps the downbeats of a three-beat bar when thinned to the last rank', () => {
    // Four bars of 3/4: the downbeats are sixteenth steps 0, 12, 24 and 36, and
    // a 4/4 reading of the same onsets would keep 0, 16 and 32 instead — the
    // second bar's downbeat dropped and two in-bar positions kept.
    const thinned = everySixteenth('3/4', 4).thin(0.8);
    expect(positionsOf(thinned)).toEqual([0, 3, 6, 9]);
    expect(thinned.ts).toEqual(parseTimeSignature('3/4'));
  });

  it('keeps the dotted-quarter pulses of a compound bar', () => {
    // 6/8 is two pulses of a beat and a half, not three quarter-note beats.
    const thinned = everySixteenth('6/8', 2).thin(0.4);
    expect(positionsOf(thinned)).toEqual([0, 1.5, 3, 4.5]);
  });

  it('ranks an additive bar by the grouping it carries', () => {
    // 2+2+3/8: the head of each group is the accent, so thinning to the rank
    // above the plain pulses leaves the three group heads of each bar.
    const thinned = everySixteenth('2+2+3/8', 2).thin(0.6);
    expect(positionsOf(thinned)).toEqual([0, 1, 2, 3.5, 4.5, 5.5]);
  });

  it('anticipates only what its own meter calls a main pulse', () => {
    const syncopated = everySixteenth('3/4', 2).syncopate(0.9, 5);
    // Every onset is already sounding, so what is under test is that no
    // position is anticipated that the meter does not accent: the pattern comes
    // back with the onsets it had, in its own meter.
    expect(positionsOf(syncopated)).toEqual(positionsOf(everySixteenth('3/4', 2)));

    // On a pattern of pulses alone, the anticipations land a sixteenth before a
    // pulse of the meter and nowhere else.
    const pulses = Rhythm.of(
      [0, 1, 2, 3, 4, 5].map((i) => ({ position: i, duration: 1 })),
      '3/4',
    );
    const pushed = pulses.syncopate(1, 5);
    for (const position of positionsOf(pushed)) {
      const anticipates = position + STEP_BEATS;
      expect(
        position % 1 === 0 || metricWeight(anticipates, '3/4') >= 1,
        `anticipation at ${position}`,
      ).toBe(true);
    }
  });

  it('moves the dials monotonically in every meter', () => {
    for (const ts of ['4/4', '3/4', '6/8', '2+2+3/8']) {
      const rhythm = everySixteenth(ts, 2);
      let previous = new Set(positionsOf(rhythm));
      for (const amount of [0.2, 0.4, 0.6, 0.8, 1]) {
        const surviving = new Set(positionsOf(rhythm.thin(amount)));
        for (const position of surviving) {
          // Thinning further never brings an onset back.
          expect(previous.has(position), `${ts} thin ${amount} at ${position}`).toBe(true);
        }
        previous = surviving;
      }
      const sparse = rhythm.thin(0.8);
      let onsets = positionsOf(sparse).length;
      for (const amount of [0.2, 0.5, 0.9, 1]) {
        const count = positionsOf(sparse.syncopate(amount, 3)).length;
        expect(count, `${ts} syncopate ${amount}`).toBeGreaterThanOrEqual(onsets);
        onsets = count;
      }
    }
  });
});
