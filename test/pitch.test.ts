import { describe, expect, it } from 'vitest';
import {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  spelledInterval,
} from '../src/core/pitch/index.js';

describe('parseNote / formatNote', () => {
  it('round-trips common spellings', () => {
    for (const text of ['C', 'C#4', 'Bb', 'F##3', 'Ebb2', 'G-1']) {
      expect(formatNote(parseNote(text))).toBe(text);
    }
  });

  it('parses double sharps written with x', () => {
    expect(parseNote('Fx3')).toEqual({ letter: 3, alter: 2, octave: 3 });
  });

  it('rejects invalid text', () => {
    expect(() => parseNote('H')).toThrow();
    expect(() => parseNote('')).toThrow();
  });

  it('rejects contradictory mixed accidentals but allows same-direction stacks', () => {
    expect(() => parseNote('C#b4')).toThrow();
    expect(() => parseNote('Bb#')).toThrow();
    expect(() => parseNote('Cxb')).toThrow();
    expect(parseNote('C##4')).toEqual({ letter: 0, alter: 2, octave: 4 });
    expect(parseNote('Ebb2')).toEqual({ letter: 2, alter: -2, octave: 2 });
  });
});

describe('pitch-class and MIDI conversion', () => {
  it('distinguishes enharmonics in spelling but shares a pitch class', () => {
    expect(noteToPitchClass(parseNote('G#'))).toBe(8);
    expect(noteToPitchClass(parseNote('Ab'))).toBe(8);
  });

  it('places middle C at MIDI 60', () => {
    expect(noteToMidi(parseNote('C4'))).toBe(60);
    expect(noteToMidi(parseNote('A4'))).toBe(69);
  });

  it('names MIDI numbers with the requested spelling', () => {
    expect(formatNote(midiToNote(61, 'sharp'))).toBe('C#4');
    expect(formatNote(midiToNote(61, 'flat'))).toBe('Db4');
    expect(formatNote(midiToNote(60))).toBe('C4');
  });

  it('requires an octave for MIDI conversion', () => {
    expect(() => noteToMidi(parseNote('C'))).toThrow();
  });

  it('names the MIDI range boundaries', () => {
    expect(formatNote(midiToNote(0))).toBe('C-1');
    expect(formatNote(midiToNote(127))).toBe('G9');
    expect(noteToMidi(midiToNote(0))).toBe(0);
    expect(noteToMidi(midiToNote(127))).toBe(127);
  });

  it('extrapolates out-of-range MIDI numbers without clamping, staying invertible', () => {
    // Negative and >127 inputs are not clamped; they extend the octave grid and
    // remain an exact inverse of noteToMidi.
    expect(formatNote(midiToNote(-1))).toBe('B-2');
    expect(formatNote(midiToNote(128))).toBe('G#9');
    for (const midi of [-12, -1, 128, 200]) {
      expect(noteToMidi(midiToNote(midi))).toBe(midi);
    }
  });

  it('rounds fractional MIDI numbers to the nearest integer', () => {
    expect(noteToMidi(midiToNote(60.4))).toBe(60);
    expect(noteToMidi(midiToNote(60.6))).toBe(61);
  });
});

describe('spelledInterval', () => {
  it('distinguishes augmented fourth from diminished fifth', () => {
    const aug4 = spelledInterval(parseNote('C4'), parseNote('F#4'));
    expect(aug4).toMatchObject({ number: 4, quality: 'A', semitones: 6 });
    const dim5 = spelledInterval(parseNote('C4'), parseNote('Gb4'));
    expect(dim5).toMatchObject({ number: 5, quality: 'd', semitones: 6 });
  });

  it('names common intervals', () => {
    expect(spelledInterval(parseNote('C4'), parseNote('E4'))).toMatchObject({
      number: 3,
      quality: 'M',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('Eb4'))).toMatchObject({
      number: 3,
      quality: 'm',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('G4'))).toMatchObject({
      number: 5,
      quality: 'P',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('C5'))).toMatchObject({
      number: 8,
      quality: 'P',
      semitones: 12,
    });
  });

  it('detects the augmented second in harmonic minor', () => {
    const aug2 = spelledInterval(parseNote('Ab4'), parseNote('B4'));
    expect(aug2).toMatchObject({ number: 2, quality: 'A', semitones: 3 });
  });

  it('carries a sign for descending intervals', () => {
    const down = spelledInterval(parseNote('G4'), parseNote('C4'));
    expect(down.semitones).toBe(-7);
    expect(down.number).toBe(5);
  });

  it('signs semitones by pitch direction, not letter direction', () => {
    const down = spelledInterval(parseNote('C4'), parseNote('Cb4'));
    expect(down).toMatchObject({ number: 1, quality: 'A', semitones: -1 });
    const up = spelledInterval(parseNote('C4'), parseNote('C#4'));
    expect(up).toMatchObject({ number: 1, quality: 'A', semitones: 1 });
  });

  describe('same-letter descending semitones (octaveless)', () => {
    it('returns a descending augmented unison, not a garbage augmentation stack', () => {
      // Regression: octave lift used to be upward-only, so a same-letter
      // downward step wrapped to +11 semitones and stacked eleven "A"s.
      for (const [from, to] of [
        ['E', 'Eb'],
        ['F#', 'F'],
        ['C', 'Cb'],
      ] as const) {
        expect(spelledInterval(parseNote(from), parseNote(to))).toMatchObject({
          number: 1,
          quality: 'A',
          semitones: -1,
        });
      }
    });

    it('leaves ascending same-letter steps unchanged', () => {
      for (const [from, to] of [
        ['Eb', 'E'],
        ['F', 'F#'],
        ['Cb', 'C'],
      ] as const) {
        expect(spelledInterval(parseNote(from), parseNote(to))).toMatchObject({
          number: 1,
          quality: 'A',
          semitones: 1,
        });
      }
    });
  });

  describe('pitch-class branch (octaveless notes)', () => {
    it('keeps wraparound intervals consistent with the ascending number', () => {
      expect(spelledInterval(parseNote('Ab'), parseNote('G#'))).toMatchObject({
        number: 7,
        quality: 'A',
        semitones: 12,
      });
      expect(spelledInterval(parseNote('C'), parseNote('B#'))).toMatchObject({
        number: 7,
        quality: 'A',
        semitones: 12,
      });
      expect(spelledInterval(parseNote('Dbb'), parseNote('C#'))).toMatchObject({
        number: 7,
        quality: 'AA',
        semitones: 13,
      });
    });

    it('measures simple intervals within a single ascending octave', () => {
      expect(spelledInterval(parseNote('B'), parseNote('C'))).toMatchObject({
        number: 2,
        quality: 'm',
        semitones: 1,
      });
      expect(spelledInterval(parseNote('C'), parseNote('C'))).toMatchObject({
        number: 1,
        quality: 'P',
        semitones: 0,
      });
      expect(spelledInterval(parseNote('C'), parseNote('G'))).toMatchObject({
        number: 5,
        quality: 'P',
        semitones: 7,
      });
    });
  });
});
