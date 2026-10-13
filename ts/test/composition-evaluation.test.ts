import { describe, expect, it } from 'vitest';
import { analyzeReference } from '../src/analyze/reference/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import { deriveCompositionPlan } from '../src/generate/plan/derive.js';
import { evaluateComposition } from '../src/generate/plan/evaluate.js';
import { COMPOSITION_PLAN_VERSION, type CompositionPlan } from '../src/generate/plan/types.js';
import { resolveKey } from '../src/theory/scale/index.js';
import {
  type ReferenceFixture,
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

const METERS = [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }];
const C_MAJOR = resolveKey('C major');
const RHYTHM_LEVELS = 6;
const IOI_BINS = 17;

/** A minimal valid rhythmic target: the tests below never check the rhythm fit fields' exact figures. */
function zeroRhythm(): CompositionPlan['rhythm'] {
  const onsetLevels = new Array(RHYTHM_LEVELS).fill(0);
  onsetLevels[0] = 1;
  const interOnsetShares = new Array(IOI_BINS).fill(0);
  interOnsetShares[0] = 1;
  return { onsetLevels, interOnsetShares, syncopation: 0 };
}

/**
 * The plan an eight-note, two-bar melody satisfies exactly: I then V, a root
 * motif of four chord tones and its literal transposition up a fifth, one
 * phrase the reference analysis reads as `wave`-shaped with a half cadence.
 * The phrase figures are read off `analyzeReference` of `baseMelody()` with
 * this plan's own harmony injected, not guessed.
 */
function basePlan(): CompositionPlan {
  return {
    planVersion: COMPOSITION_PLAN_VERSION,
    seed: 1,
    algorithmVersion: ALGORITHM_VERSION,
    keys: [C_MAJOR],
    meters: METERS,
    span: { startBeat: 0, endBeat: 8, bars: 2 },
    sections: [{ label: 'A', startBeat: 0, endBeat: 8 }],
    phrases: [
      {
        startBeat: 0,
        endBeat: 8,
        section: 0,
        cadence: 'half',
        shape: 'wave',
        peakPosition: 0.875,
        register: { low: 60, high: 79, mean: 69.25 },
        onsetDensity: 4,
        motifs: [0, 1],
      },
    ],
    harmony: [
      { startBeat: 0, endBeat: 4, key: 0, roman: 'I' },
      { startBeat: 4, endBeat: 8, key: 0, roman: 'V' },
    ],
    motifs: [
      {
        phrase: 0,
        startBeat: 0,
        endBeat: 4,
        notes: 4,
        rhythm: [1, 1, 1],
        from: null,
        relation: null,
      },
      {
        phrase: 0,
        startBeat: 4,
        endBeat: 8,
        notes: 4,
        rhythm: null,
        from: 0,
        relation: { kind: 'transposition', sequence: true, semitones: 7, timeRatio: 1 },
      },
    ],
    rhythm: {
      onsetLevels: [0, 0, 0, 0.5, 0.25, 0.25],
      interOnsetShares: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      syncopation: 0,
    },
  };
}

/** The melody `basePlan()` was read off: C major I arpeggio, then the same shape a fifth up over V. */
function baseMelody() {
  return [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 64, startBeat: 1, durationBeat: 1 },
    { pitch: 67, startBeat: 2, durationBeat: 1 },
    { pitch: 72, startBeat: 3, durationBeat: 1 },
    { pitch: 67, startBeat: 4, durationBeat: 1 },
    { pitch: 71, startBeat: 5, durationBeat: 1 },
    { pitch: 74, startBeat: 6, durationBeat: 1 },
    { pitch: 79, startBeat: 7, durationBeat: 1 },
  ];
}

describe('evaluateComposition: a melody that satisfies its plan', () => {
  it('reports no error violations', () => {
    const result = evaluateComposition(baseMelody(), basePlan());
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('reports no violations at all', () => {
    const result = evaluateComposition(baseMelody(), basePlan());
    expect(result.violations).toEqual([]);
  });

  it('reports high fit on every field that has material', () => {
    const { fit } = evaluateComposition(baseMelody(), basePlan());
    for (const [name, value] of Object.entries(fit)) {
      expect(value, name).not.toBeNull();
      expect(value as number, name).toBeGreaterThan(0.5);
    }
  });

  it('never folds the fit fields into one aggregate', () => {
    const { fit } = evaluateComposition(baseMelody(), basePlan());
    expect(fit).not.toHaveProperty('score');
    expect(fit).not.toHaveProperty('overall');
    expect(Object.keys(fit).sort()).toEqual(
      ['contour', 'density', 'duration', 'onset', 'register', 'syncopation'].sort(),
    );
  });
});

describe('evaluateComposition: one violation kind at a time', () => {
  it('flags span: the candidate runs past the plan', () => {
    const melody = baseMelody();
    melody[7] = { ...(melody[7] as (typeof melody)[number]), durationBeat: 2 };
    const result = evaluateComposition(melody, basePlan());
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'span', severity: 'error', atBeat: 8 }),
    ]);
  });

  /** `basePlan()` split into two phrases at beat 4. */
  function splitPlan(): CompositionPlan {
    const plan = basePlan();
    plan.phrases = [
      {
        startBeat: 0,
        endBeat: 4,
        section: 0,
        cadence: null,
        shape: 'ascending',
        peakPosition: 0.75,
        register: { low: 60, high: 72, mean: 65.75 },
        onsetDensity: 4,
        motifs: [0],
      },
      {
        startBeat: 4,
        endBeat: 8,
        section: 0,
        cadence: null,
        shape: 'ascending',
        peakPosition: 0.875,
        register: { low: 67, high: 79, mean: 72.75 },
        onsetDensity: 4,
        motifs: [1],
      },
    ];
    return plan;
  }

  /** Quarters on beats 0-1 and 6-7, eighths between, with `gaps` onsets left silent. */
  function eighthsMelody(gaps: readonly number[] = []) {
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
    ];
    for (let beat = 2; beat < 6; beat += 0.5) {
      if (!gaps.includes(beat)) melody.push({ pitch: 67, startBeat: beat, durationBeat: 0.5 });
    }
    melody.push(
      { pitch: 67, startBeat: 6, durationBeat: 1 },
      { pitch: 71, startBeat: 7, durationBeat: 1 },
    );
    return melody;
  }

  const boundaryViolations = (result: ReturnType<typeof evaluateComposition>) =>
    result.violations.filter((v) => v.kind === 'phraseBoundary');

  it('flags phraseBoundary: no held note or rest marks a planned split', () => {
    expect(boundaryViolations(evaluateComposition(eighthsMelody(), splitPlan()))).toEqual([
      expect.objectContaining({ kind: 'phraseBoundary', severity: 'error', atBeat: 4 }),
    ]);
  });

  it('accepts a planned split marked by a note of at least a beat ending within a pulse', () => {
    expect(boundaryViolations(evaluateComposition(baseMelody(), splitPlan()))).toEqual([]);
  });

  it('accepts a planned split marked by a rest of at least a pulse', () => {
    const melody = eighthsMelody([4, 4.5]);
    expect(boundaryViolations(evaluateComposition(melody, splitPlan()))).toEqual([]);
  });

  it('does not count a rest shorter than a pulse as marking a split', () => {
    const melody = eighthsMelody([4]);
    expect(boundaryViolations(evaluateComposition(melody, splitPlan()))).toEqual([
      expect.objectContaining({ kind: 'phraseBoundary', atBeat: 4 }),
    ]);
  });

  it('flags cadence: the closing note is not a tone the planned cadence allows', () => {
    const plan = basePlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).cadence = 'authentic';
    const result = evaluateComposition(baseMelody(), plan);
    // The closing G is a degree of the half cadence, not of the authentic one.
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'cadence',
        severity: 'error',
        atBeat: 8,
        expected: 'a closing note on pitch class 0 or 4 for a authentic cadence',
        actual: 'pitch 79',
      }),
    ]);
  });

  it('judges a cadence by its closing note alone, which a derivation may bend', () => {
    const plan = basePlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).cadence = 'authentic';
    const melody = baseMelody();
    melody[7] = { pitch: 72, startBeat: 7, durationBeat: 1 };
    const result = evaluateComposition(melody, plan);
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'motifDisplaced',
        severity: 'warning',
        atBeat: 4,
        actual: 'level 7, 1 excused note(s)',
      }),
    ]);
  });

  it('flags cadence when the phrase has no note to close on', () => {
    const plan = splitPlan();
    (plan.phrases[1] as (typeof plan.phrases)[number]).cadence = 'half';
    const melody = baseMelody().slice(0, 4);
    const cadences = evaluateComposition(melody, plan).violations.filter(
      (v) => v.kind === 'cadence',
    );
    expect(cadences).toEqual([
      expect.objectContaining({ kind: 'cadence', severity: 'error', atBeat: 8, actual: 'no note' }),
    ]);
  });

  it('flags harmony: a pulse-level note that fits none of the allowed roles', () => {
    const plan: CompositionPlan = {
      planVersion: COMPOSITION_PLAN_VERSION,
      seed: 1,
      algorithmVersion: ALGORITHM_VERSION,
      keys: [C_MAJOR],
      meters: METERS,
      span: { startBeat: 0, endBeat: 4, bars: 1 },
      sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
      phrases: [
        {
          startBeat: 0,
          endBeat: 4,
          section: 0,
          cadence: null,
          shape: 'ascending',
          peakPosition: 0.75,
          register: { low: 60, high: 72, mean: 65 },
          onsetDensity: 4,
          motifs: [],
        },
      ],
      harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
      motifs: [],
      rhythm: zeroRhythm(),
    };
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 63, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
      { pitch: 72, startBeat: 3, durationBeat: 1 },
    ];
    const result = evaluateComposition(melody, plan);
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'harmony', severity: 'error', atBeat: 1 }),
    ]);
  });

  /** One phrase over I, four quarters, no motifs. */
  function onePhrasePlan(): CompositionPlan {
    return {
      planVersion: COMPOSITION_PLAN_VERSION,
      seed: 1,
      algorithmVersion: ALGORITHM_VERSION,
      keys: [C_MAJOR],
      meters: METERS,
      span: { startBeat: 0, endBeat: 4, bars: 1 },
      sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
      phrases: [
        {
          startBeat: 0,
          endBeat: 4,
          section: 0,
          cadence: null,
          shape: 'ascending',
          peakPosition: 0.75,
          register: { low: 60, high: 72, mean: 65 },
          onsetDensity: 4,
          motifs: [],
        },
      ],
      harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
      motifs: [],
      rhythm: zeroRhythm(),
    };
  }

  it('accepts any scale tone on a weak pulse', () => {
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 62, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
      { pitch: 72, startBeat: 3, durationBeat: 1 },
    ];
    const harmony = evaluateComposition(melody, onePhrasePlan()).violations.filter(
      (v) => v.kind === 'harmony',
    );
    expect(harmony).toEqual([]);
  });

  it('flags harmony on a strong pulse a scale tone does not rescue', () => {
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 66, startBeat: 2, durationBeat: 1 },
      { pitch: 72, startBeat: 3, durationBeat: 1 },
    ];
    expect(evaluateComposition(melody, onePhrasePlan()).violations).toEqual([
      expect.objectContaining({
        kind: 'harmony',
        severity: 'error',
        atBeat: 2,
        expected: 'a chord tone or an ornamental tone',
      }),
    ]);
  });

  it('only warns of a harmony misfit inside a derived statement', () => {
    const plan = basePlan();
    const derived = plan.motifs[1] as (typeof plan.motifs)[number];
    derived.relation = { kind: 'transposition', sequence: true, semitones: 1, timeRatio: 1 };
    const melody = baseMelody().map((note, index) =>
      index < 4 ? note : { ...note, pitch: (baseMelody()[index - 4]?.pitch ?? 0) + 1 },
    );
    const harmony = evaluateComposition(melody, plan).violations.filter(
      (v) => v.kind === 'harmony',
    );
    expect(harmony.length).toBeGreaterThan(0);
    for (const violation of harmony) {
      expect(violation.atBeat).toBeGreaterThanOrEqual(4);
      expect(violation.severity).toBe('warning');
    }
  });

  it('flags motifDerivation: the named transformation does not hold on the candidate', () => {
    const plan = basePlan();
    const melody = baseMelody();
    // Swap the fifth and seventh of the V arpeggio: still every one a chord
    // tone, but no longer the literal transposition the plan names.
    melody[5] = { pitch: 74, startBeat: 5, durationBeat: 1 };
    melody[6] = { pitch: 71, startBeat: 6, durationBeat: 1 };
    const result = evaluateComposition(melody, plan);
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'motifDerivation',
        severity: 'error',
        atBeat: 4,
        expected: 'transposition',
      }),
    ]);
  });

  const derivationViolations = (result: ReturnType<typeof evaluateComposition>) =>
    result.violations.filter((v) => v.kind === 'motifDerivation' || v.kind === 'motifDisplaced');

  it('accepts a named transformation at another pitch level, warning motifDisplaced', () => {
    const plan = basePlan();
    const derived = plan.motifs[1] as (typeof plan.motifs)[number];
    derived.relation = { kind: 'transposition', sequence: true, semitones: 5, timeRatio: 1 };
    expect(derivationViolations(evaluateComposition(baseMelody(), plan))).toEqual([
      expect.objectContaining({
        kind: 'motifDisplaced',
        severity: 'warning',
        atBeat: 4,
        expected: 'transposition at level 5 with every pitch replayed',
        actual: 'level 7, 0 excused note(s)',
      }),
    ]);
  });

  it('never accepts a transposition at level 0, which is a repetition', () => {
    const plan = basePlan();
    const derived = plan.motifs[1] as (typeof plan.motifs)[number];
    derived.relation = { kind: 'transposition', sequence: true, semitones: 7, timeRatio: 1 };
    const melody = baseMelody().map((note, index) =>
      index < 4 ? note : { ...note, pitch: baseMelody()[index - 4]?.pitch ?? 0 },
    );
    expect(derivationViolations(evaluateComposition(melody, plan))).toEqual([
      expect.objectContaining({ kind: 'motifDerivation', severity: 'error', atBeat: 4 }),
    ]);
  });

  it('excuses a replayed pitch outside a register too narrow for the statement', () => {
    const plan = basePlan();
    const phrase = plan.phrases[0] as (typeof plan.phrases)[number];
    // Ten semitones cannot hold the twelve-semitone arpeggio at any level.
    phrase.register = { low: 60, high: 70, mean: 65 };
    const melody = baseMelody();
    // Two semitones down replays 58 62 65 70; the candidate holds 60 in place of the 58.
    [60, 62, 65, 70].forEach((pitch, index) => {
      melody[4 + index] = { pitch, startBeat: 4 + index, durationBeat: 1 };
    });
    expect(derivationViolations(evaluateComposition(melody, plan))).toEqual([
      expect.objectContaining({ kind: 'motifDisplaced', actual: 'level -2, 1 excused note(s)' }),
    ]);
  });

  it('does not excuse a replayed pitch outside the register when another level fits it whole', () => {
    const plan = basePlan();
    const phrase = plan.phrases[0] as (typeof plan.phrases)[number];
    phrase.register = { low: 60, high: 73, mean: 66.5 };
    const melody = baseMelody();
    // At the planned level 74 and 79 leave the register, but other levels fit all four notes.
    melody[6] = { pitch: 72, startBeat: 6, durationBeat: 1 };
    melody[7] = { pitch: 72, startBeat: 7, durationBeat: 1 };
    const derivation = derivationViolations(evaluateComposition(melody, plan));
    expect(derivation).toEqual([
      expect.objectContaining({ kind: 'motifDerivation', severity: 'error', atBeat: 4 }),
    ]);
  });

  it('flags motifDerivation when a named transformation changes its onsets, pitches intact', () => {
    const plan = basePlan();
    const melody = baseMelody();
    melody[5] = { pitch: 71, startBeat: 5, durationBeat: 1.5 };
    melody[6] = { pitch: 74, startBeat: 6.5, durationBeat: 0.5 };
    expect(derivationViolations(evaluateComposition(melody, plan))).toEqual([
      expect.objectContaining({
        kind: 'motifDerivation',
        severity: 'error',
        atBeat: 4,
        actual: 'no pitch level replays the source',
      }),
    ]);
  });

  it('does not compare durations, only onsets and pitches', () => {
    const plan = basePlan();
    const melody = baseMelody();
    melody[5] = { pitch: 71, startBeat: 5, durationBeat: 0.5 };
    expect(derivationViolations(evaluateComposition(melody, plan))).toEqual([]);
  });

  it('judges a variation by melodic similarity alone', () => {
    const plan = basePlan();
    (plan.motifs[1] as (typeof plan.motifs)[number]).relation = null;
    const melody = baseMelody();
    melody[5] = { pitch: 74, startBeat: 5, durationBeat: 1 };
    expect(derivationViolations(evaluateComposition(melody, plan))).toEqual([]);
  });

  it("flags register: a note outside its phrase's planned range", () => {
    const plan: CompositionPlan = {
      planVersion: COMPOSITION_PLAN_VERSION,
      seed: 1,
      algorithmVersion: ALGORITHM_VERSION,
      keys: [C_MAJOR],
      meters: METERS,
      span: { startBeat: 0, endBeat: 4, bars: 1 },
      sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
      phrases: [
        {
          startBeat: 0,
          endBeat: 4,
          section: 0,
          cadence: null,
          shape: 'ascending',
          peakPosition: 0.75,
          register: { low: 60, high: 67, mean: 64 },
          onsetDensity: 4,
          motifs: [],
        },
      ],
      harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman: 'I' }],
      motifs: [],
      rhythm: zeroRhythm(),
    };
    const melody = [
      { pitch: 60, startBeat: 0, durationBeat: 1 },
      { pitch: 64, startBeat: 1, durationBeat: 1 },
      { pitch: 67, startBeat: 2, durationBeat: 1 },
      { pitch: 72, startBeat: 3, durationBeat: 1 },
    ];
    const result = evaluateComposition(melody, plan);
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'register', severity: 'error', atBeat: 3 }),
    ]);
  });

  it('flags peakPosition as a warning, not an error, when it drifts past the tolerance', () => {
    const plan = basePlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).peakPosition = 0.5;
    const result = evaluateComposition(baseMelody(), plan);
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'peakPosition', severity: 'warning', atBeat: 0 }),
    ]);
  });
});

describe('evaluateComposition: the plan harmony is the one actually used', () => {
  const melody = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 63, startBeat: 1, durationBeat: 1 },
    { pitch: 67, startBeat: 2, durationBeat: 1 },
    { pitch: 72, startBeat: 3, durationBeat: 1 },
  ];

  function planWithChord(roman: string): CompositionPlan {
    return {
      planVersion: COMPOSITION_PLAN_VERSION,
      seed: 1,
      algorithmVersion: ALGORITHM_VERSION,
      keys: [C_MAJOR],
      meters: METERS,
      span: { startBeat: 0, endBeat: 4, bars: 1 },
      sections: [{ label: 'A', startBeat: 0, endBeat: 4 }],
      phrases: [
        {
          startBeat: 0,
          endBeat: 4,
          section: 0,
          cadence: null,
          shape: 'ascending',
          peakPosition: 0.75,
          register: { low: 55, high: 80, mean: 65 },
          onsetDensity: 4,
          motifs: [],
        },
      ],
      harmony: [{ startBeat: 0, endBeat: 4, key: 0, roman }],
      motifs: [],
      rhythm: zeroRhythm(),
    };
  }

  it('reads the same melody as fitting under one chord and not under another', () => {
    const underI = evaluateComposition(melody, planWithChord('I'));
    const underIi = evaluateComposition(melody, planWithChord('ii'));
    const harmonyCount = (result: ReturnType<typeof evaluateComposition>) =>
      result.violations.filter((v) => v.kind === 'harmony').length;
    // Under I only the out-of-key weak Eb misfits; under ii the strong C is left unresolved too.
    expect(harmonyCount(underI)).toBe(1);
    expect(harmonyCount(underIi)).toBe(2);
    expect(harmonyCount(underI)).not.toBe(harmonyCount(underIi));
  });
});

describe('evaluateComposition: rejection', () => {
  it('rejects a malformed plan', () => {
    const plan = basePlan() as unknown as Record<string, unknown>;
    delete plan.harmony;
    expect(() => evaluateComposition(baseMelody(), plan as unknown as CompositionPlan)).toThrow(
      InvalidInputError,
    );
  });

  it('rejects a melody that is not a valid note sequence', () => {
    const badMelody = [{ pitch: 60 }] as unknown as ReturnType<typeof baseMelody>;
    expect(() => evaluateComposition(badMelody, basePlan())).toThrow(InvalidInputError);
  });
});

describe('evaluateComposition: determinism', () => {
  it('answers the same evaluation on repeated calls with the same input', () => {
    const first = evaluateComposition(baseMelody(), basePlan());
    const second = evaluateComposition(baseMelody(), basePlan());
    expect(second).toEqual(first);
  });
});

describe('evaluateComposition: a reference melody against its own plan', () => {
  const fixtures: [string, ReferenceFixture, number][] = [
    ['source', SOURCE_SONG, 22],
    ['same structure', SAME_STRUCTURE_SONG, 22],
    ['transposed', TRANSPOSED_SONG, 22],
    ['unrelated', UNRELATED_SONG, 2],
  ];
  const keepAll = {
    form: 1,
    phraseLengths: 1,
    harmonicFunction: 1,
    harmonicRhythm: 1,
    motifRelations: 1,
    registerShape: 1,
    rhythm: 1,
  };

  it.each(fixtures)('fails only on harmony (%s)', (_, fixture, statements) => {
    const reference = analyzeReference(fixture.notes, {
      meters: fixture.meters,
      key: fixture.key,
      melody: fixture.melody,
    });
    const plan = deriveCompositionPlan(reference, { preserve: keepAll, ctx: { seed: 1 } });
    expect(plan.motifs).toHaveLength(statements);
    const errors = evaluateComposition(fixture.melody, plan).violations.filter(
      (v) => v.severity === 'error',
    );
    expect(errors.filter((v) => v.kind !== 'harmony')).toEqual([]);
  });

  it('selects 22 statements of 109 notes from 7 roots for the AABA fixtures', () => {
    for (const fixture of [SOURCE_SONG, SAME_STRUCTURE_SONG, TRANSPOSED_SONG]) {
      const reference = analyzeReference(fixture.notes, {
        meters: fixture.meters,
        key: fixture.key,
        melody: fixture.melody,
      });
      const plan = deriveCompositionPlan(reference, { preserve: keepAll, ctx: { seed: 1 } });
      expect(plan.motifs.reduce((sum, m) => sum + m.notes, 0)).toBe(109);
      expect(plan.motifs.filter((m) => m.from === null)).toHaveLength(7);
    }
  });
});
