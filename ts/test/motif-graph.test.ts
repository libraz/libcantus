import { describe, expect, it } from 'vitest';
import type { MotifGraph } from '../src/analyze/melody/graph.js';
import { motifGraph } from '../src/analyze/melody/graph.js';
import type { MotifData } from '../src/analyze/melody/index.js';
import { extractMotifs, motifFromNotes } from '../src/analyze/melody/index.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** A line of even notes: one pitch per beat from `startBeat`. */
function line(startBeat: number, pitches: number[], step = 1): NoteEvent[] {
  return pitches.map((pitch, i) => ({
    pitch,
    startBeat: startBeat + i * step,
    durationBeat: step,
  }));
}

/**
 * A single-occurrence motif addressed into `fullLine`, for tests that hand
 * `motifGraph` their own hand-picked statements rather than an
 * `extractMotifs` grouping. `fullLine` must already carry the statement at
 * `startBeat` — built by concatenating `line(...)` calls in time order, as
 * every fixture below does.
 */
function motifAt(
  fullLine: readonly NoteEvent[],
  startBeat: number,
  pitches: number[],
  step = 1,
): MotifData {
  const data = motifFromNotes(line(startBeat, pitches, step));
  const noteIndex = fullLine.findIndex((note) => note.startBeat === startBeat);
  return { ...data, occurrences: data.occurrences.map((o) => ({ ...o, noteIndex })) };
}

/** Kinds the depth rule reads as not changing pitch level. */
const SAME_DEPTH_KINDS = new Set(['repetition', 'augmentation', 'diminution']);

/**
 * Derivation depth of every node, read off `graph.edges` by the rule: a root
 * is 0, a repetition/augmentation/diminution edge keeps its parent's depth,
 * and any other edge — a named pitch-changing transform or an unnamed
 * variation — adds one. Edges only ever point from an earlier node to a later
 * one, so a single ascending pass resolves every parent before its children.
 */
function depths(graph: MotifGraph): number[] {
  const parent = new Map(graph.edges.map((edge) => [edge.to, edge]));
  const out = new Array(graph.nodes.length).fill(0);
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const edge = parent.get(i);
    if (edge === undefined) {
      continue;
    }
    const sameDepth = edge.relation !== null && SAME_DEPTH_KINDS.has(edge.relation.kind);
    out[i] = sameDepth ? out[edge.from] : out[edge.from] + 1;
  }
  return out;
}

describe('nodes', () => {
  it('lists every occurrence of every motif, ordered by startBeat then motif index', () => {
    const melody = [...line(0, [60, 62, 67]), ...line(4, [60, 62, 67])];
    const graph = motifGraph(melody, extractMotifs(melody));
    expect(graph.nodes).toEqual([
      { motif: 0, occurrence: 0, startBeat: 0, endBeat: 3 },
      { motif: 0, occurrence: 1, startBeat: 4, endBeat: 7 },
    ]);
  });

  it('breaks a startBeat tie between two motifs by motif index', () => {
    const full = [...line(0, [60, 62, 67]), ...line(4, [65, 67, 72])];
    // Two distinct motif entries whose first statement addresses the same
    // notes at beat 0: motif 1's node must still sort after motif 0's.
    const duplicateA = motifAt(full, 0, [60, 62, 67]);
    const duplicateB = motifAt(full, 0, [60, 62, 67]);
    const answer = motifAt(full, 4, [65, 67, 72]);
    const graph = motifGraph(full, [duplicateA, duplicateB, answer]);
    expect(graph.nodes[0]).toMatchObject({ motif: 0, startBeat: 0 });
    expect(graph.nodes[1]).toMatchObject({ motif: 1, startBeat: 0 });
    expect(graph.nodes[2]).toMatchObject({ motif: 2, startBeat: 4 });
  });
});

describe('parent selection', () => {
  it('draws an edge for a transposition, then an inversion of the closer statement', () => {
    // A, a real transposition of it, then an inversion of that shape. Both A
    // and its transposition read as inversions of the third statement, at
    // identical similarity, so the temporally closer one wins.
    const melody = [...line(0, [60, 62, 67]), ...line(4, [65, 67, 72]), ...line(8, [60, 58, 53])];
    const motifs = [
      motifAt(melody, 0, [60, 62, 67]),
      motifAt(melody, 4, [65, 67, 72]),
      motifAt(melody, 8, [60, 58, 53]),
    ];
    const graph = motifGraph(melody, motifs);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: 0, to: 1, relation: { kind: 'transposition' } });
    expect(graph.edges[1]).toMatchObject({ from: 1, to: 2, relation: { kind: 'inversion' } });
  });

  it('prefers the closer statement when relation and similarity both tie', () => {
    // The same pitches held at three different note-value scales: the
    // diminished statement reads equally against both earlier ones, and the
    // augmented one is the nearer of the two.
    const melody = [
      ...line(0, [60, 62, 67]),
      ...line(4, [60, 62, 67], 2),
      ...line(10, [60, 62, 67], 0.5),
    ];
    const motifs = [
      motifAt(melody, 0, [60, 62, 67]),
      motifAt(melody, 4, [60, 62, 67], 2),
      motifAt(melody, 10, [60, 62, 67], 0.5),
    ];
    const graph = motifGraph(melody, motifs);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: 0, to: 1, relation: { kind: 'augmentation' } });
    expect(graph.edges[1]).toMatchObject({ from: 1, to: 2, relation: { kind: 'diminution' } });
  });

  it('breaks an exact tie between two otherwise identical candidates by node index', () => {
    const full = [...line(0, [60, 62, 67]), ...line(4, [65, 67, 72])];
    // Two entries in `motifs` addressing the exact same statement: whichever
    // was placed first must win the parent slot.
    const first = motifAt(full, 0, [60, 62, 67]);
    const second = motifAt(full, 0, [60, 62, 67]);
    const answer = motifAt(full, 4, [65, 67, 72]);
    const graph = motifGraph(full, [first, second, answer]);
    // `second` is itself an exact repetition of `first`, addressed at the
    // same beat; the tie under test is which of the two answers to.
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: 0, to: 1, relation: { kind: 'repetition' } });
    expect(graph.edges[1]).toMatchObject({ from: 0, to: 2, relation: { kind: 'transposition' } });
  });
});

describe('variation below and above the threshold', () => {
  const original = line(0, [60, 62, 64, 65]);
  const nearVariant = line(6, [60, 62, 64, 67]);
  const unrelated = line(12, [72, 59, 70, 61]);
  const melody = [...original, ...nearVariant, ...unrelated];
  const motifs = [
    motifAt(melody, 0, [60, 62, 64, 65]),
    motifAt(melody, 6, [60, 62, 64, 67]),
    motifAt(melody, 12, [72, 59, 70, 61]),
  ];

  it('draws an unnamed edge above the default threshold and none below it', () => {
    const graph = motifGraph(melody, motifs);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 0, to: 1, relation: null });
    expect(graph.edges[0]?.similarity).toBeGreaterThanOrEqual(0.75);
    // The unrelated statement is left a root: neither candidate is named and
    // neither clears the threshold.
    expect(graph.edges.some((edge) => edge.to === 2)).toBe(false);
  });

  it('draws the low-similarity pair once the threshold is lowered under it', () => {
    const graph = motifGraph(melody, motifs, { variationThreshold: 0.2 });
    expect(graph.edges.some((edge) => edge.to === 2)).toBe(true);
  });

  it('rejects a threshold outside [0, 1]', () => {
    expect(() => motifGraph(melody, motifs, { variationThreshold: 1.5 })).toThrow(
      InvalidInputError,
    );
    expect(() => motifGraph(melody, motifs, { variationThreshold: -0.1 })).toThrow(
      /variationThreshold/,
    );
  });
});

describe('key context', () => {
  it('names a tonal transposition only when a key is given', () => {
    const subject = line(0, [60, 62, 64]);
    const tonalAnswer = line(4, [62, 64, 65]);
    const melody = [...subject, ...tonalAnswer];
    const motifs = [motifAt(melody, 0, [60, 62, 64]), motifAt(melody, 4, [62, 64, 65])];

    const withoutKey = motifGraph(melody, motifs);
    expect(withoutKey.edges[0]).toMatchObject({ relation: null });

    const withKey = motifGraph(melody, motifs, { key: cMajor });
    expect(withKey.edges[0]).toMatchObject({ relation: { kind: 'tonalTransposition' } });
  });
});

describe('derivation depth', () => {
  it('keeps augmentation and diminution at the same depth as their parent', () => {
    const melody = [
      ...line(0, [60, 64, 65]),
      ...line(4, [60, 64, 65], 2),
      ...line(10, [60, 64, 65], 0.5),
    ];
    const motifs = [
      motifAt(melody, 0, [60, 64, 65]),
      motifAt(melody, 4, [60, 64, 65], 2),
      motifAt(melody, 10, [60, 64, 65], 0.5),
    ];
    const graph = motifGraph(melody, motifs);
    expect(depths(graph)).toEqual([0, 0, 0]);
  });

  it('raises the depth by one at every transposition or inversion', () => {
    const melody = [...line(0, [60, 62, 67]), ...line(4, [65, 67, 72]), ...line(8, [60, 58, 53])];
    const motifs = [
      motifAt(melody, 0, [60, 62, 67]),
      motifAt(melody, 4, [65, 67, 72]),
      motifAt(melody, 8, [60, 58, 53]),
    ];
    const graph = motifGraph(melody, motifs);
    expect(depths(graph)).toEqual([0, 1, 2]);
  });

  it('keeps a repetition at its parent depth before a later transposition raises it', () => {
    // extractMotifs finds one motif here — repetition preserves the identity
    // that groups statements — stated at beat 0, repeated at beat 4, then
    // transposed at beat 8.
    const melody = [...line(0, [60, 62, 67]), ...line(4, [60, 62, 67]), ...line(8, [65, 67, 72])];
    const graph = motifGraph(melody, extractMotifs(melody));
    expect(graph.edges[0]).toMatchObject({ from: 0, to: 1, relation: { kind: 'repetition' } });
    // The transposition reads equally against both earlier statements; the
    // repeated one, being closer, is the parent.
    expect(graph.edges[1]).toMatchObject({ from: 1, to: 2, relation: { kind: 'transposition' } });
    expect(depths(graph)).toEqual([0, 0, 1]);
  });
});

describe('validation', () => {
  const melody = [...line(0, [60, 62, 67]), ...line(4, [60, 62, 67])];
  const motifs = extractMotifs(melody);

  it('rejects an occurrence whose startBeat does not match the line', () => {
    const corrupted = motifs.map((m) => ({
      ...m,
      occurrences: m.occurrences.map((o) => ({ ...o, startBeat: o.startBeat + 100 })),
    }));
    expect(() => motifGraph(melody, corrupted)).toThrow(InvalidInputError);
    expect(() => motifGraph(melody, corrupted)).toThrow(/does not lie on the line/);
  });

  it('rejects an occurrence whose noteIndex runs past the line', () => {
    const corrupted = motifs.map((m) => ({
      ...m,
      occurrences: m.occurrences.map((o) => ({ ...o, noteIndex: 99 })),
    }));
    expect(() => motifGraph(melody, corrupted)).toThrow(/does not lie on the line/);
  });
});

describe('budget', () => {
  /** `count` non-overlapping triads, each its own motif, four beats apart. */
  function manyMotifs(count: number): { melody: NoteEvent[]; motifs: MotifData[] } {
    const melody: NoteEvent[] = [];
    for (let i = 0; i < count; i += 1) {
      melody.push(...line(i * 4, [60, 62, 67]));
    }
    const motifs = Array.from({ length: count }, (_, i) => motifAt(melody, i * 4, [60, 62, 67]));
    return { melody, motifs };
  }

  it('refuses a comparison count over budget and allows one under it', () => {
    const { melody, motifs } = manyMotifs(50);
    // A budget too small even for the line's own notes fails there first.
    expect(() => motifGraph(melody, motifs, { budget: 100 })).toThrow(BudgetExceededError);
    // One large enough for the 150 notes but not for the 50×50 comparisons
    // fails specifically on the comparison count.
    expect(() => motifGraph(melody, motifs, { budget: 500 })).toThrow(BudgetExceededError);
    expect(() => motifGraph(melody, motifs, { budget: 500 })).toThrow(/motif graph comparisons/);
    expect(() => motifGraph(melody, motifs, { budget: 10_000 })).not.toThrow();
  });
});

describe('determinism', () => {
  it('answers the same graph for the same input', () => {
    const melody = [...line(0, [60, 62, 67]), ...line(4, [65, 67, 72]), ...line(8, [60, 58, 53])];
    const motifs = [
      motifAt(melody, 0, [60, 62, 67]),
      motifAt(melody, 4, [65, 67, 72]),
      motifAt(melody, 8, [60, 58, 53]),
    ];
    expect(motifGraph(melody, motifs)).toEqual(motifGraph(melody, motifs));
  });
});
