import { describe, expect, it } from 'vitest';
import { Chord, Interval, Key, Note, Progression, parseInterval } from '../src/index.js';

describe('Note.transposeBy', () => {
  it('accepts a name, plain interval data, and an Interval alike', () => {
    const note = Note.of('C4');
    expect(note.transposeBy('A2').name).toBe('D#4');
    expect(note.transposeBy(parseInterval('A2')).name).toBe('D#4');
    expect(note.transposeBy(Interval.parse('A2')).name).toBe('D#4');
  });

  it('distinguishes the augmented fourth from the diminished fifth', () => {
    expect(Note.of('C4').transposeBy('A4').name).toBe('F#4');
    expect(Note.of('C4').transposeBy('d5').name).toBe('Gb4');
  });

  it('moves down for a descending interval', () => {
    expect(Note.of('G#4').transposeBy('-A4').name).toBe('D4');
    expect(Note.of('C4').transposeBy('-m3').name).toBe('A3');
  });

  it('is the identity for a perfect unison', () => {
    expect(Note.of('Bb3').transposeBy('P1').name).toBe('Bb3');
  });
});

describe('Chord.transposeBy', () => {
  it('spells the root by the interval, not by the semitone count', () => {
    expect(Chord.parse('C').transposeBy('A4').symbol()).toBe('F#');
    expect(Chord.parse('C').transposeBy('d5').symbol()).toBe('Gb');
  });

  it('keeps the quality and the slash bass', () => {
    expect(Chord.parse('C/G').transposeBy('A4').symbol()).toBe('F#/C#');
    expect(Chord.parse('Cmaj7').transposeBy('m3').symbol()).toBe('Ebmaj7');
    expect(Chord.parse('C/G').transposeBy('A4').bassPc).toBe(1);
  });

  it('moves a carried key with the chord', () => {
    const chord = Chord.parse('G7').withKey(Key.major('C'));
    const moved = chord.transposeBy('m3');
    expect(moved.key?.toString()).toBe('Eb major');
    expect(moved.symbol()).toBe('Bb7');
    // The degree is preserved, which is what carrying the key is for.
    expect(moved.roman()).toBe(chord.roman());
  });

  it('round trips through the negated interval', () => {
    const chord = Chord.parse('Ab7');
    expect(chord.transposeBy('A4').transposeBy('-A4').symbol()).toBe('Ab7');
  });
});

describe('Progression.transposeBy', () => {
  const cMajor = Key.major('C');
  const progression = new Progression([Chord.parse('C'), Chord.parse('G7')], cMajor);

  it('moves every chord and the carried key', () => {
    const moved = progression.transposeBy('A4');
    expect(moved.toString()).toBe('F# C#7');
    expect(moved.key?.rootPc).toBe(6);
    expect(moved.roman()).toEqual(['I', 'V7']);
  });

  it('is the identity for a perfect unison', () => {
    const moved = progression.transposeBy('P1');
    expect(moved.toString()).toBe(progression.toString());
    expect(moved.key?.toString()).toBe(cMajor.toString());
  });

  it('round trips through the negated interval', () => {
    const interval = Interval.parse('A4');
    const moved = progression.transposeBy(interval).transposeBy(interval.negate());
    expect(moved.toString()).toBe(progression.toString());
    expect(moved.key?.toString()).toBe(cMajor.toString());
  });
});

describe('Progression.transposeTo', () => {
  it('moves the progression into the target key', () => {
    const progression = new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C'));
    const moved = progression.transposeTo(Key.major('Eb'));
    expect(moved.toString()).toBe('Eb Bb7');
    expect(moved.key?.toString()).toBe('Eb major');
    expect(moved.roman()).toEqual(['I', 'V7']);
  });

  it('lands in the target mode instead of keeping its own', () => {
    const progression = new Progression([Chord.parse('C'), Chord.parse('G7')], Key.major('C'));
    const moved = progression.transposeTo(Key.minor('A'));
    expect(moved.key?.equals(Key.minor('A'))).toBe(true);
    expect(moved.key?.toString()).toBe('A minor');
    expect(moved.toString()).toBe('A E7');
    // The members are analyzed in the target key, not in a transposed C major.
    expect(moved.chords[0]?.key?.equals(Key.minor('A'))).toBe(true);
  });

  it('carries the target key for every mode it is given', () => {
    const progression = new Progression([Key.major('C').chord(1)], Key.major('C'));
    for (const target of [
      Key.major('Eb'),
      Key.minor('A'),
      Key.minor('C'),
      Key.named('harmonicMinor', 'F#'),
      Key.named('dorian', 'D'),
    ]) {
      expect(progression.transposeTo(target).key?.equals(target)).toBe(true);
    }
  });

  it('spells the chords in the target key rather than in an enharmonic one', () => {
    const progression = new Progression([Chord.of(0, 'maj'), Chord.of(7, 'dom7')], Key.major('C'));
    expect(progression.transposeTo(Key.major('Gb')).toString()).toBe('Gb Db7');
    expect(progression.transposeTo(Key.major('F#')).toString()).toBe('F# C#7');
  });

  it('throws without a key context', () => {
    const progression = new Progression([Chord.parse('C'), Chord.parse('G7')]);
    expect(() => progression.transposeTo(Key.major('Eb'))).toThrow(/no key context/);
  });
});
