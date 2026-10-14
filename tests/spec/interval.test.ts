import {
  ConsonanceClass,
  classifyInterval,
  intervalSemitones,
  isConsonantInterval,
  isPerfectInterval,
} from '@libraz/libcantus/core';
import { describe, expect, it } from 'vitest';

describe('classifyInterval', () => {
  it('classifies perfect consonances', () => {
    expect(classifyInterval(0)).toBe(ConsonanceClass.PerfectConsonance);
    expect(classifyInterval(7)).toBe(ConsonanceClass.PerfectConsonance);
  });

  it('classifies imperfect consonances', () => {
    for (const s of [3, 4, 8, 9]) {
      expect(classifyInterval(s)).toBe(ConsonanceClass.ImperfectConsonance);
    }
  });

  it('classifies dissonances including the perfect fourth', () => {
    for (const s of [1, 2, 6, 10, 11]) {
      expect(classifyInterval(s)).toBe(ConsonanceClass.Dissonance);
    }
    expect(classifyInterval(5)).toBe(ConsonanceClass.Dissonance);
  });

  it('is octave-equivalent', () => {
    expect(classifyInterval(12)).toBe(classifyInterval(0));
    expect(classifyInterval(19)).toBe(classifyInterval(7));
    expect(classifyInterval(-7)).toBe(classifyInterval(7));
  });
});

describe('isPerfectInterval', () => {
  it('is true for unison/octave and fifth', () => {
    expect(isPerfectInterval(0)).toBe(true);
    expect(isPerfectInterval(7)).toBe(true);
    expect(isPerfectInterval(12)).toBe(true);
    expect(isPerfectInterval(19)).toBe(true);
  });

  it('is false for the perfect fourth', () => {
    expect(isPerfectInterval(5)).toBe(false);
  });
});

describe('isConsonantInterval', () => {
  it('treats the perfect fourth as context-dependent', () => {
    expect(isConsonantInterval(5, true)).toBe(false);
    expect(isConsonantInterval(5, false)).toBe(true);
  });

  it('treats the consonant set as consonant regardless of voice count', () => {
    for (const s of [0, 3, 4, 7, 8, 9]) {
      expect(isConsonantInterval(s, true)).toBe(true);
      expect(isConsonantInterval(s, false)).toBe(true);
    }
  });

  it('treats dissonances as dissonant', () => {
    for (const s of [1, 2, 6, 10, 11]) {
      expect(isConsonantInterval(s, true)).toBe(false);
      expect(isConsonantInterval(s, false)).toBe(false);
    }
  });

  it('defaults to two-voice context, matching classifyInterval', () => {
    expect(isConsonantInterval(5)).toBe(false);
    expect(isConsonantInterval(5)).toBe(isConsonantInterval(5, true));
    expect(isConsonantInterval(7)).toBe(true);
  });
});

describe('intervalSemitones with a quality that is no string', () => {
  // The repeated-letter qualities are matched against the value's text, and counted by its length.
  it('reads a one-element list by its text and its length', () => {
    expect(intervalSemitones(4, ['A'] as never)).toBe(6);
    expect(intervalSemitones(4, ['AA'] as never)).toBe(6);
    expect(() => intervalSemitones(1, ['dd'] as never)).toThrow(
      "a unison cannot be diminished; a unison narrowed by a semitone descends, so name it '-A1'",
    );
  });

  it('refuses the named qualities and a Symbol', () => {
    expect(() => intervalSemitones(5, ['P'] as never)).toThrow('unknown interval quality');
    expect(() => intervalSemitones(5, Symbol('A') as never)).toThrow(
      'Cannot convert a Symbol value to a string',
    );
  });
});
