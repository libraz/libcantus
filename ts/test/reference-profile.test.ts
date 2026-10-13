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
import type { MotifGraph } from '../src/analyze/melody/graph.js';
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
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import type { MeterLike } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Arrangement, Score } from '../src/model/index.js';
import type { KeyLike } from '../src/theory/scale/index.js';
import {
  type ReferenceFixture,
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

const FIXTURES = [SOURCE_SONG, SAME_STRUCTURE_SONG, TRANSPOSED_SONG, UNRELATED_SONG];

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

/** Depth of every graph node: roots are 0, and only a pitch-changing edge deepens. */
function derivationDepths(graph: MotifGraph): number[] {
  const parent = new Map(graph.edges.map((edge) => [edge.to, edge]));
  const depths: number[] = [];
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const edge = parent.get(index);
    if (edge === undefined) {
      depths.push(0);
      continue;
    }
    const kind = edge.relation?.kind;
    const keepsPitch = kind === 'repetition' || kind === 'augmentation' || kind === 'diminution';
    depths.push((depths[edge.from] ?? 0) + (keepsPitch ? 0 : 1));
  }
  return depths;
}

/** The profile of a fixture, read with its stated key and its own melody. */
function fixtureProfile(fixture: ReferenceFixture): ReferenceProfile {
  return analyzeReference(fixture.notes, {
    meters: fixture.meters,
    key: fixture.key,
    melody: fixture.melody,
  });
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

describe('analyzeReference on the reference fixtures', () => {
  for (const fixture of FIXTURES) {
    it(`reads ${fixture.name} into a valid, round-trip-stable profile`, () => {
      const profile = fixtureProfile(fixture);
      assertReferenceProfile(profile);
      expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
      expectPhrasesTileSpan(profile);
    });

    it(`finds the hand-annotated phrase boundaries of ${fixture.name}`, () => {
      const { phrases } = fixtureProfile(fixture).form;
      const boundaries = [phrases[0]?.startBeat, ...phrases.map((phrase) => phrase.endBeat)];
      expect(boundaries).toEqual(fixture.phraseBoundaries);
    });
  }

  it('reads the source song as four eight-bar phrases over a 32-bar span', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    expect(profile.span).toEqual({ startBeat: 0, endBeat: 128, bars: 32 });
    expect(profile.form.phrases.map((phrase) => phrase.bars)).toEqual([8, 8, 8, 8]);
  });

  it('closes every source-song phrase on the cadence written into its last bars', () => {
    const { phrases } = fixtureProfile(SOURCE_SONG).form;
    expect(phrases.map((phrase) => phrase.cadence?.type)).toEqual([
      'authentic',
      'authentic',
      'half',
      'authentic',
    ]);
    expect(phrases.map((phrase) => phrase.cadence?.atBeat)).toEqual([28, 60, 92, 124]);
  });

  it('cuts the sections on the phrase grouping and names the one each phrase opens in', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    expect(profile.form.sections.length).toBeGreaterThan(0);
    expect(profile.form.sections[0]?.startBeat).toBe(0);
    expect(profile.form.sections[profile.form.sections.length - 1]?.endBeat).toBe(128);
    for (const phrase of profile.form.phrases) {
      const section = profile.form.sections[phrase.section ?? -1];
      expect(section?.startBeat).toBeLessThanOrEqual(phrase.startBeat);
      expect(section?.endBeat).toBeGreaterThan(phrase.startBeat);
    }
    const labels = profile.form.phrases.map(
      (phrase) => profile.form.sections[phrase.section ?? -1]?.label,
    );
    expect(labels).toEqual(['A', 'A', 'B', 'A']);
  });

  it('cuts the same-structure song into the same AABA sections as the source song', () => {
    const profile = fixtureProfile(SAME_STRUCTURE_SONG);
    const labels = profile.form.phrases.map(
      (phrase) => profile.form.sections[phrase.section ?? -1]?.label,
    );
    expect(labels).toEqual(['A', 'A', 'B', 'A']);
  });

  it('reads the hook at depth 0, its transposition at depth 1 and its inversion at depth 2', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    const { motifs, graph } = profile.melody;
    const hook = motifs.findIndex((motif) => motif.intervals.join() === '2,2,1');
    const invertedHook = motifs.findIndex((motif) => motif.intervals.join() === '-2,-2,-1');
    expect(hook).toBeGreaterThanOrEqual(0);
    expect(invertedHook).toBeGreaterThanOrEqual(0);
    const depths = derivationDepths(graph);
    const depthOf = (motif: number, beat: number): number | undefined => {
      const node = graph.nodes.findIndex((n) => n.motif === motif && n.startBeat === beat);
      return node < 0 ? undefined : depths[node];
    };
    expect(depthOf(hook, 0)).toBe(0);
    expect(depthOf(hook, 16)).toBe(0);
    expect(depthOf(hook, 32)).toBe(1);
    expect(depthOf(invertedHook, 64)).toBe(2);
  });

  it('assigns every graph node to the phrase its statement starts in', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    const assigned = profile.form.phrases.flatMap((phrase) => phrase.motifNodes);
    expect([...assigned].sort((a, b) => a - b)).toEqual(
      profile.melody.graph.nodes.map((_, i) => i),
    );
    for (const phrase of profile.form.phrases) {
      for (const node of phrase.motifNodes) {
        const start = profile.melody.graph.nodes[node]?.startBeat ?? Number.NaN;
        expect(start).toBeGreaterThanOrEqual(phrase.startBeat);
        expect(start).toBeLessThan(phrase.endBeat);
      }
    }
  });

  it('reads the source melody register and phrase outlines', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    const register = profile.melody.register;
    // The bridge dips to the lowest note of the piece; the three A phrases keep
    // the register the hook and its fillers state everywhere else.
    expect(register?.low).toBe(53);
    expect(register?.high).toBe(79);
    for (const phrase of profile.form.phrases) {
      expect(phrase.melody).not.toBeNull();
      expect(phrase.melody?.outline).toHaveLength(8);
    }
    expect(profile.form.phrases.map((phrase) => phrase.melody?.high)).toEqual([79, 79, 72, 79]);
    // The first sample point of an eight-bar phrase is beat 2, where the hook's E (76) sounds.
    expect(profile.form.phrases[0]?.melody?.outline[0]).toBeCloseTo(76 - (register?.mean ?? 0), 9);
  });

  it('carries a stated key as one confident region and names every chord against it', () => {
    const profile = fixtureProfile(SOURCE_SONG);
    expect(profile.harmony.keys).toHaveLength(1);
    expect(profile.harmony.keys[0]?.key.scale.rootPc).toBe(0);
    expect(profile.harmony.chords.length).toBeGreaterThan(0);
    expect(profile.harmony.chords.every((chord) => chord.key === 0)).toBe(true);
    expect(new Set(profile.harmony.chords.map((chord) => chord.function))).toEqual(
      new Set(['tonic', 'subdominant', 'dominant']),
    );
    expect(profile.harmony.rhythm.endBeat).toBe(128);
  });

  it('infers C major as the prevailing key when none is stated', () => {
    const profile = analyzeReference(SOURCE_SONG.notes, { meters: '4/4' });
    assertReferenceProfile(profile);
    const held = new Map<number, number>();
    for (const region of profile.harmony.keys) {
      const id = region.key.scale.rootPc * 4096 + region.key.scale.modeMask12;
      held.set(id, (held.get(id) ?? 0) + region.endBeat - region.startBeat);
    }
    const stated = fixtureProfile(SOURCE_SONG).harmony.keys[0]?.key.scale;
    const [prevailing] = [...held.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    expect(prevailing).toBe((stated?.rootPc ?? -1) * 4096 + (stated?.modeMask12 ?? -1));
  });
});

describe('analyzeReference options', () => {
  it('reads nothing at all from an empty input', () => {
    const profile = analyzeReference([]);
    assertReferenceProfile(profile);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
    expect(profile.span).toEqual({ startBeat: 0, endBeat: 0, bars: 0 });
    expect(profile.form.phrases).toEqual([]);
    expect(profile.form.sections).toEqual([]);
    expect(profile.harmony.chords).toEqual([]);
    expect(profile.melody.register).toBeNull();
    expect(profile.melody.shape).toBeNull();
    expect(profile.melody.motifs).toEqual([]);
    expect(profile.melody.graph).toEqual({ nodes: [], edges: [] });
    expect(profile.melody.rhythm.onsets).toBe(0);
  });

  it('reads a melody alone, with no accompaniment to infer harmony from', () => {
    const profile = analyzeReference(SOURCE_SONG.melody, { meters: '4/4', key: C_MAJOR });
    assertReferenceProfile(profile);
    expectPhrasesTileSpan(profile);
    expect(profile.melody.register?.low).toBe(53);
    expect(profile.melody.register?.high).toBe(79);
  });

  it('reads the melody option as the line, whatever the accompaniment holds', () => {
    const base = { meters: SOURCE_SONG.meters, key: SOURCE_SONG.key };
    const withOption = analyzeReference(SOURCE_SONG.notes, {
      ...base,
      melody: SOURCE_SONG.melody,
    });
    const lineAlone = analyzeReference(SOURCE_SONG.melody, base);
    expect(withOption.melody).toEqual(lineAlone.melody);
    // Read as the top line instead, the chords' upper notes break into the melody.
    const topLine = analyzeReference(SOURCE_SONG.notes, base);
    expect(topLine.melody).not.toEqual(withOption.melody);
  });

  it('takes a given timeline as the harmony instead of inferring one', () => {
    const base = { meters: SOURCE_SONG.meters, key: SOURCE_SONG.key };
    const { timeline } = chordTimelineFromNotes(SOURCE_SONG.notes, base);
    const injected = analyzeReference(SOURCE_SONG.melody, { ...base, timeline });
    const inferred = analyzeReference(SOURCE_SONG.notes, base);
    assertReferenceProfile(injected);
    expectPhrasesTileSpan(injected);
    expect(injected.harmony.chords).toEqual(inferred.harmony.chords);
    expect(injected.harmony.rhythm).toEqual(inferred.harmony.rhythm);
    expect(injected.harmony.keys).toEqual(inferred.harmony.keys);
  });

  it('searches the notes for keys under a given timeline when no key is stated', () => {
    const { timeline } = chordTimelineFromNotes(SOURCE_SONG.notes, { meters: '4/4' });
    const profile = analyzeReference(SOURCE_SONG.melody, { meters: '4/4', timeline });
    assertReferenceProfile(profile);
    expect(profile.harmony.keys.length).toBeGreaterThan(0);
    expect(profile.harmony.chords.length).toBe(timeline.segments.length);
  });

  it('names chords against the prevailing key when a given timeline has no notes to key it', () => {
    const { timeline } = chordTimelineFromNotes(SOURCE_SONG.notes, { meters: '4/4' });
    const profile = analyzeReference([], { meters: '4/4', timeline });
    assertReferenceProfile(profile);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
    expect(profile.harmony.chords.length).toBe(timeline.segments.length);
    expectPhrasesTileSpan(profile);
  });

  it('extends the span to a given totalBeats', () => {
    const profile = analyzeReference(SOURCE_SONG.notes, {
      meters: '4/4',
      key: C_MAJOR,
      totalBeats: 136,
    });
    assertReferenceProfile(profile);
    expect(profile.span.endBeat).toBe(136);
    expect(profile.span.bars).toBe(34);
    expect(profile.harmony.rhythm.endBeat).toBe(136);
    expect(profile.melody.rhythm.endBeat).toBe(136);
    expectPhrasesTileSpan(profile);
  });

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

  it('refuses work past the budget', () => {
    expect(() => analyzeReference(SOURCE_SONG.notes, { key: C_MAJOR, budget: 10 })).toThrow(
      BudgetExceededError,
    );
    expect(() =>
      analyzeReference(SOURCE_SONG.notes, {
        key: C_MAJOR,
        timeline: chordTimelineFromNotes(SOURCE_SONG.notes, { key: C_MAJOR }).timeline,
        budget: 10,
      }),
    ).toThrow(BudgetExceededError);
  });

  it('rejects options it cannot read', () => {
    const notes = SOURCE_SONG.notes;
    const bad: unknown[] = [
      5,
      { ts: '4/4', meters: '4/4' },
      { key: 'Q major' },
      { totalBeats: Number.NaN },
      { totalBeats: -4 },
      { melody: 'not notes' },
      { melody: [{ pitch: 60 }] },
      { timeline: { segments: 'none' } },
      { budget: -1 },
    ];
    for (const opts of bad) {
      expect(() => analyzeReference(notes, opts as ReferenceProfileOptions)).toThrow(
        InvalidInputError,
      );
    }
    expect(() => analyzeReference('notes' as unknown as NoteEvent[])).toThrow(InvalidInputError);
  });

  it('answers the same profile every time, and leaves its input untouched', () => {
    const notes = structuredClone(SOURCE_SONG.notes) as NoteEvent[];
    const melody = structuredClone(SOURCE_SONG.melody) as NoteEvent[];
    const first = analyzeReference(notes, { meters: '4/4', melody });
    const second = analyzeReference(notes, { meters: '4/4', melody });
    expect(second).toEqual(first);
    expect(notes).toEqual(SOURCE_SONG.notes);
    expect(melody).toEqual(SOURCE_SONG.melody);
  });
});
