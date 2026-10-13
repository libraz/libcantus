/**
 * Comparing two {@link ReferenceProfile}s dimension by dimension.
 *
 * The answer is never folded into one number: each field names the aspect it
 * measures, so "a different song built the same way" reads as high structural
 * fields beside a low surface one. Only `melody.surfaceSimilarity` reads the
 * motifs' intervals; every other field is invariant under transposition, tempo
 * and a change of motif intervals.
 */

import { assertOptions } from '../../core/validation/index.js';
import {
  cadenceSimilarity,
  contourSimilarity,
  densitySimilarity,
  durationSimilarity,
  functionSimilarity,
  keyPlanSimilarity,
  motifStructureSimilarity,
  onsetSimilarity,
  phraseLengthSimilarity,
  progressionSimilarity,
  registerSimilarity,
  sectionSequenceSimilarity,
  surfaceSimilarity,
  syncopationSimilarity,
} from './measures.js';
import type { ReferenceProfile } from './types.js';
import { assertReferenceProfile } from './validate.js';

/**
 * Options for {@link compareReferences}.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceComparisonOptions = {
  /**
   * Upper bound on the cells of the progression alignment.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/**
 * How alike two profiled pieces are, one field per aspect.
 *
 * Every value is in [0, 1] and symmetric in the two profiles. A value is
 * `null` when neither profile has anything to measure it on, and 0 when only
 * one does.
 *
 * @category Arrangement & Analysis
 */
export type ReferenceComparison = {
  /** Formal layout. */
  form: {
    /** Likeness of the section-label sequences. */
    sectionSequenceSimilarity: number | null;
    /** Likeness of the phrase-length sequences. */
    phraseLengthSimilarity: number | null;
  };
  /** Harmony. */
  harmony: {
    /** Likeness of the structural Roman-numeral progressions. */
    progressionSimilarity: number | null;
    /** Likeness of how long each harmonic function is held. */
    functionSimilarity: number | null;
    /** Likeness of the phrase-by-phrase cadence sequences. */
    cadenceSimilarity: number | null;
    /** Likeness of the key plans, read relative to each piece's first key. */
    keyPlanSimilarity: number | null;
    /** Likeness of where in the bar the chords change. */
    harmonicRhythmOnsetSimilarity: number | null;
    /** Likeness of how often the chords change. */
    harmonicRhythmDensitySimilarity: number | null;
  };
  /** Melody. */
  melody: {
    /** Likeness of the motifs' interval content: the one field that reads the surface. */
    surfaceSimilarity: number | null;
    /** Likeness of how the motifs derive from one another. */
    motifStructureSimilarity: number | null;
    /** Likeness of the phrases' melodic outlines, each scaled by its own range. */
    contourSimilarity: number | null;
    /** Likeness of the phrases' registers, each relative to its piece's melodic mean. */
    registerSimilarity: number | null;
  };
  /** Melodic rhythm. */
  rhythm: {
    /** Likeness of where in the bar the melody's onsets fall. */
    onsetSimilarity: number | null;
    /** Likeness of the melodies' onsets per bar. */
    densitySimilarity: number | null;
    /** Likeness of the melodies' inter-onset-interval distributions. */
    durationSimilarity: number | null;
    /** Likeness of the melodies' syncopation. */
    syncopationSimilarity: number | null;
  };
  /** The two most and the two least alike fields, by name. */
  rationale: string;
};

/** How many fields the rationale names at each end. */
const RATIONALE_FIELDS = 2;

/** A sentence naming the most and least alike of the measured fields. */
function rationaleOf(comparison: Omit<ReferenceComparison, 'rationale'>): string {
  const measured: { name: string; value: number; order: number }[] = [];
  for (const group of [comparison.form, comparison.harmony, comparison.melody, comparison.rhythm]) {
    for (const [name, value] of Object.entries(group)) {
      if (value !== null) {
        measured.push({ name, value, order: measured.length });
      }
    }
  }
  if (measured.length === 0) {
    return 'Nothing to compare: neither profile has material for any field';
  }
  const describe = (entries: typeof measured): string =>
    entries.map((entry) => `${entry.name} ${Math.round(entry.value * 100)}%`).join(', ');
  const highest = [...measured].sort((x, y) => y.value - x.value || x.order - y.order);
  const lowest = [...measured].sort((x, y) => x.value - y.value || x.order - y.order);
  return (
    `Most alike: ${describe(highest.slice(0, RATIONALE_FIELDS))}; ` +
    `least alike: ${describe(lowest.slice(0, RATIONALE_FIELDS))}`
  );
}

/**
 * Compare two profiled pieces aspect by aspect: form, harmony, melody and
 * melodic rhythm.
 *
 * Sequences — sections, phrase lengths, cadences, key plans, structural
 * chords, phrase contours and registers — are aligned by a graded edit
 * distance; distributions — harmonic function, onset placement, inter-onset
 * intervals, motif derivations — by histogram intersection. The surface field
 * compares the motifs' interval cells, so a transposition of the same piece
 * reads 1 on every field. No aggregate is returned: which aspects agree is the
 * answer.
 *
 * @param a The first profile.
 * @param b The second profile.
 * @param opts The work budget.
 * @returns One likeness per aspect, and a rationale naming the extremes.
 * @throws {InvalidInputError} If either profile or the options cannot be read.
 * @throws {BudgetExceededError} If the progression alignment would exceed the budget.
 * @category Arrangement & Analysis
 */
export function compareReferences(
  a: ReferenceProfile,
  b: ReferenceProfile,
  opts?: ReferenceComparisonOptions,
): ReferenceComparison {
  assertReferenceProfile(a, 'reference profile a');
  assertReferenceProfile(b, 'reference profile b');
  const { budget } = assertOptions(opts, 'compare options');
  const structural = (profile: ReferenceProfile) =>
    profile.harmony.chords.filter((chord) => chord.level === 'structural');
  const cadences = (profile: ReferenceProfile) =>
    profile.form.phrases.map((phrase) => phrase.cadence?.type ?? null);
  const phraseMelodies = (profile: ReferenceProfile) =>
    profile.form.phrases.map((phrase) => phrase.melody);
  const comparison: Omit<ReferenceComparison, 'rationale'> = {
    form: {
      sectionSequenceSimilarity: sectionSequenceSimilarity(
        a.form.sections.map((section) => section.label),
        b.form.sections.map((section) => section.label),
      ),
      phraseLengthSimilarity: phraseLengthSimilarity(
        a.form.phrases.map((phrase) => phrase.bars),
        b.form.phrases.map((phrase) => phrase.bars),
      ),
    },
    harmony: {
      progressionSimilarity: progressionSimilarity(structural(a), structural(b), budget),
      functionSimilarity: functionSimilarity(a.harmony.chords, b.harmony.chords),
      cadenceSimilarity: cadenceSimilarity(cadences(a), cadences(b)),
      keyPlanSimilarity: keyPlanSimilarity(
        a.harmony.keys.map((region) => region.key),
        b.harmony.keys.map((region) => region.key),
      ),
      harmonicRhythmOnsetSimilarity: onsetSimilarity(a.harmony.rhythm, b.harmony.rhythm),
      harmonicRhythmDensitySimilarity: densitySimilarity(a.harmony.rhythm, b.harmony.rhythm),
    },
    melody: {
      surfaceSimilarity: surfaceSimilarity(a.melody.motifs, b.melody.motifs),
      motifStructureSimilarity: motifStructureSimilarity(
        { graph: a.melody.graph, spanBeats: a.span.endBeat - a.span.startBeat },
        { graph: b.melody.graph, spanBeats: b.span.endBeat - b.span.startBeat },
      ),
      contourSimilarity: contourSimilarity(phraseMelodies(a), phraseMelodies(b)),
      registerSimilarity: registerSimilarity(
        { phrases: phraseMelodies(a), mean: a.melody.register?.mean ?? null },
        { phrases: phraseMelodies(b), mean: b.melody.register?.mean ?? null },
      ),
    },
    rhythm: {
      onsetSimilarity: onsetSimilarity(a.melody.rhythm, b.melody.rhythm),
      densitySimilarity: densitySimilarity(a.melody.rhythm, b.melody.rhythm),
      durationSimilarity: durationSimilarity(a.melody.rhythm, b.melody.rhythm),
      syncopationSimilarity: syncopationSimilarity(a.melody.rhythm, b.melody.rhythm),
    },
  };
  return { ...comparison, rationale: rationaleOf(comparison) };
}
