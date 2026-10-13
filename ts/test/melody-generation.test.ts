import { describe, expect, it } from 'vitest';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateMelody } from '../src/generate/melody/index.js';
import { planHarmonyMisfits } from '../src/generate/plan/harmony.js';
import {
  COMPOSITION_PLAN_VERSION,
  type CompositionPlan,
  type PlannedChord,
  type PlannedPhrase,
} from '../src/generate/plan/types.js';
import { assertCompositionPlan } from '../src/generate/plan/validate.js';
import { resolveKey } from '../src/theory/scale/index.js';

const METERS = [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }];
const C_MAJOR = resolveKey('C major');
const EPS = 1e-9;

function ioiShares(): number[] {
  const shares = new Array<number>(17).fill(0);
  shares[8] = 1;
  return shares;
}

function phrase(
  over: Partial<PlannedPhrase> & { startBeat: number; endBeat: number },
): PlannedPhrase {
  return {
    section: 0,
    cadence: null,
    shape: 'arch',
    peakPosition: 0.6,
    register: { low: 55, high: 79, mean: 67 },
    onsetDensity: 4,
    motifs: [],
    ...over,
  };
}

/** A valid plan over `bars` 4/4 bars with one chord per bar unless harmony is given. */
function plan(over: Partial<CompositionPlan> & { phrases: PlannedPhrase[] }): CompositionPlan {
  const endBeat = over.phrases.reduce((end, p) => Math.max(end, p.endBeat), 0);
  const harmony: PlannedChord[] = over.harmony ?? [{ startBeat: 0, endBeat, key: 0, roman: 'I' }];
  const built: CompositionPlan = {
    planVersion: COMPOSITION_PLAN_VERSION,
    seed: 11,
    algorithmVersion: ALGORITHM_VERSION,
    keys: [C_MAJOR],
    meters: METERS,
    span: { startBeat: 0, endBeat, bars: endBeat / 4 },
    sections: [{ label: 'A', startBeat: 0, endBeat }],
    harmony,
    motifs: [],
    // Quarter notes: every pulse, one beat apart.
    rhythm: {
      onsetLevels: [0, 0, 0, 0.5, 0.25, 0.25],
      interOnsetShares: ioiShares(),
      syncopation: 0,
    },
    ...over,
  };
  return assertCompositionPlan(built);
}

function inSpan(notes: readonly NoteEvent[], start: number, end: number): NoteEvent[] {
  return notes
    .filter((n) => n.startBeat >= start - EPS && n.startBeat < end - EPS)
    .sort((a, b) => a.startBeat - b.startBeat);
}

type Cell = { pitch: number; startBeat: number; durationBeat: number }[];

/** Whether a line's notes, read as one phrase, all fit the plan's harmony. */
function misfitsOf(p: CompositionPlan, line: Cell): boolean[] {
  return planHarmonyMisfits(p)(line).map((kinds) => kinds !== null);
}

describe('generateMelody', () => {
  describe('position classes', () => {
    function rootsPlan(seed: number): CompositionPlan {
      return plan({
        seed,
        phrases: [phrase({ startBeat: 0, endBeat: 16, motifs: [0] })],
        harmony: [
          { startBeat: 0, endBeat: 4, key: 0, roman: 'I' },
          { startBeat: 4, endBeat: 8, key: 0, roman: 'IV' },
          { startBeat: 8, endBeat: 12, key: 0, roman: 'V' },
          { startBeat: 12, endBeat: 16, key: 0, roman: 'I' },
        ],
        motifs: [
          {
            phrase: 0,
            startBeat: 0,
            endBeat: 8,
            notes: 16,
            rhythm: null,
            from: null,
            relation: null,
          },
        ],
        rhythm: {
          onsetLevels: [0.2, 0.2, 0, 0.2, 0.2, 0.2],
          interOnsetShares: ioiShares(),
          syncopation: 0,
        },
      });
    }

    it('leaves no harmony misfit in what it chooses freely', () => {
      for (const seed of [1, 2, 3]) {
        const p = rootsPlan(seed);
        const line = inSpan(generateMelody(p), 0, 12);
        expect(misfitsOf(p, line)).not.toContain(true);
      }
    });
  });
});
