import { describe, expect, it } from 'vitest';
import { romanToChord } from '../src/analyze/functional/roman.js';
import { assertChordTimeline } from '../src/analyze/timeline/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import {
  COMPOSITION_PLAN_VERSION,
  type CompositionPlan,
  planTimeline,
} from '../src/generate/plan/types.js';
import { assertCompositionPlan } from '../src/generate/plan/validate.js';
import { resolveKey } from '../src/theory/scale/index.js';

const METERS = [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }];
const C_MAJOR = resolveKey('C major');

/**
 * A hand-built, internally valid plan: two four-beat phrases in one section, a
 * I-V7 progression, a root motif and a tonal-sequence derivation of it, and a
 * rhythmic target.
 */
function validPlan(): CompositionPlan {
  return {
    planVersion: COMPOSITION_PLAN_VERSION,
    seed: 42,
    algorithmVersion: ALGORITHM_VERSION,
    keys: [C_MAJOR],
    meters: METERS,
    span: { startBeat: 0, endBeat: 8, bars: 2 },
    sections: [{ label: 'A', startBeat: 0, endBeat: 8 }],
    phrases: [
      {
        startBeat: 0,
        endBeat: 4,
        section: 0,
        cadence: null,
        shape: 'ascending',
        peakPosition: 0.8,
        register: { low: 60, high: 67, mean: 64 },
        onsetDensity: 3,
        motifs: [0],
      },
      {
        startBeat: 4,
        endBeat: 8,
        section: 0,
        cadence: 'authentic',
        shape: 'ascending',
        peakPosition: 0.8,
        register: { low: 67, high: 74, mean: 71 },
        onsetDensity: 3,
        motifs: [1],
      },
    ],
    harmony: [
      { startBeat: 0, endBeat: 4, key: 0, roman: 'I' },
      { startBeat: 4, endBeat: 8, key: 0, roman: 'V7' },
    ],
    motifs: [
      {
        phrase: 0,
        startBeat: 0,
        endBeat: 1,
        notes: 3,
        rhythm: [0.25, 0.25],
        from: null,
        relation: null,
      },
      {
        phrase: 1,
        startBeat: 4,
        endBeat: 5,
        notes: 3,
        rhythm: null,
        from: 0,
        relation: {
          kind: 'tonalTransposition',
          sequence: true,
          semitones: 7,
          degrees: 4,
          timeRatio: 1,
        },
      },
    ],
    rhythm: {
      onsetLevels: [0.2, 0.2, 0.2, 0.2, 0.1, 0.1],
      interOnsetShares: [0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0.5, 0, 0, 0, 0, 0, 0, 0],
      syncopation: 0,
    },
  };
}

describe('assertCompositionPlan: acceptance', () => {
  it('accepts a hand-built valid plan', () => {
    const plan = validPlan();
    expect(assertCompositionPlan(plan)).toEqual(plan);
  });

  it('survives a JSON round trip and is still accepted', () => {
    const plan = validPlan();
    const restored = JSON.parse(JSON.stringify(plan));
    expect(restored).toEqual(plan);
    expect(assertCompositionPlan(restored)).toEqual(plan);
  });
});

describe('assertCompositionPlan: rejection', () => {
  it('rejects a missing field', () => {
    const plan = validPlan() as unknown as Record<string, unknown>;
    delete plan.harmony;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/\.harmony/);
  });

  it('rejects an unknown planVersion', () => {
    const plan = validPlan();
    plan.planVersion = COMPOSITION_PLAN_VERSION + 1;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/planVersion/);
  });

  it('rejects a seed outside the 32-bit range', () => {
    const plan = validPlan();
    plan.seed = -1;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/\.seed/);
  });

  it('rejects an algorithmVersion this build does not produce', () => {
    const plan = validPlan();
    plan.algorithmVersion = ALGORITHM_VERSION + 1;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/algorithmVersion/);
  });

  it('rejects an algorithmVersion below the oldest this build accepts', () => {
    const plan = validPlan();
    plan.algorithmVersion = 0;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/algorithmVersion/);
  });

  it('rejects an empty keys array', () => {
    const plan = validPlan();
    plan.keys = [];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/keys/);
  });

  it('rejects a key that does not resolve', () => {
    const plan = validPlan();
    plan.keys[0] = { scale: { rootPc: 0, modeMask12: 0 } } as unknown as (typeof plan.keys)[number];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/keys\[0\]/);
  });

  it('rejects a span whose endBeat precedes its startBeat', () => {
    const plan = validPlan();
    plan.span = { startBeat: 8, endBeat: 0, bars: 2 };
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/span/);
  });

  it('rejects a section whose endBeat precedes its startBeat', () => {
    const plan = validPlan();
    plan.sections[0] = { label: 'A', startBeat: 8, endBeat: 0 };
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/sections\[0\]/);
  });

  it('rejects a phrase section index outside the section array', () => {
    const plan = validPlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).section = 5;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[0\]\.section/);
  });

  it('rejects an unknown cadence type', () => {
    const plan = validPlan();
    (plan.phrases[1] as unknown as Record<string, unknown>).cadence = 'imperfect';
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[1\]\.cadence/);
  });

  it('rejects an unknown melodic contour shape', () => {
    const plan = validPlan();
    (plan.phrases[0] as unknown as Record<string, unknown>).shape = 'diagonal';
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[0\]\.shape/);
  });

  it('rejects a peakPosition outside [0, 1]', () => {
    const plan = validPlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).peakPosition = 1.5;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[0\]\.peakPosition/);
  });

  it('rejects a register low outside the MIDI range', () => {
    const plan = validPlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).register.low = 200;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[0\]\.register\.low/);
  });

  it('rejects a phrase motif index outside the motif array', () => {
    const plan = validPlan();
    (plan.phrases[0] as (typeof plan.phrases)[number]).motifs = [5];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/phrases\[0\]\.motifs\[0\]/);
  });

  it('rejects a harmony key index outside the key array', () => {
    const plan = validPlan();
    (plan.harmony[0] as (typeof plan.harmony)[number]).key = 5;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/harmony\[0\]\.key/);
  });

  it('rejects a roman numeral romanToChord cannot read', () => {
    const plan = validPlan();
    (plan.harmony[0] as (typeof plan.harmony)[number]).roman = 'not a numeral';
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/harmony\[0\]\.roman/);
  });

  it('rejects a motif phrase index outside the phrase array', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).phrase = 5;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.phrase/);
  });

  it('rejects a non-positive note count', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).notes = 0;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.notes/);
  });

  it('rejects a motif whose from is not less than its own index (self-reference)', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).from = 0;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.from/);
  });

  it('rejects a motif whose from points at a later motif', () => {
    const plan = validPlan();
    // Swap the two motifs' `from`/`relation` around so index 0 points at
    // index 1 — later than itself.
    const relation = (plan.motifs[1] as (typeof plan.motifs)[number]).relation;
    const root = plan.motifs[0] as (typeof plan.motifs)[number];
    root.from = 1;
    root.relation = relation;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.from/);
  });

  it('rejects a non-null relation on a root motif', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).relation = (
      plan.motifs[1] as (typeof plan.motifs)[number]
    ).relation;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.relation/);
  });

  it('rejects a tonalTransposition relation with no degrees', () => {
    const plan = validPlan();
    delete (
      (plan.motifs[1] as (typeof plan.motifs)[number]).relation as unknown as Record<
        string,
        unknown
      >
    ).degrees;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[1\]\.relation\.degrees/);
  });

  it('rejects a root rhythm whose length is not notes - 1', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).rhythm = [0.25, 0.25, 0.25];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.rhythm/);
  });

  it('rejects a root rhythm with a ratio that is not positive', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).rhythm = [0.25, 0];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.rhythm\[1\]/);
  });

  it('rejects root gaps that leave the last onset no room inside the statement', () => {
    const plan = validPlan();
    (plan.motifs[0] as (typeof plan.motifs)[number]).rhythm = [0.5, 0.5];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.rhythm must sum to less/);
  });

  it('rejects a rhythm on a derived statement', () => {
    const plan = validPlan();
    (plan.motifs[1] as (typeof plan.motifs)[number]).rhythm = [0.25, 0.25];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(
      /motifs\[1\]\.rhythm must be null for a derived statement/,
    );
  });

  it('rejects a motif with no rhythm key', () => {
    const plan = validPlan();
    delete (plan.motifs[0] as unknown as Record<string, unknown>).rhythm;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/motifs\[0\]\.rhythm/);
  });

  it('rejects a rhythm onsetLevels distribution of the wrong length', () => {
    const plan = validPlan();
    plan.rhythm.onsetLevels = [1];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/rhythm\.onsetLevels/);
  });

  it('rejects a rhythm onsetLevels distribution that does not sum to 1', () => {
    const plan = validPlan();
    plan.rhythm.onsetLevels = plan.rhythm.onsetLevels.map((share, index) =>
      index === 0 ? share + 1 : share,
    );
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/rhythm\.onsetLevels/);
  });

  it('rejects a rhythm interOnsetShares distribution of the wrong length', () => {
    const plan = validPlan();
    plan.rhythm.interOnsetShares = [1];
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/rhythm\.interOnsetShares/);
  });

  it('rejects a syncopation outside [0, 1]', () => {
    const plan = validPlan();
    plan.rhythm.syncopation = 1.5;
    expect(() => assertCompositionPlan(plan)).toThrow(InvalidInputError);
    expect(() => assertCompositionPlan(plan)).toThrow(/rhythm\.syncopation/);
  });
});

describe('planTimeline', () => {
  it('builds the timeline plan.harmony and plan.keys describe, and it passes assertChordTimeline', () => {
    const plan = validPlan();
    const timeline = planTimeline(plan);
    assertChordTimeline(timeline);
    expect(timeline.segments).toHaveLength(2);
    expect(timeline.segments[0]).toMatchObject({ startBeat: 0, endBeat: 4 });
    expect(timeline.segments[1]).toMatchObject({ startBeat: 4, endBeat: 8 });
    expect(timeline.at(0)).toEqual(romanToChord('I', C_MAJOR));
    expect(timeline.at(4)).toEqual(romanToChord('V7', C_MAJOR));
    expect(timeline.at(8)).toBeNull();
  });

  it('reads each chord against the key its own index names, not always keys[0]', () => {
    const gMajor = resolveKey('G major');
    const plan: CompositionPlan = {
      ...validPlan(),
      keys: [C_MAJOR, gMajor],
      span: { startBeat: 0, endBeat: 8, bars: 2 },
      harmony: [
        { startBeat: 0, endBeat: 4, key: 0, roman: 'I' },
        { startBeat: 4, endBeat: 8, key: 1, roman: 'I' },
      ],
    };
    const timeline = planTimeline(plan);
    expect(timeline.at(0)?.rootPc).toBe(romanToChord('I', C_MAJOR).rootPc);
    expect(timeline.at(4)?.rootPc).toBe(romanToChord('I', gMajor).rootPc);
    expect(timeline.at(4)?.rootPc).not.toBe(timeline.at(0)?.rootPc);
  });
});
