import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import { evaluateComposition } from '../src/generate/plan/evaluate.js';
import { COMPOSITION_PLAN_VERSION, type CompositionPlan } from '../src/generate/plan/types.js';
import { resolveKey } from '../src/theory/scale/index.js';

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
 * Every number below is read off `analyzeReference` of `baseMelody()` with
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
      { phrase: 0, startBeat: 0, endBeat: 4, notes: 4, from: null, relation: null },
      {
        phrase: 0,
        startBeat: 4,
        endBeat: 8,
        notes: 4,
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
      [
        'cadence',
        'contour',
        'duration',
        'motifStructure',
        'onset',
        'phraseLength',
        'progression',
        'register',
        'sectionSequence',
        'syncopation',
      ].sort(),
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

  it('flags cadence: the candidate closes on a different cadence than planned', () => {
    const plan = basePlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).cadence = 'authentic';
    const result = evaluateComposition(baseMelody(), plan);
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'cadence',
        severity: 'error',
        atBeat: 8,
        expected: 'authentic',
        actual: 'half',
      }),
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

  it('warns motifRepaired when a named transformation keeps its rhythm and most pitches', () => {
    const plan = basePlan();
    const melody = baseMelody();
    // One of four transposed pitches moved to another tone of V: three of four still match.
    melody[5] = { pitch: 74, startBeat: 5, durationBeat: 1 };
    const result = evaluateComposition(melody, plan);
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'motifRepaired',
        severity: 'warning',
        atBeat: 4,
        expected: 'transposition with every pitch kept',
        actual: '75% of pitches kept',
      }),
    ]);
  });

  it('flags motifDerivation when a named transformation changes its rhythm, pitches intact', () => {
    const plan = basePlan();
    const melody = baseMelody();
    melody[5] = { pitch: 71, startBeat: 5, durationBeat: 1.5 };
    melody[6] = { pitch: 74, startBeat: 6.5, durationBeat: 0.5 };
    const derivation = evaluateComposition(melody, plan).violations.filter(
      (v) => v.kind === 'motifDerivation' || v.kind === 'motifRepaired',
    );
    expect(derivation).toEqual([
      expect.objectContaining({
        kind: 'motifDerivation',
        severity: 'error',
        atBeat: 4,
        actual: 'onsets or durations differ',
      }),
    ]);
  });

  it('judges a variation by melodic similarity alone', () => {
    const plan = basePlan();
    (plan.motifs[1] as (typeof plan.motifs)[number]).relation = null;
    const melody = baseMelody();
    melody[5] = { pitch: 74, startBeat: 5, durationBeat: 1 };
    const derivation = evaluateComposition(melody, plan).violations.filter(
      (v) => v.kind === 'motifDerivation' || v.kind === 'motifRepaired',
    );
    expect(derivation).toEqual([]);
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
    expect(harmonyCount(underI)).toBe(1);
    expect(harmonyCount(underIi)).toBe(4);
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
