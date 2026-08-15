import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/pitch/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import { checkSpecies } from '../src/theory/partwriting/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

/** Spell a line written the way an exercise is printed. */
function line(names: string): Note[] {
  return names.split(' ').map((name) => parseNote(name));
}

/** The kinds a check reported, for asserting on one planted fault at a time. */
function kinds(violations: { kind: string }[]): string[] {
  return violations.map((violation) => violation.kind);
}

const D_DORIAN = scaleByName('dorian', 2);
const C_MAJOR = majorKey(0);
const A_MINOR = minorKey(9);

describe('first species', () => {
  // Fux's own D-dorian exercise, counterpoint above.
  const cantus = line('D4 F4 E4 D4 G4 F4 A4 G4 F4 E4 D4');
  const counterpoint = line('A4 A4 G4 A4 B4 C5 C5 B4 D5 C#5 D5');

  it('passes a textbook exercise with no violations', () => {
    expect(checkSpecies(cantus, counterpoint, 1, D_DORIAN)).toEqual([]);
  });

  it('flags consecutive perfect fifths', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('G4 A4 G4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('parallelFifth');
  });

  it('flags consecutive octaves', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 D5 G4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('parallelOctave');
  });

  it('flags a perfect fifth reached by similar motion with a leap', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('E4 A4 G4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('hiddenPerfect');
  });

  it('flags an octave reached by a downward leap against a rising bass', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('G5 D5 G4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('battuta');
  });

  it('flags a counterpoint that dips below the cantus firmus', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 A4 C4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('voiceCrossing');
  });

  it('flags a dissonance where the species allows none', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 D5 D5 B4 C5');
    const found = checkSpecies(cf, cp, 1, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.fromIndex).toBe(2);
  });

  it('flags the augmented second of the harmonic minor, which a pitch cannot show', () => {
    const cf = line('A4 F4 E4 D4 A4');
    const cp = line('A5 F5 G#5 F5 A5');
    expect(kinds(checkSpecies(cf, cp, 1, A_MINOR))).toContain('augmentedMelodicInterval');
  });

  it('flags a leap of a seventh', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 B5 G4 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('illegalLeap');
  });

  it('flags a close that is not the sixth stepping out to the octave', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 A4 G4 A4 E5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('missingCadence');
  });

  it('flags an opening that is not a perfect consonance', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('E4 A4 G4 B4 C5');
    const found = checkSpecies(cf, cp, 1, C_MAJOR).filter(
      (violation) => violation.kind === 'missingCadence',
    );
    expect(found[0]?.rationale).toContain('begin on a perfect consonance');
  });

  it('flags a counterpoint with the wrong number of notes', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 D5 B4 C5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toEqual(['wrongRhythmicRatio']);
  });

  it('names the cantus firmus as voice 0 and the counterpoint as voice 1', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 B5 G4 B4 C5');
    const leap = checkSpecies(cf, cp, 1, C_MAJOR).find(
      (violation) => violation.kind === 'illegalLeap',
    );
    expect(leap?.voices).toEqual([1]);
  });
});

describe('second species', () => {
  const cantus = line('C4 F4 E4 D4 C4');
  const counterpoint = line('G4 E4 A4 C5 G4 C5 D5 B4 C5');

  it('passes an exercise of two notes against one', () => {
    expect(checkSpecies(cantus, counterpoint, 2, C_MAJOR)).toEqual([]);
  });

  it('accepts a dissonance passed through by step on the weak half', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 A4 A4 B4 C5 B4 D5 B4 C5');
    // B4 over F4 is an augmented fourth, stepped into and out of in one
    // direction: the passing note the species is written to allow.
    expect(checkSpecies(cf, cp, 2, C_MAJOR)).toEqual([]);
  });

  it('flags a weak-half dissonance that is leapt away from', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 E4 A4 B4 G4 C5 D5 B4 C5');
    const found = checkSpecies(cf, cp, 2, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rationale).toContain('passed through by step');
  });

  it('flags a dissonance on the downbeat', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 E4 G4 C5 G4 C5 D5 B4 C5');
    const found = checkSpecies(cf, cp, 2, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found[0]?.rationale).toContain('only a consonance');
  });

  it('flags a counterpoint that does not present two notes to the measure', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 E4 A4 C5 G4 C5');
    expect(kinds(checkSpecies(cf, cp, 2, C_MAJOR))).toEqual(['wrongRhythmicRatio']);
  });
});

describe('third species', () => {
  const cantus = line('C4 F4 E4 D4 C4');
  const counterpoint = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 F4 G4 A4 B4 C5');

  it('passes an exercise of four notes against one', () => {
    expect(checkSpecies(cantus, counterpoint, 3, C_MAJOR)).toEqual([]);
  });

  it('accepts a neighbour note as well as a passing one', () => {
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 F4 G4 A4 B4 C5');
    // A4 over E4 in the third measure is a perfect fourth reached by step and
    // left by step in the same direction.
    expect(checkSpecies(cantus, cp, 3, C_MAJOR)).toEqual([]);
  });

  it('flags a quarter-note dissonance that is neither passing nor neighbouring', () => {
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 F4 B4 C5 F4 G4 A4 B4 C5');
    expect(kinds(checkSpecies(cantus, cp, 3, C_MAJOR))).toContain('unpreparedDissonance');
  });
});

describe('fourth species', () => {
  const cantus = line('C4 F4 E4 D4 C4');
  const counterpoint = line('C5 C5 C5 D5 D5 C5 C5 B4 C5');

  it('passes a chain of prepared and resolved suspensions', () => {
    expect(checkSpecies(cantus, counterpoint, 4, C_MAJOR)).toEqual([]);
  });

  it('flags a suspension that is not tied over from a consonance', () => {
    const cp = line('C5 C5 C5 D5 F5 C5 C5 B4 C5');
    const found = checkSpecies(cantus, cp, 4, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found[0]?.rationale).toContain('tied over from a consonance');
  });

  it('flags a suspension that does not fall by step', () => {
    const cp = line('C5 C5 C5 D5 D5 E5 C5 B4 C5');
    expect(kinds(checkSpecies(cantus, cp, 4, C_MAJOR))).toContain('unresolvedSuspension');
  });

  it('flags a dissonance on the weak half, where the preparation belongs', () => {
    const cp = line('C5 D5 C5 D5 D5 C5 C5 B4 C5');
    expect(kinds(checkSpecies(cantus, cp, 4, C_MAJOR))).toContain('unpreparedDissonance');
  });
});

describe('fifth species', () => {
  const cantus = line('C4 F4 E4 D4 C4');
  const counterpoint = line('C5 D5 C5 C5 B4 C5 C5 B4 C5');
  const durations = [1, 0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 1];

  it('passes a florid exercise', () => {
    expect(checkSpecies(cantus, counterpoint, 5, C_MAJOR, { durations })).toEqual([]);
  });

  it('needs durations, since its note values are not fixed', () => {
    expect(() => checkSpecies(cantus, counterpoint, 5, C_MAJOR)).toThrow(
      /durations for the fifth species/,
    );
  });

  it('flags durations that do not fill the cantus firmus', () => {
    const short = [1, 0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 0.5];
    expect(kinds(checkSpecies(cantus, counterpoint, 5, C_MAJOR, { durations: short }))).toEqual([
      'wrongRhythmicRatio',
    ]);
  });

  it('flags a note value the style does not write', () => {
    const odd = [1, 0.5, 0.5, 0.5, 0.3, 0.2, 0.5, 0.5, 1];
    expect(kinds(checkSpecies(cantus, counterpoint, 5, C_MAJOR, { durations: odd }))).toEqual([
      'wrongRhythmicRatio',
    ]);
  });
});

describe('checkSpecies input', () => {
  it('rejects an empty exercise', () => {
    expect(() => checkSpecies([], line('C5'), 1, C_MAJOR)).toThrow(/cantus firmus/);
  });

  it('reads a counterpoint written below the cantus firmus', () => {
    const cf = line('C5 D5 E5 D5 C5');
    const cp = line('C4 B3 A3 B3 C4');
    const found = checkSpecies(cf, cp, 1, C_MAJOR);
    expect(kinds(found)).not.toContain('voiceCrossing');
  });
});
