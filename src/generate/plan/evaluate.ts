/**
 * Checking a candidate melody against the plan it was written for.
 *
 * The candidate is read against the plan itself, never re-analyzed: its
 * phrases are the plan's phrases, its harmony is the plan's through
 * `planTimeline`, and its derivations are replayed from the candidate's own
 * source statements. What comes back is never one score: a list of concrete
 * violations (which are errors and which are only warnings), and a fit reading
 * per dimension, each measured the way {@link compareReferences} measures two
 * profiles against each other. Whether the piece is any good is left to the ear.
 */

import { BEAT_EPS } from '../../analyze/adjacency.js';
import { barSpanOf } from '../../analyze/form/internal.js';
import { DEFAULT_VARIATION_THRESHOLD } from '../../analyze/melody/graph.js';
import type { MotifRelationSummary } from '../../analyze/melody/relation.js';
import { melodicSimilarity } from '../../analyze/melody/similarity.js';
import {
  type ContourPhrase,
  contourSimilarity,
  densitySimilarity,
  durationSimilarity,
  onsetSimilarity,
  type RegisterPhrase,
  type RegisterPlan,
  registerSimilarity,
  syncopationSimilarity,
} from '../../analyze/reference/measures.js';
import { phraseMelody } from '../../analyze/reference/profile.js';
import type { ReferencePhraseMelody } from '../../analyze/reference/types.js';
import { analyzeRhythm, type BarPositionProfile } from '../../analyze/rhythm/index.js';
import type { ChordTimeline } from '../../analyze/timeline/index.js';
import { meterAt, pulseBeats } from '../../core/meter/index.js';
import { pitchClassOf } from '../../core/pitch/index.js';
import type { KeyScale, NoteEvent } from '../../core/types.js';
import { assertNoteEvents, assertOptions } from '../../core/validation/index.js';
import { scaleOf } from '../../theory/scale/index.js';
import { clipStatement, relationLevels, replayAt } from '../melody/derive.js';
import type { MotifNote } from '../motif/index.js';
import { cadencePitchClasses, planHarmonyMisfits, planKeyAt, positionClass } from './harmony.js';
import { planChordTimeline } from './timeline.js';
import {
  type CompositionPlan,
  type PlannedMotif,
  type PlannedPhrase,
  plannedContourAt,
} from './types.js';
import { assertCompositionPlan } from './validate.js';

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
    | 'motifDisplaced'
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
  /** Likeness of the candidate to the plan, one field per dimension, each phrase read over its planned span. */
  fit: {
    /** Likeness of the phrases' melodic outlines to their planned shapes. */
    contour: number | null;
    /** Likeness of the phrases' registers to the planned ones. */
    register: number | null;
    /** Likeness of where the melody's onsets fall. */
    onset: number | null;
    /** Likeness of the melody's inter-onset-interval distribution. */
    duration: number | null;
    /** Likeness of the melody's syncopation. */
    syncopation: number | null;
    /** Likeness of the melody's onsets per bar to the phrases' planned densities. */
    density: number | null;
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

/** A phrase's notes, as indices into the time-ordered candidate, one list per planned phrase. */
function phraseLines(melody: readonly NoteEvent[], plan: CompositionPlan): number[][] {
  return plan.phrases.map((phrase) =>
    melody.flatMap((note, index) =>
      note.startBeat >= phrase.startBeat - BEAT_EPS && note.startBeat < phrase.endBeat - BEAT_EPS
        ? [index]
        : [],
    ),
  );
}

/**
 * Every planned cadence whose phrase does not close on a tone the cadence
 * allows: the closing note is the phrase's latest onset, read against the
 * cadence's degrees in the key of the chord sounding there.
 */
function cadenceViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
  timeline: ChordTimeline,
  lines: readonly number[][],
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  plan.phrases.forEach((phrase, index) => {
    if (phrase.cadence === null) {
      return;
    }
    const last = lines[index]?.at(-1);
    const note = last === undefined ? undefined : melody[last];
    const allowed =
      note === undefined ? [] : cadencePitchClasses(plan, timeline, phrase.cadence, note.startBeat);
    if (note !== undefined && (allowed === null || allowed.includes(pitchClassOf(note.pitch)))) {
      return;
    }
    violations.push({
      kind: 'cadence',
      severity: 'error',
      atBeat: phrase.endBeat,
      expected: `a closing note on pitch class ${(allowed ?? []).join(' or ')} for a ${phrase.cadence} cadence`,
      actual: note === undefined ? 'no note' : `pitch ${note.pitch}`,
      rationale: `the phrase ending at beat ${phrase.endBeat} is planned to close on a ${phrase.cadence} cadence`,
    });
  });
  return violations;
}

/**
 * Every note that does not fit the planned harmony, read phrase by phrase by
 * {@link planHarmonyMisfits}. A misfit inside a derived statement is only a
 * warning: the transformation takes precedence over the harmony there.
 */
function harmonyViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
  timeline: ChordTimeline,
  lines: readonly number[][],
): CompositionViolation[] {
  const misfits = planHarmonyMisfits(plan, timeline);
  const violations: CompositionViolation[] = [];
  for (const line of lines) {
    const read = misfits(line.map((index) => melody[index] as NoteEvent));
    read.forEach((kinds, at) => {
      if (kinds === null) {
        return;
      }
      const note = melody[line[at] as number] as NoteEvent;
      const derived = plan.motifs.some(
        (motif) =>
          motif.from !== null &&
          note.startBeat >= motif.startBeat - BEAT_EPS &&
          note.startBeat < motif.endBeat - BEAT_EPS,
      );
      const strong = positionClass(note.startBeat, plan.meters) === 'strong';
      violations.push({
        kind: 'harmony',
        severity: derived ? 'warning' : 'error',
        atBeat: note.startBeat,
        expected: strong
          ? 'a chord tone or an ornamental tone'
          : 'a chord tone, an ornamental tone, or a scale tone',
        actual: kinds.length === 0 ? 'no harmonic label' : kinds.join(', '),
        rationale: derived
          ? `the note at beat ${note.startBeat} sits in a derived statement, whose transformation takes precedence over the harmony`
          : `the note at beat ${note.startBeat} does not fit the planned harmony`,
      });
    });
  }
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

/** A pitch level a derived statement replays its source at, and how many of its notes that leaves excused. */
type Replay = { level: number; forced: number };

/**
 * The pitch level nearest the planned one at which a derived statement's own
 * notes replay its source, or null when none does. At a level, the replay must
 * have as many notes and the same onset intervals, and every pitch must match
 * unless it is excused: the derived phrase's closing note, a note replaying the
 * source phrase's closing note, or — at a level leaving the fewest replayed
 * pitches outside the derived phrase's register, the only levels a generator
 * falls back to — a replayed pitch outside that register. Durations are not
 * compared.
 */
function replayLevel(
  source: readonly NoteEvent[],
  derived: readonly NoteEvent[],
  statement: PlannedMotif,
  sourceEnd: number,
  plan: CompositionPlan,
  key: KeyScale,
  closing: ReadonlySet<NoteEvent>,
): Replay | null {
  const relation = statement.relation as MotifRelationSummary;
  const planned =
    relation.kind === 'tonalTransposition' ? (relation.degrees ?? 0) : relation.semitones;
  const { low, high } = (plan.phrases[statement.phrase] as PlannedPhrase).register;
  const outside = (pitch: number) => pitch < low || pitch > high;
  const backward = relation.kind === 'retrograde' || relation.kind === 'retrogradeInversion';
  const cell = clipStatement(
    source.map((note) => ({
      pitch: note.pitch,
      startBeat: note.startBeat,
      durationBeat: note.durationBeat,
    })),
    sourceEnd,
  );
  const replays = relationLevels(relation.kind).map((level) => {
    const notes = clipStatement(
      replayAt(cell, relation, level, statement.startBeat, key),
      statement.endBeat,
    );
    return { level, notes, outside: notes.filter((note) => outside(note.pitch)).length };
  });
  const fewestOutside = Math.min(...replays.map((replay) => replay.outside));
  let best: Replay | null = null;
  for (const { level, notes: expected, outside: away } of replays) {
    if (expected.length !== derived.length) {
      continue;
    }
    let forced = 0;
    let holds = true;
    for (let i = 0; holds && i < expected.length; i += 1) {
      const want = expected[i] as MotifNote;
      const got = derived[i] as NoteEvent;
      if (i > 0) {
        const gap = got.startBeat - (derived[i - 1] as NoteEvent).startBeat;
        holds =
          Math.abs(gap - (want.startBeat - (expected[i - 1] as MotifNote).startBeat)) <= BEAT_EPS;
      }
      if (!holds || got.pitch === want.pitch) {
        continue;
      }
      const origin = source[backward ? cell.length - 1 - i : i];
      forced += 1;
      holds =
        closing.has(got) ||
        (origin !== undefined && closing.has(origin)) ||
        (away === fewestOutside && outside(want.pitch));
    }
    const distance = Math.abs(level - planned);
    const nearer =
      best === null ||
      distance < Math.abs(best.level - planned) ||
      (distance === Math.abs(best.level - planned) && level < best.level);
    if (holds && nearer) {
      best = { level, forced };
    }
  }
  return best;
}

/**
 * Every planned derivation the candidate's own notes do not carry out, as an
 * error, and every one carried out at another pitch level than planned or with
 * excused notes, as a `motifDisplaced` warning. A variation must be alike
 * enough to its source to count as one.
 */
function motifDerivationViolations(
  melody: readonly NoteEvent[],
  plan: CompositionPlan,
  closing: ReadonlySet<NoteEvent>,
): { errors: CompositionViolation[]; warnings: CompositionViolation[] } {
  const keyAt = planKeyAt(plan);
  const errors: CompositionViolation[] = [];
  const warnings: CompositionViolation[] = [];
  for (const statement of plan.motifs) {
    if (statement.from === null) {
      continue;
    }
    const source = plan.motifs[statement.from] as PlannedMotif;
    const sourceNotes = notesInRange(melody, source.startBeat, source.endBeat);
    const derivedNotes = notesInRange(melody, statement.startBeat, statement.endBeat);
    const relation = statement.relation;
    const rationale = `the statement at beat ${statement.startBeat} does not derive from its source the way the plan names`;
    if (sourceNotes.length === 0 || derivedNotes.length === 0) {
      errors.push({
        kind: 'motifDerivation',
        severity: 'error',
        atBeat: statement.startBeat,
        expected: relation === null ? 'a variation' : relation.kind,
        actual: 'no notes to compare',
        rationale,
      });
      continue;
    }
    if (relation === null) {
      const similarity = melodicSimilarity(sourceNotes, derivedNotes);
      if (similarity < DEFAULT_VARIATION_THRESHOLD) {
        errors.push({
          kind: 'motifDerivation',
          severity: 'error',
          atBeat: statement.startBeat,
          expected: `a variation (melodicSimilarity >= ${DEFAULT_VARIATION_THRESHOLD})`,
          actual: `melodicSimilarity ${similarity.toFixed(3)}`,
          rationale,
        });
      }
      continue;
    }
    const replay = replayLevel(
      sourceNotes,
      derivedNotes,
      statement,
      source.endBeat,
      plan,
      scaleOf(keyAt(statement.startBeat)),
      closing,
    );
    const planned =
      relation.kind === 'tonalTransposition' ? (relation.degrees ?? 0) : relation.semitones;
    if (replay === null) {
      errors.push({
        kind: 'motifDerivation',
        severity: 'error',
        atBeat: statement.startBeat,
        expected: relation.kind,
        actual: 'no pitch level replays the source',
        rationale,
      });
    } else if (replay.level !== planned || replay.forced > 0) {
      warnings.push({
        kind: 'motifDisplaced',
        severity: 'warning',
        atBeat: statement.startBeat,
        expected: `${relation.kind} at level ${planned} with every pitch replayed`,
        actual: `level ${replay.level}, ${replay.forced} excused note(s)`,
        rationale: `the statement at beat ${statement.startBeat} carries out its planned derivation at another pitch level or with notes excused`,
      });
    }
  }
  return { errors, warnings };
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

/** Every planned peak position the candidate's phrase drifts from by more than the tolerance. */
function peakPositionWarnings(
  plan: CompositionPlan,
  readings: readonly (ReferencePhraseMelody | null)[],
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  plan.phrases.forEach((phrase, index) => {
    const reading = readings[index];
    if (reading == null) {
      return;
    }
    const drift = Math.abs(reading.peakPosition - phrase.peakPosition);
    if (drift > PEAK_POSITION_TOLERANCE) {
      violations.push({
        kind: 'peakPosition',
        severity: 'warning',
        atBeat: phrase.startBeat,
        expected: `a peak position within ${PEAK_POSITION_TOLERANCE} of ${phrase.peakPosition}`,
        actual: `${reading.peakPosition}`,
        rationale: `the phrase starting at beat ${phrase.startBeat} places its melodic peak further from the planned position than the tolerance allows`,
      });
    }
  });
  return violations;
}

/** The candidate's duration-weighted mean pitch, or null when nothing sounds. */
function lineMeanOf(melody: readonly NoteEvent[]): number | null {
  let weighted = 0;
  let total = 0;
  for (const note of melody) {
    weighted += note.pitch * note.durationBeat;
    total += note.durationBeat;
  }
  return total > 0 ? weighted / total : null;
}

/** A plan's onset density, the phrases' targets weighted by their bar counts. */
function planDensity(plan: CompositionPlan): { onsets: number; onsetDensity: number } {
  let weighted = 0;
  let bars = 0;
  for (const phrase of plan.phrases) {
    const span = barSpanOf(phrase.startBeat, phrase.endBeat, plan.meters);
    weighted += phrase.onsetDensity * span;
    bars += span;
  }
  return { onsets: 1, onsetDensity: bars > 0 ? weighted / bars : 0 };
}

/**
 * Check a candidate melody against the plan it was written for.
 *
 * The candidate is read against the plan itself — its phrases, its harmony
 * through {@link planTimeline}, its derivations — rather than re-analyzed into
 * a profile, so every violation and fit reading judges the melody against what
 * the plan actually calls for.
 *
 * Violations name concrete departures at a beat. `span`, `phraseBoundary`,
 * `cadence`, `register` and `motifDerivation` are errors. `harmony` is an
 * error, or a warning for a note inside a derived statement, where the
 * transformation takes precedence. A derived statement passes at any pitch
 * level its relation admits, with its durations free and its closing and
 * out-of-register notes excused; `motifDisplaced` warns when that level is not
 * the planned one or a note was excused. `peakPosition` is a warning. The fit
 * fields, one per dimension, read each planned phrase of the candidate the way
 * a reference profile reads its phrases and measure it as
 * {@link compareReferences} would — never folded into one score.
 *
 * @param melody The candidate melody.
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
 *       peakPosition: 0.5, register: { low: 60, high: 67, mean: 64 }, onsetDensity: 4, motifs: [],
 *     },
 *   ],
 *   harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
 *   motifs: [],
 *   rhythm: { onsetLevels: [0, 0, 0, 1, 0, 0], interOnsetShares: new Array(17).fill(0).fill(1, 8, 9), syncopation: 0 },
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
  const notes = [
    ...assertNoteEvents(melody, 'evaluated melody', { budget, allowNonPositiveDuration: true }),
  ].sort((a, b) => a.startBeat - b.startBeat);
  const timeline = planChordTimeline(plan);
  const lines = phraseLines(notes, plan);
  const closing = new Set(
    lines.flatMap((line) => (line.length === 0 ? [] : [notes[line.at(-1) as number] as NoteEvent])),
  );
  const derivations = motifDerivationViolations(notes, plan, closing);

  const lineMean = lineMeanOf(notes);
  const readings = plan.phrases.map((phrase) =>
    phraseMelody(notes, phrase.startBeat, phrase.endBeat, lineMean ?? 0, plan.meters, budget),
  );
  const violations: CompositionViolation[] = [
    ...spanViolation(notes, plan),
    ...phraseBoundaryViolations(notes, plan),
    ...cadenceViolations(notes, plan, timeline, lines),
    ...harmonyViolations(notes, plan, timeline, lines),
    ...registerViolations(notes, plan),
    ...derivations.errors,
    ...derivations.warnings,
    ...peakPositionWarnings(plan, readings),
  ];

  const rhythm = analyzeRhythm(notes, {
    meters: plan.meters,
    totalBeats: plan.span.endBeat,
    budget,
  });
  const target = planRhythmReading(plan);
  const fit: CompositionEvaluation['fit'] = {
    contour: contourSimilarity(plan.phrases.map(planContourPhrase), readings),
    register: registerSimilarity(planRegisterPlan(plan), { phrases: readings, mean: lineMean }),
    onset: onsetSimilarity(target, rhythm),
    duration: durationSimilarity(target, rhythm),
    syncopation: syncopationSimilarity(target, rhythm),
    density: densitySimilarity(planDensity(plan), rhythm),
  };

  return { violations, fit };
}
