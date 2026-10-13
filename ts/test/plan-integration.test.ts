/**
 * The whole plan pipeline — reference → plan → melody → evaluation — over every
 * reference fixture and several seeds. The thresholds are the ones the pipeline
 * promises, not readings of what it happens to produce.
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeReference,
  assertCompositionPlan,
  Composer,
  type CompositionPlan,
  type CompositionPlanOptions,
  compareReferences,
  deriveCompositionPlan,
  evaluateComposition,
  generateMelody,
  type NoteEvent,
  type PlannedPhrase,
  planTimeline,
  type ReferenceProfile,
  Score,
} from '../src/index.js';
import {
  type ReferenceFixture,
  SAME_STRUCTURE_SONG,
  SOURCE_SONG,
  TRANSPOSED_SONG,
  UNRELATED_SONG,
} from './support/reference-fixtures.js';

/**
 * Each fixture, and whether its motif graph is rich enough (ten edges or more)
 * that the plan carries its roots' rhythms and derivations wholesale.
 */
const FIXTURES: readonly { fixture: ReferenceFixture; structured: boolean }[] = [
  { fixture: SOURCE_SONG, structured: true },
  { fixture: SAME_STRUCTURE_SONG, structured: true },
  { fixture: TRANSPOSED_SONG, structured: true },
  { fixture: UNRELATED_SONG, structured: false },
];
const SEEDS = [1, 2, 3] as const;
const EPS = 1e-9;

/** Every dimension of the reference kept. */
const PRESERVE_ALL: NonNullable<CompositionPlanOptions['preserve']> = {
  form: 1,
  phraseLengths: 1,
  harmonicFunction: 1,
  harmonicRhythm: 1,
  motifRelations: 1,
  registerShape: 1,
  rhythm: 1,
};

/** Notes this long or longer in a row, with the same intervals as the source, are a copy. */
const COPY_RUN_NOTES = 8;

/** The fixture's reference profile, read with its melody named. */
function referenceOf(fixture: ReferenceFixture): ReferenceProfile {
  return analyzeReference(fixture.notes, {
    meters: fixture.meters,
    key: fixture.key,
    melody: fixture.melody,
  });
}

/** The plan every run of a fixture under a seed starts from. */
function planOf(reference: ReferenceProfile, seed: number): CompositionPlan {
  return deriveCompositionPlan(reference, { preserve: PRESERVE_ALL, ctx: { seed } });
}

/** The notes in time order, pitch breaking ties, as a score holds them. */
function inScoreOrder(notes: readonly NoteEvent[]): NoteEvent[] {
  return [...notes].sort(
    (a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch || a.durationBeat - b.durationBeat,
  );
}

/** Successive pitch intervals of a line in time order. */
function intervalsOf(notes: readonly NoteEvent[]): number[] {
  const line = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  return line.slice(1).map((note, index) => note.pitch - (line[index] as NoteEvent).pitch);
}

/** The most notes in a row whose intervals also occur in a row in the source. */
function longestSharedRun(melody: readonly NoteEvent[], source: readonly NoteEvent[]): number {
  const a = intervalsOf(melody);
  const b = intervalsOf(source);
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = (previous[j - 1] as number) + 1;
        best = Math.max(best, current[j] as number);
      }
    }
    previous = current;
  }
  // Runs of intervals, counted as the notes that span them.
  return best === 0 ? Math.min(1, melody.length) : best + 1;
}

/** The notes that start inside a phrase's span. */
function notesIn(notes: readonly NoteEvent[], phrase: PlannedPhrase): NoteEvent[] {
  return notes.filter(
    (note) => note.startBeat >= phrase.startBeat - EPS && note.startBeat < phrase.endBeat - EPS,
  );
}

/** The phrases a phrase's motifs lead back to through `from`, transitively, itself included. */
function sourcesOf(plan: CompositionPlan, phrase: number): Set<number> {
  const sources = new Set<number>([phrase]);
  for (const [index, motif] of plan.motifs.entries()) {
    if (motif.phrase !== phrase) {
      continue;
    }
    let at: number | null = index;
    while (at !== null) {
      const step: CompositionPlan['motifs'][number] | undefined = plan.motifs[at];
      if (step === undefined) {
        break;
      }
      sources.add(step.phrase);
      at = step.from;
    }
  }
  return sources;
}

/**
 * The plan with phrase `j`'s own items changed: its shape, peak, onset density
 * and register, and the numeral of every chord that lies wholly inside it.
 */
function withPhraseEdited(plan: CompositionPlan, j: number): CompositionPlan {
  const edited = structuredClone(plan);
  const target = edited.phrases[j] as PlannedPhrase;
  target.shape = target.shape === 'descending' ? 'ascending' : 'descending';
  target.peakPosition = 1 - target.peakPosition;
  target.onsetDensity += 1;
  target.register = {
    low: target.register.low - 2,
    high: target.register.high + 2,
    mean: target.register.mean + 1,
  };
  for (const chord of edited.harmony) {
    if (chord.startBeat >= target.startBeat - EPS && chord.endBeat <= target.endBeat + EPS) {
      chord.roman = chord.roman === 'V' ? 'IV' : 'V';
    }
  }
  return edited;
}

describe.each(FIXTURES)('the plan pipeline over the $fixture.name', ({ fixture, structured }) => {
  const memo: { reference?: ReferenceProfile } = {};
  const reference = (): ReferenceProfile => {
    memo.reference ??= referenceOf(fixture);
    return memo.reference;
  };

  it('holds its own melody to every rule of its plan but the harmony', () => {
    const plan = planOf(reference(), 1);
    const errors = evaluateComposition(fixture.melody, plan).violations.filter(
      (violation) => violation.severity === 'error',
    );
    expect(errors.filter((violation) => violation.kind !== 'harmony')).toEqual([]);
  });

  it('is judged by the rhythm split its motif graph calls for', () => {
    expect(reference().melody.graph.edges.length >= 10).toBe(structured);
  });

  describe.each(SEEDS)('seed %i', (seed) => {
    const runs: { plan?: CompositionPlan; melody?: NoteEvent[] } = {};
    const plan = (): CompositionPlan => {
      runs.plan ??= planOf(reference(), seed);
      return runs.plan;
    };
    const melody = (): NoteEvent[] => {
      runs.melody ??= generateMelody(plan());
      return runs.melody;
    };

    it('derives the same plan from the same reference and options', () => {
      expect(planOf(reference(), seed)).toEqual(plan());
    });

    it('carries the plan through a JSON round trip as a valid plan', () => {
      const restored = JSON.parse(JSON.stringify(plan())) as CompositionPlan;
      expect(restored).toEqual(plan());
      expect(assertCompositionPlan(restored)).toEqual(plan());
    });

    it('writes a melody that breaks no rule of its plan', () => {
      const errors = evaluateComposition(melody(), plan()).violations.filter(
        (violation) => violation.severity === 'error',
      );
      expect(errors).toEqual([]);
    });

    it('keeps the structure of the reference', () => {
      const written = analyzeReference(melody(), {
        meters: plan().meters,
        key: plan().keys[0],
        timeline: planTimeline(plan()),
        totalBeats: plan().span.endBeat,
      });
      const comparison = compareReferences(written, reference());
      expect(comparison.harmony.functionSimilarity).toBeGreaterThanOrEqual(0.8);
      if (structured) {
        expect(comparison.rhythm.onsetSimilarity).toBeGreaterThanOrEqual(0.9);
        expect(comparison.rhythm.durationSimilarity).toBeGreaterThanOrEqual(0.9);
        expect(comparison.melody.motifStructureSimilarity).toBeGreaterThanOrEqual(0.8);
      } else {
        // Two notes out of place is the resolution of a line this short.
        const floor = 1 - 2 / fixture.melody.length;
        expect(comparison.rhythm.onsetSimilarity).toBeGreaterThanOrEqual(floor - EPS);
        expect(comparison.rhythm.durationSimilarity).toBeGreaterThanOrEqual(floor - EPS);
      }
    });

    it('does not copy the reference melody', () => {
      expect(longestSharedRun(melody(), fixture.melody)).toBeLessThan(COPY_RUN_NOTES);
    });

    it('writes the same melody on every run', () => {
      expect(generateMelody(plan())).toEqual(melody());
    });

    it('leaves a phrase as it was when a phrase it does not derive from is edited', () => {
      expect(plan().phrases.length).toBeGreaterThan(1);
      let compared = 0;
      for (const j of plan().phrases.keys()) {
        const rewritten = generateMelody(withPhraseEdited(plan(), j));
        for (const [k, phrase] of plan().phrases.entries()) {
          if (sourcesOf(plan(), k).has(j)) {
            continue;
          }
          compared += 1;
          expect(notesIn(rewritten, phrase), `phrase ${k} after editing phrase ${j}`).toEqual(
            notesIn(melody(), phrase),
          );
        }
      }
      expect(compared).toBeGreaterThan(0);
    });
  });
});

describe('the plan pipeline through the class API', () => {
  it('answers what the functions answer', () => {
    const fixture = SOURCE_SONG;
    const seed = 2;
    const score = Score.of(fixture.notes, { meters: fixture.meters, key: fixture.key });
    const reference = score.reference({ melody: fixture.melody });
    const composer = Composer.of({ key: fixture.key, seed });
    const plan = composer.plan(reference);
    const written = composer.melody(plan);

    const expectedReference = analyzeReference(fixture.notes, {
      meters: fixture.meters,
      key: fixture.key,
      melody: fixture.melody,
      totalBeats: score.totalBeats,
    });
    const expectedPlan = deriveCompositionPlan(expectedReference, {
      key: fixture.key,
      ctx: { seed },
    });
    const expectedMelody = generateMelody(expectedPlan);
    expect(reference).toEqual(expectedReference);
    expect(plan).toEqual(expectedPlan);
    expect(written.notes).toEqual(inScoreOrder(expectedMelody));
    expect(written.evaluate(plan)).toEqual(evaluateComposition(expectedMelody, expectedPlan));
  });
});
