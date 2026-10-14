import { InvalidInputError, isLibcantusError } from '@libraz/libcantus/core';
import {
  Arrangement,
  Chord,
  Composer,
  Duration,
  Instrument,
  Interval,
  Key,
  Meter,
  Motif,
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
      of: (data: never) => Rhythm.of(data, '4/4'),
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

  it('stores the signature a time signature names, not the object it arrived on', () => {
    // An arrangement resolves `ts` before it copies it, exactly as it resolves
    // its sibling `meters`, so an extra property riding on the value — here one
    // that refers back to the signature itself — never reaches the plain copy.
    // What is stored is the signature, and a copy of it terminates.
    const ts: Record<string, unknown> = { numerator: 4, denominator: 4 };
    ts.self = ts;
    const held = Arrangement.of([{ notes: [{ pitch: 60, startBeat: 0, durationBeat: 1 }] }], {
      ts: ts as never,
    });
    expect(held.data.settings?.ts).toEqual({ numerator: 4, denominator: 4 });
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

  it('refuses a non-plain value where data is copied, and drops it where a meter is read', () => {
    const notPlain = { material: () => 0 };
    expect(() => Composer.of({ vocabulary: [notPlain] as never })).toThrow(InvalidInputError);
    expect(
      Arrangement.of([{ notes: [] }], {
        ts: { numerator: 4, denominator: 4, extra: () => 0 } as never,
      }).data.settings?.ts,
    ).toEqual({ numerator: 4, denominator: 4 });
  });

  it('refuses a non-finite number where data is copied, and drops it where a meter is read', () => {
    expect(() => Composer.of({ vocabulary: [{ weight: Number.NaN }] as never })).toThrow(
      InvalidInputError,
    );
    expect(
      Arrangement.of([{ notes: [] }], {
        ts: { numerator: 4, denominator: 4, extra: Number.NaN } as never,
      }).data.settings?.ts,
    ).toEqual({ numerator: 4, denominator: 4 });
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

describe('model classes read a value they are handed through its public surface', () => {
  const region = { startBeat: 0, endBeat: 4, key: 'C major', confidence: 1 };
  const cMajorTriad = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };

  it('refuses a key region whose modulation or pivot numeral the library does not write', () => {
    const timeline = (keys: unknown[]) =>
      Timeline.fromData({ segments: [], totalBeats: 4, keys } as never);
    expect(() => timeline([{ ...region, modulation: 'sideways' }])).toThrow(
      'key region modulation must be one of same, enharmonic, relative, parallel, dominant, subdominant, relativeOfDominant, relativeOfSubdominant; received "sideways"',
    );
    expect(timeline([{ ...region, modulation: 'relative' }]).keys[0]?.modulation).toBe('relative');
    const pivot = { chord: cMajorTriad, romanFrom: 'I', romanTo: 'IV' };
    expect(() => timeline([{ ...region, pivot: { ...pivot, romanFrom: 1 } }])).toThrow(
      'key region pivot romanFrom must be a string; received number',
    );
    expect(() => timeline([{ ...region, pivot: { ...pivot, romanTo: null } }])).toThrow(
      'key region pivot romanTo must be a string; received null',
    );
  });

  it('holds the span of a stated-key region to a beat', () => {
    const score = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }], { key: 'C major' });
    expect(() => score.keys({ totalBeats: 'x' as never })).toThrow(
      'key timeline totalBeats must be finite; received x',
    );
    expect(() => score.keys({ totalBeats: -1 })).toThrow(
      'key timeline totalBeats must be in [0, 9007199254740991]; received -1',
    );
    expect(score.keys({ totalBeats: 2 })[0]?.endBeat).toBe(2);
  });

  it('keeps a tonic read structurally as the note its data names', () => {
    const scale = { rootPc: 2, modeMask12: 2741 };
    expect(() => new Key(scale, { pitchClass: 2, data: null } as never)).toThrow(
      'note data must be an object; received null',
    );
    const key = new Key(scale, { pitchClass: 2, data: { letter: 1, alter: 0 } } as never);
    expect(key.toJSON().tonic).toEqual({ letter: 1, alter: 0 });
    expect(() => new Key({ rootPc: 0, modeMask12: 2 }, 5 as never)).toThrow(
      'scale.modeMask12 must include the tonic (bit 0)',
    );
    expect(() => new Key(Key.major('D') as never, Note.parse('D'))).toThrow(
      'scale.modeMask12 must be finite; received undefined',
    );
  });

  it('rebuilds every progression member from its own data', () => {
    expect(() => new Progression([cMajorTriad] as never)).toThrow(TypeError);
    expect(() => new Progression([cMajorTriad] as never, 'C major')).toThrow(
      'chord.toJSON is not a function',
    );
    expect(() => new Progression([Score.of([])] as never, 'C major')).toThrow(
      'Unknown chord quality: undefined',
    );
    const progression = new Progression([Chord.parse('G7/D')], Key.major('Eb'));
    expect(Progression.fromData(progression as never).toJSON().chords).toEqual([
      { rootPc: 7, quality: 'dom7', intervals: [0, 4, 7, 10], bassPc: 2 },
    ]);
  });

  it('reads an instance handed as options or data through its getters and methods', () => {
    expect(() => Key.major('Eb').noteNames(Key.major('C') as never)).toThrow(
      'system must be one of english, german, japanese, italian, fixedDo; received function',
    );
    const timeline = Timeline.fromChords(
      [{ rootPc: 8, quality: 'min', startBeat: 0 }],
      4,
      'Ab minor',
    );
    expect(Score.empty(timeline as never).toJSON().key).toEqual({
      scale: { rootPc: 8, modeMask12: 1453 },
      tonic: { letter: 5, alter: -1 },
      variant: 'natural',
    });
    expect(() => Score.fromData(Key.major('C') as never)).toThrow(
      'score notes must be an array; received function',
    );
  });

  it('iterates a progression or a timeline and calls an array through its own members', () => {
    const progression = new Progression([Chord.parse('C'), Chord.parse('G')]);
    expect(() => progression.equals([1, 2] as never)).toThrow(
      "Cannot read properties of undefined (reading 'rootPc')",
    );
    const timeline = Timeline.fromChords([{ rootPc: 0, quality: 'maj', startBeat: 0 }], 4);
    expect(() => progression.concat(timeline as never)).toThrow('chord.toJSON is not a function');
    expect(() => Key.major('C').spellPitchClasses(timeline as never)).toThrow(
      'pcs[0] must be finite; received [object Object]',
    );
  });
});
