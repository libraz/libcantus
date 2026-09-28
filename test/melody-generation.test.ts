import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  InvalidInputError,
  NoSolutionError,
} from '../src/core/errors/index.js';
import { createPositionalRng } from '../src/core/random/index.js';
import { ALGORITHM_VERSION } from '../src/core/random/version.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateMelody } from '../src/generate/melody/index.js';
import { planHarmonyMisfits } from '../src/generate/plan/harmony.js';
import {
  COMPOSITION_PLAN_VERSION,
  type CompositionPlan,
  type PlannedChord,
  type PlannedMotif,
  type PlannedPhrase,
  planTimeline,
} from '../src/generate/plan/types.js';
import { assertCompositionPlan } from '../src/generate/plan/validate.js';
import { chordPitchClasses } from '../src/theory/chord/index.js';
import {
  type ResolvedKey,
  resolveKey,
  scaleTonesInDegreeOrder,
  shiftByScaleDegrees,
} from '../src/theory/scale/index.js';

const METERS = [{ startBeat: 0, ts: { numerator: 4, denominator: 4 } }];
const C_MAJOR = resolveKey('C major');
const G_MAJOR = resolveKey('G major');
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
    rhythm: { onsetLevels: [0, 0, 0, 0, 0, 1], interOnsetShares: ioiShares(), syncopation: 0 },
    ...over,
  };
  return assertCompositionPlan(built);
}

/** A piece with a root, a derivation of it in the same phrase, a derivation in the next phrase, and free spans. */
function mixedPlan(): CompositionPlan {
  return plan({
    phrases: [
      phrase({ startBeat: 0, endBeat: 16, cadence: 'half', motifs: [0, 1] }),
      phrase({
        startBeat: 16,
        endBeat: 32,
        cadence: 'authentic',
        shape: 'descending',
        register: { low: 60, high: 76, mean: 68 },
        motifs: [2],
      }),
    ],
    harmony: [
      { startBeat: 0, endBeat: 4, key: 0, roman: 'I' },
      { startBeat: 4, endBeat: 8, key: 0, roman: 'IV' },
      { startBeat: 8, endBeat: 12, key: 0, roman: 'V' },
      { startBeat: 12, endBeat: 16, key: 0, roman: 'V' },
      { startBeat: 16, endBeat: 20, key: 0, roman: 'I' },
      { startBeat: 20, endBeat: 24, key: 0, roman: 'IV' },
      { startBeat: 24, endBeat: 28, key: 0, roman: 'V' },
      { startBeat: 28, endBeat: 32, key: 0, roman: 'I' },
    ],
    motifs: [
      { phrase: 0, startBeat: 0, endBeat: 4, notes: 5, from: null, relation: null },
      {
        phrase: 0,
        startBeat: 4,
        endBeat: 8,
        notes: 5,
        from: 0,
        relation: { kind: 'transposition', sequence: true, semitones: 5, timeRatio: 1 },
      },
      {
        phrase: 1,
        startBeat: 16,
        endBeat: 20,
        notes: 5,
        from: 0,
        relation: { kind: 'repetition', sequence: false, semitones: 0, timeRatio: 1 },
      },
    ],
  });
}

function inSpan(notes: readonly NoteEvent[], start: number, end: number): NoteEvent[] {
  return notes
    .filter((n) => n.startBeat >= start - EPS && n.startBeat < end - EPS)
    .sort((a, b) => a.startBeat - b.startBeat);
}

function onPulse(beat: number): boolean {
  return Math.abs(beat - Math.round(beat)) < EPS;
}

function chordTonesAt(p: CompositionPlan, beat: number): number[] | null {
  const chord = planTimeline(p).at(beat);
  return chord ? chordPitchClasses(chord) : null;
}

type Cell = { pitch: number; startBeat: number; durationBeat: number }[];

const outside = (reg: { low: number; high: number }, pitch: number) =>
  pitch < reg.low || pitch > reg.high;

/**
 * Which notes of a statement local repair may replace: out of register, or
 * failing the plan's harmony reading in the context of the line before it.
 */
function repairFlags(
  p: CompositionPlan,
  reg: { low: number; high: number },
  context: Cell,
  statement: Cell,
): boolean[] {
  const misfits = planHarmonyMisfits(p)([...context, ...statement]).slice(context.length);
  return statement.map((n, i) => outside(reg, n.pitch) || misfits[i] !== null);
}

/**
 * A statement as local repair first places it: moved a whole octave toward the
 * register (else away) when that brings every note inside, as it is otherwise.
 */
function octavePlaced(reg: { low: number; high: number }, statement: Cell): Cell {
  if (!statement.some((n) => outside(reg, n.pitch))) return statement;
  const toward = statement.some((n) => n.pitch > reg.high) ? -12 : 12;
  for (const shift of [toward, -toward]) {
    const moved = statement.map((n) => ({ ...n, pitch: n.pitch + shift }));
    if (!moved.some((n) => outside(reg, n.pitch))) return moved;
  }
  return statement;
}

function anchor(cell: Cell, firstPitch: number, startBeat: number): Cell {
  const sorted = [...cell].sort((a, b) => a.startBeat - b.startBeat);
  const shift = firstPitch - (sorted[0]?.pitch ?? 0);
  const offset = startBeat - (sorted[0]?.startBeat ?? 0);
  return sorted.map((n) => ({ ...n, pitch: n.pitch + shift, startBeat: n.startBeat + offset }));
}

function scaleTime(cell: Cell, factor: number): Cell {
  const origin = cell[0]?.startBeat ?? 0;
  return cell.map((n) => ({
    ...n,
    startBeat: origin + (n.startBeat - origin) * factor,
    durationBeat: n.durationBeat * factor,
  }));
}

function invert(cell: Cell): Cell {
  const pivot = cell[0]?.pitch ?? 0;
  return cell.map((n) => ({ ...n, pitch: 2 * pivot - n.pitch }));
}

function retrograde(cell: Cell): Cell {
  const start = cell[0]?.startBeat ?? 0;
  const end = Math.max(...cell.map((n) => n.startBeat + n.durationBeat));
  return cell.map((n) => ({ ...n, startBeat: start + (end - (n.startBeat + n.durationBeat)) }));
}

type Relation = NonNullable<PlannedMotif['relation']>;

/** The doc's mapping of a relation onto the source cell, anchored at the planned start. */
function expectedDerivation(
  source: Cell,
  relation: Relation,
  startBeat: number,
  key: ResolvedKey,
): Cell {
  let cell: Cell = source.map((n) => ({ ...n }));
  switch (relation.kind) {
    case 'repetition':
      break;
    case 'transposition':
      cell = cell.map((n) => ({ ...n, pitch: n.pitch + relation.semitones }));
      if (relation.timeRatio !== 1) cell = scaleTime(cell, relation.timeRatio);
      break;
    case 'tonalTransposition':
      cell = cell.map((n) => ({
        ...n,
        pitch: shiftByScaleDegrees(n.pitch, relation.degrees ?? 0, key),
      }));
      break;
    case 'inversion':
      cell = invert(cell);
      if (relation.timeRatio !== 1) cell = scaleTime(cell, relation.timeRatio);
      break;
    case 'retrograde':
      cell = retrograde(cell);
      break;
    case 'retrogradeInversion':
      cell = retrograde(invert(cell));
      break;
    case 'augmentation':
    case 'diminution':
      cell = scaleTime(cell, relation.timeRatio);
      break;
  }
  return anchor(cell, (source[0]?.pitch ?? 0) + relation.semitones, startBeat);
}

/**
 * One phrase over a single I chord: a root motif at 0..4 and one derivation of
 * it at 8, clear of the final bar the phrase-end hold rewrites.
 */
function derivationPlan(relation: Relation, derivedSpan: number): CompositionPlan {
  return plan({
    phrases: [
      phrase({
        startBeat: 0,
        endBeat: 20,
        register: { low: 48, high: 84, mean: 66 },
        motifs: [0, 1],
      }),
    ],
    motifs: [
      { phrase: 0, startBeat: 0, endBeat: 4, notes: 4, from: null, relation: null },
      { phrase: 0, startBeat: 8, endBeat: 8 + derivedSpan, notes: 4, from: 0, relation },
    ],
  });
}

describe('generateMelody', () => {
  it('is deterministic for the same plan and seed, and does not mutate the plan', () => {
    const p = mixedPlan();
    const snapshot = structuredClone(p);
    const a = generateMelody(p);
    const b = generateMelody(structuredClone(p));
    expect(a).toEqual(b);
    expect(p).toEqual(snapshot);
    expect(a.length).toBeGreaterThan(0);
  });

  it('returns sounding notes in time order within the planned span', () => {
    const p = mixedPlan();
    const notes = generateMelody(p);
    for (let i = 0; i < notes.length; i += 1) {
      const n = notes[i] as NoteEvent;
      expect(n.durationBeat).toBeGreaterThan(0);
      expect(n.startBeat).toBeGreaterThanOrEqual(p.span.startBeat);
      expect(n.startBeat + n.durationBeat).toBeLessThanOrEqual(p.span.endBeat + EPS);
      if (i > 0) expect(n.startBeat).toBeGreaterThanOrEqual((notes[i - 1] as NoteEvent).startBeat);
    }
  });

  it('gives different notes under different seeds', () => {
    const base = mixedPlan();
    const outputs = [1, 2, 3].map((seed) => JSON.stringify(generateMelody({ ...base, seed })));
    expect(new Set(outputs).size).toBeGreaterThan(1);
  });

  it('keeps every note inside its phrase register', () => {
    for (const seed of [1, 2, 3, 4]) {
      const p = { ...mixedPlan(), seed };
      const notes = generateMelody(p);
      for (const ph of p.phrases) {
        for (const n of inSpan(notes, ph.startBeat, ph.endBeat)) {
          expect(n.pitch).toBeGreaterThanOrEqual(ph.register.low);
          expect(n.pitch).toBeLessThanOrEqual(ph.register.high);
        }
      }
    }
  });

  it('keeps every note on the single pitch a one-note register allows', () => {
    const p = plan({
      phrases: [
        phrase({
          startBeat: 0,
          endBeat: 8,
          register: { low: 60, high: 60, mean: 60 },
          motifs: [0],
        }),
      ],
      motifs: [{ phrase: 0, startBeat: 0, endBeat: 4, notes: 3, from: null, relation: null }],
    });
    expect(generateMelody(p).every((n) => n.pitch === 60)).toBe(true);
  });

  describe('contour', () => {
    function contourPlan(shape: PlannedPhrase['shape'], peakPosition: number): CompositionPlan {
      return plan({
        phrases: [
          phrase({
            startBeat: 0,
            endBeat: 16,
            shape,
            peakPosition,
            register: { low: 48, high: 84, mean: 66 },
            onsetDensity: 4,
            motifs: [0],
          }),
        ],
        motifs: [{ phrase: 0, startBeat: 0, endBeat: 16, notes: 16, from: null, relation: null }],
      });
    }

    function peakFraction(notes: readonly NoteEvent[]): number {
      let best = notes[0] as NoteEvent;
      for (const n of notes) if (n.pitch > best.pitch) best = n;
      return best.startBeat / 16;
    }

    it.each([0.25, 0.75])('places an arch peak within 0.2 of peakPosition %s', (peak) => {
      for (const seed of [1, 2, 3]) {
        const notes = generateMelody({ ...contourPlan('arch', peak), seed });
        expect(Math.abs(peakFraction(notes) - peak)).toBeLessThanOrEqual(0.2);
      }
    });

    it('never leaps by a tritone, a seventh or more than an octave inside a root motif', () => {
      for (const shape of ['arch', 'ascending', 'descending', 'wave', 'static'] as const) {
        for (const seed of [1, 2, 3]) {
          const notes = generateMelody({ ...contourPlan(shape, 0.6), seed });
          for (let i = 1; i < notes.length; i += 1) {
            const leap = Math.abs(
              (notes[i] as NoteEvent).pitch - (notes[i - 1] as NoteEvent).pitch,
            );
            expect([6, 10, 11]).not.toContain(leap);
            expect(leap).toBeLessThanOrEqual(12);
          }
        }
      }
    });

    it('rises for ascending and falls for descending', () => {
      const mean = (ns: NoteEvent[]) => ns.reduce((s, n) => s + n.pitch, 0) / ns.length;
      const up = generateMelody(contourPlan('ascending', 0.5));
      const down = generateMelody(contourPlan('descending', 0.5));
      expect(mean(inSpan(up, 12, 16))).toBeGreaterThan(mean(inSpan(up, 0, 4)) + 6);
      expect(mean(inSpan(down, 0, 4))).toBeGreaterThan(mean(inSpan(down, 12, 16)) + 6);
    });

    it('stays near the register mean for static', () => {
      const notes = generateMelody(contourPlan('static', 0.5));
      for (const n of notes) expect(Math.abs(n.pitch - 66)).toBeLessThanOrEqual(6);
    });

    it('peaks twice for wave', () => {
      const notes = generateMelody(contourPlan('wave', 0.5));
      const high = (s: number, e: number) => Math.max(...inSpan(notes, s, e).map((n) => n.pitch));
      const low = (s: number, e: number) => Math.min(...inSpan(notes, s, e).map((n) => n.pitch));
      expect(high(2, 6)).toBeGreaterThan(low(7, 9) + 4);
      expect(high(10, 14)).toBeGreaterThan(low(7, 9) + 4);
    });
  });

  describe('root motif length', () => {
    it.each([1, 3, 7, 12])('honours notes = %s', (count) => {
      // The phrase runs a bar past the motif, so the phrase-end hold leaves the motif whole.
      const p = plan({
        phrases: [phrase({ startBeat: 0, endBeat: 8, onsetDensity: 4, motifs: [0] })],
        motifs: [{ phrase: 0, startBeat: 0, endBeat: 4, notes: count, from: null, relation: null }],
      });
      const notes = inSpan(generateMelody(p), 0, 4);
      expect(notes).toHaveLength(count);
      expect(notes[0]?.startBeat).toBe(0);
      const last = notes[notes.length - 1] as NoteEvent;
      expect(last.startBeat + last.durationBeat).toBeCloseTo(4, 9);
      for (let i = 1; i < notes.length; i += 1) {
        const prev = notes[i - 1] as NoteEvent;
        expect(prev.startBeat + prev.durationBeat).toBeCloseTo(
          (notes[i] as NoteEvent).startBeat,
          9,
        );
      }
    });
  });

  describe('derived motifs', () => {
    const cases: [Relation, number][] = [
      [{ kind: 'repetition', sequence: false, semitones: 0, timeRatio: 1 }, 4],
      [{ kind: 'transposition', sequence: false, semitones: 7, timeRatio: 1 }, 4],
      [{ kind: 'transposition', sequence: false, semitones: -5, timeRatio: 0.5 }, 2],
      [{ kind: 'tonalTransposition', sequence: false, semitones: 2, degrees: 1, timeRatio: 1 }, 4],
      [{ kind: 'inversion', sequence: false, semitones: 0, timeRatio: 1 }, 4],
      [{ kind: 'inversion', sequence: false, semitones: 3, timeRatio: 2 }, 8],
      [{ kind: 'retrograde', sequence: false, semitones: 0, timeRatio: 1 }, 4],
      [{ kind: 'retrogradeInversion', sequence: false, semitones: -2, timeRatio: 1 }, 4],
      [{ kind: 'augmentation', sequence: false, semitones: 0, timeRatio: 2 }, 8],
      [{ kind: 'diminution', sequence: false, semitones: 0, timeRatio: 0.5 }, 2],
    ];

    it.each(cases)('maps $kind onto its source at the planned start beat', (relation, span) => {
      for (const seed of [1, 2, 3]) {
        const p = { ...derivationPlan(relation, span), seed };
        const reg = p.phrases[0]?.register as PlannedPhrase['register'];
        const notes = generateMelody(p);
        const source = inSpan(notes, 0, 4);
        expect(source).toHaveLength(4);
        const derived = inSpan(notes, 8, 8 + span);
        const context = inSpan(notes, 0, 8);
        const expected = octavePlaced(reg, expectedDerivation(source, relation, 8, C_MAJOR));
        const flags = repairFlags(p, reg, context, expected);
        expect(derived).toHaveLength(expected.length);
        expect(derived[0]?.startBeat).toBeCloseTo(8, 9);
        for (let i = 0; i < expected.length; i += 1) {
          const want = expected[i] as Cell[number];
          const got = derived[i] as NoteEvent;
          expect(got.startBeat).toBeCloseTo(want.startBeat, 9);
          expect(got.durationBeat).toBeCloseTo(want.durationBeat, 9);
          if (!flags[i]) expect(got.pitch).toBe(want.pitch);
        }
        expect(repairFlags(p, reg, context, derived)).not.toContain(true);
      }
    });

    it('keeps a variation on its source rhythm and outer pitches, inside the register', () => {
      for (const seed of [1, 2, 3]) {
        const p = {
          ...derivationPlan({ kind: 'repetition', sequence: false, semitones: 0, timeRatio: 1 }, 4),
          seed,
        };
        const motifs = p.motifs.map((m, i) => (i === 1 ? { ...m, relation: null } : m));
        const q = assertCompositionPlan({ ...p, motifs });
        const reg = q.phrases[0]?.register as PlannedPhrase['register'];
        const notes = generateMelody(q);
        const source = inSpan(notes, 0, 4);
        const derived = inSpan(notes, 8, 12);
        expect(derived).toHaveLength(source.length);
        for (let i = 0; i < source.length; i += 1) {
          const s = source[i] as NoteEvent;
          const d = derived[i] as NoteEvent;
          expect(d.startBeat).toBeCloseTo(s.startBeat + 8, 9);
          expect(d.durationBeat).toBeCloseTo(s.durationBeat, 9);
          expect(d.pitch).toBeGreaterThanOrEqual(reg.low);
          expect(d.pitch).toBeLessThanOrEqual(reg.high);
        }
        for (const i of [0, source.length - 1]) {
          const s = source[i] as NoteEvent;
          const d = derived[i] as NoteEvent;
          const flags = repairFlags(
            q,
            reg,
            inSpan(notes, 0, 8),
            octavePlaced(
              reg,
              source.map((n) => ({ ...n, startBeat: n.startBeat + 8 })),
            ),
          );
          if (!flags[i]) expect(d.pitch).toBe(s.pitch);
        }
      }
    });

    it('moves a statement that leaves the register a whole octave before repairing notes', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const base = derivationPlan(
          { kind: 'transposition', sequence: false, semitones: 12, timeRatio: 1 },
          4,
        );
        const phrases = base.phrases.map((ph) => ({
          ...ph,
          register: { low: 60, high: 72, mean: 66 },
        }));
        const p = assertCompositionPlan({ ...base, phrases, seed });
        const reg = { low: 60, high: 72 };
        const notes = generateMelody(p);
        const source = inSpan(notes, 0, 4);
        const derived = inSpan(notes, 8, 12);
        // Up an octave leaves the register; down an octave again is the source itself.
        const expected = source.map((n) => ({ ...n, startBeat: n.startBeat + 8 }));
        const flags = repairFlags(p, reg, inSpan(notes, 0, 8), expected);
        expect(derived).toHaveLength(expected.length);
        derived.forEach((got, i) => {
          if (!flags[i]) expect(got.pitch).toBe(expected[i]?.pitch);
        });
      }
    });

    it('derives from a motif in an earlier phrase', () => {
      const p = mixedPlan();
      const notes = generateMelody(p);
      const source = inSpan(notes, 0, 4);
      const derived = inSpan(notes, 16, 20);
      expect(derived.map((n) => n.startBeat - 16)).toEqual(source.map((n) => n.startBeat));
    });
  });

  describe('cadence repair', () => {
    function cadencePlan(
      cadence: PlannedPhrase['cadence'],
      lastRoman: string,
      keyIndex = 0,
    ): CompositionPlan {
      return plan({
        keys: [C_MAJOR, G_MAJOR],
        phrases: [phrase({ startBeat: 0, endBeat: 8, cadence, motifs: [0] })],
        harmony: [
          { startBeat: 0, endBeat: 4, key: 0, roman: 'IV' },
          { startBeat: 4, endBeat: 8, key: keyIndex, roman: lastRoman },
        ],
        motifs: [{ phrase: 0, startBeat: 0, endBeat: 8, notes: 8, from: null, relation: null }],
      });
    }

    function lastPulseNote(notes: readonly NoteEvent[]): NoteEvent {
      const pulses = inSpan(notes, 0, 8).filter((n) => onPulse(n.startBeat));
      return pulses[pulses.length - 1] as NoteEvent;
    }

    function degreePcs(key: ResolvedKey, degrees: number[]): number[] {
      const tones = scaleTonesInDegreeOrder(key);
      return degrees.map((d) => tones[d - 1] as number);
    }

    const pc = (pitch: number) => ((pitch % 12) + 12) % 12;

    it.each([
      ['authentic', 'I', [1, 3]],
      ['plagal', 'I', [1, 3]],
      ['half', 'V', [2, 5, 7]],
      ['phrygian', 'V', [2, 5, 7]],
      ['modal', 'I', [1]],
    ] as const)('lands a %s cadence on the specified scale degrees', (cadence, roman, degrees) => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const notes = generateMelody({ ...cadencePlan(cadence, roman), seed });
        expect(degreePcs(C_MAJOR, [...degrees])).toContain(pc(lastPulseNote(notes).pitch));
      }
    });

    it('lands a deceptive cadence on a tone of the chord sounding there', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const p = { ...cadencePlan('deceptive', 'vi'), seed };
        const last = lastPulseNote(generateMelody(p));
        expect(chordTonesAt(p, last.startBeat)).toContain(pc(last.pitch));
      }
    });

    it('reads the cadence degrees in the key of the chord at the cadence', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const notes = generateMelody({ ...cadencePlan('authentic', 'I', 1), seed });
        expect(degreePcs(G_MAJOR, [1, 3])).toContain(pc(lastPulseNote(notes).pitch));
      }
    });

    it('fails when the register holds no allowed cadence pitch', () => {
      const p = cadencePlan('modal', 'I');
      const phrases = p.phrases.map((ph) => ({
        ...ph,
        register: { low: 61, high: 62, mean: 61.5 },
      }));
      expect(() => generateMelody({ ...p, phrases })).toThrow(NoSolutionError);
    });
  });

  describe('phrase-final hold', () => {
    const plans: [string, () => CompositionPlan][] = [
      ['motifs and free spans', mixedPlan],
      ['a root motif filling the phrase', () => cadenceHoldPlan('authentic')],
      ['no motifs', () => plan({ phrases: [phrase({ startBeat: 0, endBeat: 8 })] })],
    ];

    function cadenceHoldPlan(cadence: PlannedPhrase['cadence']): CompositionPlan {
      return plan({
        phrases: [phrase({ startBeat: 0, endBeat: 8, cadence, motifs: [0] })],
        harmony: [
          { startBeat: 0, endBeat: 4, key: 0, roman: 'V' },
          { startBeat: 4, endBeat: 8, key: 0, roman: 'I' },
        ],
        motifs: [{ phrase: 0, startBeat: 0, endBeat: 8, notes: 8, from: null, relation: null }],
      });
    }

    it.each(plans)(
      'holds one note from the final bar to the phrase end, with nothing after it (%s)',
      (_, build) => {
        for (const seed of [1, 2, 3, 4, 5]) {
          const p = { ...build(), seed };
          const notes = generateMelody(p);
          for (const ph of p.phrases) {
            const downbeat = ph.endBeat - 4;
            const inside = inSpan(notes, ph.startBeat, ph.endBeat);
            const held = inside[inside.length - 1] as NoteEvent;
            expect(held.startBeat + held.durationBeat).toBeCloseTo(ph.endBeat, 9);
            // A note sounding across the downbeat is cut there and the downbeat held.
            expect(held.startBeat).toBeGreaterThanOrEqual(downbeat - EPS);
            for (const n of inside.slice(0, -1)) {
              expect(n.startBeat + n.durationBeat).toBeLessThanOrEqual(held.startBeat + EPS);
            }
          }
        }
      },
    );

    it('cuts a note sounding across the final downbeat and holds from the downbeat', () => {
      const tonicTriad = [0, 4];
      for (const seed of [1, 2, 3]) {
        // A one-note root motif over beats 2-6 sounds across the downbeat at 4.
        const p = plan({
          seed,
          phrases: [phrase({ startBeat: 0, endBeat: 8, cadence: 'authentic', motifs: [0] })],
          motifs: [{ phrase: 0, startBeat: 2, endBeat: 6, notes: 1, from: null, relation: null }],
        });
        const notes = generateMelody(p);
        const cut = notes.find((n) => Math.abs(n.startBeat - 2) < EPS) as NoteEvent;
        expect(cut.durationBeat).toBeCloseTo(2, 9);
        const held = notes[notes.length - 1] as NoteEvent;
        expect(held.startBeat).toBeCloseTo(4, 9);
        expect(held.durationBeat).toBeCloseTo(4, 9);
        expect(tonicTriad).toContain(((held.pitch % 12) + 12) % 12);
      }
    });

    it('bends the held note onto the cadence', () => {
      const tonicTriad = [0, 4];
      for (const seed of [1, 2, 3, 4, 5]) {
        const notes = generateMelody({ ...cadenceHoldPlan('authentic'), seed });
        const held = notes[notes.length - 1] as NoteEvent;
        expect(held.startBeat + held.durationBeat).toBeCloseTo(8, 9);
        expect(tonicTriad).toContain(((held.pitch % 12) + 12) % 12);
      }
    });
  });

  describe('development fill', () => {
    it('covers every span no motif covers, starting from the root rhythm', () => {
      const p = mixedPlan();
      const notes = generateMelody(p);
      for (const ph of p.phrases) {
        const inside = inSpan(notes, ph.startBeat, ph.endBeat);
        let reach = ph.startBeat;
        for (const n of inside) {
          expect(n.startBeat).toBeLessThanOrEqual(reach + EPS);
          reach = Math.max(reach, n.startBeat + n.durationBeat);
        }
        expect(reach).toBeCloseTo(ph.endBeat, 9);
      }
      const root = inSpan(notes, 0, 4);
      const fill = inSpan(notes, 8, 12);
      expect(fill.slice(0, root.length).map((n) => n.startBeat - 8)).toEqual(
        root.map((n) => n.startBeat),
      );
    });

    it('fills a phrase with no root motif from the root its derivations lead back to', () => {
      const p = mixedPlan();
      const notes = generateMelody(p);
      const root = inSpan(notes, 0, 4);
      const fill = inSpan(notes, 20, 24);
      expect(fill.slice(0, root.length).map((n) => n.startBeat - 20)).toEqual(
        root.map((n) => n.startBeat),
      );
    });

    it('treats a phrase with no motifs as one root span', () => {
      const p = plan({ phrases: [phrase({ startBeat: 0, endBeat: 8, motifs: [] })] });
      const notes = generateMelody(p);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]?.startBeat).toBe(0);
      const last = notes[notes.length - 1] as NoteEvent;
      expect(last.startBeat + last.durationBeat).toBeCloseTo(8, 9);
    });
  });

  it('leaves a phrase unchanged when only a phrase it does not reference changes', () => {
    const p = mixedPlan();
    const before = inSpan(generateMelody(p), 0, 16);
    const phrases = p.phrases.map((ph, i) =>
      i === 1 ? { ...ph, shape: 'ascending' as const, onsetDensity: 7 } : ph,
    );
    const after = inSpan(generateMelody({ ...p, phrases }), 0, 16);
    expect(after).toEqual(before);
  });

  it('throws NoSolutionError at the phrase start for an impossible register', () => {
    const p = plan({
      phrases: [
        phrase({ startBeat: 0, endBeat: 4 }),
        phrase({
          startBeat: 4,
          endBeat: 8,
          register: { low: 70, high: 60, mean: 65 },
          motifs: [0],
        }),
      ],
      motifs: [{ phrase: 1, startBeat: 4, endBeat: 8, notes: 4, from: null, relation: null }],
    });
    let caught: unknown;
    try {
      generateMelody(p);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NoSolutionError);
    expect((caught as NoSolutionError).at).toBe(4);
  });

  describe('budget', () => {
    it('rejects a pitch search over the budget', () => {
      expect(() => generateMelody(mixedPlan(), { budget: 10 })).toThrow(BudgetExceededError);
      expect(() => generateMelody(mixedPlan(), { budget: 10 })).toThrow(/melody pitch search/);
    });

    it('rejects a development over the budget', () => {
      const p = plan({
        phrases: [
          phrase({
            startBeat: 0,
            endBeat: 32,
            register: { low: 60, high: 60, mean: 60 },
            motifs: [0],
          }),
        ],
        motifs: [{ phrase: 0, startBeat: 0, endBeat: 1, notes: 2, from: null, relation: null }],
      });
      // Pitch search: 2 notes · 9 · 1² = 18; development: 32 tiles · 2 notes = 64.
      expect(() => generateMelody(p, { budget: 30 })).toThrow(/melody development notes/);
      expect(() => generateMelody(p, { budget: 30 })).toThrow(BudgetExceededError);
      expect(() => generateMelody(p, { budget: 64 })).not.toThrow();
    });

    it('rejects a malformed budget', () => {
      expect(() => generateMelody(mixedPlan(), { budget: -1 })).toThrow(InvalidInputError);
    });
  });

  describe('input rejection', () => {
    it('rejects an invalid plan', () => {
      expect(() => generateMelody({ ...mixedPlan(), planVersion: 2 })).toThrow(InvalidInputError);
      expect(() => generateMelody(null as unknown as CompositionPlan)).toThrow(InvalidInputError);
      const p = mixedPlan();
      const motifs = p.motifs.map((m, i) => (i === 1 ? { ...m, from: 1 } : m));
      expect(() => generateMelody({ ...p, motifs })).toThrow(InvalidInputError);
    });

    it('rejects malformed options', () => {
      expect(() => generateMelody(mixedPlan(), null as unknown as undefined)).toThrow(
        InvalidInputError,
      );
    });
  });

  describe('ctx', () => {
    it('reads seed and algorithm version from the plan by default', () => {
      const p = mixedPlan();
      expect(generateMelody(p)).toEqual(generateMelody(p, { ctx: { seed: p.seed } }));
      expect(generateMelody(p)).toEqual(
        generateMelody(p, { ctx: { complexity: { harmonic: 0.3 } } }),
      );
      expect(generateMelody(p)).toEqual(
        generateMelody(p, { ctx: { algorithmVersion: p.algorithmVersion } }),
      );
    });

    it('lets an explicit seed override the plan seed', () => {
      const p = mixedPlan();
      expect(generateMelody(p, { ctx: 5 })).toEqual(generateMelody({ ...p, seed: 5 }));
      expect(generateMelody(p, { ctx: { seed: 5 } })).toEqual(generateMelody({ ...p, seed: 5 }));
    });

    it('rejects a supplied rng', () => {
      const rng = createPositionalRng(1);
      expect(() => generateMelody(mixedPlan(), { ctx: { rng } })).toThrow(InvalidInputError);
    });

    it('rejects a malformed ctx', () => {
      expect(() => generateMelody(mixedPlan(), { ctx: { seed: -1 } })).toThrow(InvalidInputError);
      expect(() => generateMelody(mixedPlan(), { ctx: { algorithmVersion: 999 } })).toThrow(
        InvalidInputError,
      );
      expect(() => generateMelody(mixedPlan(), { ctx: null as unknown as number })).toThrow(
        InvalidInputError,
      );
    });
  });
});
