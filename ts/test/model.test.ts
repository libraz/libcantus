import { describe, expect, it } from 'vitest';
import { Chord, Key, Note, Progression } from '../src/model/index.js';

describe('Note', () => {
  it('is immutable: transpose returns a new instance', () => {
    const original = Note.parse('C4');
    const transposed = original.transpose(2);
    expect(transposed).not.toBe(original);
    expect(original.name).toBe('C4');
  });

  it('transposes by zero as the identity, preserving the exact spelling', () => {
    // A naive MIDI round-trip would respell Eb4 as D#4; zero must keep Eb4.
    expect(Note.parse('Eb4').transpose(0).name).toBe('Eb4');
    expect(Note.parse('D#4').transpose(0).name).toBe('D#4');
    expect(Note.parse('Cb').transpose(0).name).toBe('Cb');
    const eb = Note.parse('Eb4');
    const same = eb.transpose(0);
    expect(same).not.toBe(eb);
    expect(same.equals(eb)).toBe(true);
  });
});

describe('plain data round trips and collection access', () => {
  it('indexes and iterates a progression without copying it each time', () => {
    const chords = [Chord.parse('C'), Chord.parse('Am'), Chord.parse('F')];
    const progression = new Progression(chords);
    expect(progression.at(0)?.symbol()).toBe('C');
    expect(progression.at(-1)?.symbol()).toBe('F');
    expect(progression.at(3)).toBeUndefined();
    expect([...progression].map((chord) => chord.symbol())).toEqual(['C', 'Am', 'F']);
    // The same array is handed out each time rather than a fresh copy.
    expect(progression.chords).toBe(progression.chords);
  });
});

describe('Chord', () => {
  it('is immutable: withKey and invert return new instances', () => {
    const original = Chord.of(0, 'maj');
    const withKey = original.withKey(Key.major('C'));
    expect(withKey).not.toBe(original);
    expect(original.key).toBeUndefined();
    const inverted = original.invert(1);
    expect(inverted).not.toBe(original);
    expect(original.bassPc).toBeUndefined();
    // Mutating exposed copies never affects the chord.
    original.intervals.push(99);
    expect(original.intervals).toEqual([0, 4, 7]);
  });
});

describe('Progression', () => {
  it('is immutable: add returns a new progression', () => {
    const cMajor = Key.major('C');
    const prog = new Progression([cMajor.chord(1)], cMajor);
    const longer = prog.add(cMajor.chord(5, 'dom7'));
    expect(longer).not.toBe(prog);
    expect(prog.length).toBe(1);
    expect(longer.length).toBe(2);
    expect(longer.chords[1]?.quality).toBe('dom7');
  });
});
