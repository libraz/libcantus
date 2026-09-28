import { describe, expect, it } from 'vitest';
import type { MotifGraphEdge, MotifGraphNode } from '../src/analyze/melody/graph.js';
import type { MotifRelationKind } from '../src/analyze/melody/relation.js';
import { compareReferences, type ReferenceComparison } from '../src/analyze/reference/compare.js';
import { romanDegreeToken } from '../src/analyze/reference/measures.js';
import { analyzeReference } from '../src/analyze/reference/profile.js';
import type { ReferenceChord, ReferenceProfile } from '../src/analyze/reference/types.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import {
  type ReferenceFixture,
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

/** A fixture read with its stated meter, key and melody line. */
function profileOf(fixture: ReferenceFixture): ReferenceProfile {
  return analyzeReference(fixture.notes, {
    meters: fixture.meters,
    key: fixture.key,
    melody: fixture.melody,
  });
}

const SOURCE = profileOf(SOURCE_SONG);
const SAME_STRUCTURE = profileOf(SAME_STRUCTURE_SONG);
const TRANSPOSED = profileOf(TRANSPOSED_SONG);
const UNRELATED = profileOf(UNRELATED_SONG);
const PROFILES: [string, ReferenceProfile][] = [
  ['source', SOURCE],
  ['same-structure', SAME_STRUCTURE],
  ['transposed', TRANSPOSED],
  ['unrelated', UNRELATED],
];

type Dimension = Exclude<keyof ReferenceComparison, 'rationale'>;

/** Every similarity field of a comparison, as `dimension.field` → value. */
function fields(comparison: ReferenceComparison): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const dimension of ['form', 'harmony', 'melody', 'rhythm'] as Dimension[]) {
    for (const [field, value] of Object.entries(comparison[dimension])) {
      out[`${dimension}.${field}`] = value as number | null;
    }
  }
  return out;
}

const RHYTHM_EMPTY = {
  startBeat: 0,
  endBeat: 0,
  bars: 0,
  onsets: 0,
  onsetDensity: 0,
  barOnsets: [],
  onsetLevels: [0, 0, 0, 0, 0, 0],
  barPositions: [],
  interOnsetShares: new Array(17).fill(0),
  restRatio: 0,
  syncopation: 0,
  offGridRatio: 0,
  rationale: 'nothing sounds',
};

/** A valid profile of nothing at all. */
function emptyProfile(): ReferenceProfile {
  return {
    profileVersion: 1,
    span: { startBeat: 0, endBeat: 0, bars: 0 },
    meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
    form: { hypermeter: { groupBars: 1, confidence: 0 }, sections: [], phrases: [] },
    harmony: { keys: [], chords: [], rhythm: structuredClone(RHYTHM_EMPTY) },
    melody: {
      register: null,
      shape: null,
      motifs: [],
      graph: { nodes: [], edges: [] },
      rhythm: structuredClone(RHYTHM_EMPTY),
    },
  };
}

/** The source profile with its melody taken away: no register, motifs, graph or melodic rhythm. */
function melodyless(profile: ReferenceProfile): ReferenceProfile {
  const out = structuredClone(profile);
  out.melody = emptyProfile().melody;
  for (const phrase of out.form.phrases) {
    phrase.melody = null;
    phrase.motifNodes = [];
  }
  return out;
}

/** The profile with its chords and harmonic rhythm taken away, its key regions kept. */
function chordless(profile: ReferenceProfile): ReferenceProfile {
  const out = structuredClone(profile);
  out.harmony.chords = [];
  out.harmony.rhythm = structuredClone(RHYTHM_EMPTY);
  return out;
}

/** The profile with its chords replaced, all read in its first key region. */
function withChords(
  profile: ReferenceProfile,
  chords: readonly [string, ReferenceChord['function'], ReferenceChord['level']?][],
): ReferenceProfile {
  const out = structuredClone(profile);
  out.harmony.chords = chords.map(([roman, fn, level], i) => ({
    startBeat: i * 4,
    endBeat: i * 4 + 4,
    key: 0,
    roman,
    function: fn,
    level: level ?? 'structural',
  }));
  return out;
}

/**
 * The profile with its motif graph replaced by the given nodes (each a
 * four-beat statement starting at the given beat) and edges, over one motif.
 */
function withGraph(
  profile: ReferenceProfile,
  starts: readonly number[],
  edges: readonly [number, number, MotifRelationKind | null][],
): ReferenceProfile {
  const out = structuredClone(profile);
  for (const phrase of out.form.phrases) {
    phrase.motifNodes = [];
  }
  out.melody.motifs =
    starts.length === 0
      ? []
      : [
          {
            intervals: [2, 2],
            rhythm: [1, 1],
            unitBeats: 1,
            spanBeats: 3,
            occurrences: starts.length,
          },
        ];
  const nodes: MotifGraphNode[] = starts.map((startBeat, occurrence) => ({
    motif: 0,
    occurrence,
    startBeat,
    endBeat: startBeat + 4,
  }));
  const graphEdges: MotifGraphEdge[] = edges.map(([from, to, kind]) => ({
    from,
    to,
    relation: kind === null ? null : { kind, sequence: false, semitones: 0, timeRatio: 1 },
    similarity: 1,
  }));
  out.melody.graph = { nodes, edges: graphEdges };
  return out;
}

describe('compareReferences on the reference fixtures', () => {
  for (const [name, profile] of PROFILES) {
    it(`reads the ${name} profile as identical to itself on every measured field`, () => {
      const comparison = compareReferences(profile, profile);
      for (const [field, value] of Object.entries(fields(comparison))) {
        expect(value, field).not.toBeNull();
        expect(value, field).toBeCloseTo(1, 9);
      }
    });
  }

  it('reads a transposition as the same piece on every field, surface included', () => {
    // The surface compares motif-cell intervals, and a transposition moves no interval.
    const comparison = compareReferences(SOURCE, TRANSPOSED);
    for (const [field, value] of Object.entries(fields(comparison))) {
      expect(value, field).toBeCloseTo(1, 9);
    }
  });

  it('reads the same-structure song as structurally alike and different on the surface', () => {
    const comparison = compareReferences(SOURCE, SAME_STRUCTURE);
    expect(comparison.melody.motifStructureSimilarity).toBeGreaterThanOrEqual(0.9);
    expect(comparison.melody.surfaceSimilarity).toBeLessThanOrEqual(0.6);
    // Same skeleton, cadences, key and rhythm: every one of those reads identical.
    expect(comparison.form).toEqual({ sectionSequenceSimilarity: 1, phraseLengthSimilarity: 1 });
    // The accompaniment is identical, but chords are read from every note: the source's
    // C-Bb-Ab-G over the bridge's opening vi folds that bar into the preceding I as one
    // Iadd6 (beats 60-68), where the same-structure melody leaves I and vi apart. Its 22
    // structural chords align to the source's 21 by Iadd6→I (0.25) plus one inserted vi
    // (0.75): 1 − 1/22. Chord changes: 21 against 22 over 32 bars, all on downbeats, and
    // beats 60-68 are tonic on both sides.
    expect(comparison.harmony.progressionSimilarity).toBeCloseTo(21 / 22, 9);
    expect(comparison.harmony.harmonicRhythmDensitySimilarity).toBeCloseTo(21 / 22, 9);
    expect(comparison.harmony.harmonicRhythmOnsetSimilarity).toBe(1);
    expect(comparison.harmony.functionSimilarity).toBe(1);
    expect(comparison.harmony.cadenceSimilarity).toBe(1);
    expect(comparison.harmony.keyPlanSimilarity).toBe(1);
    expect(comparison.rhythm).toEqual({
      onsetSimilarity: 1,
      densitySimilarity: 1,
      durationSimilarity: 1,
      syncopationSimilarity: 1,
    });
  });

  it('reads the unrelated song as structurally far from the source song', () => {
    const comparison = compareReferences(SOURCE, UNRELATED);
    const same = compareReferences(SOURCE, SAME_STRUCTURE);
    // Sections A A B against A B: one gap over three.
    expect(comparison.form.sectionSequenceSimilarity).toBeCloseTo(2 / 3, 9);
    // Bars 8 8 8 8 against 3 5: substitute 8→3 (5/8) and 8→5 (3/8), drop two (1 each) = 3 over 4.
    expect(comparison.form.phraseLengthSimilarity).toBeCloseTo(0.25, 9);
    // Cadences auth auth half auth against auth auth: two gaps over four.
    expect(comparison.harmony.cadenceSimilarity).toBeCloseTo(0.5, 9);
    // Both are read in one key, C major throughout.
    expect(comparison.harmony.keyPlanSimilarity).toBe(1);
    // Function shares, weighted by chord length: source T 44 / S 56 / D 28 of 128 beats,
    // unrelated T 8 / S 9 / D 7 of 24 beats.
    expect(comparison.harmony.functionSimilarity).toBeCloseTo(8 / 24 + 9 / 24 + 28 / 128, 9);
    // Chord changes per bar: 21 over 32 bars against 10 over 8.
    expect(comparison.harmony.harmonicRhythmDensitySimilarity).toBeCloseTo(21 / 32 / 1.25, 9);
    // 4/4 against 3/4 shares no meter, so the onset levels stand in: every source chord
    // change on a downbeat (level 5); half the unrelated ones there, half on a beat (level 3).
    expect(comparison.harmony.harmonicRhythmOnsetSimilarity).toBeCloseTo(0.5, 9);
    // Melodic onsets per bar: 116 over 32 bars against 13 over 8.
    expect(comparison.rhythm.densitySimilarity).toBeCloseTo(1.625 / 3.625, 9);
    // Onset levels: source 14/29 at level 3, 7/29 at 4, 8/29 at 5; unrelated 8/13 at 3, 5/13 at 5.
    expect(comparison.rhythm.onsetSimilarity).toBeCloseTo(14 / 29 + 8 / 29, 9);
    // Inter-onset shares: source 28/29 one beat, 1/29 four beats; unrelated 4/13 one beat.
    expect(comparison.rhythm.durationSimilarity).toBeCloseTo(4 / 13, 9);
    expect(comparison.rhythm.syncopationSimilarity).toBeCloseTo(
      1 - Math.abs(SOURCE.melody.rhythm.syncopation - UNRELATED.melody.rhythm.syncopation),
      9,
    );
    // Clearly lower than the same-structure song on the structural fields.
    expect(comparison.melody.motifStructureSimilarity).toBeLessThan(
      same.melody.motifStructureSimilarity ?? 0,
    );
    expect(comparison.form.phraseLengthSimilarity).toBeLessThan(
      same.form.phraseLengthSimilarity ?? 0,
    );
    expect(comparison.melody.motifStructureSimilarity).toBeLessThan(0.5);
    expect(comparison.harmony.progressionSimilarity).toBeLessThan(0.6);
    expect(comparison.melody.contourSimilarity).toBeLessThan(0.6);
    expect(comparison.melody.registerSimilarity).toBeLessThan(0.6);
  });

  it('is symmetric in its arguments on every field', () => {
    for (const [, a] of PROFILES) {
      for (const [, b] of PROFILES) {
        expect(fields(compareReferences(a, b))).toEqual(fields(compareReferences(b, a)));
      }
    }
  });

  it('keeps every value in [0, 1] and answers the same way twice', () => {
    for (const [, a] of PROFILES) {
      for (const [, b] of PROFILES) {
        const first = compareReferences(a, b);
        expect(compareReferences(a, b)).toEqual(first);
        for (const value of Object.values(fields(first))) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('names the fields it reports in its rationale', () => {
    const comparison = compareReferences(SOURCE, UNRELATED);
    expect(comparison.rationale).toMatch(/phraseLength/);
  });
});

describe('compareReferences null rules', () => {
  it('reads nothing measurable between two empty profiles', () => {
    const comparison = compareReferences(emptyProfile(), emptyProfile());
    for (const [field, value] of Object.entries(fields(comparison))) {
      expect(value, field).toBeNull();
    }
  });

  it('reads 0 wherever only one side has material', () => {
    const comparison = compareReferences(emptyProfile(), SOURCE);
    for (const [field, value] of Object.entries(fields(comparison))) {
      expect(value, field).toBe(0);
    }
  });

  it('leaves the melodic fields null when neither side has a melody', () => {
    const a = melodyless(SOURCE);
    const comparison = compareReferences(a, melodyless(SAME_STRUCTURE));
    expect(comparison.melody).toEqual({
      surfaceSimilarity: null,
      motifStructureSimilarity: null,
      contourSimilarity: null,
      registerSimilarity: null,
    });
    expect(comparison.rhythm).toEqual({
      onsetSimilarity: null,
      densitySimilarity: null,
      durationSimilarity: null,
      syncopationSimilarity: null,
    });
    expect(comparison.form.phraseLengthSimilarity).toBe(1);
    expect(comparison.harmony.keyPlanSimilarity).toBe(1);
  });

  it('reads 0 on the melodic fields when only one side has a melody', () => {
    const comparison = compareReferences(melodyless(SOURCE), SOURCE);
    for (const value of [
      ...Object.values(comparison.melody),
      ...Object.values(comparison.rhythm),
    ]) {
      expect(value).toBe(0);
    }
  });

  it('leaves the chord fields null when neither side has chords, but still reads the keys', () => {
    const comparison = compareReferences(chordless(SOURCE), chordless(TRANSPOSED));
    expect(comparison.harmony).toEqual({
      progressionSimilarity: null,
      functionSimilarity: null,
      cadenceSimilarity: 1,
      keyPlanSimilarity: 1,
      harmonicRhythmOnsetSimilarity: null,
      harmonicRhythmDensitySimilarity: null,
    });
  });

  it('reads 0 progression when one side has chords but none structural', () => {
    const allPassing = withChords(SOURCE, [
      ['I', 'tonic', 'passing'],
      ['V', 'dominant', 'passing'],
    ]);
    const structural = withChords(SOURCE, [
      ['I', 'tonic'],
      ['V', 'dominant'],
    ]);
    const comparison = compareReferences(allPassing, structural);
    expect(comparison.harmony.progressionSimilarity).toBe(0);
    // The function shares still read every chord, passing ones included.
    expect(comparison.harmony.functionSimilarity).toBe(1);
  });
});

describe('compareReferences surface', () => {
  it('reads a cell that leaps across most of the MIDI range without leaving it', () => {
    const wide = structuredClone(SOURCE);
    const first = wide.melody.motifs[0];
    expect(first).toBeDefined();
    wide.melody.motifs[0] = {
      ...(first as NonNullable<typeof first>),
      intervals: [100, -90],
      rhythm: [1, 1],
    };
    const comparison = compareReferences(wide, wide);
    expect(comparison.melody.surfaceSimilarity).toBe(1);
  });
});

describe('compareReferences motif structure', () => {
  const base = SOURCE;
  // Span 128 beats; every statement is four beats long.

  it('leaves out a distribution both sides have no mass in', () => {
    // No edges on either side: the relation-kind distribution drops out of the mean.
    // Families: all single roots on both sides → 1. Depths: all 0 → 1.
    // Coverage: 8/128 against 4/128 → 1 − 4/128.
    const a = withGraph(base, [0, 4], []);
    const b = withGraph(base, [0], []);
    const comparison = compareReferences(a, b);
    expect(comparison.melody.motifStructureSimilarity).toBeCloseTo((1 + 1 + (1 - 4 / 128)) / 3, 9);
  });

  it('reads 0 for a distribution only one side has mass in', () => {
    // a: one repetition edge; b: none → relation kinds 0.
    // Families: one family of 2 against two of 1 → 0. Depths: all 0 on both → 1.
    // Coverage: identical → 1.
    const a = withGraph(base, [0, 4], [[0, 1, 'repetition']]);
    const b = withGraph(base, [0, 4], []);
    const comparison = compareReferences(a, b);
    expect(comparison.melody.motifStructureSimilarity).toBeCloseTo((0 + 0 + 1 + 1) / 4, 9);
  });

  it('deepens a derivation only across edges that change pitch', () => {
    // a: repetition then augmentation → depths 0 0 0.
    // b: transposition then inversion → depths 0 1 2.
    // Relation kinds disjoint → 0. One family of three each → 1.
    // Depths: {0: 3} against {0: 1, 1: 1, 2: 1} → 1/3. Coverage identical → 1.
    const a = withGraph(
      base,
      [0, 4, 8],
      [
        [0, 1, 'repetition'],
        [1, 2, 'augmentation'],
      ],
    );
    const b = withGraph(
      base,
      [0, 4, 8],
      [
        [0, 1, 'transposition'],
        [1, 2, 'inversion'],
      ],
    );
    const comparison = compareReferences(a, b);
    expect(comparison.melody.motifStructureSimilarity).toBeCloseTo((0 + 1 + 1 / 3 + 1) / 4, 9);
  });

  it('counts an unexplained variant as its own relation kind that deepens the derivation', () => {
    // a: one variant edge; b: one transposition edge → relation kinds 0.
    // Families: one of two each → 1. Depths 0 1 on both → 1. Coverage identical → 1.
    const a = withGraph(base, [0, 4], [[0, 1, null]]);
    const b = withGraph(base, [0, 4], [[0, 1, 'transposition']]);
    const comparison = compareReferences(a, b);
    expect(comparison.melody.motifStructureSimilarity).toBeCloseTo(3 / 4, 9);
  });

  it('is null only when every distribution drops out', () => {
    const comparison = compareReferences(withGraph(base, [], []), withGraph(base, [], []));
    expect(comparison.melody.motifStructureSimilarity).toBeNull();
  });
});

describe('compareReferences progression', () => {
  /** Progression likeness of two one-chord progressions: 1 − substitution cost. */
  const pair = (
    x: [string, ReferenceChord['function']],
    y: [string, ReferenceChord['function']],
  ): number | null =>
    compareReferences(withChords(SOURCE, [x]), withChords(SOURCE, [y])).harmony
      .progressionSimilarity;

  it('reads the degree token as accidental plus numeral, ignoring case, quality and inversion', () => {
    expect(romanDegreeToken('V7')).toBe('V');
    expect(romanDegreeToken('V6')).toBe('V');
    expect(romanDegreeToken('vi')).toBe('VI');
    expect(romanDegreeToken('IVadd6')).toBe('IV');
    expect(romanDegreeToken('bVII7')).toBe('bVII');
    expect(romanDegreeToken('#iv°7')).toBe('#IV');
    expect(romanDegreeToken('vii°')).toBe('VII');
  });

  it('reads an applied chord as one token distinct from its numeral', () => {
    expect(romanDegreeToken('V7/V')).toBe('V/V');
    expect(romanDegreeToken('vii°7/ii')).toBe('VII/II');
    expect(romanDegreeToken('V/V')).not.toBe(romanDegreeToken('V'));
  });

  it('reads the Neapolitan and augmented sixths as tokens equal only to themselves', () => {
    expect(romanDegreeToken('N6')).toBe('N');
    expect(romanDegreeToken('It6')).toBe('It');
    expect(romanDegreeToken('Fr6')).toBe('Fr');
    expect(romanDegreeToken('Ger6')).toBe('Ger');
    expect(romanDegreeToken('Ger65')).toBe('Ger');
    expect(romanDegreeToken('Ger6/V')).toBe('Ger/V');
    expect(romanDegreeToken('N6')).not.toBe(romanDegreeToken('bII'));
  });

  it('grades a substitution by identity, degree token, then function', () => {
    expect(pair(['V7', 'dominant'], ['V7', 'dominant'])).toBe(1);
    // Same degree token, another quality or inversion: 0.25.
    expect(pair(['V7', 'dominant'], ['V', 'dominant'])).toBeCloseTo(0.75, 9);
    expect(pair(['V6', 'dominant'], ['V', 'dominant'])).toBeCloseTo(0.75, 9);
    expect(pair(['vi', 'tonic'], ['VI', 'tonic'])).toBeCloseTo(0.75, 9);
    expect(pair(['Ger65', 'subdominant'], ['Ger6', 'subdominant'])).toBeCloseTo(0.75, 9);
    // Another token with the same function: 0.5.
    expect(pair(['V7/V', 'dominant'], ['V7', 'dominant'])).toBeCloseTo(0.5, 9);
    expect(pair(['N6', 'subdominant'], ['bII', 'subdominant'])).toBeCloseTo(0.5, 9);
    expect(pair(['Ger6', 'subdominant'], ['Fr6', 'subdominant'])).toBeCloseTo(0.5, 9);
    // Anything else: 1 (a gap pair would cost 1.5, so the substitution stands).
    expect(pair(['I', 'tonic'], ['V', 'dominant'])).toBe(0);
  });

  it('aligns with a gap cost of 0.75', () => {
    const a = withChords(SOURCE, [
      ['I', 'tonic'],
      ['IV', 'subdominant'],
      ['V', 'dominant'],
    ]);
    const b = withChords(SOURCE, [
      ['I', 'tonic'],
      ['V', 'dominant'],
    ]);
    // One skipped chord: 0.75 over three.
    expect(compareReferences(a, b).harmony.progressionSimilarity).toBeCloseTo(0.75, 9);
  });

  it('aligns structural chords only', () => {
    const a = withChords(SOURCE, [
      ['I', 'tonic'],
      ['ii', 'subdominant', 'passing'],
      ['V', 'dominant'],
    ]);
    const b = withChords(SOURCE, [
      ['I', 'tonic'],
      ['V', 'dominant'],
    ]);
    expect(compareReferences(a, b).harmony.progressionSimilarity).toBe(1);
  });
});

describe('compareReferences cadences and keys', () => {
  it('reads a half cadence answered by a Phrygian one as half a mismatch', () => {
    const a = structuredClone(SOURCE);
    const b = structuredClone(SOURCE);
    const bridge = b.form.phrases[2];
    if (bridge?.cadence) {
      bridge.cadence.type = 'phrygian';
    }
    // One substitution at 0.5 over four phrases.
    expect(compareReferences(a, b).harmony.cadenceSimilarity).toBeCloseTo(1 - 0.5 / 4, 9);
    const c = structuredClone(SOURCE);
    const last = c.form.phrases[3];
    if (last) {
      last.cadence = null;
    }
    // Authentic against none: a full substitution.
    expect(compareReferences(a, c).harmony.cadenceSimilarity).toBeCloseTo(1 - 1 / 4, 9);
  });

  it('reads the key plan relative to its first key, half-matching a change of mode', () => {
    const a = structuredClone(SOURCE);
    const b = structuredClone(TRANSPOSED);
    const region = a.harmony.keys[0];
    const other = b.harmony.keys[0];
    if (!region || !other) {
      throw new Error('fixture has no key region');
    }
    // Source: C major then G major; transposed: F major then C minor.
    a.harmony.keys = [
      { ...region, endBeat: 64 },
      {
        ...region,
        startBeat: 64,
        key: {
          ...region.key,
          scale: { rootPc: 7, modeMask12: region.key.scale.modeMask12 },
          tonic: { letter: 4, alter: 0 },
        },
      },
    ];
    b.harmony.keys = [
      { ...other, endBeat: 64 },
      {
        ...other,
        startBeat: 64,
        // Seven semitones above F, as G is above C, with the natural-minor mask.
        key: {
          ...other.key,
          scale: { rootPc: 0, modeMask12: 1453 },
          tonic: { letter: 0, alter: 0 },
          variant: 'natural',
        },
      },
    ];
    for (const chord of [...a.harmony.chords, ...b.harmony.chords]) {
      chord.key = 0;
    }
    // Tokens (0, major) (7, major) against (0, major) (7, minor): one half-cost substitution over two.
    expect(compareReferences(a, b).harmony.keyPlanSimilarity).toBeCloseTo(0.75, 9);
  });
});

describe('compareReferences entry checks', () => {
  it('rejects the alignment when it would exceed the budget', () => {
    // The source song has 21 structural chords: 21 × 21 = 441 alignment cells.
    expect(() => compareReferences(SOURCE, SOURCE, { budget: 440 })).toThrow(BudgetExceededError);
    expect(() => compareReferences(SOURCE, SOURCE, { budget: 440 })).toThrow(
      /reference progression alignment/,
    );
    expect(compareReferences(SOURCE, SOURCE, { budget: 441 }).harmony.progressionSimilarity).toBe(
      1,
    );
  });

  it('rejects a malformed profile on either side through the profile validator', () => {
    const broken = structuredClone(SOURCE) as unknown as { profileVersion: number };
    broken.profileVersion = 99;
    expect(() => compareReferences(broken as unknown as ReferenceProfile, SOURCE)).toThrow(
      InvalidInputError,
    );
    expect(() => compareReferences(SOURCE, {} as ReferenceProfile)).toThrow(InvalidInputError);
    expect(() => compareReferences(SOURCE, SOURCE, null as never)).toThrow(InvalidInputError);
  });
});
