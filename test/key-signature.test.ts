import { describe, expect, it } from 'vitest';
import { formatNote, parseNote } from '../src/core/pitch/index.js';
import {
  keyFromFifths,
  keySignatureFifths,
  majorKey,
  minorKey,
  scaleByName,
} from '../src/theory/scale/index.js';

describe('keySignatureFifths', () => {
  it('counts the sharps and flats of the major keys', () => {
    expect(keySignatureFifths(parseNote('C'), majorKey(0))).toBe(0);
    expect(keySignatureFifths(parseNote('G'), majorKey(7))).toBe(1);
    expect(keySignatureFifths(parseNote('F'), majorKey(5))).toBe(-1);
    expect(keySignatureFifths(parseNote('Bb'), majorKey(10))).toBe(-2);
    expect(keySignatureFifths(parseNote('C#'), majorKey(1))).toBe(7);
    expect(keySignatureFifths(parseNote('Cb'), majorKey(11))).toBe(-7);
  });

  it('counts the sharps and flats of the minor keys', () => {
    expect(keySignatureFifths(parseNote('A'), minorKey(9))).toBe(0);
    expect(keySignatureFifths(parseNote('C'), minorKey(0))).toBe(-3);
    expect(keySignatureFifths(parseNote('F#'), minorKey(6))).toBe(3);
    expect(keySignatureFifths(parseNote('Ab'), minorKey(8))).toBe(-7);
  });

  it('offsets each diatonic mode from the major key on the same tonic', () => {
    expect(keySignatureFifths(parseNote('D'), scaleByName('dorian', 2))).toBe(0);
    expect(keySignatureFifths(parseNote('E'), scaleByName('phrygian', 4))).toBe(0);
    expect(keySignatureFifths(parseNote('F'), scaleByName('lydian', 5))).toBe(0);
    expect(keySignatureFifths(parseNote('G'), scaleByName('mixolydian', 7))).toBe(0);
    expect(keySignatureFifths(parseNote('B'), scaleByName('locrian', 11))).toBe(0);
    expect(keySignatureFifths(parseNote('C'), scaleByName('lydian', 0))).toBe(1);
    expect(keySignatureFifths(parseNote('C'), scaleByName('mixolydian', 0))).toBe(-1);
    expect(keySignatureFifths(parseNote('C'), scaleByName('dorian', 0))).toBe(-2);
    expect(keySignatureFifths(parseNote('C'), scaleByName('phrygian', 0))).toBe(-4);
    expect(keySignatureFifths(parseNote('C'), scaleByName('locrian', 0))).toBe(-5);
  });

  it('gives an altered minor scale the signature of its parallel natural minor', () => {
    // The G# of A harmonic minor is written as an accidental, not in the
    // signature, so both altered forms report the signature of A minor.
    expect(keySignatureFifths(parseNote('A'), scaleByName('harmonicMinor', 9))).toBe(0);
    expect(keySignatureFifths(parseNote('A'), scaleByName('melodicMinor', 9))).toBe(0);
    expect(keySignatureFifths(parseNote('C'), scaleByName('harmonicMinor', 0))).toBe(-3);
    expect(keySignatureFifths(parseNote('C'), scaleByName('melodicMinor', 0))).toBe(-3);
  });

  it('gives a scale that is not heptatonic the signature of its parallel major or minor', () => {
    expect(keySignatureFifths(parseNote('C'), scaleByName('minorPentatonic', 0))).toBe(-3);
    expect(keySignatureFifths(parseNote('C'), scaleByName('blues', 0))).toBe(-3);
    expect(keySignatureFifths(parseNote('C'), scaleByName('majorPentatonic', 0))).toBe(0);
    expect(keySignatureFifths(parseNote('C'), scaleByName('wholeTone', 0))).toBe(0);
    expect(keySignatureFifths(parseNote('D'), scaleByName('chromatic', 2))).toBe(2);
  });

  it('reports a theoretical key beyond seven accidentals rather than clamping', () => {
    expect(keySignatureFifths(parseNote('Fb'), majorKey(4))).toBe(-8);
    expect(keySignatureFifths(parseNote('G#'), majorKey(8))).toBe(8);
  });

  it('ignores the tonic octave', () => {
    expect(keySignatureFifths(parseNote('Bb3'), majorKey(10))).toBe(-2);
  });
});

describe('keyFromFifths', () => {
  it('names the major key of a signature', () => {
    expect(formatNote(keyFromFifths(0).tonic)).toBe('C');
    expect(formatNote(keyFromFifths(1).tonic)).toBe('G');
    expect(formatNote(keyFromFifths(-1).tonic)).toBe('F');
    expect(formatNote(keyFromFifths(-2).tonic)).toBe('Bb');
    expect(formatNote(keyFromFifths(7).tonic)).toBe('C#');
    expect(formatNote(keyFromFifths(-7).tonic)).toBe('Cb');
  });

  it('names the minor key of a signature', () => {
    expect(formatNote(keyFromFifths(0, 'minor').tonic)).toBe('A');
    expect(formatNote(keyFromFifths(-3, 'minor').tonic)).toBe('C');
    expect(formatNote(keyFromFifths(1, 'minor').tonic)).toBe('E');
    expect(formatNote(keyFromFifths(7, 'minor').tonic)).toBe('A#');
    expect(formatNote(keyFromFifths(-7, 'minor').tonic)).toBe('Ab');
  });

  it('builds a scale whose root is the spelled tonic', () => {
    expect(keyFromFifths(-2).scale).toEqual(majorKey(10));
    expect(keyFromFifths(-2, 'minor').scale).toEqual(minorKey(7));
  });

  it('round-trips every conventional signature, in both modes', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const { tonic, scale } = keyFromFifths(fifths, mode);
        expect(keySignatureFifths(tonic, scale), `${fifths}/${mode}`).toBe(fifths);
      }
    }
  });

  it('round-trips the theoretical signatures too', () => {
    for (let fifths = -12; fifths <= 12; fifths += 1) {
      const { tonic, scale } = keyFromFifths(fifths);
      expect(keySignatureFifths(tonic, scale), `${fifths}`).toBe(fifths);
    }
  });

  it('rejects a signature that is not an integer in range, and an unknown mode', () => {
    expect(() => keyFromFifths(1.5)).toThrow(RangeError);
    expect(() => keyFromFifths(13)).toThrow(RangeError);
    expect(() => keyFromFifths(-13)).toThrow(RangeError);
    expect(() => keyFromFifths(Number.NaN)).toThrow(RangeError);
    expect(() => keyFromFifths(0, 'lydian' as 'major')).toThrow(RangeError);
  });
});
