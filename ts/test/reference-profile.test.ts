/**
 * analyzeReference, table-driven over a pairwise (coverwise, seed 1, 16 rows,
 * coverage 1.0) model of its input combinations:
 *
 *   texture    ∈ {melodyOnly, polyphonic, polyphonicWithMelodyOption}
 *   key        ∈ {stated, inferred}
 *   meter      ∈ {4/4, 3/4, 6/8, changing}
 *   pickup     ∈ {false, true}
 *   modulation ∈ {false, true}
 *   entry      ∈ {analyzeReference, Score.reference, Arrangement.reference}
 *
 *   IF entry = Arrangement.reference THEN texture != melodyOnly
 *   IF key = stated THEN modulation = false
 *
 *   #  texture                     key       meter     pickup modulation entry
 *   1  polyphonic                  stated    6/8       true   false      analyzeReference
 *   2  polyphonicWithMelodyOption  inferred  changing  true   true       Arrangement.reference
 *   3  melodyOnly                  inferred  3/4       false  true       Score.reference
 *   4  polyphonicWithMelodyOption  stated    3/4       true   false      Score.reference
 *   5  polyphonic                  inferred  4/4       false  false      Arrangement.reference
 *   6  polyphonicWithMelodyOption  stated    changing  false  false      analyzeReference
 *   7  melodyOnly                  inferred  4/4       true   true       analyzeReference
 *   8  polyphonic                  inferred  6/8       true   true       Score.reference
 *   9  melodyOnly                  stated    4/4       true   false      Score.reference
 *  10  polyphonic                  stated    3/4       true   false      Arrangement.reference
 *  11  polyphonic                  stated    3/4       true   false      analyzeReference
 *  12  melodyOnly                  inferred  changing  false  true       Score.reference
 *  13  polyphonicWithMelodyOption  inferred  4/4       true   true       analyzeReference
 *  14  polyphonicWithMelodyOption  inferred  6/8       true   false      Arrangement.reference
 *  15  polyphonic                  inferred  changing  true   true       Score.reference
 *  16  melodyOnly                  stated    6/8       false  false      analyzeReference
 *
 * Every row is checked for (a) the validator accepting the profile, (b) the
 * profile surviving a JSON round trip unchanged, (c) the class entry agreeing
 * with the function it wraps, and (d) the phrases tiling
 * [span.startBeat, span.endBeat] with no gap; (c) applies only to a class
 * entry, an analyzeReference row being the function itself. Rows are listed
 * by id; a row runs through the runner its `entry` names.
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeReference,
  type ReferenceProfileOptions,
  readingsFor,
  referenceFromReadings,
} from '../src/analyze/reference/profile.js';
import type { ReferenceProfile } from '../src/analyze/reference/types.js';
import { REFERENCE_PROFILE_VERSION } from '../src/analyze/reference/types.js';
import { assertReferenceProfile } from '../src/analyze/reference/validate.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { MeterLike } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Arrangement, Score } from '../src/model/index.js';
import type { KeyLike } from '../src/theory/scale/index.js';
import { SOURCE_SONG, UNRELATED_SONG } from './support/reference-fixtures.js';

/** `notes` led into by one note of `beats` beats, sounding before beat 0. */
function withPickup(notes: readonly NoteEvent[], beats: number): NoteEvent[] {
  return [{ pitch: 71, startBeat: -beats, durationBeat: beats }, ...notes];
}

/** The second half of the source song (from beat 64) moved up a fifth into G major. */
function modulated(notes: readonly NoteEvent[]): NoteEvent[] {
  return notes.map((note) => (note.startBeat >= 64 ? { ...note, pitch: note.pitch + 7 } : note));
}

/**
 * A score's own canonical note order: by onset, then pitch, then length.
 *
 * `Score` keeps its notes sorted this way, so a check (c) row feeds
 * `analyzeReference` the notes in the same order `Score.reference` reads them
 * in — otherwise a chord voicing carrying two notes of the same pitch and
 * onset but different lengths could pick a different one as the top voice, or
 * a confidence built by summing over the notes could round a last decimal
 * place differently, on nothing more than which order the array arrived in.
 */
function scoreOrder(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(
    (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch || a.durationBeat - b.durationBeat,
  );
}

/** 4/4 for the first sixteen bars, 3/4 from there on. */
const CHANGING_METER: MeterLike = [
  { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
  { startBeat: 64, ts: { numerator: 3, denominator: 4 } },
];

type Texture = 'melodyOnly' | 'polyphonic' | 'polyphonicWithMelodyOption';
type Entry = 'analyzeReference' | 'Score.reference' | 'Arrangement.reference';

type Row = {
  id: number;
  texture: Texture;
  key: 'stated' | 'inferred';
  meter: '4/4' | '3/4' | '6/8' | 'changing';
  pickup: boolean;
  modulation: boolean;
  entry: Entry;
  /**
   * The harmony notes, and the options `analyzeReference` needs to reproduce
   * the entry's answer — the check (c) below runs for a class entry.
   */
  notes: readonly NoteEvent[];
  opts: ReferenceProfileOptions;
  /**
   * Builds the profile through {@link Score.reference} or {@link
   * Arrangement.reference}; set only when `entry` names one of them.
   */
  classProfile?: () => ReferenceProfile;
  /** The first beat the span must open on: the pickup's onset, or 0. */
  startBeat: number;
  /** The beat the span must close on: the end of the last note. */
  endBeat: number;
};

/** How each entry turns a row's input into a profile. */
const RUN: Record<Entry, (row: Row) => ReferenceProfile> = {
  analyzeReference: (row) => analyzeReference(row.notes, row.opts),
  'Score.reference': (row) => (row.classProfile as () => ReferenceProfile)(),
  'Arrangement.reference': (row) => (row.classProfile as () => ReferenceProfile)(),
};

const C_MAJOR: KeyLike = 'C major';

/**
 * The 3/4 unrelated song's bars are three quarter-beats long, which is also
 * the length of a 6/8 bar, so the same notes stand as a 6/8 tune.
 */
const ROWS: Row[] = [
  {
    id: 1,
    texture: 'polyphonic',
    key: 'stated',
    meter: '6/8',
    pickup: true,
    modulation: false,
    entry: 'analyzeReference',
    notes: withPickup(UNRELATED_SONG.notes, 1.5),
    opts: { meters: '6/8', key: C_MAJOR },
    startBeat: -1.5,
    endBeat: 24,
  },
  {
    id: 2,
    texture: 'polyphonicWithMelodyOption',
    key: 'inferred',
    meter: 'changing',
    pickup: true,
    modulation: true,
    entry: 'Arrangement.reference',
    // The melody-role track is not percussion, so it pools into the harmony
    // reading too, alongside the harmony track.
    notes: [
      ...withPickup(modulated(SOURCE_SONG.notes), 1),
      ...withPickup(modulated(SOURCE_SONG.melody), 1),
    ],
    opts: { meters: CHANGING_METER, melody: withPickup(modulated(SOURCE_SONG.melody), 1) },
    classProfile: () =>
      Arrangement.of(
        [
          { name: 'harmony', notes: withPickup(modulated(SOURCE_SONG.notes), 1) },
          { name: 'lead', role: 'melody', notes: withPickup(modulated(SOURCE_SONG.melody), 1) },
        ],
        { meters: CHANGING_METER },
      ).reference(),
    startBeat: -1,
    endBeat: 128,
  },
  {
    id: 3,
    texture: 'melodyOnly',
    key: 'inferred',
    meter: '3/4',
    pickup: false,
    modulation: true,
    entry: 'Score.reference',
    notes: scoreOrder(modulated(SOURCE_SONG.melody)),
    opts: { meters: '3/4' },
    classProfile: () =>
      Score.of(scoreOrder(modulated(SOURCE_SONG.melody)), { meters: '3/4' }).reference(),
    startBeat: 0,
    endBeat: 128,
  },
  {
    id: 4,
    texture: 'polyphonicWithMelodyOption',
    key: 'stated',
    meter: '3/4',
    pickup: true,
    modulation: false,
    entry: 'Score.reference',
    notes: scoreOrder(withPickup(UNRELATED_SONG.notes, 1)),
    opts: { meters: '3/4', key: C_MAJOR, melody: withPickup(UNRELATED_SONG.melody, 1) },
    classProfile: () =>
      Score.of(scoreOrder(withPickup(UNRELATED_SONG.notes, 1)), {
        meters: '3/4',
        key: C_MAJOR,
      }).reference({
        melody: withPickup(UNRELATED_SONG.melody, 1),
      }),
    startBeat: -1,
    endBeat: 24,
  },
  {
    id: 5,
    texture: 'polyphonic',
    key: 'inferred',
    meter: '4/4',
    pickup: false,
    modulation: false,
    entry: 'Arrangement.reference',
    notes: SOURCE_SONG.notes,
    opts: {},
    classProfile: () => Arrangement.of([{ name: 'harmony', notes: SOURCE_SONG.notes }]).reference(),
    startBeat: 0,
    endBeat: 128,
  },
  {
    id: 6,
    texture: 'polyphonicWithMelodyOption',
    key: 'stated',
    meter: 'changing',
    pickup: false,
    modulation: false,
    entry: 'analyzeReference',
    notes: SOURCE_SONG.notes,
    opts: { meters: CHANGING_METER, key: C_MAJOR, melody: SOURCE_SONG.melody },
    startBeat: 0,
    endBeat: 128,
  },
  {
    id: 7,
    texture: 'melodyOnly',
    key: 'inferred',
    meter: '4/4',
    pickup: true,
    modulation: true,
    entry: 'analyzeReference',
    notes: withPickup(modulated(SOURCE_SONG.melody), 1),
    opts: { meters: '4/4' },
    startBeat: -1,
    endBeat: 128,
  },
  {
    id: 8,
    texture: 'polyphonic',
    key: 'inferred',
    meter: '6/8',
    pickup: true,
    modulation: true,
    entry: 'Score.reference',
    notes: scoreOrder(withPickup(modulated(SOURCE_SONG.notes), 1.5)),
    opts: { meters: '6/8' },
    classProfile: () =>
      Score.of(scoreOrder(withPickup(modulated(SOURCE_SONG.notes), 1.5)), {
        meters: '6/8',
      }).reference(),
    startBeat: -1.5,
    endBeat: 128,
  },
  {
    id: 9,
    texture: 'melodyOnly',
    key: 'stated',
    meter: '4/4',
    pickup: true,
    modulation: false,
    entry: 'Score.reference',
    notes: scoreOrder(withPickup(SOURCE_SONG.melody, 1)),
    opts: { meters: '4/4', key: C_MAJOR },
    classProfile: () =>
      Score.of(scoreOrder(withPickup(SOURCE_SONG.melody, 1)), {
        meters: '4/4',
        key: C_MAJOR,
      }).reference(),
    startBeat: -1,
    endBeat: 128,
  },
  {
    id: 10,
    texture: 'polyphonic',
    key: 'stated',
    meter: '3/4',
    pickup: true,
    modulation: false,
    entry: 'Arrangement.reference',
    notes: withPickup(UNRELATED_SONG.notes, 1),
    opts: { meters: '3/4', key: C_MAJOR },
    classProfile: () =>
      Arrangement.of([{ name: 'harmony', notes: withPickup(UNRELATED_SONG.notes, 1) }], {
        meters: '3/4',
        key: C_MAJOR,
      }).reference(),
    startBeat: -1,
    endBeat: 24,
  },
  {
    id: 11,
    texture: 'polyphonic',
    key: 'stated',
    meter: '3/4',
    pickup: true,
    modulation: false,
    entry: 'analyzeReference',
    notes: withPickup(UNRELATED_SONG.notes, 1),
    opts: { meters: '3/4', key: C_MAJOR },
    startBeat: -1,
    endBeat: 24,
  },
  {
    id: 12,
    texture: 'melodyOnly',
    key: 'inferred',
    meter: 'changing',
    pickup: false,
    modulation: true,
    entry: 'Score.reference',
    notes: scoreOrder(modulated(SOURCE_SONG.melody)),
    opts: { meters: CHANGING_METER },
    classProfile: () =>
      Score.of(scoreOrder(modulated(SOURCE_SONG.melody)), { meters: CHANGING_METER }).reference(),
    startBeat: 0,
    endBeat: 128,
  },
  {
    id: 13,
    texture: 'polyphonicWithMelodyOption',
    key: 'inferred',
    meter: '4/4',
    pickup: true,
    modulation: true,
    entry: 'analyzeReference',
    notes: withPickup(modulated(SOURCE_SONG.notes), 1),
    opts: { meters: '4/4', melody: withPickup(modulated(SOURCE_SONG.melody), 1) },
    startBeat: -1,
    endBeat: 128,
  },
  {
    id: 14,
    texture: 'polyphonicWithMelodyOption',
    key: 'inferred',
    meter: '6/8',
    pickup: true,
    modulation: false,
    entry: 'Arrangement.reference',
    // The melody-role track is not percussion, so it pools into the harmony
    // reading too, alongside the harmony track.
    notes: [...withPickup(UNRELATED_SONG.notes, 1.5), ...withPickup(UNRELATED_SONG.melody, 1.5)],
    opts: { meters: '6/8', melody: withPickup(UNRELATED_SONG.melody, 1.5) },
    classProfile: () =>
      Arrangement.of(
        [
          { name: 'harmony', notes: withPickup(UNRELATED_SONG.notes, 1.5) },
          { name: 'lead', role: 'melody', notes: withPickup(UNRELATED_SONG.melody, 1.5) },
        ],
        { meters: '6/8' },
      ).reference(),
    startBeat: -1.5,
    endBeat: 24,
  },
  {
    id: 15,
    texture: 'polyphonic',
    key: 'inferred',
    meter: 'changing',
    pickup: true,
    modulation: true,
    entry: 'Score.reference',
    notes: scoreOrder(withPickup(modulated(SOURCE_SONG.notes), 1)),
    opts: { meters: CHANGING_METER },
    classProfile: () =>
      Score.of(scoreOrder(withPickup(modulated(SOURCE_SONG.notes), 1)), {
        meters: CHANGING_METER,
      }).reference(),
    startBeat: -1,
    endBeat: 128,
  },
  {
    id: 16,
    texture: 'melodyOnly',
    key: 'stated',
    meter: '6/8',
    pickup: false,
    modulation: false,
    entry: 'analyzeReference',
    notes: UNRELATED_SONG.melody,
    opts: { meters: '6/8', key: C_MAJOR },
    startBeat: 0,
    endBeat: 24,
  },
];

/** Check (d): the phrases cover the span end to end, each starting where the last ended. */
function expectPhrasesTileSpan(profile: ReferenceProfile): void {
  const { phrases } = profile.form;
  expect(phrases.length).toBeGreaterThan(0);
  expect(phrases[0]?.startBeat).toBe(profile.span.startBeat);
  for (let index = 1; index < phrases.length; index += 1) {
    expect(phrases[index]?.startBeat).toBe(phrases[index - 1]?.endBeat);
  }
  expect(phrases[phrases.length - 1]?.endBeat).toBe(profile.span.endBeat);
}

describe('analyzeReference across the pairwise input model', () => {
  for (const row of ROWS) {
    const title = `row ${row.id}: ${row.texture}, ${row.key} key, ${row.meter}${
      row.pickup ? ', pickup' : ''
    }${row.modulation ? ', modulating' : ''} via ${row.entry}`;

    it(`${title} — (a) the validator accepts the profile`, () => {
      const profile = RUN[row.entry](row);
      expect(assertReferenceProfile(profile)).toBe(profile);
      expect(profile.profileVersion).toBe(REFERENCE_PROFILE_VERSION);
    });

    it(`${title} — (b) the profile survives a JSON round trip`, () => {
      const profile = RUN[row.entry](row);
      const restored: unknown = JSON.parse(JSON.stringify(profile));
      expect(restored).toEqual(profile);
      expect(assertReferenceProfile(restored)).toEqual(profile);
    });

    if (row.entry !== 'analyzeReference') {
      it(`${title} — (c) the class result equals the function result`, () => {
        expect(RUN[row.entry](row)).toEqual(analyzeReference(row.notes, row.opts));
      });
    }

    it(`${title} — (d) the phrases tile the span`, () => {
      const profile = RUN[row.entry](row);
      expect(profile.span.startBeat).toBe(row.startBeat);
      expect(profile.span.endBeat).toBe(row.endBeat);
      expectPhrasesTileSpan(profile);
    });

    it(`${title} — reads the melody and key the row describes`, () => {
      const profile = RUN[row.entry](row);
      expect(profile.melody.register).not.toBeNull();
      expect(profile.melody.rhythm.onsets).toBeGreaterThan(0);
      if (row.key === 'stated') {
        expect(profile.harmony.keys).toHaveLength(1);
        expect(profile.harmony.keys[0]?.key.scale.rootPc).toBe(0);
        expect(profile.harmony.keys[0]?.confidence).toBe(1);
      } else {
        expect(profile.harmony.keys.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('analyzeReference options', () => {
  it('is the readings it is built from, whichever way they arrive', () => {
    const opts: ReferenceProfileOptions = { meters: '4/4', key: C_MAJOR };
    const readings = readingsFor(SOURCE_SONG.notes, opts);
    expect(referenceFromReadings(SOURCE_SONG.notes, readings, opts)).toEqual(
      analyzeReference(SOURCE_SONG.notes, opts),
    );
    const cached = chordTimelineFromNotes(SOURCE_SONG.notes, opts);
    expect(referenceFromReadings(SOURCE_SONG.notes, cached, opts)).toEqual(
      analyzeReference(SOURCE_SONG.notes, opts),
    );
  });
});
