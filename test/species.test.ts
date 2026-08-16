import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { Note } from '../src/core/pitch/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import type { Species } from '../src/theory/partwriting/index.js';
import { checkPartWriting, checkSpecies, spellVoicing } from '../src/theory/partwriting/index.js';
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
    const cp = line('C5 G4 A4 B4 C5 B4 D5 B4 C5');
    // B4 over F4 is an augmented fourth, stepped into and out of in one
    // direction: the passing note the species is written to allow.
    expect(checkSpecies(cf, cp, 2, C_MAJOR)).toEqual([]);
  });

  it('accepts a closing measure written in the species own note values', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('C5 G4 A4 B4 C5 B4 D5 B4 C5 C5');
    // The same exercise with the final held as two half notes rather than
    // written as the whole note convention asks for.
    expect(checkSpecies(cf, cp, 2, C_MAJOR)).toEqual([]);
  });

  it('flags a repeated note, which this species does not write', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 A4 A4 B4 C5 B4 D5 B4 C5');
    const found = checkSpecies(cf, cp, 2, C_MAJOR).filter(
      (violation) => violation.kind === 'melodicShape',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rationale).toContain('repeats a note');
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

  it('accepts a closing measure written in the species own note values', () => {
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 F4 G4 A4 B4 C5 B4 A4 C5');
    // Twenty quarter notes: the last measure moves in quarters like every other
    // one instead of closing on the single whole note convention asks for.
    expect(checkSpecies(cantus, cp, 3, C_MAJOR)).toEqual([]);
  });

  it('points a missed clausula at the measure before the close, not inside it', () => {
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 F4 G4 A4 G4 C5 B4 A4 C5');
    const found = checkSpecies(cantus, cp, 3, C_MAJOR).filter(
      (violation) => violation.kind === 'missingCadence',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.fromIndex).toBe(15);
    expect(found[0]?.toIndex).toBe(16);
  });
});

describe('the figures that quit a dissonance by leap', () => {
  it('accepts a third-species exercise carrying the cambiata', () => {
    // Fux's D-dorian cantus firmus, with the counterpoint writing the nota
    // cambiata across the seventh bar line: E5 D5 B4 C5, where the dissonant D5
    // is left by a downward third rather than by step.
    const cf = line('D4 F4 E4 D4 G4 F4 A4 G4 F4 E4 D4');
    const cp = line(
      'A4 B4 C5 B4 A4 C5 B4 A4 G4 A4 B4 C5 B4 A4 G4 A4 B4 C5 D5 C5 D5 C5 B4 A4 C5 D5 E5 D5 B4 C5 D5 C5 D5 C5 B4 A4 G4 A4 B4 C#5 D5',
    );
    expect(checkSpecies(cf, cp, 3, D_DORIAN)).toEqual([]);
  });

  it('accepts the double neighbour, whose second note is reached by leap', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 F4 G4 A4 G4 A4 B4 C5');
    // The third measure decorates G4 from both sides — G4 A4 F4 G4 — and both
    // neighbours are dissonant over the cantus firmus E4.
    expect(checkSpecies(cf, cp, 3, C_MAJOR)).toEqual([]);
  });

  it('still flags a dissonance left by leap in the first species', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('C5 B4 G4 B4 C5');
    expect(checkSpecies(cf, cp, 1, C_MAJOR)).toEqual([
      {
        kind: 'unpreparedDissonance',
        voices: [0, 1],
        fromIndex: 1,
        toIndex: 1,
        rationale: 'A A4 falls where this species allows only a consonance',
      },
    ]);
  });

  it('still flags the cambiata shape in the second species', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('G4 A4 C5 B4 G4 A4 D5 B4 C5');
    // C5 B4 G4 A4 spells the figure, but a half note against each half of the
    // measure is not where the style writes it.
    const found = checkSpecies(cf, cp, 2, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found.map((violation) => violation.fromIndex)).toContain(3);
  });

  it('still flags the figure on the weak half of the fourth species', () => {
    const cantus = line('C4 F4 E4 D4 C4');
    const cp = line('C5 C5 C5 D5 E5 D5 B4 C5 C5');
    const found = checkSpecies(cantus, cp, 4, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found.map((violation) => violation.fromIndex)).toContain(5);
  });
});

describe('melodic shape', () => {
  const cantus = line('C4 D4 E4 D4 C4');

  /** The rationales of the shape violations a check reported. */
  function shapes(cf: Note[], cp: Note[], species: 1 | 2 | 3 | 4 | 5 = 1): string[] {
    return checkSpecies(cf, cp, species, C_MAJOR)
      .filter((violation) => violation.kind === 'melodicShape')
      .map((violation) => violation.rationale);
  }

  it('flags a line that reaches its highest note twice', () => {
    expect(shapes(cantus, line('C5 A4 C5 B4 C5'))).toEqual([
      'The line reaches its highest note more than once, so it has no one climax',
    ]);
  });

  it('flags three leaps in a row in the same direction', () => {
    expect(shapes(cantus, line('C5 E5 G5 B5 C6'))).toEqual([
      'The counterpoint leaps 3 times in a row in the same direction',
    ]);
  });

  it('flags two leaps in one direction that span more than an octave', () => {
    expect(shapes(cantus, line('C5 E5 E6 B5 C6'))).toContain(
      'Two leaps in the same direction carry the line further than an octave',
    );
  });

  it('flags a wide leap that carries on in the same direction', () => {
    expect(shapes(cantus, line('C5 A5 B5 B4 C5'))).toEqual([
      'The leap of a sixth is not answered by a step the other way',
    ]);
  });

  it('flags a run of notes outlining a tritone between its turning points', () => {
    const cf = line('C4 D4 E4 F4 G4 F4 D4 C4');
    expect(shapes(cf, line('C5 F4 G4 A4 B4 A4 B4 C5'))).toEqual([
      'The line turns around on a tritone, outlining the interval it may not leap',
    ]);
  });

  it('leaves the textbook exercises alone', () => {
    const dorian = line('D4 F4 E4 D4 G4 F4 A4 G4 F4 E4 D4');
    expect(shapes(dorian, line('A4 A4 G4 A4 B4 C5 C5 B4 D5 C#5 D5'))).toEqual([]);
    expect(shapes(line('C4 F4 E4 D4 C4'), line('C5 G4 A4 B4 C5 B4 D5 B4 C5'), 2)).toEqual([]);
    expect(
      shapes(line('C4 F4 E4 D4 C4'), line('G4 A4 B4 C5 D5 C5 B4 A4 G4 A4 B4 C5 F4 G4 A4 B4 C5'), 3),
    ).toEqual([]);
    expect(shapes(line('C4 F4 E4 D4 C4'), line('C5 C5 C5 D5 D5 C5 C5 B4 C5'), 4)).toEqual([]);
  });

  it('is not applied by the four-part checker', () => {
    // A soprano that climbs by three leaps in a row, which a species exercise
    // would be charged for and a chorale is not.
    const tonic = makeChord(0, 'maj');
    const chords = [tonic, tonic, tonic];
    const voicings = [
      [48, 55, 64, 72],
      [48, 55, 64, 76],
      [48, 55, 64, 79],
    ].map((pitches) => spellVoicing(pitches, tonic, C_MAJOR));
    expect(kinds(checkPartWriting(voicings, chords, C_MAJOR))).not.toContain('melodicShape');
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

  it('rejects a species there is no such thing as', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('C5 A4 G4 B4 C5');
    expect(() => checkSpecies(cf, cp, 6 as Species, C_MAJOR)).toThrow(InvalidInputError);
    expect(() => checkSpecies(cf, cp, '3' as unknown as Species, C_MAJOR)).toThrow(
      /must be one of 1, 2, 3, 4, 5/,
    );
  });

  it('reads a counterpoint written below the cantus firmus', () => {
    const cf = line('C5 D5 E5 D5 C5');
    const cp = line('C4 B3 A3 B3 C4');
    const found = checkSpecies(cf, cp, 1, C_MAJOR);
    expect(kinds(found)).not.toContain('voiceCrossing');
  });
});
