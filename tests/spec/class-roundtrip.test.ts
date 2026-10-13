/**
 * Every model class survives `toJSON` → `fromData` without losing anything.
 *
 * A class crosses the binding boundary as its data alone, so whatever an
 * instance answers has to be recoverable from `toJSON()`. The check is
 * behavioural: the restored instance must serialize to the same data and
 * answer every getter the same way, so state held beside the data (a cache, a
 * context, an analysis) that the data cannot rebuild shows up as a difference.
 */
import * as model from '@libraz/libcantus/model';
import {
  Arrangement,
  BudgetExceededError,
  Chord,
  Composer,
  Duration,
  Instrument,
  Interval,
  InvalidInputError,
  Key,
  Meter,
  Motif,
  NoSolutionError,
  Note,
  Progression,
  Rhythm,
  Score,
  Tempo,
  Timeline,
  Tuning,
  Voicing,
} from '@libraz/libcantus/model';
import { describe, expect, it } from 'vitest';

type DataClass = {
  name: string;
  fromData(data: unknown): { toJSON(): unknown };
};

/** C major, two bars of block chords over a moving bass and a melody. */
const NOTES = [
  { pitch: 48, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 2 },
  { pitch: 67, startBeat: 0, durationBeat: 2 },
  { pitch: 72, startBeat: 0, durationBeat: 1 },
  { pitch: 74, startBeat: 1, durationBeat: 1 },
  { pitch: 76, startBeat: 2, durationBeat: 2 },
  { pitch: 43, startBeat: 4, durationBeat: 4 },
  { pitch: 62, startBeat: 4, durationBeat: 4 },
  { pitch: 65, startBeat: 4, durationBeat: 4 },
  { pitch: 71, startBeat: 4, durationBeat: 2 },
  { pitch: 67, startBeat: 6, durationBeat: 2 },
];

/** One instance per class, built with its optional parts filled in. */
const INSTANCES: Record<string, () => { toJSON(): unknown }> = {
  Arrangement: () =>
    Arrangement.of(
      [
        { name: 'melody', role: 'melody', notes: NOTES.filter((n) => n.pitch >= 71) },
        { name: 'bass', role: 'bass', notes: NOTES.filter((n) => n.pitch < 50) },
      ],
      { key: 'C major', meters: '4/4' },
    ),
  Chord: () => Chord.fromFiguredBass('E3', '6', 'C major'),
  Composer: () => Composer.of({ key: Key.major('C'), bpm: 96, seed: 7 }),
  Duration: () => Duration.of('eighth', 1, { actual: 3, normal: 2 }),
  Instrument: () => Instrument.guitarDropD(),
  Interval: () => Interval.between(Note.parse('E4'), Note.parse('C4')),
  Key: () => Key.named('dorian', 'D'),
  Meter: () => Meter.of(7, 8, [2, 2, 3]),
  Motif: () => Motif.fromNotes(NOTES.filter((n) => n.pitch >= 71)),
  Note: () => Note.parse('Eb4'),
  Progression: () =>
    Progression.of([Chord.parse('Dm7'), Chord.parse('G7'), Chord.parse('Cmaj7')], 'C major'),
  Rhythm: () => Rhythm.generate('6/8', { bars: 2, ctx: { seed: 3 } }),
  Score: () => Score.of(NOTES, { meters: '4/4', tempo: 112, key: 'C major' }),
  Tempo: () => Tempo.of(84),
  Timeline: () => Timeline.fromNotes(NOTES),
  Tuning: () => Tuning.edo(19, 440, 69),
  Voicing: () => Voicing.satb(Chord.parse('G7')),
};

const ERROR_CLASSES = [BudgetExceededError, InvalidInputError, NoSolutionError];

/** Whether a value is a class rather than a plain function. */
function isClass(value: unknown): value is abstract new (...args: never[]) => unknown {
  return typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value));
}

/** A value with every class instance replaced by its data and every function by a marker. */
function normalize(value: unknown, seen = new Set<unknown>()): unknown {
  if (typeof value === 'function') return '[function]';
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  try {
    const own = value as { toJSON?: () => unknown };
    if (typeof own.toJSON === 'function' && Object.getPrototypeOf(value) !== Object.prototype) {
      return { $class: value.constructor.name, data: normalize(own.toJSON(), seen) };
    }
    if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item, seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

/** The string-named getters a class's prototype declares. */
function getters(cls: abstract new (...args: never[]) => unknown): string[] {
  return Object.entries(Object.getOwnPropertyDescriptors(cls.prototype))
    .filter(([, descriptor]) => typeof descriptor.get === 'function')
    .map(([name]) => name)
    .sort();
}

const classes = Object.entries(model)
  .filter(([, value]) => isClass(value))
  .map(([name, value]) => [name, value] as [string, abstract new (...args: never[]) => unknown]);

describe('the model barrel', () => {
  it('exports twenty classes: the data classes and the three errors', () => {
    expect(classes).toHaveLength(20);
    const errors = classes.filter(([, cls]) => ERROR_CLASSES.includes(cls as never));
    expect(errors.map(([name]) => name).sort()).toEqual([
      'BudgetExceededError',
      'InvalidInputError',
      'NoSolutionError',
    ]);
  });

  it('gives every class that is not an error a fromData and a toJSON', () => {
    const data = classes.filter(([, cls]) => !ERROR_CLASSES.includes(cls as never));
    expect(data.map(([name]) => name).sort()).toEqual(Object.keys(INSTANCES).sort());
    for (const [name, cls] of data) {
      expect(typeof (cls as unknown as DataClass).fromData, `${name}.fromData`).toBe('function');
      expect(typeof cls.prototype.toJSON, `${name}#toJSON`).toBe('function');
    }
  });
});

describe('toJSON → fromData', () => {
  it.each(Object.keys(INSTANCES).sort())('loses nothing for %s', (name) => {
    const cls = (model as Record<string, unknown>)[name] as DataClass &
      (abstract new (
        ...args: never[]
      ) => unknown);
    const original = INSTANCES[name]?.() as Record<string, unknown> & { toJSON(): unknown };
    const data = original.toJSON();

    const restored = cls.fromData(structuredClone(data)) as Record<string, unknown> & {
      toJSON(): unknown;
    };

    expect(restored).toBeInstanceOf(cls);
    expect(restored.toJSON()).toEqual(data);
    const names = getters(cls);
    expect(names.length).toBeGreaterThan(0);
    for (const getter of names) {
      expect(normalize(restored[getter]), `${name}#${getter}`).toEqual(normalize(original[getter]));
    }
  });

  it.each(Object.keys(INSTANCES).sort())('is stable under a second round trip for %s', (name) => {
    const cls = (model as Record<string, unknown>)[name] as DataClass;
    const once = cls.fromData(structuredClone(INSTANCES[name]?.().toJSON())).toJSON();

    expect(cls.fromData(structuredClone(once)).toJSON()).toEqual(once);
  });
});
