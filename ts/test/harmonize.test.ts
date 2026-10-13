import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { buildCandidates } from '../src/generate/harmonize/candidates.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { diatonicTriad } from '../src/theory/chord/index.js';
import { isScaleTone, majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Quarter notes from beat 0. */
function quarters(pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, i) => ({ pitch, startBeat: i, durationBeat: 1 }));
}

describe('harmonizeMelody follows the harmony rather than the melody notes', () => {
  it('opens the vocabulary a chord at a time rather than a family at a time', () => {
    // A dial barely off zero has opened the dominant's own dominant and nothing
    // else, so a melody that spells another tonicization cannot have it yet.
    const tonicizesTwo = quarters([62, 66, 69, 62, 74, 69, 65, 62]);
    const partial = harmonizeMelody({
      melody: tonicizesTwo,
      key: cMajor,
      harmonicRhythm: 2,
      ctx: { seed: 0, complexity: { harmonic: 0.125 } },
      placement: { transposeSearch: false, octaveSearch: false },
    });
    for (const chord of partial.chords) {
      expect(chord.secondaryDominant ? chord.rootPc : 2).toBe(2);
    }
    // The whole family is open half way up, and the vocabulary itself is what
    // the dial moves — a melody only shows which part of it it needs.
    const roots = (harmonic: number) =>
      buildCandidates(cMajor, harmonic)
        .filter((candidate) => candidate.secondaryDominant)
        .map((candidate) => candidate.rootPc);
    expect(roots(0)).toEqual([]);
    expect(roots(0.125)).toEqual([2]);
    expect(roots(0.5)).toEqual([9, 0, 2, 4]);
  });
});

describe('reharmonize validation', () => {
  const melody = quarters([72, 71, 69, 67]);

  it('maps every named strength to a dial position the vocabulary grows with', () => {
    const sizes = (['diatonic', 'secondaryDominant', 'borrowed'] as const).map((reharmonize) => {
      const result = harmonizeMelody({ melody, key: cMajor, reharmonize });
      expect(result.chords.length).toBeGreaterThan(0);
      return buildCandidates(cMajor, REHARMONIZE_POSITION[reharmonize]).length;
    });
    expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
  });
});

/** The dial position each named strength stands for, as the generator reads it. */
const REHARMONIZE_POSITION = {
  diatonic: 0,
  secondaryDominant: 0.5,
  borrowed: 1,
} as const;

describe('the diatonic tier stays inside the mode it names', () => {
  const modes = [
    { name: 'dorian', key: scaleByName('dorian', 2) },
    { name: 'phrygian', key: scaleByName('phrygian', 4) },
    { name: 'locrian', key: scaleByName('locrian', 11) },
  ];

  it.each(modes)('uses only the scale tones of $name', ({ key }) => {
    // `diatonic` promises the key's own triads. A mode is not a minor key
    // waiting to have its seventh raised: D dorian harmonized with A major
    // sounds a C#, and B locrian offered a triad on F# overwrites the lowered
    // fifth the mode is named for.
    for (const candidate of buildCandidates(key, 0)) {
      for (const pc of candidate.pcs) {
        expect(isScaleTone(pc, key), `${pc} of ${candidate.rootPc}:${candidate.quality}`).toBe(
          true,
        );
      }
    }
  });

  it('still lets a minor key cadence through its raised seventh', () => {
    // The allowance is the minor key's: it writes that seventh as an accidental
    // rather than in its scale, and without the major dominant a minor melody
    // can be harmonized but never closed.
    const candidates = buildCandidates(minorKey(9), 0);
    expect(candidates.some((c) => c.rootPc === 4 && c.quality === 'maj')).toBe(true);
    expect(candidates.some((c) => c.rootPc === 4 && c.quality === 'min')).toBe(true);
  });
});

describe('a secondary dominant tonicizes only a degree that can be a tonic', () => {
  const keys = [
    { name: 'C major', key: cMajor },
    { name: 'A minor', key: minorKey(9) },
    { name: 'C lydian', key: scaleByName('lydian', 0) },
    { name: 'D dorian', key: scaleByName('dorian', 2) },
  ];

  it.each(keys)('offers no dominant of a diminished degree in $name', ({ key }) => {
    for (const candidate of buildCandidates(key, 1)) {
      if (!candidate.secondaryDominant || candidate.targetDegree === undefined) {
        continue;
      }
      const target = diatonicTriad(candidate.targetDegree, key);
      expect(['maj', 'min'], `degree ${candidate.targetDegree}`).toContain(target.quality);
    }
  });

  it('puts no F#7 in front of the diminished supertonic of A minor', () => {
    const candidates = buildCandidates(minorKey(9), 1).filter((c) => c.secondaryDominant);
    expect(candidates.map((c) => c.targetDegree)).not.toContain(2);
    expect(candidates.map((c) => c.rootPc)).not.toContain(6);
  });

  it('leaves the diminished fourth degree of lydian alone', () => {
    // C lydian raises its fourth, so the triad there is F# diminished and its
    // dominant would tonicize a chord that is no tonic.
    const candidates = buildCandidates(scaleByName('lydian', 0), 1).filter(
      (c) => c.secondaryDominant,
    );
    expect(candidates.map((c) => c.targetDegree)).not.toContain(4);
  });

  it('keeps the whole family a major key has', () => {
    const targets = buildCandidates(cMajor, 0.5)
      .filter((c) => c.secondaryDominant)
      .map((c) => c.targetDegree);
    expect(targets).toEqual([2, 4, 5, 6]);
  });
});

describe('the borrowed chords open in the order an arranger uses them', () => {
  /** The roots of the borrowings a dial position has opened. */
  const borrowedRoots = (harmonic: number): number[] =>
    buildCandidates(cMajor, harmonic)
      .filter((candidate) => !candidate.secondaryDominant && candidate.degree === undefined)
      .map((candidate) => candidate.rootPc);

  /** The lowest dial position at which a root has entered the vocabulary. */
  const entersAt = (rootPc: number): number => {
    for (let step = 0; step <= 8; step += 1) {
      const dial = 0.5 + step / 16;
      if (borrowedRoots(dial).includes(rootPc)) {
        return dial;
      }
    }
    return Number.POSITIVE_INFINITY;
  };

  it('opens bVII before the minor tonic and the diminished supertonic', () => {
    // bVII is the borrowing pop writing reaches for most and the minor tonic
    // the least; taking them in scale-degree order opened them the other way
    // round, so the top of the dial was where bVII finally arrived.
    expect(entersAt(10)).toBeLessThan(entersAt(0));
    expect(entersAt(10)).toBeLessThan(entersAt(2));
    expect(entersAt(5)).toBeLessThanOrEqual(entersAt(10));
  });

  it('has the useful borrowings and none of the rare ones part way up', () => {
    const opened = borrowedRoots(0.65);
    expect(opened).toContain(5);
    expect(opened).toContain(10);
    expect(opened).not.toContain(0);
    expect(opened).not.toContain(2);
  });

  it('still opens every one of them at the top of the dial', () => {
    expect(borrowedRoots(1).sort((a, b) => a - b)).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });
});
