import { describe, expect, it } from 'vitest';
import { InvalidInputError, isLibcantusError } from '../src/core/errors/index.js';
import { Arrangement } from '../src/model/arrangement.js';
import { Chord } from '../src/model/chord.js';
import { Composer } from '../src/model/composer.js';
import { Duration } from '../src/model/duration.js';
import { Instrument } from '../src/model/instrument.js';
import { Interval } from '../src/model/interval.js';
import { Key } from '../src/model/key.js';
import { Meter } from '../src/model/meter.js';
import { Motif } from '../src/model/motif.js';
import { Note } from '../src/model/note.js';
import { Progression } from '../src/model/progression.js';
import { Rhythm } from '../src/model/rhythm.js';
import { Score } from '../src/model/score.js';
import { Tempo } from '../src/model/tempo.js';
import { Timeline } from '../src/model/timeline.js';
import { Tuning } from '../src/model/tuning.js';
import { Voicing } from '../src/model/voicing.js';

/**
 * One class's rebuilding factories, and the malformed data they must refuse.
 *
 * The universal patterns — `null`, a value that is not an object, and an object
 * carrying no field at all — are added to every entry, so a class listed here is
 * covered by them whether or not it names any malformed value of its own.
 */
type FactoryCase = {
  /** What the class is called in a test name. */
  name: string;
  /** The factories taking caller data, bound to the class. */
  factories: Record<string, (data: never) => unknown>;
  /**
   * Data missing a required field, or carrying one of the wrong shape. Named
   * per class because what "missing" means differs: a composer holds nothing
   * required, while a score cannot be built without its notes.
   */
  malformed: readonly unknown[];
  /**
   * Whether an object carrying no field at all is itself malformed. True for
   * every class that requires one; a composer's settings are all optional, so
   * an empty object is a composer that names nothing rather than a fault.
   */
  emptyIsMalformed?: false;
};

/** Every class the model layer rebuilds from plain data, with its factories. */
const FACTORY_CASES: readonly FactoryCase[] = [
  {
    name: 'Arrangement',
    factories: {
      of: (data: never) => Arrangement.of(data),
      fromData: (data: never) => Arrangement.fromData(data),
      fromJSON: (data: never) => Arrangement.fromJSON(data),
    },
    malformed: [{ tracks: 'none' }, { tracks: [null] }, { tracks: [{ notes: [null] }] }],
  },
  {
    name: 'Chord',
    factories: {
      fromData: (data: never) => Chord.fromData(data),
      fromJSON: (data: never) => Chord.fromJSON(data),
    },
    malformed: [
      { rootPc: 0, quality: 'maj' },
      { rootPc: 0, quality: 'maj', intervals: 'none' },
    ],
  },
  {
    name: 'Composer',
    factories: {
      of: (data: never) => Composer.of(data),
      fromData: (data: never) => Composer.fromData(data),
      fromJSON: (data: never) => Composer.fromJSON(data),
    },
    malformed: [{ vocabulary: 'none' }, { instruments: 'none' }, { complexity: 'none' }],
    emptyIsMalformed: false,
  },
  {
    name: 'Duration',
    factories: {
      fromData: (data: never) => Duration.fromData(data),
      fromJSON: (data: never) => Duration.fromJSON(data),
    },
    malformed: [{ dots: 1 }],
  },
  {
    name: 'Instrument',
    factories: {
      of: (data: never) => Instrument.of(data),
      fromData: (data: never) => Instrument.fromData(data),
      fromJSON: (data: never) => Instrument.fromJSON(data),
    },
    malformed: [{ name: 'guitar' }],
  },
  {
    name: 'Interval',
    factories: {
      fromData: (data: never) => Interval.fromData(data),
      fromJSON: (data: never) => Interval.fromJSON(data),
    },
    malformed: [{ number: 3 }],
  },
  {
    name: 'Key',
    factories: {
      of: (data: never) => Key.of(data),
      fromData: (data: never) => Key.fromData(data),
      fromJSON: (data: never) => Key.fromJSON(data),
    },
    malformed: [{ scale: null }, { scale: { rootPc: 0, modeMask12: 0 } }],
  },
  {
    name: 'Meter',
    factories: {
      fromData: (data: never) => Meter.fromData(data),
      fromJSON: (data: never) => Meter.fromJSON(data),
    },
    malformed: [{ numerator: 4 }],
  },
  {
    name: 'Motif',
    factories: {
      fromData: (data: never) => Motif.fromData(data),
      fromJSON: (data: never) => Motif.fromJSON(data),
    },
    malformed: [{ notes: 'none' }, { notes: [null] }],
  },
  {
    name: 'Note',
    factories: {
      fromData: (data: never) => Note.fromData(data),
      fromJSON: (data: never) => Note.fromJSON(data),
    },
    malformed: [{ alter: 0 }],
  },
  {
    name: 'Progression',
    factories: {
      of: (data: never) => Progression.of(data),
      fromData: (data: never) => Progression.fromData(data),
      fromJSON: (data: never) => Progression.fromJSON(data),
    },
    malformed: [{ chords: 'none' }, { chords: [null] }],
  },
  {
    name: 'Rhythm',
    factories: {
      of: (data: never) => Rhythm.of(data),
      fromData: (data: never) => Rhythm.fromData(data),
      fromJSON: (data: never) => Rhythm.fromJSON(data),
    },
    malformed: [{ ts: { numerator: 4, denominator: 4 } }, { events: [null], ts: null }],
  },
  {
    name: 'Score',
    factories: {
      of: (data: never) => Score.of(data),
      fromData: (data: never) => Score.fromData(data),
      fromJSON: (data: never) => Score.fromJSON(data),
    },
    malformed: [{ notes: 'none' }, { notes: [null] }, { meters: [], tempo: [] }],
  },
  {
    name: 'Tempo',
    factories: {
      fromData: (data: never) => Tempo.fromData(data),
      fromJSON: (data: never) => Tempo.fromJSON(data),
    },
    malformed: [{ beat: 120 }],
  },
  {
    name: 'Timeline',
    factories: {
      fromData: (data: never) => Timeline.fromData(data),
      fromJSON: (data: never) => Timeline.fromJSON(data),
    },
    malformed: [
      { totalBeats: 4 },
      { segments: 'none', totalBeats: 4 },
      { segments: [null], totalBeats: 4 },
      { segments: [], totalBeats: 0, keys: [null] },
    ],
  },
  {
    name: 'Tuning',
    factories: {
      of: (data: never) => Tuning.of(data),
      fromData: (data: never) => Tuning.fromData(data),
      fromJSON: (data: never) => Tuning.fromJSON(data),
    },
    malformed: [{ refFreq: 440 }],
  },
  {
    name: 'Voicing',
    factories: {
      of: (data: never) => Voicing.of(data),
      fromData: (data: never) => Voicing.fromData(data),
      fromJSON: (data: never) => Voicing.fromJSON(data),
    },
    malformed: [[null], ['60']],
  },
];

/** The patterns every rebuilding factory is held to, plus the class's own. */
function malformedInputs(entry: FactoryCase): readonly { label: string; value: unknown }[] {
  return [
    { label: 'null', value: null },
    { label: 'a number', value: 7 },
    ...(entry.emptyIsMalformed === false ? [] : [{ label: 'an empty object', value: {} }]),
    ...entry.malformed.map((value) => ({ label: JSON.stringify(value) ?? 'undefined', value })),
  ];
}

describe('rebuilding factories refuse malformed data as an input error', () => {
  for (const entry of FACTORY_CASES) {
    for (const [factory, call] of Object.entries(entry.factories)) {
      for (const { label, value } of malformedInputs(entry)) {
        it(`${entry.name}.${factory} refuses ${label}`, () => {
          expect(() => call(value as never)).toThrow(InvalidInputError);
        });
      }
    }
  }

  it('covers every class the model layer rebuilds from plain data', () => {
    expect(FACTORY_CASES).toHaveLength(17);
  });
});

describe('the documented failure kinds hold at the rebuilding boundary', () => {
  it('reports a project file missing an array field as an input error', () => {
    try {
      Timeline.fromJSON({ totalBeats: 4 } as never);
      expect.unreachable('a timeline without segments is not rebuildable');
    } catch (error) {
      expect(isLibcantusError(error)).toBe(true);
    }
  });

  it('names the field that is wrong rather than the property read off it', () => {
    expect(() => Score.fromJSON({ notes: [null] } as never)).toThrow(/score notes\[0\]/);
  });

  it('refuses a score built from no notes at all', () => {
    expect(() => Score.of({} as never)).toThrow(InvalidInputError);
    expect(() => Score.fromJSON(null as never)).toThrow(InvalidInputError);
  });
});

describe('plain-data copies terminate on pathological input', () => {
  it('refuses a vocabulary entry that refers back to itself', () => {
    const material: Record<string, unknown> = {};
    material.self = material;
    expect(() => Composer.of({ vocabulary: [{ material }] as never })).toThrow(InvalidInputError);
  });

  it('refuses a time signature carrying a self-referring extra property', () => {
    const ts: Record<string, unknown> = { numerator: 4, denominator: 4 };
    ts.self = ts;
    expect(() =>
      Arrangement.of([{ notes: [{ pitch: 60, startBeat: 0, durationBeat: 1 }] }], {
        ts: ts as never,
      }),
    ).toThrow(InvalidInputError);
  });

  it('refuses data nested past the depth a document is copied to', () => {
    const deep: Record<string, unknown> = {};
    let leaf = deep;
    for (let level = 0; level < 200; level += 1) {
      const next: Record<string, unknown> = {};
      leaf.next = next;
      leaf = next;
    }
    expect(() => Composer.of({ vocabulary: [{ material: deep }] as never })).toThrow(
      InvalidInputError,
    );
  });

  it('rejects the same non-plain values on both sides that copy plain data', () => {
    const notPlain = { material: () => 0 };
    expect(() => Composer.of({ vocabulary: [notPlain] as never })).toThrow(InvalidInputError);
    expect(() =>
      Arrangement.of([{ notes: [] }], {
        ts: { numerator: 4, denominator: 4, extra: () => 0 } as never,
      }),
    ).toThrow(InvalidInputError);
  });

  it('rejects a non-finite number on both sides that copy plain data', () => {
    expect(() => Composer.of({ vocabulary: [{ weight: Number.NaN }] as never })).toThrow(
      InvalidInputError,
    );
    expect(() =>
      Arrangement.of([{ notes: [] }], {
        ts: { numerator: 4, denominator: 4, extra: Number.NaN } as never,
      }),
    ).toThrow(InvalidInputError);
  });

  it('copies a record named twice beside itself rather than calling it cyclic', () => {
    const shared = { weight: 1 };
    const entry = {
      id: 'figure',
      genre: 'pop',
      material: { a: shared, b: shared },
      articulations: [],
      difficulty: 1,
      provenance: { basis: 'construction', note: 'written for this test from its own grid' },
    };
    const composer = Composer.of({ vocabulary: [entry] as never });
    expect(composer.data.vocabulary?.[0]?.material).toEqual({ a: { weight: 1 }, b: { weight: 1 } });
  });
});
