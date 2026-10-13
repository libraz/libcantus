import { describe, expect, it } from 'vitest';
import {
  analyzeChord,
  augmentedSixthChord,
  augmentedSixthFromPitchClasses,
  augmentedSixthKind,
  borrowedSource,
  Chord,
  chordToRoman,
  detectCadence,
  explainRoman,
  functionOf,
  InvalidInputError,
  isBorrowedChord,
  isDiatonic,
  isMinorKey,
  Key,
  majorKey,
  makeChord,
  minorKey,
  Note,
  noteNames,
  parseChordSymbol,
  parseNote,
  pivotChords,
  romanToChord,
  secondaryDominant,
  secondaryDominantOf,
  spellAugmentedSixth,
  spellLine,
} from '../src/index.js';

/**
 * The analyze layer's public functions take a key, a chord, or a note in
 * whatever form the caller holds it. Every case here asserts that the text form
 * answers exactly what the plain-data form answers, so widening the entry
 * points stayed a widening and changed no reading.
 */

const C_MAJOR = majorKey(0);
const A_MINOR = minorKey(9);
const G7 = makeChord(7, 'dom7');

describe('functional harmony takes a key in any form', () => {
  it('reads the mode from a key name', () => {
    expect(isMinorKey('A minor')).toBe(isMinorKey(A_MINOR));
    expect(isMinorKey('A minor')).toBe(true);
    expect(isMinorKey('C major')).toBe(false);
  });

  it('reads a `Key` instance through its toJSON', () => {
    const key = Key.minor('A');
    expect(isMinorKey(key)).toBe(isMinorKey(A_MINOR));
    expect(functionOf(G7, key)).toBe(functionOf(G7, A_MINOR));
  });

  it('names the parallel key of a key name', () => {
    expect(secondaryDominant(5, 'C major')).toEqual(secondaryDominant(5, C_MAJOR));
  });

  it('reads a chord symbol and a key name alike', () => {
    expect(functionOf('G7', 'C major')).toBe(functionOf(G7, C_MAJOR));
    expect(isDiatonic('G7', 'C major')).toBe(isDiatonic(G7, C_MAJOR));
    expect(isBorrowedChord('Fm', 'C major')).toBe(isBorrowedChord(makeChord(5, 'min'), C_MAJOR));
    expect(borrowedSource('Fm', 'C major')).toBe(borrowedSource(makeChord(5, 'min'), C_MAJOR));
  });

  it('analyzes a chord named as text', () => {
    expect(analyzeChord('G7', 'C major')).toEqual(analyzeChord(G7, C_MAJOR));
    expect(analyzeChord('G7', 'C major', { alternatives: true })).toEqual(
      analyzeChord(G7, C_MAJOR, { alternatives: true }),
    );
  });

  it('builds the dominant of a chord named as text', () => {
    // The symbol carries a spelling hint the bare pitch-class chord has not, so
    // the forms compared are the symbol, its data, and the class over it.
    expect(secondaryDominantOf('Eb')).toEqual(secondaryDominantOf(parseChordSymbol('Eb')));
    expect(secondaryDominantOf(Chord.parse('Eb'))).toEqual(secondaryDominantOf('Eb'));
    expect(secondaryDominantOf(makeChord(3, 'maj')).rootPc).toBe(secondaryDominantOf('Eb').rootPc);
  });

  it('lists the pivots between two key names', () => {
    expect(pivotChords('C major', 'G major')).toEqual(pivotChords(C_MAJOR, majorKey(7)));
  });

  it('renders and parses numerals against a key name', () => {
    expect(chordToRoman('G7', 'C major')).toBe(chordToRoman(G7, C_MAJOR));
    expect(chordToRoman('D7', 'C major', { applied: true })).toBe(
      chordToRoman(makeChord(2, 'dom7'), C_MAJOR, { applied: true }),
    );
    expect(explainRoman('G7', 'C major')).toEqual(explainRoman(G7, C_MAJOR));
    expect(romanToChord('V7', 'C major')).toEqual(romanToChord('V7', C_MAJOR));
  });

  it('detects a cadence between chords named as text', () => {
    expect(detectCadence('G', 'C', 'C major')).toEqual(
      detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), C_MAJOR),
    );
    // The approach chord inside the options object widens the same way.
    expect(detectCadence('G', 'C', 'C major', { approach: 'C/G' })).toEqual(
      detectCadence(makeChord(7, 'maj'), makeChord(0, 'maj'), C_MAJOR, {
        approach: makeChord(0, 'maj', 7),
      }),
    );
  });
});

describe('the augmented sixths take a key, a chord, and a tonic in any form', () => {
  it('builds and identifies from text', () => {
    expect(augmentedSixthChord('german', 'C major')).toEqual(
      augmentedSixthChord('german', C_MAJOR),
    );
    const german = augmentedSixthChord('german', C_MAJOR);
    expect(augmentedSixthKind(german, 'C major')).toBe(augmentedSixthKind(german, C_MAJOR));
    expect(augmentedSixthKind(Chord.fromData(german), 'C major')).toBe('german');
    expect(augmentedSixthFromPitchClasses([8, 0, 3, 6], 8, 'C major')).toEqual(
      augmentedSixthFromPitchClasses([8, 0, 3, 6], 8, C_MAJOR),
    );
  });

  it('spells from a tonic given as a name, a MIDI number, or a `Note`', () => {
    const spelled = spellAugmentedSixth('german', parseNote('C'));
    expect(spellAugmentedSixth('german', 'C')).toEqual(spelled);
    expect(noteNames(spellAugmentedSixth('german', Note.parse('C')))).toEqual(noteNames(spelled));
    expect(noteNames(spellAugmentedSixth('italian', 60))).toEqual(
      noteNames(spellAugmentedSixth('italian', parseNote('C4'))),
    );
  });
});

describe('line spelling takes a key and a tonic in any form', () => {
  const rising = [60, 61, 62].map((pitch, index) => ({
    pitch,
    startBeat: index,
    durationBeat: 1,
  }));

  it('spells against a key name', () => {
    expect(noteNames(spellLine(rising, null, 'C major'))).toEqual(
      noteNames(spellLine(rising, null, C_MAJOR)),
    );
  });

  it('takes the anchoring tonic as text', () => {
    expect(noteNames(spellLine(rising, null, 'C major', { tonic: 'C' }))).toEqual(
      noteNames(spellLine(rising, null, C_MAJOR, { tonic: parseNote('C') })),
    );
  });
});

describe('a value that names nothing is refused at the boundary', () => {
  it('rejects a key name no parser knows', () => {
    expect(() => isMinorKey('H dur moll')).toThrow(InvalidInputError);
    expect(() => chordToRoman('G7', 'not a key')).toThrow(InvalidInputError);
  });

  it('rejects a chord symbol no parser knows', () => {
    expect(() => functionOf('Cmaj7(#', 'C major')).toThrow(InvalidInputError);
  });
});
