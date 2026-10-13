/**
 * How the statements of a melody's motifs derive from one another.
 *
 * {@link extractMotifs} groups statements into motifs; this reads across that
 * grouping and asks, for every statement after the first, which earlier
 * statement it most plausibly grew out of. The answer is a forest rather than a
 * graph proper — every statement has at most one parent — because a derivation
 * only ever has one source, however many statements it could be heard against.
 */

import { InvalidInputError } from '../../core/errors/index.js';
import type { NoteEvent } from '../../core/types.js';
import {
  assertArray,
  assertGenerationBudget,
  assertOptions,
  assertRange,
  assertRecord,
} from '../../core/validation/index.js';
import type { SpelledKeyLike } from '../../theory/scale/index.js';
import { BEAT_EPS } from '../adjacency.js';
import { orderedNotes } from './internal.js';
import type { MotifData, MotifOccurrence } from './motifs.js';
import { motifFromNotes } from './motifs.js';
import type { MotifRelation, MotifRelationSummary } from './relation.js';
import { relateMotifs } from './relation.js';
import { melodicSimilarity } from './similarity.js';

/**
 * `melodicSimilarity` a pair must clear to be drawn as a variation once no
 * named transformation explains it.
 *
 * Set high enough that a pair this loose is still recognisably the same
 * gesture rather than a coincidence of interval count: a third scored this way
 * has to agree almost everywhere before it counts as a derivation rather than
 * two unrelated cells.
 */
export const DEFAULT_VARIATION_THRESHOLD = 0.75;

/**
 * Options controlling {@link motifGraph}.
 *
 * @category Arrangement & Analysis
 */
export type MotifGraphOptions = {
  /** Key context for the tonal reading `relateMotifs` can offer. */
  key?: SpelledKeyLike;
  /**
   * Lower bound on `melodicSimilarity` for a pair with no named transformation
   * to still be drawn as a variation.
   *
   * @defaultValue 0.75
   */
  variationThreshold?: number;
  /**
   * Upper bound on the work this call may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};
/**
 * One statement of a motif, as a node of {@link MotifGraph}.
 *
 * @category Arrangement & Analysis
 */
export type MotifGraphNode = {
  /** Index into the `motifs` array this statement belongs to. */
  motif: number;
  /** Index into that motif's `occurrences`. */
  occurrence: number;
  /** Onset of the statement's first note. */
  startBeat: number;
  /** End of the statement's last note, exclusive. */
  endBeat: number;
};
/**
 * The derivation drawn from one statement to a later one.
 *
 * @category Arrangement & Analysis
 */
export type MotifGraphEdge = {
  /** Index of the preceding node this statement derives from. */
  from: number;
  /** Index of the derived node. */
  to: number;
  /** The named transformation, or null when none explains the pair. */
  relation: MotifRelationSummary | null;
  /** `melodicSimilarity` between the two statements. */
  similarity: number;
};
/**
 * How a melody's motif statements derive from one another.
 *
 * @category Arrangement & Analysis
 */
export type MotifGraph = {
  /** Every statement of every motif, ordered by `startBeat` then by `motif`. */
  nodes: MotifGraphNode[];
  /**
   * The derivation drawn to each node from an earlier one, ordered by `to`.
   * Every node has at most one edge into it, so the edges describe a forest.
   */
  edges: MotifGraphEdge[];
};
/** The fields {@link MotifRelation} carries that a summary keeps. */
function summarize(relation: MotifRelation): MotifRelationSummary {
  const { kind, sequence, semitones, degrees, timeRatio } = relation;
  return { kind, sequence, semitones, degrees, timeRatio };
}
/** One node together with the occurrence it stands for, as a motif of its own. */
type NodeInfo = {
  node: MotifGraphNode;
  data: MotifData;
};
/** A candidate parent for a node, ranked by {@link betterParent}. */
type Candidate = {
  index: number;
  startBeat: number;
  relation: MotifRelation | null;
  similarity: number;
};
/**
 * Whether `candidate` outranks `current` as the parent of a node.
 *
 * A named transformation always outranks the lack of one; among candidates
 * that agree on that, the closer match wins, then the more recent statement,
 * then — only to make an otherwise exact tie deterministic — the earlier
 * index.
 */
function betterParent(candidate: Candidate, current: Candidate): boolean {
  const candidateNamed = candidate.relation !== null;
  const currentNamed = current.relation !== null;
  if (candidateNamed !== currentNamed) {
    return candidateNamed;
  }
  if (candidate.similarity !== current.similarity) {
    return candidate.similarity > current.similarity;
  }
  if (candidate.startBeat !== current.startBeat) {
    return candidate.startBeat > current.startBeat;
  }
  return candidate.index < current.index;
}
/**
 * Read a melody's motif statements as a derivation forest.
 *
 * Every statement after the first is compared against every statement that
 * precedes it: the pair {@link relateMotifs} can name outranks any it cannot,
 * the closest-scoring precedent among equals outranks the rest, and a
 * statement whose best precedent is neither named nor close enough by
 * `melodicSimilarity` is a root — new material, not a derivation of what came
 * before it. The derivation traced this way explains a subject restated,
 * transposed, inverted, augmented, or loosely varied by what it grew out of,
 * and leaves a truly new idea unattached rather than forcing it onto whatever
 * came earliest.
 *
 * `motifs` is read against `line` rather than against its own prime
 * statements: an occurrence's notes can differ from the motif's first
 * statement in duration even where their intervals and onset gaps agree, and a
 * retrograde reading depends on that duration. So every occurrence is read
 * back off `line` and named fresh, occurrence to occurrence.
 *
 * @param line The melody `motifs` was extracted from. Notes that never sound
 *   are dropped, exactly as {@link extractMotifs} drops them, so the two agree
 *   on which note an occurrence's `noteIndex` addresses.
 * @param motifs The motifs to graph, as {@link extractMotifs} reports them.
 * @param opts Key context, the variation threshold, and a work budget; see
 *   {@link MotifGraphOptions}.
 * @returns The statements as nodes, and the derivation drawn to each from an
 *   earlier one.
 * @example
 * ```ts
 * import { extractMotifs, motifGraph } from '@libraz/libcantus';
 * const notes = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 62, startBeat: 1, durationBeat: 1 },
 *   { pitch: 64, startBeat: 2, durationBeat: 1 },
 *   { pitch: 67, startBeat: 4, durationBeat: 1 },
 *   { pitch: 69, startBeat: 5, durationBeat: 1 },
 *   { pitch: 71, startBeat: 6, durationBeat: 1 },
 * ];
 * const graph = motifGraph(notes, extractMotifs(notes));
 * graph.edges[0]?.relation?.kind; // 'transposition'
 * ```
 * @category Arrangement & Analysis
 */
export function motifGraph(
  line: readonly NoteEvent[],
  motifs: readonly MotifData[],
  opts: MotifGraphOptions = {},
): MotifGraph {
  const asked = assertOptions(opts, 'opts');
  const variationThreshold = asked.variationThreshold ?? DEFAULT_VARIATION_THRESHOLD;
  assertRange(variationThreshold, 0, 1, 'motif graph variationThreshold');
  const ordered = orderedNotes(line, 'line', asked.budget);

  const motifList = assertArray<MotifData>(motifs, 'motifs');
  const infos: NodeInfo[] = [];
  for (let mi = 0; mi < motifList.length; mi += 1) {
    const motif = assertRecord<MotifData>(motifList[mi], `motifs[${mi}]`);
    const notes = assertArray<NoteEvent>(motif.notes, `motifs[${mi}].notes`);
    const occurrences = assertArray<MotifOccurrence>(
      motif.occurrences,
      `motifs[${mi}].occurrences`,
    );
    for (let oi = 0; oi < occurrences.length; oi += 1) {
      const occurrence = assertRecord<MotifOccurrence>(
        occurrences[oi],
        `motifs[${mi}].occurrences[${oi}]`,
      );
      const { noteIndex } = occurrence;
      const onLine =
        Number.isInteger(noteIndex) &&
        noteIndex >= 0 &&
        noteIndex + notes.length <= ordered.length &&
        Math.abs((ordered[noteIndex]?.startBeat ?? Number.NaN) - occurrence.startBeat) <= BEAT_EPS;
      if (!onLine) {
        throw new InvalidInputError(
          `motif occurrence motifs[${mi}].occurrences[${oi}] does not lie on the line`,
        );
      }
      infos.push({
        node: {
          motif: mi,
          occurrence: oi,
          startBeat: occurrence.startBeat,
          endBeat: occurrence.endBeat,
        },
        data: motifFromNotes(ordered.slice(noteIndex, noteIndex + notes.length)),
      });
    }
  }
  infos.sort((a, b) => a.node.startBeat - b.node.startBeat || a.node.motif - b.node.motif);

  const nodeCount = infos.length;
  assertGenerationBudget(nodeCount * nodeCount, 'motif graph comparisons', asked.budget);

  const edges: MotifGraphEdge[] = [];
  for (let to = 1; to < nodeCount; to += 1) {
    const toInfo = infos[to] as NodeInfo;
    let best: Candidate | null = null;
    for (let from = 0; from < to; from += 1) {
      const fromInfo = infos[from] as NodeInfo;
      const candidate: Candidate = {
        index: from,
        startBeat: fromInfo.node.startBeat,
        relation: relateMotifs(fromInfo.data, toInfo.data, asked.key),
        similarity: melodicSimilarity(fromInfo.data, toInfo.data),
      };
      if (best === null || betterParent(candidate, best)) {
        best = candidate;
      }
    }
    if (best !== null && (best.relation !== null || best.similarity >= variationThreshold)) {
      edges.push({
        from: best.index,
        to,
        relation: best.relation === null ? null : summarize(best.relation),
        similarity: best.similarity,
      });
    }
  }

  return { nodes: infos.map((info) => info.node), edges };
}
