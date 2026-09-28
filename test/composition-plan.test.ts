import { describe, expect, it } from 'vitest';
import type { MotifRelationSummary } from '../src/analyze/melody/relation.js';
import {
  analyzeReference,
  assertReferenceProfile,
  type ReferenceProfile,
} from '../src/analyze/reference/index.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import { createPositionalRng } from '../src/core/random/index.js';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import { resolveContext } from '../src/generate/context/index.js';
import { deriveCompositionPlan, type PreserveWeights } from '../src/generate/plan/derive.js';
import type { CompositionPlan } from '../src/generate/plan/types.js';
import { assertCompositionPlan } from '../src/generate/plan/validate.js';
import { resolveKey } from '../src/theory/scale/index.js';
import {
  type ReferenceFixture,
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

function profileOf(fixture: ReferenceFixture): ReferenceProfile {
  return analyzeReference(fixture.notes, {
    meters: fixture.meters,
    key: fixture.key,
    melody: fixture.melody,
  });
}

const SOURCE = profileOf(SOURCE_SONG);
const UNRELATED = profileOf(UNRELATED_SONG);
const TRANSPOSED = profileOf(TRANSPOSED_SONG);
const SAME_STRUCTURE = profileOf(SAME_STRUCTURE_SONG);

const ALL_ZERO: Required<PreserveWeights> = {
  form: 0,
  phraseLengths: 0,
  harmonicFunction: 0,
  harmonicRhythm: 0,
  motifRelations: 0,
  registerShape: 0,
  rhythm: 0,
};

/** Every preserve weight at 1 except the one named. */
function onlyReplacing(aspect: keyof PreserveWeights, weight = 0): PreserveWeights {
  return { [aspect]: weight };
}

/** A deep copy of a profile, edited and re-validated as a reference. */
function edited(profile: ReferenceProfile, edit: (p: ReferenceProfile) => void): ReferenceProfile {
  const copy = structuredClone(profile);
  edit(copy);
  return assertReferenceProfile(copy);
}

/** The draw the plan's replacement rules read, at the same position. */
function planDraw(seed: number) {
  return resolveContext(seed).part('plan');
}

/** Candidate numerals for a replaced structural chord in a major key. */
const MAJOR_CANDIDATES: Record<string, string[]> = {
  tonic: ['I', 'vi', 'iii'],
  subdominant: ['IV', 'ii'],
  dominant: ['V', 'viio'],
};

const NEUTRAL_ONSET_LEVELS = [0, 1 / 15, 2 / 15, 3 / 15, 4 / 15, 5 / 15];

/** The motif graph node each plan statement was selected from, matched by span and note count. */
function nodesOf(reference: ReferenceProfile, plan: CompositionPlan): number[] {
  const { nodes } = reference.melody.graph;
  return plan.motifs.map((motif) => {
    const matches = nodes
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node }) =>
          node.startBeat === motif.startBeat &&
          node.endBeat === motif.endBeat &&
          (reference.melody.motifs[node.motif]?.intervals.length ?? -1) + 1 === motif.notes,
      );
    expect(matches).toHaveLength(1);
    return matches[0]?.index ?? -1;
  });
}

/**
 * The derivation a selected node should carry: the nearest selected ancestor,
 * with the edge's own relation when that ancestor is the parent, a composed
 * repetition or transposition when only those lie between, a variation when
 * the ancestor's motif has as many notes, and a root otherwise.
 */
function expectedDerivation(
  reference: ReferenceProfile,
  selected: readonly number[],
  node: number,
): { from: number | null; relation: MotifRelationSummary | null } {
  const { nodes, edges } = reference.melody.graph;
  const parent = (index: number) => edges.find((edge) => edge.to === index);
  const path: (MotifRelationSummary | null)[] = [];
  let edge = parent(node);
  while (edge !== undefined) {
    path.push(edge.relation);
    const at = selected.indexOf(edge.from);
    if (at >= 0) {
      if (path.length === 1) return { from: at, relation: edge.relation };
      const plain = path.every(
        (r) =>
          r !== null &&
          (r.kind === 'repetition' || (r.kind === 'transposition' && r.timeRatio === 1)),
      );
      if (plain) {
        const semitones = path.reduce((sum, r) => sum + (r?.semitones ?? 0), 0);
        const gap = (nodes[node]?.startBeat ?? 0) - (nodes[edge.from]?.endBeat ?? 0);
        return {
          from: at,
          relation: {
            kind: semitones === 0 ? 'repetition' : 'transposition',
            sequence: Math.abs(gap) <= 0.05,
            semitones,
            timeRatio: 1,
          },
        };
      }
      const size = (index: number) =>
        reference.melody.motifs[nodes[index]?.motif ?? -1]?.intervals.length;
      return size(edge.from) === size(node)
        ? { from: at, relation: null }
        : { from: null, relation: null };
    }
    edge = parent(edge.from);
  }
  return { from: null, relation: null };
}

describe('deriveCompositionPlan: determinism and serialization', () => {
  it('returns deep-equal plans for the same reference, seed and options', () => {
    const opts = { preserve: { form: 0.5, harmonicFunction: 0.3, motifRelations: 0.4 }, ctx: 11 };
    expect(deriveCompositionPlan(SOURCE, opts)).toEqual(deriveCompositionPlan(SOURCE, opts));
  });

  it('materializes the resolved seed and algorithm version', () => {
    const plan = deriveCompositionPlan(SOURCE, { ctx: { seed: 7 } });
    expect(plan.seed).toBe(7);
    expect(plan.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(deriveCompositionPlan(SOURCE).seed).toBe(0);
    expect(deriveCompositionPlan(SOURCE, { ctx: 3 }).seed).toBe(3);
  });

  it('can differ between seeds when preserve is below 1', () => {
    const preserve = {
      form: 0.5,
      phraseLengths: 0.5,
      harmonicFunction: 0.5,
      harmonicRhythm: 0.5,
      motifRelations: 0.5,
    };
    const base = deriveCompositionPlan(SOURCE, { preserve, ctx: 1 });
    const others = [2, 3, 4, 5].map((seed) =>
      deriveCompositionPlan(SOURCE, { preserve, ctx: seed }),
    );
    const differing = others.filter(
      (plan) => JSON.stringify({ ...plan, seed: 0 }) !== JSON.stringify({ ...base, seed: 0 }),
    );
    expect(differing.length).toBeGreaterThan(0);
  });

  it('survives a JSON round trip and passes assertCompositionPlan', () => {
    for (const reference of [SOURCE, UNRELATED, TRANSPOSED]) {
      for (const preserve of [undefined, ALL_ZERO, { harmonicRhythm: 0.5, registerShape: 0.3 }]) {
        const plan = deriveCompositionPlan(reference, { preserve, ctx: 5 });
        const restored = JSON.parse(JSON.stringify(plan)) as CompositionPlan;
        expect(restored).toEqual(plan);
        expect(() => assertCompositionPlan(restored)).not.toThrow();
      }
    }
  });
});

describe('deriveCompositionPlan: preserve all 1', () => {
  // A section boundary moves to the nearest reference phrase boundary; SOURCE's
  // already sit on one, UNRELATED's at beat 12 moves to its phrase boundary at 9.
  const cases = [
    {
      reference: SOURCE,
      sections: SOURCE.form.sections.map((s) => [s.label, s.startBeat, s.endBeat]),
      phrases: SOURCE.form.phrases.map((p) => [
        p.startBeat,
        p.endBeat,
        p.section,
        p.cadence?.type ?? null,
      ]),
      sources: SOURCE.form.phrases.map((_, index) => index),
    },
    {
      reference: UNRELATED,
      sections: [
        ['A', 0, 9],
        ['B', 9, 24],
      ],
      phrases: [
        [0, 9, 0, 'authentic'],
        [9, 24, 1, 'authentic'],
      ],
      sources: [0, 1],
    },
  ];
  for (const { reference, sections, phrases, sources } of cases) {
    it(`carries every structural item of the reference (${reference.meters[0]?.ts.numerator}/4)`, () => {
      const plan = deriveCompositionPlan(reference, { ctx: 9 });
      expect(plan.keys).toEqual(reference.harmony.keys.map((region) => region.key));
      expect(plan.meters).toEqual(reference.meters);
      expect(plan.span).toEqual(reference.span);
      expect(plan.sections.map((s) => [s.label, s.startBeat, s.endBeat])).toEqual(sections);
      expect(plan.phrases.map((p) => [p.startBeat, p.endBeat, p.section, p.cadence])).toEqual(
        phrases,
      );
      plan.phrases.forEach((phrase, index) => {
        const melody = reference.form.phrases[sources[index] ?? -1]?.melody;
        expect(melody).not.toBeNull();
        if (!melody) return;
        expect(phrase.shape).toBe(melody.shape);
        expect(phrase.peakPosition).toBe(melody.peakPosition);
        expect(phrase.register).toEqual({ low: melody.low, high: melody.high, mean: melody.mean });
        expect(phrase.onsetDensity).toBe(melody.onsetDensity);
      });
      expect(plan.harmony).toEqual(
        reference.harmony.chords.map((c) => ({
          startBeat: c.startBeat,
          endBeat: c.endBeat,
          key: c.key,
          roman: c.roman,
        })),
      );
      // Which graph nodes become statements is covered under motif selection.
      expect(plan.motifs.length).toBeGreaterThan(0);
      expect(plan.rhythm).toEqual({
        onsetLevels: reference.melody.rhythm.onsetLevels,
        interOnsetShares: reference.melody.rhythm.interOnsetShares,
        syncopation: reference.melody.rhythm.syncopation,
      });
    });
  }

  it('gives every statement the note count of its own motif', () => {
    const plan = deriveCompositionPlan(SOURCE);
    const nodes = nodesOf(SOURCE, plan);
    plan.motifs.forEach((motif, index) => {
      const cell = SOURCE.melody.motifs[SOURCE.melody.graph.nodes[nodes[index] ?? -1]?.motif ?? -1];
      expect(motif.notes).toBe((cell?.intervals.length ?? Number.NaN) + 1);
    });
  });
});

describe('deriveCompositionPlan: preserve all 0', () => {
  const seed = 4;
  const plan = deriveCompositionPlan(SOURCE, { preserve: ALL_ZERO, ctx: seed });
  const draw = planDraw(seed);

  it('gives every section its neighbour label', () => {
    expect(plan.sections.map((s) => s.label)).toEqual(['B', 'A', 'B']);
    expect(plan.sections.map((s) => [s.startBeat, s.endBeat])).toEqual([
      [0, 64],
      [64, 96],
      [96, 128],
    ]);
  });

  it('keeps 8-bar phrases, which are already powers of two', () => {
    expect(plan.phrases.map((p) => [p.startBeat, p.endBeat, p.section, p.cadence])).toEqual([
      [0, 32, 0, 'authentic'],
      [32, 64, 0, 'authentic'],
      [64, 96, 1, 'half'],
      [96, 128, 2, 'authentic'],
    ]);
  });

  it('uses the neutral contour, peak and register', () => {
    for (const phrase of plan.phrases) {
      expect(phrase.shape).toBe('arch');
      expect(phrase.peakPosition).toBeCloseTo(0.6, 12);
      expect(phrase.register).toEqual({ low: 53, high: 79, mean: 66 });
    }
  });

  it('draws every structural numeral from its function candidates', () => {
    expect(plan.harmony).toHaveLength(SOURCE.harmony.chords.length);
    SOURCE.harmony.chords.forEach((chord, index) => {
      const candidates = MAJOR_CANDIDATES[chord.function] ?? [];
      const pick = draw.range(0, candidates.length - 1, 'harmonicFunction', index, 'pick');
      expect(plan.harmony[index]).toEqual({
        startBeat: chord.startBeat,
        endBeat: chord.endBeat,
        key: chord.key,
        roman: candidates[pick],
      });
    });
  });

  it('turns every derivation into a variation of the same source', () => {
    const kept = deriveCompositionPlan(SOURCE, { ctx: seed });
    plan.motifs.forEach((motif, index) => {
      expect(motif.from).toBe(kept.motifs[index]?.from);
      expect(motif.relation).toBeNull();
    });
  });

  it('uses the neutral rhythm and keeps the reference IOI shares', () => {
    plan.rhythm.onsetLevels.forEach((share, index) => {
      expect(share).toBeCloseTo(NEUTRAL_ONSET_LEVELS[index] ?? Number.NaN, 12);
    });
    expect(plan.rhythm.interOnsetShares).toEqual(SOURCE.melody.rhythm.interOnsetShares);
    expect(plan.rhythm.syncopation).toBe(0);
  });

  it('moves every harmonic change to its bar start without splitting held chords', () => {
    const neutral = deriveCompositionPlan(UNRELATED, { preserve: ALL_ZERO, ctx: seed });
    expect(neutral.harmony.map((c) => [c.startBeat, c.endBeat])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 15],
      [15, 18],
      [18, 21],
      [21, 24],
    ]);
  });
});

describe('deriveCompositionPlan: discrete replacement rules', () => {
  const kept = deriveCompositionPlan(SOURCE, { ctx: 2 });

  it('form: a replaced section takes the next label, the last the previous one', () => {
    const plan = deriveCompositionPlan(SOURCE, { preserve: onlyReplacing('form'), ctx: 2 });
    expect(plan.sections.map((s) => s.label)).toEqual(['B', 'A', 'B']);
    expect({ ...plan, sections: kept.sections }).toEqual(kept);
  });

  it('form: a single section has no neighbour and keeps its label', () => {
    const single = edited(SOURCE, (p) => {
      p.form.sections = [{ ...(p.form.sections[0] as (typeof p.form.sections)[0]), endBeat: 128 }];
      for (const phrase of p.form.phrases) phrase.section = 0;
    });
    const plan = deriveCompositionPlan(single, { preserve: onlyReplacing('form') });
    expect(plan.sections.map((s) => s.label)).toEqual(['A']);
  });

  it('phraseLengths: rounds to a power of two, halves an overflow and clips at the section end', () => {
    const irregular = edited(SOURCE, (p) => {
      const [first, second] = p.form.phrases;
      if (!first || !second) throw new Error('fixture has two opening phrases');
      first.endBeat = 12;
      first.bars = 3;
      first.cadence = null;
      second.startBeat = 12;
      second.bars = 13;
    });
    const preservedPlan = deriveCompositionPlan(irregular);
    expect(preservedPlan.phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 12],
      [12, 64],
      [64, 96],
      [96, 128],
    ]);
    const plan = deriveCompositionPlan(irregular, { preserve: onlyReplacing('phraseLengths') });
    expect(plan.phrases.map((p) => [p.startBeat, p.endBeat, p.section, p.cadence])).toEqual([
      [0, 16, 0, null],
      [16, 48, 0, null],
      [48, 64, 0, 'authentic'],
      [64, 96, 1, 'half'],
      [96, 128, 2, 'authentic'],
    ]);
    // Both halves of a split phrase carry the phrase they came from.
    expect(plan.phrases[1]?.register).toEqual(plan.phrases[2]?.register);
    expect(plan.phrases[1]?.shape).toBe(plan.phrases[2]?.shape);
    plan.motifs.forEach((motif, index) => {
      const phrase = plan.phrases[motif.phrase];
      expect(motif.startBeat).toBeGreaterThanOrEqual(phrase?.startBeat ?? Number.NaN);
      expect(motif.startBeat).toBeLessThan(phrase?.endBeat ?? Number.NaN);
      expect(phrase?.motifs).toContain(index);
    });
    expect(plan.phrases.flatMap((p) => p.motifs)).toEqual(plan.motifs.map((_, index) => index));
  });

  it('phraseLengths: lays rounded lengths inside each section moved onto a phrase boundary', () => {
    const plan = deriveCompositionPlan(UNRELATED, { preserve: onlyReplacing('phraseLengths') });
    // Sections [0, 9) and [9, 24). The 3-bar phrase rounds to 4 bars, overflows
    // its section and halves, the second half cut at 9; the 5-bar phrase rounds
    // to 4 bars and the last phrase runs to its section's end.
    expect(plan.phrases.map((p) => [p.startBeat, p.endBeat, p.section, p.cadence])).toEqual([
      [0, 6, 0, null],
      [6, 9, 0, 'authentic'],
      [9, 24, 1, 'authentic'],
    ]);
  });

  it('moves each section boundary to the nearest phrase boundary, the earlier on a tie', () => {
    const shifted = edited(SOURCE, (p) => {
      const [a, b, c] = p.form.sections;
      if (!a || !b || !c) throw new Error('fixture has three sections');
      a.endBeat = 50;
      b.startBeat = 50;
      b.endBeat = 80;
      c.startBeat = 80;
    });
    const plan = deriveCompositionPlan(shifted);
    // 50 is nearer 64 than 32; 80 is as near 64 as 96 and takes 64, which
    // leaves the middle section with no length.
    expect(plan.sections.map((s) => [s.label, s.startBeat, s.endBeat])).toEqual([
      ['A', 0, 64],
      ['A', 64, 128],
    ]);
    expect(plan.phrases.map((p) => [p.startBeat, p.endBeat, p.section])).toEqual([
      [0, 32, 0],
      [32, 64, 0],
      [64, 96, 1],
      [96, 128, 1],
    ]);
  });

  it('harmonicFunction: replaces structural numerals only, by the positional pick', () => {
    const withPassing = edited(SOURCE, (p) => {
      const chord = p.harmony.chords[1];
      if (!chord) throw new Error('fixture has a second chord');
      chord.level = 'passing';
    });
    const seed = 6;
    const plan = deriveCompositionPlan(withPassing, {
      preserve: onlyReplacing('harmonicFunction'),
      ctx: seed,
    });
    const draw = planDraw(seed);
    withPassing.harmony.chords.forEach((chord, index) => {
      if (chord.level !== 'structural') {
        expect(plan.harmony[index]?.roman).toBe(chord.roman);
        return;
      }
      const candidates = MAJOR_CANDIDATES[chord.function] ?? [];
      const pick = draw.range(0, candidates.length - 1, 'harmonicFunction', index, 'pick');
      expect(plan.harmony[index]?.roman).toBe(candidates[pick]);
    });
    expect(plan.harmony[1]?.roman).toBe('V6');
  });

  it('harmonicFunction: keeps a chord whose draw passes at an intermediate weight', () => {
    const seed = 8;
    const p = 0.5;
    const plan = deriveCompositionPlan(SOURCE, {
      preserve: onlyReplacing('harmonicFunction', p),
      ctx: seed,
    });
    const draw = planDraw(seed);
    SOURCE.harmony.chords.forEach((chord, index) => {
      if (draw.prob(p, 'harmonicFunction', index)) {
        expect(plan.harmony[index]?.roman).toBe(chord.roman);
      } else {
        const candidates = MAJOR_CANDIDATES[chord.function] ?? [];
        const pick = draw.range(0, candidates.length - 1, 'harmonicFunction', index, 'pick');
        expect(plan.harmony[index]?.roman).toBe(candidates[pick]);
      }
    });
  });

  it('motifRelations: a replaced derivation becomes a variation and keeps its source', () => {
    const seed = 3;
    const p = 0.5;
    const plan = deriveCompositionPlan(SOURCE, {
      preserve: onlyReplacing('motifRelations', p),
      ctx: seed,
    });
    const draw = planDraw(seed);
    plan.motifs.forEach((motif, index) => {
      const original = kept.motifs[index];
      expect(motif.from).toBe(original?.from);
      if (original?.from === null) {
        expect(motif.relation).toBeNull();
      } else if (draw.prob(p, 'motifRelations', index)) {
        expect(motif.relation).toEqual(original?.relation);
      } else {
        expect(motif.relation).toBeNull();
      }
    });
    expect({ ...plan, motifs: kept.motifs, seed: 2 }).toEqual(kept);
  });
});

describe('deriveCompositionPlan: motif selection', () => {
  const references = [
    ['source', SOURCE],
    ['same structure', SAME_STRUCTURE],
    ['transposed', TRANSPOSED],
    ['unrelated', UNRELATED],
  ] as const;
  for (const [name, reference] of references) {
    it(`selects non-overlapping statements inside one phrase each (${name})`, () => {
      const plan = deriveCompositionPlan(reference, { ctx: 1 });
      const nodes = nodesOf(reference, plan);
      expect(plan.motifs.length).toBeGreaterThan(0);
      plan.motifs.forEach((motif, index) => {
        const phrase = plan.phrases[motif.phrase];
        expect(motif.startBeat).toBeGreaterThanOrEqual(phrase?.startBeat ?? Number.NaN);
        expect(motif.endBeat).toBeLessThanOrEqual(phrase?.endBeat ?? Number.NaN);
        const next = plan.motifs[index + 1];
        if (next) expect(next.startBeat).toBeGreaterThanOrEqual(motif.endBeat);
        const derivation = expectedDerivation(reference, nodes, nodes[index] ?? -1);
        expect({ from: motif.from, relation: motif.relation }, `motif ${index}`).toEqual(
          derivation,
        );
        if (motif.from !== null) expect(motif.from).toBeLessThan(index);
      });
      plan.phrases.forEach((phrase, index) => {
        expect(phrase.motifs).toEqual(
          plan.motifs.flatMap((motif, at) => (motif.phrase === index ? [at] : [])),
        );
      });
    });
  }

  it('covers SOURCE with the hook statements derived from earlier ones', () => {
    const plan = deriveCompositionPlan(SOURCE, { ctx: 1 });
    // Each A unit is covered by two eight-note cells around the four-note hook
    // at bar five and one more cell; the bridge by its three- and four-note
    // figures. The hook at bar five of the first unit is a root: its only
    // ancestor, the hook at beat 0, lies inside the selected cell 0-8.
    const summary = plan.motifs.map((m) => [
      m.startBeat,
      m.endBeat,
      m.notes,
      m.from,
      m.relation?.kind ?? null,
      m.relation?.semitones ?? null,
    ]);
    expect(summary).toEqual([
      [0, 8, 8, null, null, null],
      [8, 16, 8, 0, null, null],
      [16, 20, 4, null, null, null],
      [20, 28, 8, 0, null, null],
      [32, 40, 8, 0, null, null],
      [40, 48, 8, 1, 'repetition', 0],
      // Hook down a fourth, through the unselected hook at beat 32.
      [48, 52, 4, 2, 'transposition', -5],
      [52, 60, 8, 3, 'repetition', 0],
      // The bridge inverts the transposed hook around its top note.
      [64, 68, 4, 6, 'inversion', 5],
      [69, 73, 4, 8, null, null],
      [73, 76, 3, null, null, null],
      [76, 79, 3, null, null, null],
      [80, 84, 4, 8, 'repetition', 0],
      [85, 89, 4, 9, 'transposition', -2],
      [90, 96, 3, null, null, null],
      [96, 104, 8, 0, 'repetition', 0],
      [104, 112, 8, 5, 'repetition', 0],
      [112, 116, 4, 6, 'transposition', 5],
      [116, 124, 8, 7, 'repetition', 0],
    ]);
    expect(plan.motifs.every((m) => m.relation?.sequence !== true)).toBe(true);
    expect(plan.phrases.map((p) => p.motifs)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14],
      [15, 16, 17, 18],
    ]);
  });

  it('keeps no statement that crosses a phrase boundary', () => {
    // UNRELATED's second statement (beats 9-15) lies inside its second phrase.
    const plan = deriveCompositionPlan(UNRELATED, { ctx: 1 });
    expect(plan.motifs.map((m) => [m.startBeat, m.endBeat, m.phrase, m.from])).toEqual([
      [0, 5, 0, null],
      [9, 15, 1, 0],
    ]);
    const cut = deriveCompositionPlan(UNRELATED, { preserve: onlyReplacing('phraseLengths') });
    // With the first phrase halved at beat 6, the statement at 0-5 still fits.
    expect(cut.motifs.map((m) => [m.startBeat, m.endBeat, m.phrase])).toEqual([
      [0, 5, 0],
      [9, 15, 2],
    ]);
  });

  it('refuses a containment check over the budget', () => {
    const node = SOURCE.melody.graph.nodes[0];
    const crowded = edited(SOURCE, (p) => {
      p.melody.graph.edges = [];
      p.melody.graph.nodes = Array.from({ length: 250_001 }, () => ({ ...(node as never) }));
    });
    expect(() => deriveCompositionPlan(crowded)).toThrow(BudgetExceededError);
    expect(() => deriveCompositionPlan(crowded)).toThrow(/plan motif selection/);
  });
});

describe('deriveCompositionPlan: phrase tiling', () => {
  const references = [
    ['source', SOURCE],
    ['same structure', SAME_STRUCTURE],
    ['transposed', TRANSPOSED],
    ['unrelated', UNRELATED],
  ] as const;
  for (const [name, reference] of references) {
    for (const weight of [0, 0.5, 1]) {
      for (const seed of [1, 2, 3]) {
        it(`tiles the span and opens every section (${name}, phraseLengths ${weight}, seed ${seed})`, () => {
          const plan = deriveCompositionPlan(reference, {
            preserve: onlyReplacing('phraseLengths', weight),
            ctx: seed,
          });
          const { phrases, sections, motifs, span } = plan;
          expect(phrases.length).toBeGreaterThan(0);
          expect(phrases[0]?.startBeat).toBe(span.startBeat);
          expect(phrases.at(-1)?.endBeat).toBe(span.endBeat);
          phrases.forEach((phrase, index) => {
            expect(phrase.endBeat).toBeGreaterThan(phrase.startBeat);
            if (index > 0) expect(phrase.startBeat).toBe(phrases[index - 1]?.endBeat);
          });
          for (const section of sections) {
            const opened = phrases.some(
              (p) => p.startBeat >= section.startBeat && p.startBeat < section.endBeat,
            );
            expect(opened, `section at ${section.startBeat}`).toBe(true);
          }
          for (const motif of motifs) {
            const phrase = phrases[motif.phrase];
            expect(motif.startBeat).toBeGreaterThanOrEqual(phrase?.startBeat ?? Number.NaN);
            expect(motif.startBeat).toBeLessThan(phrase?.endBeat ?? Number.NaN);
          }
          expect(phrases.flatMap((p) => p.motifs)).toEqual(motifs.map((_, index) => index));
          expect(() => assertCompositionPlan(JSON.parse(JSON.stringify(plan)))).not.toThrow();
        });
      }
    }
  }
});

describe('deriveCompositionPlan: continuous items', () => {
  it('registerShape: interpolates peak and register, switching shape at 0.5', () => {
    const quarter = deriveCompositionPlan(SOURCE, {
      preserve: onlyReplacing('registerShape', 0.25),
    });
    const half = deriveCompositionPlan(SOURCE, { preserve: onlyReplacing('registerShape', 0.5) });
    SOURCE.form.phrases.forEach((phrase, index) => {
      const melody = phrase.melody;
      if (!melody) throw new Error('fixture phrases carry melody');
      const q = quarter.phrases[index];
      expect(q?.shape).toBe('arch');
      expect(q?.peakPosition).toBeCloseTo(0.25 * melody.peakPosition + 0.75 * 0.6, 12);
      expect(q?.register.low).toBe(Math.round(0.25 * melody.low + 0.75 * 53));
      expect(q?.register.high).toBe(Math.round(0.25 * melody.high + 0.75 * 79));
      expect(q?.register.mean).toBeCloseTo(0.25 * melody.mean + 0.75 * 66, 12);
      expect(half.phrases[index]?.shape).toBe(melody.shape);
    });
  });

  it('register option: maps the reference range linearly onto the requested one', () => {
    const plan = deriveCompositionPlan(SOURCE, { register: { low: 60, high: 86 } });
    SOURCE.form.phrases.forEach((phrase, index) => {
      const melody = phrase.melody;
      if (!melody) throw new Error('fixture phrases carry melody');
      expect(plan.phrases[index]?.register).toEqual({
        low: melody.low + 7,
        high: melody.high + 7,
        mean: melody.mean + 7,
      });
    });
    const neutral = deriveCompositionPlan(SOURCE, {
      register: { low: 60, high: 72 },
      preserve: onlyReplacing('registerShape'),
    });
    for (const phrase of neutral.phrases) {
      expect(phrase.register).toEqual({ low: 60, high: 72, mean: 66 });
    }
  });

  it('rhythm: interpolates the level distribution and syncopation', () => {
    const plan = deriveCompositionPlan(UNRELATED, { preserve: onlyReplacing('rhythm', 0.5) });
    const reference = UNRELATED.melody.rhythm;
    plan.rhythm.onsetLevels.forEach((share, index) => {
      expect(share).toBeCloseTo(
        0.5 * (reference.onsetLevels[index] ?? 0) + 0.5 * (NEUTRAL_ONSET_LEVELS[index] ?? 0),
        12,
      );
    });
    expect(plan.rhythm.syncopation).toBeCloseTo(0.5 * reference.syncopation, 12);
    expect(plan.rhythm.interOnsetShares).toEqual(reference.interOnsetShares);
  });

  it('harmonicRhythm: every change either stays or moves to its bar start', () => {
    const seed = 12;
    const p = 0.5;
    const plan = deriveCompositionPlan(UNRELATED, {
      preserve: onlyReplacing('harmonicRhythm', p),
      ctx: seed,
    });
    const draw = planDraw(seed);
    const kept = UNRELATED.harmony.chords
      .slice(1)
      .filter((_, offset) => draw.prob(p, 'harmonicRhythm', offset + 1))
      .map((chord) => chord.startBeat);
    const starts = plan.harmony.map((c) => c.startBeat);
    for (const beat of kept) {
      expect(starts).toContain(beat);
    }
    for (const beat of starts) {
      const isReference = UNRELATED.harmony.chords.some((c) => c.startBeat === beat);
      expect(isReference || beat % 3 === 0).toBe(true);
    }
    expect(plan.harmony[0]?.startBeat).toBe(0);
    expect(plan.harmony.at(-1)?.endBeat).toBe(24);
    for (let i = 1; i < plan.harmony.length; i += 1) {
      expect(plan.harmony[i]?.startBeat).toBe(plan.harmony[i - 1]?.endBeat);
    }
  });
});

describe('deriveCompositionPlan: key change', () => {
  it('moves every key by the tonic shift and the register by the nearest shift', () => {
    expect(deriveCompositionPlan(SOURCE, { key: 'F major' })).toEqual(
      deriveCompositionPlan(TRANSPOSED),
    );
    const plan = deriveCompositionPlan(SOURCE, { key: 'G major' });
    expect(plan.keys).toEqual([resolveKey('G major')]);
    expect(plan.phrases[0]?.register).toEqual({ low: 67, high: 74, mean: 74.96875 - 5 });
    expect(plan.harmony).toEqual(deriveCompositionPlan(SOURCE).harmony);
  });

  it('keeps each key region its own variant', () => {
    const modulating = edited(SOURCE, (p) => {
      const home = p.harmony.keys[0];
      if (!home) throw new Error('fixture has a key');
      home.endBeat = 64;
      p.harmony.keys.push({
        startBeat: 64,
        endBeat: 96,
        key: resolveKey('A minor'),
        confidence: 1,
      });
      p.harmony.keys.push({
        startBeat: 96,
        endBeat: 128,
        key: resolveKey('C major'),
        confidence: 1,
      });
      for (const chord of p.harmony.chords) {
        if (chord.startBeat >= 64 && chord.startBeat < 96) {
          chord.key = 1;
          chord.roman = 'i';
          chord.function = 'tonic';
        } else if (chord.startBeat >= 96) {
          chord.key = 2;
        }
      }
    });
    const plan = deriveCompositionPlan(modulating, { key: 'D major' });
    expect(plan.keys).toEqual([
      resolveKey('D major'),
      resolveKey('B minor'),
      resolveKey('D major'),
    ]);
    expect(plan.harmony.map((c) => c.key)).toEqual(modulating.harmony.chords.map((c) => c.key));
  });

  it('keeps a modal home key modal', () => {
    const dorian = analyzeReference(SOURCE_SONG.notes, {
      meters: SOURCE_SONG.meters,
      key: 'D dorian',
      melody: SOURCE_SONG.melody,
    });
    const plan = deriveCompositionPlan(dorian, { key: 'E dorian' });
    expect(plan.keys[0]).toEqual(resolveKey('E dorian'));
    expect(plan.keys[0]?.scale.modeMask12).toBe(dorian.harmony.keys[0]?.key.scale.modeMask12);
    expect(() => assertCompositionPlan(JSON.parse(JSON.stringify(plan)))).not.toThrow();
    expect(() => deriveCompositionPlan(dorian, { key: 'E phrygian' })).toThrow(InvalidInputError);
  });

  it('rejects a key whose mode differs from the reference home key', () => {
    expect(() => deriveCompositionPlan(SOURCE, { key: 'C minor' })).toThrow(InvalidInputError);
    expect(() => deriveCompositionPlan(SOURCE, { key: 'A dorian' })).toThrow(InvalidInputError);
  });
});

describe('deriveCompositionPlan: rejection', () => {
  it('rejects a caller-supplied positional source', () => {
    expect(() => deriveCompositionPlan(SOURCE, { ctx: { rng: createPositionalRng(1) } })).toThrow(
      InvalidInputError,
    );
  });

  it('rejects invalid options', () => {
    const bad: unknown[] = [
      null,
      5,
      { preserve: null },
      { preserve: { form: 1.5 } },
      { preserve: { rhythm: -0.1 } },
      { preserve: { motifRelations: Number.NaN } },
      { preserve: { harmonicRhythm: '1' } },
      { register: { low: 80, high: 60 } },
      { register: { low: 60, high: 200 } },
      { register: { low: 60.5, high: 72 } },
      { register: { low: 60 } },
      { key: 'not a key' },
      { ctx: { seed: -1 } },
      { ctx: null },
    ];
    for (const opts of bad) {
      expect(() => deriveCompositionPlan(SOURCE, opts as never), JSON.stringify(opts)).toThrow(
        InvalidInputError,
      );
    }
  });

  it('rejects an invalid reference', () => {
    expect(() => deriveCompositionPlan({} as never)).toThrow(InvalidInputError);
    expect(() => deriveCompositionPlan(null as never)).toThrow(InvalidInputError);
    expect(() => deriveCompositionPlan({ ...SOURCE, profileVersion: 99 })).toThrow(
      InvalidInputError,
    );
  });

  it('rejects a reference with no melody onsets', () => {
    const silent = analyzeReference(SOURCE_SONG.notes, {
      meters: SOURCE_SONG.meters,
      key: SOURCE_SONG.key,
      melody: [],
    });
    expect(silent.melody.rhythm.onsets).toBe(0);
    expect(() => deriveCompositionPlan(silent)).toThrow(InvalidInputError);
  });
});

describe('deriveCompositionPlan: the melodic surface is not carried', () => {
  it('holds no reference motif intervals and no outline', () => {
    const plan = deriveCompositionPlan(SOURCE, { preserve: { registerShape: 0.7 } });
    expect(Object.keys(plan).sort()).toEqual(
      [
        'algorithmVersion',
        'harmony',
        'keys',
        'meters',
        'motifs',
        'phrases',
        'planVersion',
        'rhythm',
        'sections',
        'seed',
        'span',
      ].sort(),
    );
    for (const motif of plan.motifs) {
      expect(Object.keys(motif).sort()).toEqual(
        ['endBeat', 'from', 'notes', 'phrase', 'relation', 'startBeat'].sort(),
      );
    }
    const text = JSON.stringify(plan);
    expect(text).not.toContain('"intervals"');
    expect(text).not.toContain('"outline"');
    const cells = SOURCE.melody.motifs.map((m) => JSON.stringify(m.intervals));
    const arrays: string[] = [];
    const walk = (value: unknown, key: string): void => {
      if (Array.isArray(value)) {
        if (key !== 'motifs') arrays.push(JSON.stringify(value));
        for (const item of value) walk(item, key);
      } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, k);
      }
    };
    walk(plan, '');
    for (const array of arrays) {
      expect(cells).not.toContain(array);
    }
  });
});
