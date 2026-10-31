/**
 * A melody written to a plan derived from a reference evaluates clean against
 * that plan: the generator's own rules (the held final note, the reading of a
 * pulse with no planned chord) are the evaluator's.
 */

import {
  analyzeReference,
  type CompositionPlan,
  deriveCompositionPlan,
  evaluateComposition,
  generateMelody,
  type NoteEvent,
  resolveKey,
} from '@libraz/libcantus';
import { describe, expect, it } from 'vitest';

/** A line of quarter notes from beat `startBeat`. */
function quarters(pitches: readonly number[], startBeat = 0): NoteEvent[] {
  return pitches.map((pitch, index) => ({ pitch, startBeat: startBeat + index, durationBeat: 1 }));
}

const C = 60;
const D = 62;
const E = 64;
const F = 65;
const G = 67;
const A = 69;

/** Twinkle Twinkle in C major, 48 quarter notes in three 16-beat phrases. */
const TWINKLE = quarters([
  ...[C, C, G, G, A, A, G, G, F, F, E, E, D, D, C, C],
  ...[G, G, F, F, E, E, D, D, G, G, F, F, E, E, D, D],
  ...[C, C, G, G, A, A, G, G, F, F, E, E, D, D, C, C],
]);

/** Ode to Joy in C major; the harmony derived from it leaves the opening beats without a chord. */
const ODE = quarters([
  ...[E, E, F, G, G, F, E, D, C, C, D, E, E, D, D, D],
  ...[E, E, F, G, G, F, E, D, C, C, D, E, D, C, C, C],
]);

const TUNES = [
  { name: 'Twinkle Twinkle', melody: TWINKLE },
  { name: 'Ode to Joy', melody: ODE },
] as const;
const SEEDS = [1, 2, 3, 4, 5] as const;

describe.each(TUNES)('a plan derived from $name', ({ melody }) => {
  const reference = analyzeReference(melody, { key: 'C major', melody });

  it.each(SEEDS)('evaluates the melody generated from it with no error under seed %i', (seed) => {
    const plan = deriveCompositionPlan(reference, { ctx: { seed } });
    const errors = evaluateComposition(generateMelody(plan), plan).violations.filter(
      (violation) => violation.severity === 'error',
    );
    expect(errors).toEqual([]);
  });
});

/** Two 4/4 bars in C major whose harmony leaves the first half bar without a chord. */
const GAP_PLAN: CompositionPlan = {
  planVersion: 1,
  seed: 7,
  algorithmVersion: 1,
  keys: [resolveKey('C major')],
  meters: [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }],
  span: { startBeat: 0, endBeat: 8, bars: 2 },
  sections: [{ label: 'A', startBeat: 0, endBeat: 8 }],
  phrases: [
    {
      startBeat: 0,
      endBeat: 8,
      section: 0,
      cadence: 'authentic',
      shape: 'arch',
      peakPosition: 0.6,
      register: { low: 60, high: 72, mean: 66 },
      onsetDensity: 4,
      motifs: [],
    },
  ],
  harmony: [
    { startBeat: 2, endBeat: 4, key: 0, roman: 'V' },
    { startBeat: 4, endBeat: 8, key: 0, roman: 'I' },
  ],
  motifs: [],
  rhythm: {
    onsetLevels: [0, 0, 0, 0, 0, 1],
    interOnsetShares: new Array(17).fill(0).fill(1, 8, 9),
    syncopation: 0,
  },
};

/** The harmony violations an evaluation reports at a beat. */
function harmonyAt(melody: readonly NoteEvent[], beat: number) {
  return evaluateComposition(melody, GAP_PLAN).violations.filter(
    (violation) => violation.kind === 'harmony' && violation.atBeat === beat,
  );
}

describe('a strong pulse where the plan names no chord', () => {
  it('takes a scale tone in generation and passes it in evaluation', () => {
    for (const seed of SEEDS) {
      const melody = generateMelody({ ...GAP_PLAN, seed });
      expect(melody[0]?.startBeat).toBe(0);
      expect(harmonyAt(melody, 0)).toEqual([]);
    }
  });

  it('is judged against the key: a scale tone fits and a chromatic tone does not', () => {
    const opening = (pitch: number): NoteEvent[] => [
      { pitch, startBeat: 0, durationBeat: 2 },
      { pitch: G, startBeat: 2, durationBeat: 2 },
      { pitch: C, startBeat: 4, durationBeat: 4 },
    ];
    expect(harmonyAt(opening(A), 0)).toEqual([]);
    expect(harmonyAt(opening(A - 1), 0)).toHaveLength(1);
  });
});
