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

  it('reports a fifth reached by similar motion though the upper voice steps', () => {
    // A sixth opening to a fifth, both voices rising, the counterpoint moving
    // C5 to D5 by step over a leap in the cantus firmus. Two voices and nothing
    // between them: the step is no excuse for the direct fifth, whatever the
    // four-part chorale allows its outer voices.
    const cf = line('E4 G4');
    const cp = line('C5 D5');
    expect(kinds(checkSpecies(cf, cp, 1, C_MAJOR))).toContain('hiddenPerfect');
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

  it('flags a neighbour dissonance on the weak half, which this species does not write', () => {
    const cf = line('C4 F4 E4 D4 C4');
    const cp = line('C5 G4 A4 C5 B4 A4 B4 G4 C5');
    // A4 over E4 is a perfect fourth stepped down onto from B4 and stepped back
    // up to B4: a neighbour note, and the only dissonance the second species
    // licenses is the one passed through in a single direction.
    const found = checkSpecies(cf, cp, 2, C_MAJOR).filter(
      (violation) => violation.kind === 'unpreparedDissonance',
    );
    expect(found.map((violation) => violation.fromIndex)).toContain(5);
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
    const cp = line('G4 A4 B4 C5 D5 C5 B4 A4 B4 A4 B4 C5 F4 G4 A4 B4 C5');
    // A4 over E4 in the third measure is a perfect fourth stepped down onto
    // from B4 and stepped back up to B4: the neighbour the quarter-note line
    // is allowed to decorate a consonance with.
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

  it('names a leap wider than an octave in the rationale that reports it', () => {
    // The rationale is the only channel that tells the shape rules apart, so
    // the interval it is about has to be in it: past the octave the name fell
    // back to the bare noun and the sentence read `The leap of a interval`,
    // which names no interval and is not a sentence.
    const found = shapes(line('C4 D4 E4 D4 C4'), line('C5 D6 E6 D6 C6'));
    expect(found).toContain('The leap of a ninth is not answered by a step the other way');
    for (const rationale of found) {
      expect(rationale).not.toContain('a interval');
    }
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

  describe('a note tied across the bar line', () => {
    // The ligature that defines the species: E4 is struck on the weak half of
    // the first measure and goes on sounding into the second, where the cantus
    // firmus moves to D4 underneath it and the tie becomes a major second.
    const cantusFirmus = line('C4 D4 C4');
    const values = [0.5, 1, 0.5, 1];

    it('is judged against the measure it is carried into', () => {
      const cp = line('C5 E4 F4 C4');
      // The second rises to F4 instead of falling, so the dissonance the tie
      // sounds over D4 is left where it stands.
      expect(kinds(checkSpecies(cantusFirmus, cp, 5, C_MAJOR, { durations: values }))).toContain(
        'unresolvedSuspension',
      );
    });

    it('reports one crossing for a note that crosses in both its measures', () => {
      // A counterpoint written above that dips under the cantus firmus and is
      // held there has an entry per measure it sounds in, and every field of a
      // crossing record comes from the note's own index — so two of them are
      // one error a caller cannot tell apart, marked twice in a scoring UI and
      // subtracted twice from a score counted by violations.
      const cp = line('C5 B3 D5 C5');
      const found = checkSpecies(cantusFirmus, cp, 5, C_MAJOR, { durations: values }).filter(
        (violation) => violation.kind === 'voiceCrossing',
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.fromIndex).toBe(1);
    });

    it('passes where it is prepared by a consonance and falls by step', () => {
      const cp = line('C5 E4 D4 C4');
      const found = checkSpecies(cantusFirmus, cp, 5, C_MAJOR, { durations: values }).filter(
        (violation) =>
          violation.kind === 'unpreparedDissonance' || violation.kind === 'unresolvedSuspension',
      );
      expect(found).toEqual([]);
    });
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

describe('the order violations come back in', () => {
  /** Whether the violations run forward through the exercise. */
  function inTimeOrder(violations: { fromIndex: number; toIndex: number }[]): boolean {
    return violations.every((found, position) => {
      const previous = violations[position - 1];
      if (previous === undefined) {
        return true;
      }
      return (
        previous.fromIndex < found.fromIndex ||
        (previous.fromIndex === found.fromIndex && previous.toIndex <= found.toIndex)
      );
    });
  }

  it('marks a faulty exercise from the top rather than rule by rule', () => {
    // Parallel fifths in the first measure, then a seventh leapt at the fourth:
    // read from the top, the fifths have to come first.
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('G4 A4 G4 F5 C5');
    const found = checkSpecies(cf, cp, 1, C_MAJOR);
    expect(found.length).toBeGreaterThan(1);
    expect(inTimeOrder(found)).toBe(true);
    expect(kinds(found)).toContain('parallelFifth');
    expect(found[0]?.fromIndex).toBe(0);
  });

  it('marks every species in time order', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cases: { species: Species; cp: Note[] }[] = [
      { species: 1, cp: line('C5 B4 C5 B4 C5') },
      { species: 2, cp: line('G4 E4 F4 A4 G4 F4 A4 B4 C5') },
      { species: 3, cp: line('G4 A4 B4 C5 D5 C5 B4 A4 G4 F4 E4 D4 C5 B4 A4 G4 C5') },
    ];
    for (const { species, cp } of cases) {
      const found = checkSpecies(cf, cp, species, C_MAJOR);
      expect(found.length, `species ${species}`).toBeGreaterThan(0);
      expect(inTimeOrder(found), `species ${species}`).toBe(true);
    }
  });

  it('returns the same order for the same exercise', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const cp = line('G4 A4 G4 B4 C5');
    expect(checkSpecies(cf, cp, 1, C_MAJOR)).toEqual(checkSpecies(cf, cp, 1, C_MAJOR));
  });

  it('reports a wrong rhythmic ratio on its own, at the start', () => {
    const cf = line('C4 D4 E4 D4 C4');
    const found = checkSpecies(cf, line('C5 B4 C5'), 1, C_MAJOR);
    expect(kinds(found)).toEqual(['wrongRhythmicRatio']);
    expect(inTimeOrder(found)).toBe(true);
    expect(found[0]?.fromIndex).toBe(0);
  });
});

describe('a suspension that resolves onto another dissonance', () => {
  // The cantus firmus of the figure: the suspended Gb is a diminished twelfth
  // over the C, and the F it steps down to is a perfect eleventh — both
  // dissonances, which only a chromatic spelling makes possible.
  const cf = line('C4 Eb4 C4 Bb3 Eb4');
  const durations = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1];
  const C_MINOR = minorKey(0);

  it('reports the fourth-species suspension at the suspension itself', () => {
    const cp = line('C5 C5 Bb4 Gb5 Gb5 F5 Eb5 Eb5 Eb5');
    const found = checkSpecies(cf, cp, 4, C_MINOR, { durations });
    expect(
      found.filter((v) => v.kind === 'unresolvedSuspension' && v.fromIndex === 4),
    ).toHaveLength(1);
  });

  it('reports it in the fifth species, where the resolution passes for a passing note', () => {
    // The resolution falls on a weak half and is stepped through, which is
    // exactly the licence that used to leave the whole figure unreported.
    const cp = line('C5 C5 Bb4 Gb5 Gb5 F5 Eb5 Eb5 Eb5');
    const found = checkSpecies(cf, cp, 5, C_MINOR, { durations });
    expect(
      found.filter((v) => v.kind === 'unresolvedSuspension' && v.fromIndex === 4),
    ).toHaveLength(1);
  });

  it('says nothing where the suspension lands on a consonance', () => {
    // The plain fourth-to-third suspension: F prepared as a tenth over D, held
    // as an eleventh over C, resolving down to the tenth.
    const plain = line('C4 D4 C4 D4 C4');
    const cp = line('C5 C5 F5 F5 F5 E5 E5 D5 C5');
    const found = checkSpecies(plain, cp, 4, C_MAJOR, { durations });
    expect(found.filter((v) => v.kind === 'unresolvedSuspension')).toEqual([]);
  });
});
