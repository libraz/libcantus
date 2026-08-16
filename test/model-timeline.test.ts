import { describe, expect, it } from 'vitest';
import { chordToRoman } from '../src/analyze/functional/index.js';
import { prevailingKeyOf } from '../src/analyze/keys/index.js';
import { reduceProgression } from '../src/analyze/reduction/index.js';
import {
  chordTimelineFromChords,
  chordTimelineFromNotes,
  detectCadences,
} from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { toSpelledInterval } from '../src/core/pitch/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Chord } from '../src/model/chord.js';
import { Key } from '../src/model/key.js';
import { Progression } from '../src/model/progression.js';
import { Timeline, type TimelineData } from '../src/model/timeline.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord, transposeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

/**
 * The timed harmony class: the contracts every model class holds, the three
 * ways a timeline is built, and — the point of the class — that every
 * analytical member answers exactly what calling the underlying function on the
 * same input answers.
 */

/** `I - IV - V7 - I`, one chord per bar, as the generators hand chords over. */
const SPANS: readonly ChordSpan[] = [
  { rootPc: 0, quality: 'maj', startBeat: 0 },
  { rootPc: 5, quality: 'maj', startBeat: 4 },
  { rootPc: 7, quality: 'dom7', startBeat: 8 },
  { rootPc: 0, quality: 'maj', startBeat: 12 },
];

const TOTAL_BEATS = 16;

/** The same chords as the analysis functions read them, for the comparisons. */
const direct = () => chordTimelineFromChords(SPANS, TOTAL_BEATS);

/** The timeline under test: the same chords, in C major. */
const placed = () => Timeline.fromChords(SPANS, TOTAL_BEATS, 'C major');

/** One block chord as note events. */
function block(pitches: readonly number[], startBeat: number): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
}

/** The same progression played as block chords, for the note path. */
const NOTES: readonly NoteEvent[] = [
  ...block([60, 64, 67], 0),
  ...block([65, 69, 72], 4),
  ...block([67, 71, 74, 77], 8),
  ...block([60, 64, 67], 12),
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

describe('construction', () => {
  it('builds from placed chords exactly as the timeline function reads them', () => {
    const timeline = placed();
    expect(timeline.segments).toEqual(direct().segments);
    expect(timeline.totalBeats).toBe(TOTAL_BEATS);
    expect(timeline.length).toBe(SPANS.length);
    expect(timeline.key?.scale).toEqual(majorKey(0));
  });

  it('carries a stated key as the one region under the span', () => {
    const timeline = placed();
    expect(timeline.keys).toEqual([
      { startBeat: 0, endBeat: TOTAL_BEATS, key: majorKey(0), confidence: 1 },
    ]);
    // Without one, the timeline says it has no key rather than inventing one.
    expect(Timeline.fromChords(SPANS, TOTAL_BEATS).keys).toEqual([]);
    expect(Timeline.fromChords(SPANS, TOTAL_BEATS).key).toBeUndefined();
  });

  it('infers from notes exactly what the inference function returns', () => {
    const analysis = chordTimelineFromNotes(NOTES);
    const timeline = Timeline.fromNotes(NOTES);
    expect(timeline.segments).toEqual(analysis.timeline.segments);
    expect(timeline.keys).toEqual(analysis.keys);
    expect(timeline.key?.scale).toEqual(analysis.prevailingKey);
    expect(timeline.totalBeats).toBe(
      Math.max(
        ...analysis.timeline.segments.map((segment) => segment.endBeat),
        ...analysis.keys.map((region) => region.endBeat),
      ),
    );
  });

  it('passes the inference options through', () => {
    const opts = { totalBeats: 24, harmonicRhythm: 4 } as const;
    const analysis = chordTimelineFromNotes(NOTES, opts);
    const timeline = Timeline.fromNotes(NOTES, opts);
    expect(timeline.segments).toEqual(analysis.timeline.segments);
    expect(timeline.totalBeats).toBe(24);
  });

  it('places a progression on a regular grid', () => {
    const progression = new Progression([Chord.parse('C'), Chord.parse('F'), Chord.parse('G7')]);
    const timeline = Timeline.fromProgression(progression, 4);
    expect(timeline.segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
    expect(timeline.totalBeats).toBe(12);
    expect(timeline.segments.map((segment) => segment.chord.rootPc)).toEqual([0, 5, 7]);
  });

  it('refuses a grid whose chords last no time', () => {
    const progression = new Progression([Chord.parse('C')]);
    expect(() => Timeline.fromProgression(progression, 0)).toThrow(RangeError);
    expect(() => Timeline.fromProgression(progression, Number.NaN)).toThrow(RangeError);
  });
});

describe('plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const timeline = placed();
    expect(timeline.data).not.toBe(timeline.data);
    expect(timeline.data).toEqual(timeline.data);
    expect(timeline.segments).not.toBe(timeline.segments);
    expect(timeline.keys).not.toBe(timeline.keys);
  });

  it('cannot be changed through the value it hands out', () => {
    const timeline = placed();
    const segments = timeline.segments;
    const first = segments[0] as { startBeat: number };
    first.startBeat = 99;
    expect(timeline.segments[0]?.startBeat).toBe(0);
    expect(timeline.at(0)).not.toBeNull();
  });

  it('round-trips through its plain data', () => {
    const timeline = placed();
    expect(timeline.toJSON()).toEqual(timeline.data);
    expect(JSON.parse(JSON.stringify(timeline))).toEqual(timeline.data);
    expect(Timeline.fromData(timeline.data).data).toEqual(timeline.data);
    expect(Timeline.fromJSON(timeline.toJSON()).data).toEqual(timeline.data);
    expect(Timeline.fromData(timeline.data).equals(timeline)).toBe(true);
  });

  it('leaves the key regions out of a timeline that has none', () => {
    const bare = Timeline.fromChords(SPANS, TOTAL_BEATS);
    expect('keys' in bare.data).toBe(false);
    expect(Timeline.fromData(bare.data).data).toEqual(bare.data);
  });

  it.each([
    ['placed chords', () => placed()],
    ['inferred notes', () => Timeline.fromNotes(NOTES)],
  ])('rebuilds no %s value carrying a number it cannot hold', (_label, build) => {
    const sample = build().data as unknown;
    const paths = numericPaths(sample);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Timeline;
        try {
          rebuilt = Timeline.fromData(withNumberAt(sample, path, poison) as TimelineData);
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
});

describe('equality', () => {
  it('compares through the public surface alone', () => {
    const timeline = placed();
    expect(timeline.equals(publicFacade(timeline))).toBe(true);
  });

  it('compares the chords and the span, not the key lens', () => {
    const timeline = placed();
    expect(timeline.equals(Timeline.fromChords(SPANS, TOTAL_BEATS))).toBe(true);
    expect(timeline.equals(Timeline.fromChords(SPANS, TOTAL_BEATS + 4, 'C major'))).toBe(false);
    expect(timeline.equals(timeline.transpose(1))).toBe(false);
    expect(timeline.equals(timeline.slice(0, 8))).toBe(false);
  });
});

describe('reading a beat', () => {
  it('answers with what the underlying lookup answers', () => {
    const timeline = placed();
    const lookup = direct();
    for (const beat of [0, 2, 3.5, 4, 8, 12, 15.9]) {
      expect(timeline.at(beat)?.toJSON(), `beat ${beat}`).toEqual(lookup.at(beat));
    }
  });

  it('gives the arriving chord on a boundary, not the leaving one', () => {
    const timeline = placed();
    expect(timeline.at(3.9)?.toJSON()).toEqual(makeChord(0, 'maj'));
    expect(timeline.at(4)?.toJSON()).toEqual(makeChord(5, 'maj'));
  });

  it('answers null outside every segment', () => {
    const timeline = placed();
    expect(timeline.at(TOTAL_BEATS)).toBeNull();
    expect(timeline.at(-1)).toBeNull();
    // A rest between two segments is outside both of them.
    const gapped = new Timeline({
      segments: [
        { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
        { startBeat: 8, endBeat: 12, chord: makeChord(7, 'dom7') },
      ],
      totalBeats: 12,
    });
    expect(gapped.at(6)).toBeNull();
    expect(gapped.at(8)?.toJSON()).toEqual(makeChord(7, 'dom7'));
    expect(() => gapped.at(Number.NaN)).toThrow(RangeError);
  });

  it('hands the chord the key in force, so it can name itself', () => {
    const timeline = placed();
    expect(timeline.at(8)?.roman()).toBe(chordToRoman(makeChord(7, 'dom7'), majorKey(0)));
    // Without a key region there is none to attach, and the chord says so.
    expect(() => Timeline.fromChords(SPANS, TOTAL_BEATS).at(8)?.roman()).toThrow(InvalidInputError);
  });

  it('exposes the shape the analysis functions take', () => {
    const timeline = placed();
    expect(timeline.chordTimeline.segments).toEqual(direct().segments);
    expect(timeline.chordTimeline.at(5)).toEqual(direct().at(5));
    expect([...timeline]).toEqual(timeline.segments);
  });
});

describe('analysis equivalence', () => {
  it('reduces to what reduceProgression reduces to', () => {
    const timeline = placed();
    for (const basis of ['function', 'duration'] as const) {
      expect(timeline.reduce({ basis }), basis).toEqual(
        reduceProgression(direct(), majorKey(0), { basis }),
      );
    }
    expect(timeline.reduce()).toEqual(reduceProgression(direct(), majorKey(0)));
    expect(timeline.reduce().length).toBe(timeline.length);
  });

  it('finds the cadences detectCadences finds, each with its beat', () => {
    const timeline = placed();
    const hits = timeline.cadences();
    expect(hits).toEqual(detectCadences(direct(), majorKey(0)));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      // The beat is the point of answering from a timeline rather than a pair.
      expect(timeline.at(hit.atBeat)?.toJSON()).toEqual(hit.to);
    }
  });

  it('names the same numerals chordToRoman names, segment by segment', () => {
    const timeline = placed();
    expect(timeline.roman()).toEqual(
      timeline.segments.map((segment) => ({
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
        roman: chordToRoman(segment.chord, majorKey(0)),
      })),
    );
    expect(timeline.roman(undefined, { applied: true }).map((entry) => entry.roman)).toEqual(
      timeline.segments.map((segment) =>
        chordToRoman(segment.chord, majorKey(0), { applied: true }),
      ),
    );
    // An explicit key is read instead of the carried one.
    expect(timeline.roman('G major').map((entry) => entry.roman)).toEqual(
      timeline.segments.map((segment) => chordToRoman(segment.chord, majorKey(7))),
    );
  });

  it('reads every chord in the key in force where the piece modulates', () => {
    const modulating = new Timeline({
      segments: [
        { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
        { startBeat: 4, endBeat: 8, chord: makeChord(2, 'dom7') },
        { startBeat: 8, endBeat: 12, chord: makeChord(7, 'maj') },
      ],
      totalBeats: 12,
      keys: [
        { startBeat: 0, endBeat: 6, key: majorKey(0), confidence: 1 },
        { startBeat: 6, endBeat: 12, key: majorKey(7), confidence: 1, modulation: 'dominant' },
      ],
    });
    expect(modulating.roman().map((entry) => entry.roman)).toEqual([
      chordToRoman(makeChord(0, 'maj'), majorKey(0)),
      chordToRoman(makeChord(2, 'dom7'), majorKey(0)),
      chordToRoman(makeChord(7, 'maj'), majorKey(7)),
    ]);
    expect(modulating.key?.scale).toEqual(prevailingKeyOf(modulating.keys));
  });

  it('reports the prevailing key the key module reports', () => {
    const timeline = Timeline.fromNotes(NOTES);
    expect(timeline.key?.scale).toEqual(prevailingKeyOf(timeline.keys));
  });

  it('needs a key before it will read the chords', () => {
    const bare = Timeline.fromChords(SPANS, TOTAL_BEATS);
    expect(() => bare.reduce()).toThrow(InvalidInputError);
    expect(() => bare.cadences()).toThrow(InvalidInputError);
    expect(() => bare.roman()).toThrow(InvalidInputError);
    // A key passed in is enough for the numerals.
    expect(bare.roman('C major').map((entry) => entry.roman)).toEqual(
      placed()
        .roman()
        .map((entry) => entry.roman),
    );
  });
});

describe('transforming', () => {
  it('slices the stretch between two beats, keeping the beats', () => {
    const sliced = placed().slice(6, 14);
    expect(sliced.segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [6, 8],
      [8, 12],
      [12, 14],
    ]);
    expect(sliced.totalBeats).toBe(14);
    expect(sliced.keys).toEqual([{ startBeat: 6, endBeat: 14, key: majorKey(0), confidence: 1 }]);
    expect(sliced.at(6)?.toJSON()).toEqual(placed().at(6)?.toJSON());
    expect(sliced.at(4)).toBeNull();
    expect(() => placed().slice(8, 4)).toThrow(InvalidInputError);
    expect(placed().slice(4, 4).length).toBe(0);
  });

  it('transposes every chord the way transposeChord does', () => {
    const timeline = placed();
    expect(timeline.transpose(2).segments.map((segment) => segment.chord)).toEqual(
      timeline.segments.map((segment) => transposeChord(segment.chord, 2)),
    );
    expect(timeline.transpose(2).key?.scale).toEqual(majorKey(2));
    expect(timeline.transpose(2).totalBeats).toBe(TOTAL_BEATS);
  });

  it('transposes by a spelled interval by the semitones it spans', () => {
    const timeline = placed();
    const semitones = toSpelledInterval('A4').semitones;
    expect(timeline.transposeBy('A4').segments.map((segment) => segment.chord)).toEqual(
      timeline.segments.map((segment) => transposeChord(segment.chord, semitones)),
    );
    expect(timeline.transposeBy('A4').key?.scale).toEqual(majorKey(6));
  });

  it('spells a chord that carries its own spelling by the interval', () => {
    // The letters follow the interval, not the semitone count: up an augmented
    // fourth is F#, up a diminished fifth Gb. A chord read off a span carries no
    // spelling, so this needs one that does.
    const spelled = new Timeline({
      segments: [{ startBeat: 0, endBeat: 4, chord: Chord.parse('C').toJSON() }],
      totalBeats: 4,
    });
    expect(spelled.transposeBy('A4').at(0)?.symbol()).toBe('F#');
    expect(spelled.transposeBy('d5').at(0)?.symbol()).toBe('Gb');
    // A key region holds a key/scale, so a chord spelled by the key in force
    // takes the letters that scale reads best from either way.
    expect(placed().transposeBy('A4').at(0)?.symbol()).toBe(
      placed().transposeBy('d5').at(0)?.symbol(),
    );
  });
});

describe('dropping the time axis', () => {
  it('keeps the chord order and the key', () => {
    const key = Key.major('C');
    const progression = new Progression(
      [Chord.parse('C'), Chord.parse('F'), Chord.parse('G7'), Chord.parse('C')],
      key,
    );
    const back = Timeline.fromProgression(progression, 4).progression();
    expect(back.equals(progression)).toBe(true);
    expect(back.key?.scale).toEqual(key.scale);
    expect(back.roman()).toEqual(progression.roman());
  });

  it('loses the spellings the chords carried', () => {
    const progression = new Progression([Chord.parse('Bb'), Chord.parse('Eb'), Chord.parse('F7')]);
    const back = Timeline.fromProgression(progression, 4).progression();
    expect(back.equals(progression)).toBe(true);
    // A span carries pitch classes, so the flats come back as their sharps.
    expect(progression.chords.map((chord) => chord.symbol())).toEqual(['Bb', 'Eb', 'F7']);
    expect(back.chords.map((chord) => chord.symbol())).toEqual(['A#', 'D#', 'F7']);
  });

  it('loses the scale form of a detected key', () => {
    const detected = Key.detectBest([57, 59, 60, 62, 64, 65, 68]) ?? Key.minor('A');
    expect(detected.variant).toBe('harmonic');
    const progression = new Progression([Chord.parse('Am'), Chord.parse('E7')], detected);
    const back = Timeline.fromProgression(progression, 4).progression();
    // A key region holds a key/scale, not the reading it came from.
    expect(back.key?.scale).toEqual(detected.scale);
    expect(back.key?.variant).toBeUndefined();
  });

  it('makes neighbours of the chords a rest separated', () => {
    const gapped = new Timeline({
      segments: [
        { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
        { startBeat: 8, endBeat: 12, chord: makeChord(7, 'dom7') },
      ],
      totalBeats: 12,
    });
    expect(gapped.progression().chords.map((chord) => chord.rootPc)).toEqual([0, 7]);
    expect(gapped.progression().length).toBe(2);
  });
});
