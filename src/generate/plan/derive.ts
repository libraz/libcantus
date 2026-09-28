/**
 * Deriving a {@link CompositionPlan} from a {@link ReferenceProfile}.
 *
 * Each structural dimension of the reference is either carried into the plan
 * or replaced, weighted per dimension by {@link PreserveWeights}. A discrete
 * item (a section label, a phrase length, a structural chord, a motif
 * derivation) is kept or replaced whole by a positional draw addressed by that
 * item's index, so changing one weight or one item never redraws another; a
 * replacement follows a fixed rule. A continuous item (harmonic rhythm,
 * register and contour, onset placement) is interpolated between the
 * reference's value and a neutral one.
 *
 * The reference's melodic surface — its motif intervals and phrase outlines —
 * never reaches the plan: a plan says how motifs derive from one another, not
 * what they sound like.
 */

import { HUMANIZE_ADJACENCY } from '../../analyze/adjacency.js';
import type { CadenceType } from '../../analyze/functional/cadence.js';
import type { HarmonicFunction } from '../../analyze/functional/function.js';
import { chordToRoman } from '../../analyze/functional/roman.js';
import type { MelodicContourShape } from '../../analyze/melody/contour.js';
import type { MotifGraph, MotifGraphEdge } from '../../analyze/melody/graph.js';
import type { MotifRelationSummary } from '../../analyze/melody/relation.js';
import type { ReferenceProfile } from '../../analyze/reference/types.js';
import { assertReferenceProfile } from '../../analyze/reference/validate.js';
import { InvalidInputError } from '../../core/errors/index.js';
import { BEAT_EPS, barStartBeat, beatsPerBarAt, type MeterMap } from '../../core/meter/index.js';
import { spelledInterval, transposeByInterval } from '../../core/pitch/index.js';
import {
  assertGenerationBudget,
  assertMidiPitch,
  assertOptions,
  assertRange,
  assertRecord,
} from '../../core/validation/index.js';
import { diatonicTriad } from '../../theory/chord/index.js';
import {
  type KeyLike,
  type ResolvedKey,
  resolveKey,
  scaleTonesInDegreeOrder,
} from '../../theory/scale/index.js';
import { type Draw, type GenerationContextInput, resolveContext } from '../context/index.js';
import {
  COMPOSITION_PLAN_VERSION,
  type CompositionPlan,
  type PlannedChord,
  type PlannedMotif,
  type PlannedPhrase,
  type PlannedRhythm,
  type PlannedSection,
} from './types.js';

/**
 * How much of each structural dimension of a reference a derived plan keeps,
 * each in [0, 1]; an omitted weight is 1.
 *
 * @category Composition
 */
export type PreserveWeights = {
  /** Section labels; a replaced section takes its neighbour's label. */
  form?: number;
  /** Phrase lengths; a replaced phrase is rounded to a power-of-two bar count. */
  phraseLengths?: number;
  /** Structural chords; a replaced chord is another numeral of the same function. */
  harmonicFunction?: number;
  /** Where the chords change, interpolated toward one change per bar line. */
  harmonicRhythm?: number;
  /** Motif derivations; a replaced derivation becomes a variation of the same source. */
  motifRelations?: number;
  /** Phrase contour, peak and register, interpolated toward a neutral arch. */
  registerShape?: number;
  /** Onset placement, interpolated toward a level-proportional distribution without syncopation. */
  rhythm?: number;
};

/**
 * Options for {@link deriveCompositionPlan}.
 *
 * @category Composition
 */
export type CompositionPlanOptions = {
  /**
   * The home key of the plan. Every reference key moves by the interval from
   * the reference's home tonic to this one, keeping its own variant. Defaults
   * to the reference's home key; a key of another variant is rejected.
   */
  key?: KeyLike;
  /**
   * The melody range the plan's phrase registers are mapped onto. Defaults to
   * the reference's melody range, moved by the nearest shift to the new key.
   */
  register?: { low: number; high: number };
  /** How much of each dimension of the reference to keep; see {@link PreserveWeights}. */
  preserve?: PreserveWeights;
  /**
   * The seed and algorithm version the plan records. A caller-supplied `rng`
   * is rejected: a plan has to carry its source as a seed to be reproducible.
   */
  ctx?: GenerationContextInput;
};

/** Every preserve dimension, in declaration order. */
const PRESERVE_ASPECTS = [
  'form',
  'phraseLengths',
  'harmonicFunction',
  'harmonicRhythm',
  'motifRelations',
  'registerShape',
  'rhythm',
] as const;

/** The contour a phrase takes when its shape is not preserved. */
const NEUTRAL_SHAPE: MelodicContourShape = 'arch';

/** The peak position a phrase is interpolated toward. */
const NEUTRAL_PEAK_POSITION = 0.6;

/** The registerShape weight at and above which the reference's contour shape is kept. */
const SHAPE_KEEP_THRESHOLD = 0.5;

/** Onset-level mass proportional to the level index, levels 0..5. */
const NEUTRAL_ONSET_LEVELS = Object.freeze([0, 1, 2, 3, 4, 5].map((level) => level / 15));

/** Scale degrees whose triads may stand in for a structural chord of each function. */
const FUNCTION_DEGREES: Readonly<Record<HarmonicFunction, readonly number[]>> = {
  tonic: [1, 6, 3],
  subdominant: [4, 2],
  dominant: [5, 7],
};

/** Degree count of a scale whose degrees stack into diatonic triads. */
const HEPTATONIC_DEGREES = 7;

/** A phrase span in the plan, and the reference phrase it was laid from. */
type PhraseSpan = {
  startBeat: number;
  endBeat: number;
  source: number;
  cadence: CadenceType | null;
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function lerp(weight: number, reference: number, neutral: number): number {
  return weight * reference + (1 - weight) * neutral;
}

/** Read every preserve weight, defaulting an omitted one to 1. */
function readPreserve(value: PreserveWeights | undefined): Required<PreserveWeights> {
  const read = value === undefined ? {} : assertRecord<PreserveWeights>(value, 'opts.preserve');
  const weights = {} as Required<PreserveWeights>;
  for (const aspect of PRESERVE_ASPECTS) {
    const weight = read[aspect];
    weights[aspect] =
      weight === undefined ? 1 : assertRange(weight, 0, 1, `opts.preserve.${aspect}`);
  }
  return weights;
}

/** Read a caller's register as whole MIDI pitches with low not above high. */
function readRegister(value: { low: number; high: number }): { low: number; high: number } {
  const read = assertRecord<{ low: number; high: number }>(value, 'opts.register');
  const low = assertMidiPitch(read.low, 'opts.register.low');
  const high = assertMidiPitch(read.high, 'opts.register.high');
  if (low > high) {
    throw new InvalidInputError(
      `opts.register.low must not exceed opts.register.high; received ${low} > ${high}`,
    );
  }
  return { low, high };
}

/** Refuse a caller-supplied positional source, which a plan cannot record. */
function rejectSuppliedRng(ctx: GenerationContextInput | undefined): void {
  if (typeof ctx === 'object' && ctx !== null && ctx.rng !== undefined) {
    throw new InvalidInputError(
      'opts.ctx.rng is not accepted: a composition plan records its seed, not a source',
    );
  }
}

/**
 * The plan's keys: the reference's key regions in order, each moved by the
 * spelled interval from the reference's home tonic to the requested one.
 */
function plannedKeys(profile: ReferenceProfile, requested: KeyLike | undefined): ResolvedKey[] {
  const regions = profile.harmony.keys.map(
    ({ key }): ResolvedKey => ({
      scale: { ...key.scale },
      tonic: { ...key.tonic },
      variant: key.variant,
    }),
  );
  const home = regions[0] as ResolvedKey;
  if (requested === undefined) {
    return regions;
  }
  const target = resolveKey(requested);
  if (target.variant !== home.variant || target.scale.modeMask12 !== home.scale.modeMask12) {
    throw new InvalidInputError(
      "opts.key must be in the same mode as the reference's home key; a key change moves the tonic only",
    );
  }
  const step = spelledInterval(
    { letter: home.tonic.letter, alter: home.tonic.alter },
    { letter: target.tonic.letter, alter: target.tonic.alter },
  );
  const moved = regions.map(
    (key): ResolvedKey => ({
      scale: {
        rootPc: mod12(key.scale.rootPc + step.semitones),
        modeMask12: key.scale.modeMask12,
      },
      tonic: transposeByInterval({ letter: key.tonic.letter, alter: key.tonic.alter }, step),
      variant: key.variant,
    }),
  );
  moved[0] = target;
  return moved;
}

/** Section labels, each replaced one taking its neighbour's original label. */
function plannedSections(profile: ReferenceProfile, weight: number, draw: Draw): PlannedSection[] {
  const sections = profile.form.sections;
  return sections.map((section, index) => {
    const keep = sections.length < 2 || draw.prob(weight, 'form', index);
    const neighbour = index + 1 < sections.length ? index + 1 : index - 1;
    return {
      label: keep ? section.label : (sections[neighbour]?.label ?? section.label),
      startBeat: section.startBeat,
      endBeat: section.endBeat,
    };
  });
}

/** The beat reached by advancing `bars` bars from `startBeat`, bar by bar under the meter map. */
function beatAfterBars(startBeat: number, bars: number, meters: MeterMap): number {
  let beat = startBeat;
  let left = bars;
  while (left > BEAT_EPS) {
    const step = Math.min(1, left);
    beat += step * beatsPerBarAt(beat, meters);
    left -= step;
  }
  return beat;
}

/** Bar count of `[startBeat, endBeat)`, bar by bar under the meter map. */
function barsBetween(startBeat: number, endBeat: number, meters: MeterMap): number {
  let beat = startBeat;
  let bars = 0;
  while (beat < endBeat - BEAT_EPS) {
    const barBeats = beatsPerBarAt(beat, meters);
    const step = Math.min(barStartBeat(beat, meters) + barBeats, endBeat) - beat;
    bars += step / barBeats;
    beat += step;
  }
  return bars;
}

/**
 * The span cut at every section boundary: each section, and each stretch no
 * section covers, is one segment.
 */
function spanSegments(profile: ReferenceProfile): [number, number][] {
  const { startBeat, endBeat } = profile.span;
  const cuts = [startBeat, endBeat];
  for (const section of profile.form.sections) {
    for (const beat of [section.startBeat, section.endBeat]) {
      if (beat > startBeat + BEAT_EPS && beat < endBeat - BEAT_EPS) cuts.push(beat);
    }
  }
  cuts.sort((a, b) => a - b);
  const segments: [number, number][] = [];
  for (let index = 1; index < cuts.length; index += 1) {
    const from = cuts[index - 1] as number;
    const to = cuts[index] as number;
    if (to - from > BEAT_EPS) segments.push([from, to]);
  }
  return segments;
}

/**
 * The reference phrases cut at segment boundaries. A cut phrase's cadence
 * stays with its last part.
 */
function phrasePieces(
  profile: ReferenceProfile,
  segments: readonly [number, number][],
): PhraseSpan[] {
  const pieces: PhraseSpan[] = [];
  profile.form.phrases.forEach((phrase, source) => {
    const parts: PhraseSpan[] = [];
    for (const [from, to] of segments) {
      const startBeat = Math.max(phrase.startBeat, from);
      const endBeat = Math.min(phrase.endBeat, to);
      if (endBeat - startBeat > BEAT_EPS) parts.push({ startBeat, endBeat, source, cadence: null });
    }
    const last = parts.at(-1);
    if (last) last.cadence = phrase.cadence?.type ?? null;
    pieces.push(...parts);
  });
  return pieces;
}

/**
 * Lay out phrase spans so they tile the span with every section opening at
 * least one phrase. The reference phrases are cut at section boundaries, and
 * within each segment the parts are laid end to end from its start: a kept
 * part at its own length, a replaced one rounded to a power-of-two bar count
 * and halved when it overflows the segment. The last phrase ends at the
 * segment's end; a segment no reference phrase reaches gets one phrase read
 * from the phrase before it.
 */
function plannedPhraseSpans(profile: ReferenceProfile, weight: number, draw: Draw): PhraseSpan[] {
  const segments = spanSegments(profile);
  const pieces = phrasePieces(profile, segments);
  const replaced = pieces.map((_, index) => !draw.prob(weight, 'phraseLengths', index));
  const spans: PhraseSpan[] = [];
  for (const [segmentStart, segmentEnd] of segments) {
    const members = pieces
      .map((piece, index) => ({ piece, index }))
      .filter(
        ({ piece }) =>
          piece.startBeat >= segmentStart - BEAT_EPS && piece.startBeat < segmentEnd - BEAT_EPS,
      );
    const laid: PhraseSpan[] = [];
    let cursor = segmentStart;
    for (const { piece, index } of members) {
      const lengths: number[] = [];
      if (replaced[index]) {
        const bars = barsBetween(piece.startBeat, piece.endBeat, profile.meters);
        const rounded = 2 ** Math.round(Math.log2(bars));
        const overflows = beatAfterBars(cursor, rounded, profile.meters) > segmentEnd + BEAT_EPS;
        let partStart = cursor;
        for (const part of overflows ? [rounded / 2, rounded / 2] : [rounded]) {
          const partEnd = beatAfterBars(partStart, part, profile.meters);
          lengths.push(partEnd - partStart);
          partStart = partEnd;
        }
      } else {
        lengths.push(piece.endBeat - piece.startBeat);
      }
      lengths.forEach((length, part) => {
        if (cursor >= segmentEnd - BEAT_EPS) return;
        const end = cursor + length;
        laid.push({
          startBeat: cursor,
          endBeat: Math.min(end, segmentEnd),
          source: piece.source,
          cadence: part === lengths.length - 1 ? piece.cadence : null,
        });
        cursor = end;
      });
    }
    const last = laid.at(-1);
    if (last) {
      last.endBeat = segmentEnd;
    } else {
      laid.push({
        startBeat: segmentStart,
        endBeat: segmentEnd,
        source: spans.at(-1)?.source ?? (profile.form.phrases.length > 0 ? 0 : -1),
        cadence: null,
      });
    }
    spans.push(...laid);
  }
  return spans;
}

/** Index of the section whose span holds a beat, or null. */
function sectionAt(sections: readonly PlannedSection[], beat: number): number | null {
  const index = sections.findIndex(
    (section) => beat >= section.startBeat - BEAT_EPS && beat < section.endBeat - BEAT_EPS,
  );
  return index < 0 ? null : index;
}

/** Index of the phrase that holds `[startBeat, endBeat)` whole, or -1. */
function phraseHolding(
  phrases: readonly PlannedPhrase[],
  startBeat: number,
  endBeat: number,
): number {
  return phrases.findIndex(
    (phrase) => startBeat >= phrase.startBeat - BEAT_EPS && endBeat <= phrase.endBeat + BEAT_EPS,
  );
}

/** A motif graph node that fits inside one plan phrase. */
type MotifCandidate = {
  node: number;
  phrase: number;
  startBeat: number;
  endBeat: number;
  notes: number;
};

/**
 * The non-overlapping candidates that cover the most notes, by weighted
 * interval scheduling. Among equal covers the one taking the earlier start,
 * then the lower node index, at the first place they differ wins. Returned in
 * node order.
 */
function scheduleMotifs(candidates: readonly MotifCandidate[]): MotifCandidate[] {
  const order = [...candidates].sort((a, b) => a.startBeat - b.startBeat || a.node - b.node);
  const count = order.length;
  // First candidate at or after position `from` starting no earlier than `beat`.
  const firstFrom = (from: number, beat: number): number => {
    let low = from;
    let high = count;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((order[mid] as MotifCandidate).startBeat < beat - BEAT_EPS) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const next = order.map((candidate, index) => firstFrom(index + 1, candidate.endBeat));
  // best[k]: the most notes candidates k.. can cover.
  const best = new Array<number>(count + 1).fill(0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const taken = (order[index] as MotifCandidate).notes + (best[next[index] as number] as number);
    best[index] = Math.max(best[index + 1] as number, taken);
  }
  const chosen: MotifCandidate[] = [];
  let index = 0;
  while (index < count) {
    const candidate = order[index] as MotifCandidate;
    if (candidate.notes + (best[next[index] as number] as number) === best[index]) {
      chosen.push(candidate);
      index = next[index] as number;
    } else {
      index += 1;
    }
  }
  return chosen.sort((a, b) => a.node - b.node);
}

/**
 * The derivation a selected node takes from its nearest selected ancestor. The
 * parent's edge is used as is; across skipped nodes a path of repetitions and
 * unstretched transpositions composes into one, any other path is a variation
 * when the ancestor's motif has as many notes, and a root otherwise.
 */
function selectedDerivation(
  graph: MotifGraph,
  parentEdge: ReadonlyMap<number, MotifGraphEdge>,
  selectedAt: ReadonlyMap<number, number>,
  noteCount: (node: number) => number,
  node: number,
): { from: number | null; relation: MotifRelationSummary | null } {
  let plain = true;
  let semitones = 0;
  let steps = 0;
  for (let edge = parentEdge.get(node); edge !== undefined; edge = parentEdge.get(edge.from)) {
    const relation = edge.relation;
    steps += 1;
    plain &&=
      relation !== null &&
      (relation.kind === 'repetition' ||
        (relation.kind === 'transposition' && Math.abs(relation.timeRatio - 1) <= BEAT_EPS));
    semitones += relation?.semitones ?? 0;
    const from = selectedAt.get(edge.from);
    if (from === undefined) continue;
    if (steps === 1) {
      return { from, relation: relation === null ? null : { ...relation } };
    }
    if (plain) {
      const gap = (graph.nodes[node]?.startBeat ?? 0) - (graph.nodes[edge.from]?.endBeat ?? 0);
      return {
        from,
        relation: {
          kind: semitones === 0 ? 'repetition' : 'transposition',
          sequence: gap >= -HUMANIZE_ADJACENCY && gap <= HUMANIZE_ADJACENCY,
          semitones,
          timeRatio: 1,
        },
      };
    }
    return noteCount(edge.from) === noteCount(node)
      ? { from, relation: null }
      : { from: null, relation: null };
  }
  return { from: null, relation: null };
}

/**
 * Candidate numerals for a structural chord of a function: the diatonic
 * triads on that function's degrees, named in the chord's key. Null for a key
 * whose scale has no diatonic triads.
 */
function functionCandidates(fn: HarmonicFunction, key: ResolvedKey): string[] | null {
  if (scaleTonesInDegreeOrder(key).length !== HEPTATONIC_DEGREES) {
    return null;
  }
  return FUNCTION_DEGREES[fn].map((degree) => chordToRoman(diatonicTriad(degree, key), key));
}

/**
 * The plan's harmony: structural numerals kept or replaced by function, and
 * each chord change kept or moved to its bar start. A held chord is never
 * split; a chord a moved change leaves with no length is dropped.
 */
function plannedHarmony(
  profile: ReferenceProfile,
  keys: readonly ResolvedKey[],
  preserve: Required<PreserveWeights>,
  draw: Draw,
): PlannedChord[] {
  const chords = profile.harmony.chords;
  const romans = chords.map((chord, index) => {
    if (
      chord.level !== 'structural' ||
      draw.prob(preserve.harmonicFunction, 'harmonicFunction', index)
    ) {
      return chord.roman;
    }
    const candidates = functionCandidates(chord.function, keys[chord.key] as ResolvedKey);
    if (candidates === null) {
      return chord.roman;
    }
    const pick = draw.range(0, candidates.length - 1, 'harmonicFunction', index, 'pick');
    return candidates[pick] as string;
  });
  const starts: number[] = [];
  chords.forEach((chord, index) => {
    const keep = index === 0 || draw.prob(preserve.harmonicRhythm, 'harmonicRhythm', index);
    const start = keep ? chord.startBeat : barStartBeat(chord.startBeat, profile.meters);
    starts.push(index === 0 ? start : Math.max(start, starts[index - 1] as number));
  });
  const planned: PlannedChord[] = [];
  chords.forEach((chord, index) => {
    const next = chords[index + 1];
    const nextStart = starts[index + 1];
    let endBeat = chord.endBeat;
    if (next !== undefined && nextStart !== undefined) {
      endBeat =
        Math.abs(chord.endBeat - next.startBeat) <= BEAT_EPS
          ? nextStart
          : Math.min(chord.endBeat, nextStart);
    }
    const startBeat = starts[index] as number;
    if (endBeat - startBeat > BEAT_EPS) {
      planned.push({ startBeat, endBeat, key: chord.key, roman: romans[index] as string });
    }
  });
  return planned;
}

/** The plan's onset target: levels and syncopation interpolated, IOI shares kept. */
function plannedRhythm(profile: ReferenceProfile, weight: number): PlannedRhythm {
  const reference = profile.melody.rhythm;
  return {
    onsetLevels: reference.onsetLevels.map((share, level) =>
      lerp(weight, share, NEUTRAL_ONSET_LEVELS[level] as number),
    ),
    interOnsetShares: [...reference.interOnsetShares],
    syncopation: lerp(weight, reference.syncopation, 0),
  };
}

/**
 * Derive a composition plan from a reference profile.
 *
 * The plan keeps the reference's meter and span. Its keys are the reference's,
 * moved to `opts.key` with each key's variant kept, and its phrase registers
 * are the reference's mapped onto `opts.register`. Each dimension named in
 * `opts.preserve` is kept, replaced or interpolated by its weight; a draw for
 * a discrete item is addressed by the dimension and the item's index, so the
 * same reference, options and seed always give the same plan. The resolved
 * seed and algorithm version are recorded in the plan.
 *
 * @param reference The reference profile to derive from.
 * @param opts The key, register, preserve weights and generation context.
 * @returns A plan that passes {@link assertCompositionPlan}.
 * @throws {InvalidInputError} If the reference is not a valid profile or has
 *   no melody onsets, an option is out of range, `opts.key` is of another
 *   variant than the reference's home key, `opts.ctx` carries an `rng`, or the
 *   default register moved to the new key leaves the MIDI range.
 * @category Composition
 */
export function deriveCompositionPlan(
  reference: ReferenceProfile,
  opts?: CompositionPlanOptions,
): CompositionPlan {
  const profile = assertReferenceProfile(reference, 'reference');
  const asked = assertOptions(opts, 'opts');
  const preserve = readPreserve(asked.preserve);
  const requestedRegister = asked.register === undefined ? undefined : readRegister(asked.register);
  rejectSuppliedRng(asked.ctx);
  const ctx = resolveContext(asked.ctx);
  const draw = ctx.part('plan');

  const melodyRegister = profile.melody.register;
  if (profile.melody.rhythm.onsets === 0 || melodyRegister === null) {
    throw new InvalidInputError('reference must carry melody onsets to derive a plan from');
  }
  const keys = plannedKeys(profile, asked.key);
  const homeShift = mod12(
    (keys[0] as ResolvedKey).scale.rootPc - (profile.harmony.keys[0]?.key.scale.rootPc ?? 0),
  );
  const shift = homeShift >= 6 ? homeShift - 12 : homeShift;
  const source = { low: melodyRegister.low + shift, high: melodyRegister.high + shift };
  if (source.low < 0 || source.high > 127) {
    throw new InvalidInputError(
      `the reference melody range moved to the new key leaves the MIDI range; received ${source.low}..${source.high}`,
    );
  }
  const target = requestedRegister ?? source;
  const scale =
    source.high === source.low ? 0 : (target.high - target.low) / (source.high - source.low);
  const offset =
    source.high === source.low ? (target.low + target.high) / 2 : target.low - source.low * scale;
  const mapPitch = (pitch: number) => (pitch + shift) * scale + offset;
  const neutralRegister = {
    low: target.low,
    high: target.high,
    mean: (target.low + target.high) / 2,
  };

  const sections = plannedSections(profile, preserve.form, draw);
  const shapeWeight = preserve.registerShape;
  const phrases: PlannedPhrase[] = plannedPhraseSpans(profile, preserve.phraseLengths, draw).map(
    (span) => {
      const melody = profile.form.phrases[span.source]?.melody ?? null;
      const register = melody
        ? {
            low: Math.round(lerp(shapeWeight, mapPitch(melody.low), neutralRegister.low)),
            high: Math.round(lerp(shapeWeight, mapPitch(melody.high), neutralRegister.high)),
            mean: lerp(shapeWeight, mapPitch(melody.mean), neutralRegister.mean),
          }
        : { ...neutralRegister };
      return {
        startBeat: span.startBeat,
        endBeat: span.endBeat,
        section: sectionAt(sections, span.startBeat),
        cadence: span.cadence,
        shape: melody && shapeWeight >= SHAPE_KEEP_THRESHOLD ? melody.shape : NEUTRAL_SHAPE,
        peakPosition: melody
          ? lerp(shapeWeight, melody.peakPosition, NEUTRAL_PEAK_POSITION)
          : NEUTRAL_PEAK_POSITION,
        register,
        onsetDensity: melody ? melody.onsetDensity : profile.melody.rhythm.onsetDensity,
        motifs: [],
      };
    },
  );

  const graph = profile.melody.graph;
  const noteCount = (node: number) =>
    (profile.melody.motifs[graph.nodes[node]?.motif ?? -1]?.intervals.length ?? 0) + 1;
  assertGenerationBudget(graph.nodes.length * phrases.length, 'plan motif selection');
  const candidates: MotifCandidate[] = [];
  graph.nodes.forEach((node, index) => {
    const phrase = phraseHolding(phrases, node.startBeat, node.endBeat);
    if (phrase >= 0) {
      candidates.push({
        node: index,
        phrase,
        startBeat: node.startBeat,
        endBeat: node.endBeat,
        notes: noteCount(index),
      });
    }
  });
  const selected = scheduleMotifs(candidates);
  const selectedAt = new Map(selected.map((candidate, index) => [candidate.node, index]));
  const parentEdge = new Map(graph.edges.map((edge) => [edge.to, edge]));
  const motifs: PlannedMotif[] = selected.map((candidate, index) => {
    const { from, relation } = selectedDerivation(
      graph,
      parentEdge,
      selectedAt,
      noteCount,
      candidate.node,
    );
    const keepRelation = draw.prob(preserve.motifRelations, 'motifRelations', index);
    phrases[candidate.phrase]?.motifs.push(index);
    return {
      phrase: candidate.phrase,
      startBeat: candidate.startBeat,
      endBeat: candidate.endBeat,
      notes: candidate.notes,
      from,
      relation: keepRelation ? relation : null,
    };
  });

  return {
    planVersion: COMPOSITION_PLAN_VERSION,
    seed: ctx.seed,
    algorithmVersion: ctx.algorithmVersion,
    keys,
    meters: profile.meters.map((entry) => ({
      startBeat: entry.startBeat,
      ts:
        entry.ts.grouping === undefined
          ? { ...entry.ts }
          : { ...entry.ts, grouping: [...entry.ts.grouping] },
    })),
    span: { ...profile.span },
    sections,
    phrases,
    harmony: plannedHarmony(profile, keys, preserve, draw),
    motifs,
    rhythm: plannedRhythm(profile, preserve.rhythm),
  };
}
