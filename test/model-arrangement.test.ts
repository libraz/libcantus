import { describe, expect, it } from 'vitest';
import type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
} from '../src/analyze/arrange/index.js';
import {
  analyzeArrangement,
  createArrangementSession,
  tensionCurveFrom,
} from '../src/analyze/arrange/index.js';
import { type MeterMap, parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Arrangement, type ArrangementData } from '../src/model/arrangement.js';
import { Key } from '../src/model/key.js';
import { Score } from '../src/model/score.js';
import { NoteSafety } from '../src/theory/safety/index.js';
import { resolveKey } from '../src/theory/scale/index.js';

/**
 * `Arrangement` is a skin over the arrangement-analysis functions and the
 * session that holds one open across edits, so most of what is checked here is
 * equivalence: the class answer must be the answer the underlying function
 * gives for the same tracks and the same settings, and an updated arrangement
 * must answer exactly as one built from the edited tracks outright. The rest is
 * the contract every model class holds — plain data out, plain data back in,
 * nothing shared with the caller, and no method that mutates.
 */

/** A melody over two bars, with a chromatic note that clashes with the harmony. */
const MELODY: NoteEvent[] = [
  { pitch: 72, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 74, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 73, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 76, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 79, startBeat: 6, durationBeat: 2, velocity: 92 },
];

/** A bass line spelling out the harmony under the melody. */
const BASS: NoteEvent[] = [
  { pitch: 48, startBeat: 0, durationBeat: 4 },
  { pitch: 43, startBeat: 4, durationBeat: 4 },
];

/** A drum part, whose pitches name instruments rather than harmony. */
const DRUMS: NoteEvent[] = [
  { pitch: 36, startBeat: 0, durationBeat: 0.5 },
  { pitch: 38, startBeat: 2, durationBeat: 0.5 },
  { pitch: 36, startBeat: 4, durationBeat: 0.5 },
  { pitch: 38, startBeat: 6, durationBeat: 0.5 },
];

/** The melody after an edit that moves the clashing note onto a chord tone. */
const EDITED_MELODY: NoteEvent[] = [
  { pitch: 72, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 74, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 76, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 76, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 79, startBeat: 6, durationBeat: 2, velocity: 92 },
];

/** The tracks every check reads, the last of them deliberately unnamed. */
const TRACKS: readonly ArrangementTrack[] = [
  { name: 'melody', role: 'melody', notes: MELODY },
  { name: 'bass', role: 'bass', notes: BASS },
  { role: 'drums', notes: DRUMS },
];

/** A meter map that changes signature partway, so the meter is carried, not assumed. */
const METERS: MeterMap = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 4, ts: parseTimeSignature('3/4') },
];

/**
 * Settings filling every option the class stores, so the round trip and the
 * poison checks reach each of them. Written as the plain options the analysis
 * takes, so the same value drives the class and the function it is compared
 * against.
 */
const OPTIONS: ArrangementOptions = {
  key: Key.major('C').scale,
  meters: METERS,
  harmonyTracks: [0, 1],
  minSeverity: NoteSafety.Warning,
  harmonicRhythm: 2,
  profile: 'pop',
  budget: 500_000,
};

/** The tracks as a fresh mutable array, which the analysis functions take. */
function tracks(edited?: readonly NoteEvent[]): ArrangementTrack[] {
  return TRACKS.map((track, index) =>
    edited !== undefined && index === 0 ? { ...track, notes: edited } : { ...track },
  );
}

/**
 * The analysis as plain data.
 *
 * The chord timeline carries a lookup function, which is not data and not
 * comparable; its segments are, and they are what the lookup reads.
 */
function plain(analysis: ArrangementAnalysis) {
  const { timeline, ...rest } = analysis;
  return { ...rest, segments: timeline.segments };
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

describe('Arrangement as the class API documents it', () => {
  /**
   * The snippets the class carries as documentation once it is exported from
   * the package root. They live here as well until then, since what the doc
   * harness runs is the example as written and the class is not reachable from
   * the published entry point yet.
   */
  it('answers the questions the class documentation asks of it', () => {
    const pair = Arrangement.of([
      { name: 'melody', role: 'melody', notes: [{ pitch: 72, startBeat: 0, durationBeat: 4 }] },
      { name: 'bass', role: 'bass', notes: [{ pitch: 48, startBeat: 0, durationBeat: 4 }] },
    ]);
    expect(pair.track('melody')?.totalBeats).toBe(4);

    const keyed = Arrangement.of(
      [{ name: 'lead', notes: [{ pitch: 60, startBeat: 0, durationBeat: 4 }] }],
      { key: 'C major' },
    );
    expect(keyed.tracks.length).toBe(1);

    const moved = keyed.update([
      { trackIndex: 0, notes: [{ pitch: 62, startBeat: 0, durationBeat: 4 }] },
    ]);
    expect(moved.tracks[0]?.notes[0]?.pitch).toBe(62);
    expect(keyed.tracks[0]?.notes[0]?.pitch).toBe(60);
  });
});

describe('Arrangement plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.data).not.toBe(arrangement.data);
    expect(arrangement.data).toEqual(arrangement.data);
    expect(arrangement.data.tracks[0]).not.toBe(arrangement.data.tracks[0]);
    expect(arrangement.tracks).not.toBe(arrangement.tracks);
  });

  it('cannot be reached through the value it hands out', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const data = arrangement.data;
    (data.tracks[0]?.notes[0] as NoteEvent).pitch = 0;
    data.tracks.push({ notes: [] });
    (data.settings as { harmonyTracks?: number[] }).harmonyTracks = [2];
    expect(arrangement.tracks).toHaveLength(3);
    expect(arrangement.tracks[0]?.notes[0]?.pitch).toBe(72);
    expect(arrangement.data.settings?.harmonyTracks).toEqual([0, 1]);
  });

  it('does not retain the arrays it was built from', () => {
    const notes: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    const given: ArrangementTrack[] = [{ name: 'lead', notes }];
    const arrangement = Arrangement.of(given, { harmonyTracks: [0] });
    given.push({ name: 'added', notes: [] });
    notes.push({ pitch: 62, startBeat: 1, durationBeat: 1 });
    (notes[0] as NoteEvent).pitch = 61;
    expect(arrangement.tracks).toHaveLength(1);
    expect(arrangement.tracks[0]?.notes).toHaveLength(1);
    expect(arrangement.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it('reports toJSON as the value .data hands out', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.toJSON()).toEqual(arrangement.data);
    expect(JSON.parse(JSON.stringify(arrangement))).toEqual(arrangement.data);
  });

  it('round-trips through fromData and fromJSON', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(Arrangement.fromData(arrangement.data).data).toEqual(arrangement.data);
    expect(
      Arrangement.fromJSON(JSON.parse(JSON.stringify(arrangement)) as ArrangementData).data,
    ).toEqual(arrangement.data);
    expect(Arrangement.fromData(arrangement.data).equals(arrangement)).toBe(true);
  });

  it('re-derives the analysis from the data it carries', () => {
    // The plain data holds the tracks and the settings; the reading is made
    // again from them, so a rebuilt arrangement answers as the original does.
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const rebuilt = Arrangement.fromData(JSON.parse(JSON.stringify(arrangement)));
    expect(plain(rebuilt.analysis)).toEqual(plain(arrangement.analysis));
    expect(rebuilt.tension({ step: 1 })).toEqual(arrangement.tension({ step: 1 }));
  });

  it('leaves the settings out of an arrangement given none', () => {
    expect('settings' in Arrangement.of(TRACKS).data).toBe(false);
    expect('settings' in Arrangement.of(TRACKS, {}).data).toBe(false);
    // The key is held whole, tonic and form included: an arrangement told its
    // key in Ab minor is not one in G# minor, and the stored settings are what
    // it is read back under.
    expect(Arrangement.of(TRACKS, { key: 'C major' }).data.settings?.key).toEqual(
      resolveKey('C major'),
    );
  });

  it('holds a supplied harmony as the segments a file can carry', () => {
    const inferred = Arrangement.of(TRACKS).timeline();
    const supplied = Arrangement.of(TRACKS, {
      timeline: inferred.chordTimeline,
      keys: [...inferred.keys],
    });
    expect(supplied.data.settings?.timeline).toEqual(inferred.segments);
    expect(JSON.parse(JSON.stringify(supplied))).toEqual(supplied.data);
    expect(plain(supplied.analysis)).toEqual(
      plain(
        analyzeArrangement(tracks(), {
          timeline: inferred.chordTimeline,
          keys: [...inferred.keys],
        }),
      ),
    );
  });

  it('rebuilds no arrangement carrying a number it cannot hold', () => {
    const sample = Arrangement.of(TRACKS, {
      ...OPTIONS,
      pickupBeats: 0,
      keys: Arrangement.of(TRACKS)
        .timeline()
        .keys.map((region) => ({ ...region })),
    }).data;
    const paths = numericPaths(sample);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const label = `${path.join('.')} = ${poison}`;
        let rebuilt: Arrangement | undefined;
        try {
          rebuilt = Arrangement.fromData(withNumberAt(sample, path, poison) as ArrangementData);
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

  it('refuses what the analysis could not read', () => {
    expect(() =>
      Arrangement.of([{ notes: [{ pitch: 900, startBeat: 0, durationBeat: 1 }] }]),
    ).toThrow(RangeError);
    expect(() => Arrangement.of(TRACKS, { harmonyTracks: [3] })).toThrow(RangeError);
    expect(() => Arrangement.of(TRACKS, { harmonicRhythm: 0 })).toThrow(RangeError);
    expect(() => Arrangement.of(TRACKS, { ts: parseTimeSignature('3/4'), meters: METERS })).toThrow(
      RangeError,
    );
    expect(() => Arrangement.of(TRACKS, { profile: 'nonsense' as 'pop' }).analysis).toThrow(
      RangeError,
    );
  });
});

describe('Arrangement equality', () => {
  it('compares through the public surface only', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.equals(publicFacade(arrangement))).toBe(true);
  });

  it('separates arrangements differing in their tracks or their settings', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.equals(Arrangement.of(TRACKS, OPTIONS))).toBe(true);
    expect(arrangement.equals(Arrangement.of(TRACKS))).toBe(false);
    expect(
      arrangement.equals(Arrangement.of(TRACKS, { ...OPTIONS, minSeverity: NoteSafety.Dissonant })),
    ).toBe(false);
    expect(arrangement.equals(arrangement.update([{ trackIndex: 0, notes: EDITED_MELODY }]))).toBe(
      false,
    );
  });

  it('reads a key given by name as the key it names', () => {
    expect(
      Arrangement.of(TRACKS, { key: 'C major' }).equals(
        Arrangement.of(TRACKS, { key: Key.major('C').scale }),
      ),
    ).toBe(true);
  });
});

describe('Arrangement answers as the functions do', () => {
  it('reports the analysis analyzeArrangement reports', () => {
    expect(plain(Arrangement.of(TRACKS).analysis)).toEqual(plain(analyzeArrangement(tracks())));
    expect(plain(Arrangement.of(TRACKS, OPTIONS).analysis)).toEqual(
      plain(analyzeArrangement(tracks(), OPTIONS)),
    );
  });

  it('reports the conflicts the analysis found', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.conflicts).toEqual(analyzeArrangement(tracks(), OPTIONS).conflicts);
    expect(arrangement.conflicts.length).toBeGreaterThan(0);
    expect(arrangement.conflicts).not.toBe(arrangement.conflicts);
  });

  it('hands back the harmony as a timeline over the analysis segments', () => {
    const analysis = analyzeArrangement(tracks(), OPTIONS);
    const timeline = Arrangement.of(TRACKS, OPTIONS).timeline();
    expect(timeline.segments).toEqual(analysis.timeline.segments);
    expect(timeline.keys).toEqual(analysis.keys);
    // Through `toJSON`, since a chord read off a timeline carries the key in
    // force and spells itself against it, which the plain segment does not.
    expect(timeline.at(0)?.toJSON()).toEqual(analysis.timeline.at(0));
    expect(timeline.totalBeats).toBe(
      analysis.timeline.segments.reduce((end, segment) => Math.max(end, segment.endBeat), 0),
    );
  });

  it('hands back one track as a score of its own notes', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(
      arrangement.track('melody')?.equals(Score.of(MELODY, { meters: METERS, key: 'C major' })),
    ).toBe(true);
    expect(arrangement.track('bass')?.notes).toEqual(Score.of(BASS).notes);
    // A track given no name is found under the name the analysis reports.
    expect(arrangement.track('track 3')?.notes).toEqual(Score.of(DRUMS).notes);
    expect(arrangement.track('percussion')).toBeUndefined();
  });

  it('reads a track score against the arrangement context alone', () => {
    const bare = Arrangement.of(TRACKS);
    expect(bare.track('melody')?.equals(Score.of(MELODY))).toBe(true);
  });

  it('samples the tension the curve function samples', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const analysis = analyzeArrangement(tracks(), OPTIONS);
    expect(arrangement.tension({ step: 1 })).toEqual(
      tensionCurveFrom(tracks(), analysis, { ...OPTIONS, step: 1 }),
    );
    expect(arrangement.tension()).toEqual(tensionCurveFrom(tracks(), analysis, OPTIONS));
    expect(arrangement.tension({ step: 2 }).length).toBeLessThan(
      arrangement.tension({ step: 1 }).length,
    );
  });

  it('lays a meter given to tension over the arrangement own', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const ts = parseTimeSignature('3/4');
    const analysis = analyzeArrangement(tracks(), OPTIONS);
    const { meters, ...withoutMeter } = OPTIONS;
    expect(arrangement.tension({ ts, step: 1 })).toEqual(
      tensionCurveFrom(tracks(), analysis, { ...withoutMeter, ts, step: 1 }),
    );
  });
});

describe('Arrangement updates', () => {
  it('answers as an arrangement built from the edited tracks outright', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const updated = arrangement.update([{ trackIndex: 0, notes: EDITED_MELODY }]);
    const fresh = Arrangement.of(tracks(EDITED_MELODY), OPTIONS);
    expect(plain(updated.analysis)).toEqual(plain(fresh.analysis));
    // And as the function does, which is what the incremental path is trusted
    // against: a carried-over segment that a fresh pass would have moved shows
    // up here and nowhere else.
    expect(plain(updated.analysis)).toEqual(
      plain(analyzeArrangement(tracks(EDITED_MELODY), OPTIONS)),
    );
    expect(updated.data).toEqual(fresh.data);
    expect(updated.equals(fresh)).toBe(true);
  });

  it('agrees with a fresh analysis after every edit of a run', () => {
    let arrangement = Arrangement.of(TRACKS, OPTIONS);
    let notes = MELODY;
    for (const pitch of [77, 71, 69]) {
      notes = [...notes.slice(0, 4), { ...(notes[4] as NoteEvent), pitch }];
      arrangement = arrangement.update([{ trackIndex: 0, notes }]);
      expect(plain(arrangement.analysis), `pitch ${pitch}`).toEqual(
        plain(analyzeArrangement(tracks(notes), OPTIONS)),
      );
    }
  });

  it('agrees with the session it holds open', () => {
    const session = createArrangementSession(tracks(), OPTIONS).update([
      { trackIndex: 0, notes: EDITED_MELODY },
    ]);
    const updated = Arrangement.of(TRACKS, OPTIONS).update([
      { trackIndex: 0, notes: EDITED_MELODY },
    ]);
    expect(plain(updated.analysis)).toEqual(plain(session.analysis));
  });

  it('leaves the arrangement it was asked of unchanged', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const before = arrangement.data;
    const analysisBefore = plain(arrangement.analysis);
    const updated = arrangement.update([{ trackIndex: 0, notes: EDITED_MELODY }]);
    expect(arrangement.data).toEqual(before);
    expect(plain(arrangement.analysis)).toEqual(analysisBefore);
    expect(plain(arrangement.analysis)).toEqual(plain(analyzeArrangement(tracks(), OPTIONS)));
    expect(updated).not.toBe(arrangement);
    expect(updated.tracks[0]?.notes).toEqual(EDITED_MELODY);
    expect(arrangement.tracks[0]?.notes).toEqual(MELODY);
  });

  it('carries the settings into the arrangement it returns', () => {
    const updated = Arrangement.of(TRACKS, OPTIONS).update([
      { trackIndex: 0, notes: EDITED_MELODY },
    ]);
    expect(updated.data.settings).toEqual(Arrangement.of(TRACKS, OPTIONS).data.settings);
  });

  it('does not retain the notes an edit was given', () => {
    const notes: NoteEvent[] = EDITED_MELODY.map((note) => ({ ...note }));
    const updated = Arrangement.of(TRACKS, OPTIONS).update([{ trackIndex: 0, notes }]);
    (notes[0] as NoteEvent).pitch = 0;
    notes.push({ pitch: 90, startBeat: 8, durationBeat: 1 });
    expect(updated.tracks[0]?.notes).toEqual(EDITED_MELODY);
    expect(plain(updated.analysis)).toEqual(
      plain(analyzeArrangement(tracks(EDITED_MELODY), OPTIONS)),
    );
  });

  it('refuses an edit that names no track of the arrangement', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(() => arrangement.update([{ trackIndex: 7, notes: [] }])).toThrow(RangeError);
    expect(() =>
      arrangement.update([
        { trackIndex: 0, notes: [{ pitch: 900, startBeat: 0, durationBeat: 1 }] },
      ]),
    ).toThrow(RangeError);
  });

  it('takes an edit that changes nothing and an edit that only reorders', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const same = arrangement.update([{ trackIndex: 0, notes: MELODY }]);
    expect(plain(same.analysis)).toEqual(plain(arrangement.analysis));
    const reordered = [...MELODY].reverse();
    const shuffled = arrangement.update([{ trackIndex: 0, notes: reordered }]);
    expect(plain(shuffled.analysis)).toEqual(plain(analyzeArrangement(tracks(reordered), OPTIONS)));
  });
});
