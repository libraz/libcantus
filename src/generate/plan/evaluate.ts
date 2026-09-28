/**
 * Checking a candidate melody against the plan it was written for.
 *
 * The candidate is read with the plan's own harmony injected — a monophonic
 * line cannot be re-analyzed into the chords that judge it, so `planTimeline`
 * stands in for inference the way an arrangement's `timeline` option does. What
 * comes back is never one score: a list of concrete violations (which are
 * errors and which are only warnings), and a fit reading per structural
 * dimension, each measured the way {@link compareReferences} measures two
 * profiles against each other. Whether the piece is any good is left to the ear.
 */

import { BEAT_EPS } from '../../analyze/adjacency.js';
import { barSpanOf } from '../../analyze/form/internal.js';
import { functionOf } from '../../analyze/functional/function.js';
import { romanToChord } from '../../analyze/functional/roman.js';
import type { MotifGraph, MotifGraphEdge, MotifGraphNode } from '../../analyze/melody/graph.js';
import { melodicSimilarity } from '../../analyze/melody/similarity.js';
import {
  analyzeReference,
  type ContourPhrase,
  cadenceSimilarity,
  contourSimilarity,
  durationSimilarity,
  motifStructureSimilarity,
  onsetSimilarity,
  type ProgressionChord,
  phraseLengthSimilarity,
  progressionSimilarity,
  type ReferencePhrase,
  type RegisterPhrase,
  type RegisterPlan,
  registerSimilarity,
  sectionSequenceSimilarity,
  syncopationSimilarity,
} from '../../analyze/reference/index.js';
import type { BarPositionProfile } from '../../analyze/rhythm/index.js';
import { meterAt, pulseBeats } from '../../core/meter/index.js';
import type { NoteEvent } from '../../core/types.js';
import { assertOptions } from '../../core/validation/index.js';
import { type ResolvedKey, scaleOf } from '../../theory/scale/index.js';
import { deriveStatement } from '../melody/derive.js';
import type { MotifNote } from '../motif/index.js';
import { planHarmonyMisfits, planKeyAt } from './harmony.js';
import {
  type CompositionPlan,
  type PlannedMotif,
  type PlannedPhrase,
  plannedContourAt,
  planTimeline,
} from './types.js';
import { assertCompositionPlan } from './validate.js';

/**
 * `melodicSimilarity` a derivation with no named transformation must clear to
 * count as a variation rather than a broken derivation; matches
 * {@link motifGraph}'s own default.
 */
const VARIATION_THRESHOLD = 0.75;
/** Share of pitches a named derivation must keep once harmony repair has had its say. */
const DERIVED_PITCH_THRESHOLD = 0.75;
/** How far a phrase's actual peak position may drift from the planned one before it warns. */
const PEAK_POSITION_TOLERANCE = 0.2;
/** Sample points an outline is read at, matching {@link ReferencePhraseMelody.outline}. */
const OUTLINE_POINTS = 8;
/** Shortest note, in beats, whose end marks a phrase boundary. */
const HELD_NOTE_BEATS = 1;

/**
 * One way a candidate melody departs from its plan.
 *
 * @category Composition
 */
export type CompositionViolation = {
  /** What kind of departure this is. */
  kind:
    | 'span'
    | 'phraseBoundary'
    | 'cadence'
    | 'harmony'
    | 'motifDerivation'
    | 'motifRepaired'
    | 'register'
    | 'peakPosition';
  /** Whether this rules the candidate out, or only flags it. */
  severity: 'error' | 'warning';
  /** Where in the candidate this was found. */
  atBeat: number;
  /** What the plan called for. */
  expected: string;
  /** What the candidate did instead. */
  actual: string;
  /** Why this counts as a departure. */
  rationale: string;
};

/**
 * How a candidate melody measures up against its plan: violations that judge
 * it, and a fit reading per structural dimension.
 *
 * There is no aggregate: the fields never fold into one score, the same way
 * {@link ReferenceComparison} does not.
 *
 * @category Composition
 */
export type CompositionEvaluation = {
  /** Concrete departures from the plan, error and warning alike. */
  violations: CompositionViolation[];
  /** Likeness of the candidate to the plan, one field per structural dimension. */
  fit: {
    /** Likeness of the section-label sequences. */
    sectionSequence: number | null;
    /** Likeness of the phrase-length sequences. */
    phraseLength: number | null;
    /** Likeness of the structural Roman-numeral progressions. */
    progression: number | null;
    /** Likeness of the phrase-by-phrase cadence sequences. */
    cadence: number | null;
    /** Likeness of how the motifs derive from one another. */
    motifStructure: number | null;
    /** Likeness of the phrases' melodic outlines. */
    contour: number | null;
    /** Likeness of the phrases' registers. */
    register: number | null;
    /** Likeness of where the melody's onsets fall. */
    onset: number | null;
    /** Likeness of the melody's inter-onset-interval distribution. */
    duration: number | null;
    /** Likeness of the melody's syncopation. */
    syncopation: number | null;
  };
};

/** Options for {@link evaluateComposition}. */
export type EvaluateCompositionOptions = {
  /**
   * Upper bound on the work each analysis may do.
   *
   * @defaultValue {@link DEFAULT_GENERATION_BUDGET}
   */
  budget?: number;
};

/** The plan's phrase boundaries strictly inside its span, ascending. */
function interiorBoundaries(plan: CompositionPlan): number[] {
  const beats = new Set<number>();
  for (const phrase of plan.phrases) {
    for (const beat of [phrase.startBeat, phrase.endBeat]) {
      if (beat > plan.span.startBeat + BEAT_EPS && beat < plan.span.endBeat - BEAT_EPS) {
        beats.add(beat);
      }
    }
  }
  return [...beats].sort((a, b) => a - b);
}

/** Every stretch of silence in the candidate, from its span start to its span end. */
function restsOf(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): { startBeat: number; endBeat: number }[] {
  const rests: { startBeat: number; endBeat: number }[] = [];
  let reach = plan.span.startBeat;
  for (const note of [...melody].sort((a, b) => a.startBeat - b.startBeat)) {
    if (note.startBeat > reach + BEAT_EPS) {
      rests.push({ startBeat: reach, endBeat: note.startBeat });
    }
    reach = Math.max(reach, note.startBeat + note.durationBeat);
  }
  if (plan.span.endBeat > reach + BEAT_EPS) {
    rests.push({ startBeat: reach, endBeat: plan.span.endBeat });
  }
  return rests;
}

/**
 * Every planned phrase boundary inside the span that the candidate gives no
 * boundary signal for: within one pulse of it, neither a note of at least
 * {@link HELD_NOTE_BEATS} ends nor a rest of at least a pulse sounds.
 */
function phraseBoundaryViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): CompositionViolation[] {
  const rests = restsOf(melody, plan);
  const violations: CompositionViolation[] = [];
  for (const beat of interiorBoundaries(plan)) {
    const pulse = pulseBeats(meterAt(beat, plan.meters));
    const held = melody.some(
      (note) =>
        note.durationBeat >= HELD_NOTE_BEATS - BEAT_EPS &&
        Math.abs(note.startBeat + note.durationBeat - beat) <= pulse + BEAT_EPS,
    );
    const rested = rests.some(
      (rest) =>
        rest.endBeat - rest.startBeat >= pulse - BEAT_EPS &&
        rest.startBeat <= beat + pulse + BEAT_EPS &&
        rest.endBeat >= beat - pulse - BEAT_EPS,
    );
    if (!held && !rested) {
      violations.push({
        kind: 'phraseBoundary',
        severity: 'error',
        atBeat: beat,
        expected: `a note of at least ${HELD_NOTE_BEATS} beat(s) ending, or a rest of at least ${pulse} beat(s), within ${pulse} beat(s)`,
        actual: 'neither',
        rationale: `the plan places a phrase boundary at beat ${beat}, which the candidate does not mark`,
      });
    }
  }
  return violations;
}

/** The candidate phrase whose end lands within `tolerance` of a planned phrase's end, if any. */
function matchingPhrase(
  phrase: PlannedPhrase,
  candidatePhrases: readonly ReferencePhrase[],
  tolerance: number,
): ReferencePhrase | undefined {
  let best: ReferencePhrase | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidatePhrases) {
    const distance = Math.abs(candidate.endBeat - phrase.endBeat);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== undefined && bestDistance <= tolerance ? best : undefined;
}

/**
 * Every planned cadence a matched candidate phrase closes on differently.
 *
 * A plan phrase the candidate's own phrasing has no matching phrase for has
 * no candidate cadence to compare, and is skipped.
 */
function cadenceViolations(
  plan: CompositionPlan,
  candidatePhrases: readonly ReferencePhrase[],
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  for (const phrase of plan.phrases) {
    if (phrase.cadence === null) {
      continue;
    }
    const tolerance = pulseBeats(meterAt(phrase.endBeat, plan.meters));
    const match = matchingPhrase(phrase, candidatePhrases, tolerance);
    if (match === undefined) {
      continue;
    }
    const actual = match.cadence?.type ?? null;
    if (actual !== phrase.cadence) {
      violations.push({
        kind: 'cadence',
        severity: 'error',
        atBeat: phrase.endBeat,
        expected: phrase.cadence,
        actual: actual ?? 'none',
        rationale: `the phrase ending at beat ${phrase.endBeat} is planned to close on a ${phrase.cadence} cadence`,
      });
    }
  }
  return violations;
}

/** Every planned peak position a matched candidate phrase drifts from by more than the tolerance. */
function peakPositionWarnings(
  plan: CompositionPlan,
  candidatePhrases: readonly ReferencePhrase[],
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  for (const phrase of plan.phrases) {
    const tolerance = pulseBeats(meterAt(phrase.endBeat, plan.meters));
    const match = matchingPhrase(phrase, candidatePhrases, tolerance);
    if (match?.melody == null) {
      continue;
    }
    const drift = Math.abs(match.melody.peakPosition - phrase.peakPosition);
    if (drift > PEAK_POSITION_TOLERANCE) {
      violations.push({
        kind: 'peakPosition',
        severity: 'warning',
        atBeat: phrase.startBeat,
        expected: `a peak position within ${PEAK_POSITION_TOLERANCE} of ${phrase.peakPosition}`,
        actual: `${match.melody.peakPosition}`,
        rationale: `the phrase starting at beat ${phrase.startBeat} places its melodic peak further from the planned position than the tolerance allows`,
      });
    }
  }
  return violations;
}

/** Whether the candidate's last note runs past the plan's span. */
function spanViolation(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): CompositionViolation[] {
  const end = melody.reduce((max, note) => Math.max(max, note.startBeat + note.durationBeat), 0);
  if (end <= plan.span.endBeat + BEAT_EPS) {
    return [];
  }
  return [
    {
      kind: 'span',
      severity: 'error',
      atBeat: plan.span.endBeat,
      expected: `ending by beat ${plan.span.endBeat}`,
      actual: `ending at beat ${end}`,
      rationale: "the candidate's last note runs past the plan's span",
    },
  ];
}

/** Every pulse-level note that does not fit the planned harmony, read by {@link planHarmonyMisfits}. */
function harmonyViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): CompositionViolation[] {
  const misfits = planHarmonyMisfits(plan)(melody);
  const violations: CompositionViolation[] = [];
  misfits.forEach((kinds, index) => {
    if (kinds === null) {
      return;
    }
    const note = melody[index] as NoteEvent;
    violations.push({
      kind: 'harmony',
      severity: 'error',
      atBeat: note.startBeat,
      expected: 'a chord tone, suspension, appoggiatura, or anticipation',
      actual: kinds.length === 0 ? 'no harmonic label' : kinds.join(', '),
      rationale: `the note at beat ${note.startBeat} does not fit the planned harmony`,
    });
  });
  return violations;
}

/** The candidate's notes whose onsets fall in `[startBeat, endBeat)`. */
function notesInRange(
  melody: readonly NoteEvent[],
  startBeat: number,
  endBeat: number,
): NoteEvent[] {
  return melody.filter(
    (note) => note.startBeat >= startBeat - BEAT_EPS && note.startBeat < endBeat - BEAT_EPS,
  );
}

/** Notes as a statement cut at `endBeat`: nothing sounds past the span it was taken from. */
function cutStatement(notes: readonly MotifNote[], endBeat: number): MotifNote[] {
  return notes.map((note) => ({
    pitch: note.pitch,
    startBeat: note.startBeat,
    durationBeat: Math.min(note.durationBeat, endBeat - note.startBeat),
  }));
}

/** How a derived statement compares with its expected notes: rhythm identical, and the share of pitches kept. */
function compareStatements(
  expected: readonly MotifNote[],
  actual: readonly MotifNote[],
): { rhythm: boolean; pitchShare: number } {
  if (expected.length !== actual.length) {
    return { rhythm: false, pitchShare: 0 };
  }
  let rhythm = true;
  let kept = 0;
  expected.forEach((want, index) => {
    const got = actual[index] as MotifNote;
    rhythm &&=
      Math.abs(got.startBeat - want.startBeat) <= BEAT_EPS &&
      Math.abs(got.durationBeat - want.durationBeat) <= BEAT_EPS;
    kept += got.pitch === want.pitch ? 1 : 0;
  });
  return { rhythm, pitchShare: kept / expected.length };
}

/**
 * Every planned derivation the candidate's own notes do not carry out. A named
 * relation is replayed on the candidate's source notes, the way generation
 * replays it: the derived notes must keep every onset and duration and at least
 * {@link DERIVED_PITCH_THRESHOLD} of the pitches, and a derivation that keeps
 * fewer than all of them warns that harmony repair bent it. A variation must be
 * alike enough to its source to count as one.
 */
function motifDerivationViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): CompositionViolation[] {
  const keyAt = planKeyAt(plan);
  const violations: CompositionViolation[] = [];
  for (const statement of plan.motifs) {
    if (statement.from === null) {
      continue;
    }
    const source = plan.motifs[statement.from] as PlannedMotif;
    const sourceNotes = notesInRange(melody, source.startBeat, source.endBeat);
    const derivedNotes = notesInRange(melody, statement.startBeat, statement.endBeat);
    const relation = statement.relation;
    let severity: CompositionViolation['severity'] | null = null;
    let actual: string;
    if (sourceNotes.length === 0 || derivedNotes.length === 0) {
      severity = 'error';
      actual = 'no notes to compare';
    } else if (relation === null) {
      const similarity = melodicSimilarity(sourceNotes, derivedNotes);
      severity = similarity < VARIATION_THRESHOLD ? 'error' : null;
      actual = `melodicSimilarity ${similarity.toFixed(3)}`;
    } else {
      const expected = cutStatement(
        deriveStatement(
          cutStatement(sourceNotes, source.endBeat),
          relation,
          statement.startBeat,
          scaleOf(keyAt(statement.startBeat)),
        ),
        statement.endBeat,
      );
      const { rhythm, pitchShare } = compareStatements(
        expected,
        cutStatement(derivedNotes, statement.endBeat),
      );
      if (!rhythm || pitchShare < DERIVED_PITCH_THRESHOLD) {
        severity = 'error';
      } else if (pitchShare < 1) {
        severity = 'warning';
      }
      actual = rhythm
        ? `${(pitchShare * 100).toFixed(0)}% of pitches kept`
        : 'onsets or durations differ';
    }
    if (severity === 'error') {
      violations.push({
        kind: 'motifDerivation',
        severity,
        atBeat: statement.startBeat,
        expected:
          relation === null
            ? `a variation (melodicSimilarity >= ${VARIATION_THRESHOLD})`
            : relation.kind,
        actual,
        rationale: `the statement at beat ${statement.startBeat} does not derive from its source the way the plan names`,
      });
    } else if (severity === 'warning') {
      violations.push({
        kind: 'motifRepaired',
        severity,
        atBeat: statement.startBeat,
        expected: `${relation?.kind} with every pitch kept`,
        actual,
        rationale: `the statement at beat ${statement.startBeat} keeps its planned derivation, with some pitches moved to fit the harmony or register`,
      });
    }
  }
  return violations;
}

/** The planned phrase a beat falls in, if any. */
function phraseAt(plan: CompositionPlan, beat: number): PlannedPhrase | undefined {
  return plan.phrases.find(
    (phrase) => beat >= phrase.startBeat - BEAT_EPS && beat < phrase.endBeat - BEAT_EPS,
  );
}

/** Every note whose pitch falls outside its phrase's planned register. */
function registerViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  for (const note of melody) {
    const phrase = phraseAt(plan, note.startBeat);
    if (phrase === undefined) {
      continue;
    }
    if (note.pitch < phrase.register.low || note.pitch > phrase.register.high) {
      violations.push({
        kind: 'register',
        severity: 'error',
        atBeat: note.startBeat,
        expected: `a pitch within [${phrase.register.low}, ${phrase.register.high}]`,
        actual: `pitch ${note.pitch}`,
        rationale: `the note at beat ${note.startBeat} falls outside its phrase's planned register`,
      });
    }
  }
  return violations;
}

/** A phrase's outline as its own target curve would draw it, sampled the way {@link ReferencePhraseMelody.outline} is. */
function planOutline(phrase: PlannedPhrase): number[] {
  const amplitude = (phrase.register.high - phrase.register.low) / 2;
  const outline: number[] = [];
  for (let k = 0; k < OUTLINE_POINTS; k += 1) {
    const t = (k + 0.5) / OUTLINE_POINTS;
    outline.push(
      phrase.register.mean + plannedContourAt(phrase.shape, phrase.peakPosition, t) * amplitude,
    );
  }
  return outline;
}

/** A planned phrase, read as the contour measure reads a reference phrase. */
function planContourPhrase(phrase: PlannedPhrase): ContourPhrase {
  return {
    shape: phrase.shape,
    low: phrase.register.low,
    high: phrase.register.high,
    outline: planOutline(phrase),
  };
}

/** A plan's phrases and their duration-weighted overall mean, read as the register measure reads a reference. */
function planRegisterPlan(plan: CompositionPlan): RegisterPlan {
  const phrases: (RegisterPhrase | null)[] = plan.phrases.map((phrase) => ({
    low: phrase.register.low,
    high: phrase.register.high,
    mean: phrase.register.mean,
    peakPosition: phrase.peakPosition,
  }));
  let weighted = 0;
  let weight = 0;
  for (const phrase of plan.phrases) {
    const length = phrase.endBeat - phrase.startBeat;
    weighted += phrase.register.mean * length;
    weight += length;
  }
  return { phrases, mean: weight > 0 ? weighted / weight : null };
}

/** A plan's harmony, read as the progression measure reads a reduced chord. */
function planProgressionChords(plan: CompositionPlan): ProgressionChord[] {
  return plan.harmony.map((planned) => {
    const key = plan.keys[planned.key] as ResolvedKey;
    return { roman: planned.roman, function: functionOf(romanToChord(planned.roman, key), key) };
  });
}

/** A plan's motif statements, read as one graph node each with the derivation edges the plan names. */
function planMotifGraph(plan: CompositionPlan): MotifGraph {
  const nodes: MotifGraphNode[] = plan.motifs.map((motif, index) => ({
    motif: index,
    occurrence: 0,
    startBeat: motif.startBeat,
    endBeat: motif.endBeat,
  }));
  const edges: MotifGraphEdge[] = plan.motifs.flatMap((motif, index) =>
    motif.from === null
      ? []
      : [{ from: motif.from, to: index, relation: motif.relation, similarity: 1 }],
  );
  return { nodes, edges };
}

/** A plan's rhythmic target, read as the onset/duration/syncopation measures read a reading with no bar-position detail. */
function planRhythmReading(plan: CompositionPlan): {
  onsets: number;
  onsetLevels: number[];
  barPositions: BarPositionProfile[];
  interOnsetShares: number[];
  syncopation: number;
} {
  const hasOnsets = plan.rhythm.onsetLevels.some((share) => share > 0);
  return {
    onsets: hasOnsets ? 1 : 0,
    onsetLevels: plan.rhythm.onsetLevels,
    barPositions: [],
    interOnsetShares: plan.rhythm.interOnsetShares,
    syncopation: plan.rhythm.syncopation,
  };
}

/**
 * Check a candidate melody against the plan it was written for.
 *
 * The candidate is analyzed with the plan's own harmony injected —
 * `planTimeline(plan)` stands in for the chord inference a monophonic line
 * cannot support on its own — so every violation and fit reading below judges
 * the melody against the harmony the plan actually calls for, not a guess an
 * analyzer would make from the notes alone.
 *
 * Violations name concrete departures at a beat: `span` and `harmony` and
 * `register` and `cadence` and `phraseBoundary` and `motifDerivation` are
 * errors, `peakPosition` and `motifRepaired` are warnings. The fit fields, one per structural
 * dimension, are measured the way {@link compareReferences} measures two
 * profiles — never folded into one score.
 *
 * @param melody The candidate melody, in time order.
 * @param plan The plan it was written for.
 * @param opts The work budget.
 * @returns The violations found and the fit reading.
 * @throws {InvalidInputError} If the plan or the melody cannot be read.
 * @throws {BudgetExceededError} If an analysis would exceed the budget.
 * @example
 * ```ts
 * import { evaluateComposition, planTimeline, resolveKey } from '@libraz/libcantus';
 * const plan = {
 *   planVersion: 1, seed: 0, algorithmVersion: 1,
 *   keys: [resolveKey('C major')],
 *   meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
 *   span: { startBeat: 0, endBeat: 4, bars: 1 },
 *   sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
 *   phrases: [
 *     {
 *       startBeat: 0, endBeat: 4, section: 0, cadence: null, shape: 'ascending',
 *       peakPosition: 1, register: { low: 60, high: 67, mean: 64 }, onsetDensity: 4, motifs: [],
 *     },
 *   ],
 *   harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
 *   motifs: [],
 *   rhythm: { onsetLevels: [0, 0, 0, 1, 0, 0], interOnsetShares: new Array(17).fill(0), syncopation: 0 },
 * };
 * const melody = [
 *   { pitch: 60, startBeat: 0, durationBeat: 1 },
 *   { pitch: 64, startBeat: 1, durationBeat: 1 },
 *   { pitch: 67, startBeat: 2, durationBeat: 1 },
 *   { pitch: 60, startBeat: 3, durationBeat: 1 },
 * ];
 * evaluateComposition(melody, plan).violations; // []
 * ```
 * @category Composition
 */
export function evaluateComposition(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
  opts?: EvaluateCompositionOptions,
): CompositionEvaluation {
  assertCompositionPlan(plan, 'evaluated plan');
  const { budget } = assertOptions(opts, 'evaluate options');
  const candidate = analyzeReference(melody, {
    meters: plan.meters,
    key: plan.keys[0],
    timeline: planTimeline(plan),
    totalBeats: plan.span.endBeat,
    budget,
  });

  const violations: CompositionViolation[] = [
    ...spanViolation(melody, plan),
    ...phraseBoundaryViolations(melody, plan),
    ...cadenceViolations(plan, candidate.form.phrases),
    ...harmonyViolations(melody, plan),
    ...motifDerivationViolations(melody, plan),
    ...registerViolations(melody, plan),
    ...peakPositionWarnings(plan, candidate.form.phrases),
  ];

  const candidateStructural = candidate.harmony.chords.filter(
    (chord) => chord.level === 'structural',
  );
  const fit: CompositionEvaluation['fit'] = {
    sectionSequence: sectionSequenceSimilarity(
      plan.sections.map((section) => section.label),
      candidate.form.sections.map((section) => section.label),
    ),
    phraseLength: phraseLengthSimilarity(
      plan.phrases.map((phrase) => barSpanOf(phrase.startBeat, phrase.endBeat, plan.meters)),
      candidate.form.phrases.map((phrase) => phrase.bars),
    ),
    progression: progressionSimilarity(planProgressionChords(plan), candidateStructural, budget),
    cadence: cadenceSimilarity(
      plan.phrases.map((phrase) => phrase.cadence),
      candidate.form.phrases.map((phrase) => phrase.cadence?.type ?? null),
    ),
    motifStructure: motifStructureSimilarity(
      { graph: planMotifGraph(plan), spanBeats: plan.span.endBeat - plan.span.startBeat },
      {
        graph: candidate.melody.graph,
        spanBeats: candidate.span.endBeat - candidate.span.startBeat,
      },
    ),
    contour: contourSimilarity(
      plan.phrases.map(planContourPhrase),
      candidate.form.phrases.map((phrase) => phrase.melody),
    ),
    register: registerSimilarity(planRegisterPlan(plan), {
      phrases: candidate.form.phrases.map((phrase) => phrase.melody),
      mean: candidate.melody.register?.mean ?? null,
    }),
    onset: onsetSimilarity(planRhythmReading(plan), candidate.melody.rhythm),
    duration: durationSimilarity(planRhythmReading(plan), candidate.melody.rhythm),
    syncopation: syncopationSimilarity(planRhythmReading(plan), candidate.melody.rhythm),
  };

  return { violations, fit };
}
