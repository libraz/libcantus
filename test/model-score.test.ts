import { describe, expect, it } from 'vitest';
import { hypermeter, phrasesFromTimeline, sectionsFromNotes } from '../src/analyze/form/index.js';
import { keyLookup, keyTimelineFromNotes, prevailingKeyOf } from '../src/analyze/keys/index.js';
import { extractMotifs, melodicContour } from '../src/analyze/melody/index.js';
import { chordTimelineFromNotes, detectCadences } from '../src/analyze/timeline/index.js';
import { analyzeVoice } from '../src/analyze/voice/index.js';
import { createNoteEventIndex } from '../src/core/event-index/index.js';
import { BASS_4_STRING } from '../src/core/instrument/index.js';
import { playability } from '../src/core/instrument/playability.js';
import {
  beatToBarPosition,
  type MeterMap,
  meterAt,
  parseTimeSignature,
} from '../src/core/meter/index.js';
import { beatsToSeconds, type TempoMap } from '../src/core/tempo/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  humanize,
  ornament,
} from '../src/generate/index.js';
import { Key, keyIdentity } from '../src/model/key.js';
import { Score, type ScoreData } from '../src/model/score.js';
import { Timeline } from '../src/model/timeline.js';
import { scaleOf } from '../src/theory/scale/index.js';

/**
 * `Score` is a skin over the timed analysis functions, so most of what is
 * checked here is equivalence: the class answer must be the answer the
 * underlying function gives for the same notes and the same context. The rest
 * is the contract every model class holds — plain data out, plain data back in,
 * nothing shared with the caller, and no transformation that mutates.
 */

/** A four-bar tune with a clear tonic, enough to read harmony and form from. */
const TUNE: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 64, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 67, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 65, startBeat: 4, durationBeat: 1, velocity: 80 },
  { pitch: 69, startBeat: 5, durationBeat: 1, velocity: 75 },
  { pitch: 72, startBeat: 6, durationBeat: 2, velocity: 95 },
  { pitch: 67, startBeat: 8, durationBeat: 1, velocity: 80 },
  { pitch: 71, startBeat: 9, durationBeat: 1, velocity: 78 },
  { pitch: 74, startBeat: 10, durationBeat: 2, velocity: 88 },
  { pitch: 72, startBeat: 12, durationBeat: 4, velocity: 92 },
];

/** The same tune opening with a pickup, so beat 0 is not where it starts. */
const WITH_PICKUP: NoteEvent[] = [{ pitch: 55, startBeat: -1, durationBeat: 1 }, ...TUNE];

/** A meter map that changes signature partway, for the bar-reading checks. */
const METERS: MeterMap = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 8, ts: parseTimeSignature('3/4') },
];

/** A tempo map that changes tempo partway, for the seconds-reading checks. */
const TEMPO: TempoMap = [
  { startBeat: 0, bpm: 120 },
  { startBeat: 4, bpm: 60 },
];

/** The score the equivalence checks are made against. */
function tune(): Score {
  return Score.of(TUNE);
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

describe('Score as the class API documents it', () => {
  /**
   * The snippets the class carries as documentation once it is exported from
   * the package root. They live here until then, since the doc-example harness
   * runs every `@example` in `src` against the published entry point and
   * `Score` is not reachable from it yet.
   */
  it('answers the questions the class documentation asks of it', () => {
    const triad = Score.of([
      { pitch: 60, startBeat: 0, durationBeat: 2 },
      { pitch: 64, startBeat: 0, durationBeat: 2 },
      { pitch: 67, startBeat: 0, durationBeat: 2 },
    ]);
    expect(triad.totalBeats).toBe(2);

    const waltz = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 4 }], {
      meters: { numerator: 3, denominator: 4 },
      tempo: 90,
    });
    expect(waltz.meterAt(0).numerator).toBe(3);

    const ticked = Score.fromTicks([{ pitch: 60, startBeat: 480, durationBeat: 960 }], 480);
    expect(ticked.notes[0]?.durationBeat).toBe(2);

    const loose = Score.of([{ pitch: 60, startBeat: 0.98, durationBeat: 1.03 }]);
    expect(loose.quantize(0.5).notes[0]?.startBeat).toBe(1);
  });
});

describe('Score plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const score = tune();
    expect(score.data).not.toBe(score.data);
    expect(score.data).toEqual(score.data);
    expect(score.data.notes[0]).not.toBe(score.data.notes[0]);
    expect(score.notes).not.toBe(score.notes);
  });

  it('cannot be reached through the value it hands out', () => {
    const score = tune();
    const data = score.data;
    const first = data.notes[0] as NoteEvent;
    first.pitch = 0;
    data.meters[0] = { startBeat: 0, ts: parseTimeSignature('7/8') };
    expect(score.notes[0]?.pitch).toBe(60);
    expect(score.meterAt(0).numerator).toBe(4);
  });

  it('does not retain the array it was built from', () => {
    const notes: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    const score = Score.of(notes);
    notes.push({ pitch: 62, startBeat: 1, durationBeat: 1 });
    const only = notes[0] as NoteEvent;
    only.pitch = 61;
    expect(score.notes).toHaveLength(1);
    expect(score.notes[0]?.pitch).toBe(60);
  });

  it('reports toJSON as the value .data hands out', () => {
    const score = Score.of(TUNE, { meters: METERS, tempo: TEMPO, key: 'C major' });
    expect(score.toJSON()).toEqual(score.data);
    expect(JSON.parse(JSON.stringify(score))).toEqual(score.data);
  });

  it('round-trips through fromData and fromJSON', () => {
    const score = Score.of(WITH_PICKUP, { meters: METERS, tempo: TEMPO, key: 'A minor' });
    expect(Score.fromData(score.data).data).toEqual(score.data);
    expect(Score.fromJSON(JSON.parse(JSON.stringify(score)) as ScoreData).data).toEqual(score.data);
    expect(Score.fromData(score.data).equals(score)).toBe(true);
  });

  it('leaves the key out of a score that was given none', () => {
    expect('key' in Score.of(TUNE).data).toBe(false);
    expect(Score.of(TUNE, { key: 'C major' }).data.key).toEqual(Key.major('C').toJSON());
  });

  it('rebuilds no score carrying a number it cannot hold', () => {
    const sample = Score.of(WITH_PICKUP, { meters: METERS, tempo: TEMPO, key: 'C major' }).data;
    const paths = numericPaths(sample);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Score | undefined;
        try {
          rebuilt = Score.fromData(withNumberAt(sample, path, poison) as ScoreData);
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

  it('refuses a note the analysis could not read', () => {
    expect(() => Score.of([{ pitch: 900, startBeat: 0, durationBeat: 1 }])).toThrow(RangeError);
    expect(() => Score.of([], { tempo: [] })).toThrow(RangeError);
    expect(() => Score.of([], { tempo: 0 })).toThrow(RangeError);
  });
});

describe('Score equality', () => {
  it('compares through the public surface only', () => {
    const score = Score.of(TUNE, { meters: METERS, tempo: TEMPO, key: 'C major' });
    expect(score.equals(publicFacade(score))).toBe(true);
  });

  it('ignores the order the notes arrived in', () => {
    expect(Score.of(TUNE).equals(Score.of([...TUNE].reverse()))).toBe(true);
  });

  it('separates scores differing only in their context', () => {
    const score = Score.of(TUNE);
    expect(score.equals(score.withTempo(90))).toBe(false);
    expect(score.equals(score.withMeters(parseTimeSignature('3/4')))).toBe(false);
    expect(score.equals(score.withKey('C major'))).toBe(false);
    expect(score.equals(score.shift(1))).toBe(false);
    expect(score.withKey('C major').equals(score.withKey('C major'))).toBe(true);
  });
});

describe('Score context', () => {
  it('reads a bare time signature as a one-entry map at beat 0', () => {
    expect(Score.of(TUNE, { meters: parseTimeSignature('3/4') }).meters).toEqual([
      { startBeat: 0, ts: { numerator: 3, denominator: 4 } },
    ]);
    expect(Score.of(TUNE).meters).toEqual([{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }]);
  });

  it('reads a bare bpm as a one-entry tempo map at beat 0', () => {
    expect(Score.of(TUNE, { tempo: 90 }).tempo).toEqual([{ startBeat: 0, bpm: 90 }]);
    expect(Score.of(TUNE).tempo).toEqual([{ startBeat: 0, bpm: 120 }]);
    expect(Score.of(TUNE, { tempo: TEMPO }).tempo).toEqual(TEMPO);
  });

  it('ends where the last note stops sounding, pickup or not', () => {
    expect(Score.of(TUNE).totalBeats).toBe(16);
    expect(Score.of(WITH_PICKUP).totalBeats).toBe(16);
    expect(Score.empty().totalBeats).toBe(0);
    expect(Score.empty().notes).toEqual([]);
  });

  it('holds the notes in time order however they arrived', () => {
    const score = Score.of([...WITH_PICKUP].reverse());
    expect(score.notes.map((note) => note.startBeat)).toEqual(
      [...WITH_PICKUP].map((note) => note.startBeat).sort((a, b) => a - b),
    );
    expect(score.notes[0]?.startBeat).toBe(-1);
  });

  it('reads ticks and hands them back', () => {
    const score = Score.fromTicks(
      [
        { pitch: 55, startBeat: -480, durationBeat: 480 },
        { pitch: 60, startBeat: 480, durationBeat: 960 },
      ],
      480,
    );
    expect(score.notes.map((note) => note.startBeat)).toEqual([-1, 1]);
    expect(score.notes[1]?.durationBeat).toBe(2);
    expect(score.toTicks(480).map((note) => note.startBeat)).toEqual([-480, 480]);
  });
});

describe('Score time conversion', () => {
  const score = Score.of(TUNE, { meters: METERS, tempo: TEMPO });

  it('reads seconds through every tempo segment the span crosses', () => {
    for (const beat of [-1, 0, 2, 4, 8, 12]) {
      expect(score.secondsAt(beat), `beat ${beat}`).toBe(beatsToSeconds(beat, TEMPO));
    }
    // Four beats at 120 then four at 60: the second half takes twice as long.
    expect(score.secondsAt(4)).toBe(2);
    expect(score.secondsAt(8)).toBe(6);
    expect(score.secondsAt(-1)).toBe(-0.5);
  });

  it('reads bars through the signature in force at the beat', () => {
    for (const beat of [-1, 0, 4, 8, 11, 14]) {
      expect(score.barAt(beat), `beat ${beat}`).toEqual(beatToBarPosition(beat, METERS));
      expect(score.meterAt(beat), `beat ${beat}`).toEqual(meterAt(beat, METERS));
    }
    expect(score.barAt(-1)).toEqual({ bar: -1, beat: 3 });
    expect(score.barAt(8)).toEqual({ bar: 2, beat: 0 });
    // The 3/4 stretch is three beats a bar, so beat 11 opens the next bar.
    expect(score.barAt(11)).toEqual({ bar: 3, beat: 0 });
    expect(score.meterAt(11).numerator).toBe(3);
  });
});

describe('Score analysis', () => {
  const notes = tune().notes;

  it('reads the key regions the key timeline reads', () => {
    expect(tune().keys().length).toBeGreaterThan(0);
    expect(tune().keys()).toEqual(keyTimelineFromNotes(notes, { meters: tune().meters }));
    expect(tune().keys({ expectedKeyBeats: 8 })).toEqual(
      keyTimelineFromNotes(notes, { meters: tune().meters, expectedKeyBeats: 8 }),
    );
  });

  it('names the key held longest, not the one the score opens on', () => {
    const regions = keyTimelineFromNotes(notes, { meters: tune().meters });
    const prevailing = prevailingKeyOf(regions);
    expect(prevailing).not.toBeNull();
    expect(keyIdentity(tune().key() as Key)).toEqual(prevailing);
    // A score with nothing sounding has no key to name.
    expect(Score.empty().key()).toBeUndefined();
    // A carried key is the key, without a search.
    expect(Score.of(TUNE, { key: 'Eb major' }).key()?.toString()).toBe('Eb major');
  });

  it('reads the phrases the phrase reader reads', () => {
    const timeline = chordTimelineFromNotes(notes, { meters: tune().meters }).timeline;
    expect(tune().phrases().length).toBeGreaterThan(0);
    expect(tune().phrases()).toEqual(
      phrasesFromTimeline(timeline, notes, { meters: tune().meters }),
    );
    expect(tune().phrases({ minPhraseBeats: 8 })).toEqual(
      phrasesFromTimeline(timeline, notes, { meters: tune().meters, minPhraseBeats: 8 }),
    );
  });

  it('reads the sections the section reader reads', () => {
    expect(tune().sections().length).toBeGreaterThan(0);
    expect(tune().sections()).toEqual(sectionsFromNotes(notes, { meters: tune().meters }));
    expect(tune().sections({ unitBars: 2 })).toEqual(
      sectionsFromNotes(notes, { meters: tune().meters, unitBars: 2 }),
    );
  });

  it('reads the hypermeter the hypermeter reader reads, on the score own cadences', () => {
    const timeline = chordTimelineFromNotes(notes, { meters: tune().meters }).timeline;
    const regions = keyTimelineFromNotes(notes, { meters: tune().meters });
    const keyAt = keyLookup(regions, prevailingKeyOf(regions) ?? keyIdentity(Key.major('C')));
    const cadenceBeats = detectCadences(timeline, (beat) => scaleOf(keyAt(beat))).map(
      (hit) => hit.atBeat,
    );
    expect(cadenceBeats.length).toBeGreaterThan(0);
    expect(tune().hypermeter()).toEqual(hypermeter(notes, tune().meters, { cadenceBeats }));
    expect(tune().hypermeter({ cadenceBeats: [8] })).toEqual(
      hypermeter(notes, tune().meters, { cadenceBeats: [8] }),
    );
  });

  it('reads its phrases on the grouping it reports as its hypermeter', () => {
    // The phrase reader builds its own grouping from the score's cadences. Handing
    // it the grouping the score reports must therefore change nothing: one score
    // holds one reading of where its hyperbars are.
    const score = tune();
    expect(score.phrases({ hypermeter: score.hypermeter() })).toEqual(score.phrases());
  });

  it('reads the motifs and the contour the melody reader reads', () => {
    // A cell stated twice, so the comparison is against a found motif rather
    // than against two empty answers.
    const cell = [60, 62, 64];
    const repeated: NoteEvent[] = [0, 4].flatMap((bar) =>
      cell.map((pitch, step) => ({ pitch, startBeat: bar + step, durationBeat: 1 })),
    );
    const score = Score.of(repeated);
    expect(score.motifs().length).toBeGreaterThan(0);
    expect(score.motifs()).toEqual(extractMotifs(score.notes));
    expect(score.motifs({ minNotes: 2 })).toEqual(extractMotifs(score.notes, { minNotes: 2 }));
    expect(tune().contour()).toEqual(melodicContour(notes));
    expect(tune().contour().shape.length).toBeGreaterThan(0);
  });

  it('reads each note against the harmony and the key under it', () => {
    const score = tune();
    const timeline = chordTimelineFromNotes(notes, { meters: score.meters }).timeline;
    const regions = keyTimelineFromNotes(notes, { meters: score.meters });
    const prevailing = prevailingKeyOf(regions);
    expect(prevailing).not.toBeNull();
    expect(score.voices()).toHaveLength(notes.length);
    // This tune is a single line, so the polyphonic reading the score makes and
    // the single-voice reader's answer are the same answer — down to the shape,
    // since the score answers about its own array and says nothing about having
    // taken it apart to read it.
    expect(score.voices()).toEqual(
      analyzeVoice(notes, timeline.at, (beat) =>
        scaleOf(keyLookup(regions, prevailing ?? keyIdentity(Key.major('C')))(beat)),
      ),
    );
    // A key given at the call reaches the analysis as one key for every beat.
    expect(score.voices('C major')).toEqual(analyzeVoice(notes, timeline.at, Key.major('C').scale));
    expect(score.withKey('C major').voices()).toEqual(score.voices('C major'));
  });

  it('reads a score with no harmony to read without failing', () => {
    const empty = Score.empty();
    expect(empty.voices()).toEqual([]);
    expect(empty.keys()).toEqual([]);
    expect(empty.sections()).toEqual([]);
    // One note names no chord, so every note is read against C major.
    const single = Score.of([{ pitch: 61, startBeat: 0, durationBeat: 1 }]);
    expect(single.voices()).toHaveLength(1);
  });

  it('builds a timeline over its own notes', () => {
    expect(tune().timeline()).toBeInstanceOf(Timeline);
    expect(tune().timeline({ segmentation: 'grid', harmonicRhythm: 4 })).toBeInstanceOf(Timeline);
  });

  it('indexes and judges the notes as the core functions do', () => {
    const score = tune();
    const index = score.index();
    expect(index.notes.map((entry) => entry.note)).toEqual(
      createNoteEventIndex(notes, {
        allowNonPositiveDuration: true,
        name: 'score notes',
      }).notes.map((entry) => entry.note),
    );
    expect(index.at(2)?.note.pitch).toBe(67);
    expect(score.playability(BASS_4_STRING)).toEqual(playability(notes, BASS_4_STRING, 120));
    expect(score.withTempo(200).playability(BASS_4_STRING)).toEqual(
      playability(notes, BASS_4_STRING, 200),
    );
  });
});

describe('Score note transformation', () => {
  it('keeps the notes whose onsets fall in the slice', () => {
    const score = Score.of(WITH_PICKUP);
    expect(score.slice(0, 8).notes.map((note) => note.startBeat)).toEqual([0, 1, 2, 4, 5, 6]);
    // The pickup is before beat 0 and is only kept by a slice that reaches it.
    expect(score.slice(-2, 2).notes.map((note) => note.startBeat)).toEqual([-1, 0, 1]);
    expect(score.slice(0, 0).notes).toEqual([]);
    expect(score.slice(0, 8).totalBeats).toBe(8);
  });

  it('filters and maps the notes, keeping the context', () => {
    const score = Score.of(TUNE, { meters: METERS, tempo: TEMPO, key: 'C major' });
    const high = score.filter((note) => note.pitch >= 67);
    expect(high.notes.every((note) => note.pitch >= 67)).toBe(true);
    expect(high.meters).toEqual(score.meters);
    expect(high.tempo).toEqual(score.tempo);
    expect(high.data.key).toEqual(score.data.key);
    const louder = score.map((note) => ({ ...note, velocity: 100 }));
    expect(louder.notes.every((note) => note.velocity === 100)).toBe(true);
    expect(louder.notes.map((note) => note.startBeat)).toEqual(
      score.notes.map((note) => note.startBeat),
    );
  });

  it('concatenates another score or a plain array', () => {
    const first = Score.of([{ pitch: 60, startBeat: 0, durationBeat: 1 }]);
    const second = Score.of([{ pitch: 62, startBeat: 1, durationBeat: 1 }]);
    expect(first.concat(second).notes.map((note) => note.pitch)).toEqual([60, 62]);
    expect(first.concat(second.notes).notes.map((note) => note.pitch)).toEqual([60, 62]);
    // The notes come back in time order, not in the order they were joined.
    expect(second.concat(first).notes.map((note) => note.pitch)).toEqual([60, 62]);
  });

  it('shifts a pickup without folding it onto the downbeat', () => {
    const score = Score.of(WITH_PICKUP);
    expect(score.shift(4).notes[0]?.startBeat).toBe(3);
    expect(score.shift(-4).notes[0]?.startBeat).toBe(-5);
    expect(score.shift(1).notes[0]?.startBeat).toBe(0);
    // The meter and the tempo stay put: the music moves over them.
    const context = Score.of(WITH_PICKUP, { meters: METERS, tempo: TEMPO });
    expect(context.shift(4).meters).toEqual(METERS);
    expect(context.shift(4).tempo).toEqual(TEMPO);
  });

  it('transposes by semitones and by a spelled interval', () => {
    const score = Score.of(WITH_PICKUP);
    expect(score.transpose(2).notes.map((note) => note.pitch)).toEqual(
      score.notes.map((note) => note.pitch + 2),
    );
    expect(score.transposeBy('P5').notes[0]?.pitch).toBe(62);
    expect(score.transposeBy('-m3').notes[0]?.pitch).toBe(52);
    expect(score.transposeBy('A4').notes[0]?.pitch).toBe(score.transpose(6).notes[0]?.pitch);
    expect(() => score.transpose(80)).toThrow(RangeError);
  });

  it('quantizes toward the grid in both directions from beat 0', () => {
    const score = Score.of([
      { pitch: 55, startBeat: -1.04, durationBeat: 0.98 },
      { pitch: 60, startBeat: 0.06, durationBeat: 1.02 },
      { pitch: 64, startBeat: 1.48, durationBeat: 0.51 },
    ]);
    const quantized = score.quantize(0.5);
    expect(quantized.notes.map((note) => note.startBeat)).toEqual([-1, 0, 1.5]);
    expect(quantized.notes.map((note) => note.durationBeat)).toEqual([1, 1, 0.5]);
    // No onset comes back as a negative zero, which JSON cannot carry.
    expect(
      Object.is(
        Score.of([{ pitch: 60, startBeat: -0.1, durationBeat: 1 }]).quantize(1).notes[0]?.startBeat,
        0,
      ),
    ).toBe(true);
    expect(() => score.quantize(0)).toThrow(RangeError);
  });

  it('leaves the original untouched and returns a new instance', () => {
    const score = Score.of(WITH_PICKUP, { meters: METERS, tempo: TEMPO, key: 'C major' });
    const before = score.data;
    const derived = [
      score.slice(0, 4),
      score.filter(() => true),
      score.map((note) => note),
      score.concat([{ pitch: 48, startBeat: 0, durationBeat: 1 }]),
      score.shift(2),
      score.transpose(1),
      score.transposeBy('m2'),
      score.quantize(0.5),
      score.humanize({ ctx: { seed: 3 } }),
      score.ornament({ ctx: { seed: 3 } }),
      score.withMeters(parseTimeSignature('3/4')),
      score.withTempo(90),
      score.withKey('G major'),
    ];
    for (const [index, other] of derived.entries()) {
      expect(other, `derived[${index}]`).toBeInstanceOf(Score);
      expect(other, `derived[${index}]`).not.toBe(score);
    }
    expect(score.data).toEqual(before);
  });
});

describe('Score performance shaping', () => {
  it('humanizes as the groove module does, reading the opening signature', () => {
    const score = Score.of(TUNE, { meters: METERS });
    expect(score.humanize({ ctx: { seed: 7 } }).notes).toEqual(
      humanize(score.notes, { ts: parseTimeSignature('4/4'), ctx: { seed: 7 } }),
    );
    expect(score.humanize({ ctx: { seed: 7 }, ts: parseTimeSignature('3/4') }).notes).toEqual(
      humanize(score.notes, { ts: parseTimeSignature('3/4'), ctx: { seed: 7 } }),
    );
  });

  it('ornaments as the ornament module does', () => {
    const score = Score.of(TUNE);
    expect(score.ornament({ style: 'accent', ctx: { seed: 2 } }).notes).toEqual(
      ornament(score.notes, { ts: parseTimeSignature('4/4'), style: 'accent', ctx: { seed: 2 } }),
    );
  });

  it('applies a groove template against its own opening signature', () => {
    const ts = parseTimeSignature('4/4');
    const groovy: NoteEvent[] = [
      { pitch: 36, startBeat: 0.02, durationBeat: 1, velocity: 100 },
      { pitch: 38, startBeat: 1.06, durationBeat: 1, velocity: 70 },
    ];
    const template = extractGrooveTemplate(groovy, ts, 4);
    const score = Score.of([
      { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
      { pitch: 38, startBeat: 1, durationBeat: 1, velocity: 80 },
    ]);
    expect(score.groove(template).notes).toEqual(
      applyGrooveTemplate(score.notes, template, ts).sort(
        (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch,
      ),
    );
    // A template extracted under another meter is refused, not drifted.
    const other = extractGrooveTemplate(groovy, parseTimeSignature('3/4'), 4);
    expect(() => score.groove(other)).toThrow(RangeError);
  });
});
