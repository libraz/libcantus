import { describe, expect, it } from 'vitest';
import { melodicSimilarity, motifFromNotes, relateMotifs } from '../src/analyze/melody/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  developMotif,
  generateMotif,
  type MotifCell,
  type MotifNote,
  type MotifTransform,
  motifToNoteEvents,
  transformMotif,
} from '../src/generate/index.js';
import { Motif } from '../src/model/motif.js';
import { Score } from '../src/model/score.js';
import { Timeline } from '../src/model/timeline.js';
import { majorKey } from '../src/theory/scale/index.js';
import { toChordData } from '../src/theory/symbol/index.js';

/**
 * `Motif` is a skin over the motif generator, the transformations that develop
 * a cell, and the analyses that name how two cells relate, so most of what is
 * checked here is equivalence: the class answer must be the answer the
 * underlying function gives for the same cell and the same key. The rest is the
 * contract every model class holds — plain data out, plain data back in,
 * nothing shared with the caller, and no transformation that mutates.
 */

const C_MAJOR = majorKey(0);

/** The seed motif the equivalence checks are made against. */
function subject(): Motif {
  return Motif.generate({ key: 'C major', bars: 2, ctx: { seed: 5 } });
}

/** A cell written by hand, so the transforms have known intervals to work on. */
const CELL: MotifNote[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 62, startBeat: 1, durationBeat: 1 },
  { pitch: 64, startBeat: 2, durationBeat: 1 },
];

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

describe('Motif plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const motif = subject();
    expect(motif.data).not.toBe(motif.data);
    expect(motif.data).toEqual(motif.data);
    expect(motif.data.notes[0]).not.toBe(motif.data.notes[0]);
    expect(motif.notes).not.toBe(motif.notes);
  });

  it('cannot be reached through the value it hands out', () => {
    const motif = subject();
    const data = motif.data;
    (data.notes[0] as MotifNote).pitch = 0;
    data.notes.push({ pitch: 90, startBeat: 9, durationBeat: 1 });
    expect(motif.notes[0]?.pitch).not.toBe(0);
    expect(motif.notes).toHaveLength(4);
  });

  it('does not retain the array it was built from', () => {
    const notes: MotifNote[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    const motif = Motif.fromNotes(notes);
    notes.push({ pitch: 62, startBeat: 1, durationBeat: 1 });
    (notes[0] as MotifNote).pitch = 61;
    expect(motif.notes).toEqual([{ pitch: 60, startBeat: 0, durationBeat: 1 }]);
  });

  it('reports toJSON as the value .data hands out', () => {
    const motif = subject();
    expect(motif.toJSON()).toEqual(motif.data);
    expect(JSON.parse(JSON.stringify(motif))).toEqual(motif.data);
  });

  it('round-trips through fromData and fromJSON', () => {
    const motif = subject();
    expect(Motif.fromData(motif.data).data).toEqual(motif.data);
    expect(Motif.fromJSON(JSON.parse(JSON.stringify(motif)) as MotifCell).data).toEqual(motif.data);
    expect(Motif.fromData(motif.data).equals(motif)).toBe(true);
  });

  it('keeps only the fields a motif note carries', () => {
    const played: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 90, articulation: 'staccato' },
    ];
    expect(Motif.fromNotes(played).data).toEqual({
      notes: [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
    });
  });

  it('rebuilds no cell carrying a number it cannot hold', () => {
    const sample = subject().data;
    const paths = numericPaths(sample);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Motif | undefined;
        try {
          rebuilt = Motif.fromData(withNumberAt(sample, path, poison) as MotifCell);
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

  it('refuses a note the transforms could not read', () => {
    expect(() => Motif.fromNotes([{ pitch: 900, startBeat: 0, durationBeat: 1 }])).toThrow(
      RangeError,
    );
    expect(() => Motif.fromNotes([{ pitch: 60, startBeat: 0, durationBeat: 0 }])).toThrow(
      RangeError,
    );
  });

  it('holds the notes in the order they sound', () => {
    // A retrograde reverses when the notes sound, not the order they are
    // written in, so the cell it hands back still runs forwards and the pivot
    // of an inversion on top of it is the note that now sounds first.
    const retrograde = Motif.fromNotes(CELL).transform('retrograde');
    expect(retrograde.notes.map((note) => note.startBeat)).toEqual([0, 1, 2]);
    expect(retrograde.notes.map((note) => note.pitch)).toEqual([64, 62, 60]);
    expect(retrograde.transform('invert').notes.map((note) => note.pitch)).toEqual([64, 66, 68]);
  });
});

describe('Motif equality', () => {
  it('compares through the public surface only', () => {
    const motif = subject();
    expect(motif.equals(publicFacade(motif))).toBe(true);
  });

  it('separates cells differing in a note', () => {
    const motif = Motif.fromNotes(CELL);
    expect(motif.equals(Motif.fromNotes(CELL))).toBe(true);
    expect(motif.equals(motif.transform('transposeChromatic', 1))).toBe(false);
    expect(motif.equals(Motif.fromNotes(CELL.slice(0, 2)))).toBe(false);
  });
});

describe('Motif answers what the functions answer', () => {
  it('generates the cell the generator generates from the same seed', () => {
    const ctx = { seed: 5 };
    expect(Motif.generate({ key: 'C major', bars: 2, ctx }).data).toEqual(
      generateMotif({ key: C_MAJOR, bars: 2, ctx }),
    );
    // Same seed, same cell, whichever surface asked for it.
    expect(subject().equals(subject())).toBe(true);
    expect(
      Motif.generate({ key: 'C major', bars: 2, ctx: { seed: 5, complexity: { ornament: 1 } } })
        .data,
    ).toEqual(
      generateMotif({ key: C_MAJOR, bars: 2, ctx: { seed: 5, complexity: { ornament: 1 } } }),
    );
  });

  it('passes every option the generator accepts', () => {
    const opts = {
      bars: 2,
      ts: parseTimeSignature('3/4'),
      contour: 'ascending' as const,
      jitter: 0.5,
      ctx: { seed: 3 },
    };
    expect(Motif.generate({ key: 'C major', chord: 'C', ...opts }).data).toEqual(
      generateMotif({ key: C_MAJOR, chord: toChordData('C'), ...opts }),
    );
    // A key and a chord are taken however the library spells one.
    expect(Motif.generate({ key: C_MAJOR, chord: toChordData('C'), ...opts }).data).toEqual(
      generateMotif({ key: C_MAJOR, chord: toChordData('C'), ...opts }),
    );
    expect(Motif.generate({ key: 'C major', chord: null, ...opts }).data).toEqual(
      generateMotif({ key: C_MAJOR, chord: null, ...opts }),
    );
  });

  it('transforms the cell the way transformMotif transforms it', () => {
    const motif = Motif.fromNotes(CELL);
    const cell: MotifCell = { notes: CELL };
    const kinds: MotifTransform[] = [
      'invert',
      'retrograde',
      'augment',
      'diminish',
      'transposeChromatic',
      'transposeDiatonic',
      'sequence',
    ];
    for (const kind of kinds) {
      expect(motif.transform(kind).data, kind).toEqual(transformMotif(cell, kind));
      expect(motif.transform(kind, 3).data, `${kind} by 3`).toEqual(transformMotif(cell, kind, 3));
      expect(motif.transform(kind, 3, 'C major').data, `${kind} by 3 in C`).toEqual(
        transformMotif(cell, kind, 3, C_MAJOR),
      );
    }
    expect(() => motif.transform('transposeChromatic', 400)).toThrow(RangeError);
  });

  it('develops the cell the way developMotif develops it', () => {
    const motif = Motif.generate({ key: 'C major', bars: 1 });
    const cell = motif.data;
    const spans = [{ rootPc: 0, quality: 'maj' as const, startBeat: 0 }];
    const timeline = Timeline.fromChords(spans, 8);
    expect(motif.develop(timeline, 'C major', 2, '4/4').data).toEqual(
      developMotif(cell, timeline.chordTimeline, C_MAJOR, 2, '4/4'),
    );
    // The plain timeline the analysis layer hands out is taken as readily.
    const plain = chordTimelineFromChords(spans, 8);
    expect(motif.develop(plain, C_MAJOR, 2, '4/4').data).toEqual(
      developMotif(cell, plain, C_MAJOR, 2, '4/4'),
    );
    const waltz = parseTimeSignature('3/4');
    expect(motif.develop(plain, 'C major', 2, waltz).data).toEqual(
      developMotif(cell, plain, C_MAJOR, 2, waltz),
    );
    expect(() => motif.develop(plain, 'C major', 0, '4/4')).toThrow(RangeError);
  });

  it('names a relation the way relateMotifs names it', () => {
    const model = Motif.fromNotes(CELL);
    const answer = model.transform('transposeDiatonic', 1, 'C major');
    expect(model.relateTo(answer)).toEqual(
      relateMotifs(motifFromNotes(model.notes), motifFromNotes(answer.notes)),
    );
    expect(model.relateTo(answer, 'C major')).toEqual(
      relateMotifs(motifFromNotes(model.notes), motifFromNotes(answer.notes), C_MAJOR),
    );
    // The key is what tells a tonal answer from a real one.
    expect(model.relateTo(answer)?.kind).toBe(undefined);
    expect(model.relateTo(answer, 'C major')?.kind).toBe('tonalTransposition');
    expect(model.relateTo(Motif.fromNotes(CELL.slice(0, 2)))).toBe(null);
  });

  it('scores its likeness the way melodicSimilarity scores it', () => {
    const model = Motif.fromNotes(CELL);
    const other = Motif.generate({ key: 'C major', bars: 1 });
    expect(model.similarityTo(other)).toBe(melodicSimilarity(model.notes, other.notes));
    expect(model.similarityTo(model)).toBe(melodicSimilarity(CELL, CELL));
    expect(model.similarityTo(model.transform('transposeChromatic', 5))).toBe(1);
  });

  it('makes the score motifToNoteEvents makes of it', () => {
    const motif = subject();
    expect(motif.toScore().data).toEqual(Score.of(motifToNoteEvents(motif.data)).data);
    const opts = { meters: parseTimeSignature('3/4'), tempo: 90, key: 'C major' };
    expect(motif.toScore(opts).data).toEqual(Score.of(motifToNoteEvents(motif.data), opts).data);
    expect(motif.toScore().notes).toHaveLength(motif.notes.length);
  });

  it('measures its own span from its first onset', () => {
    expect(Motif.fromNotes(CELL).totalBeats).toBe(3);
    expect(Motif.fromNotes([]).totalBeats).toBe(0);
    expect(Motif.fromNotes(CELL).transform('augment', 2).totalBeats).toBe(6);
  });
});

describe('Motif chains', () => {
  it('leaves every cell in the chain untouched', () => {
    const motif = Motif.fromNotes(CELL);
    const before = motif.data;
    motif.transform('invert').transform('retrograde').transform('augment');
    expect(motif.data).toEqual(before);
  });

  it('is the transformations applied in order', () => {
    const motif = Motif.fromNotes(CELL);
    const chained = motif.transform('invert').transform('augment', 2).transform('retrograde');
    const applied = transformMotif(
      transformMotif(transformMotif({ notes: CELL }, 'invert'), 'augment', 2),
      'retrograde',
    );
    expect(chained.data).toEqual(applied);
    // The self-inverse pair comes back to the cell it started from.
    expect(motif.transform('invert').transform('invert').equals(motif)).toBe(true);
  });
});

/**
 * A cell as long as an imported track: the constructor accepts a cell up to the
 * generation budget, so this is an ordinary caller rather than an extreme one.
 * `Motif.fromNotes(score.notes)` on a phrase lifted out of a MIDI file is how it
 * arrives.
 */
function longCell(count: number): MotifCell {
  const notes: MotifNote[] = [];
  for (let index = 0; index < count; index += 1) {
    notes.push({ pitch: 60 + (index % 12), startBeat: index * 0.25, durationBeat: 0.25 });
  }
  return { notes };
}

/** The members that answer for a whole cell without being given another one. */
function wholeCellMembers(): string[] {
  const found: string[] = [];
  for (const key of Reflect.ownKeys(Motif.prototype)) {
    if (typeof key !== 'string' || key === 'constructor') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(Motif.prototype, key);
    if (descriptor?.get !== undefined) {
      found.push(key);
      continue;
    }
    const value = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
    if (typeof value === 'function' && value.length === 0) {
      found.push(key);
    }
  }
  return found.sort();
}

describe('Motif over a cell the size its constructor accepts', () => {
  // The cell a `Motif` may hold is bounded by the generation budget, not by the
  // number of arguments a call can carry. A member that reads the cell by
  // spreading it into `Math.min` or `Math.max` stops working long before that
  // bound and fails with a native `RangeError`, which is not one of the errors
  // this library documents. The subject is derived from the class so a member
  // added later is covered without being listed here.
  const members = wholeCellMembers();

  it('has members to check', () => {
    expect(members).toContain('totalBeats');
    expect(members.length).toBeGreaterThan(3);
  });

  it.each(members)('answers from `%s` rather than overflowing the stack', (member) => {
    const motif = Motif.fromData(longCell(200_000));
    const descriptor = Object.getOwnPropertyDescriptor(Motif.prototype, member);
    expect(descriptor).toBeDefined();
    const reader = descriptor?.get ?? (descriptor?.value as ((this: Motif) => unknown) | undefined);
    expect(typeof reader).toBe('function');
    expect(() => (reader as (this: Motif) => unknown).call(motif)).not.toThrow();
  });

  it('measures the span of a long cell the way the function layer does', () => {
    const cell = longCell(200_000);
    expect(Motif.fromData(cell).totalBeats).toBe(200_000 * 0.25);
  });
});
