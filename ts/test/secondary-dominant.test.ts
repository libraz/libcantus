import { describe, expect, it } from 'vitest';
import { Chord } from '../src/model/chord.js';
import { Key } from '../src/model/key.js';

describe('Chord.secondaryDominant', () => {
  it('builds the dominant a perfect fifth above the chord root', () => {
    const dominant = Chord.of(2, 'min7').secondaryDominant();
    expect(dominant.rootPc).toBe(9);
    expect(dominant.quality).toBe('dom7');
  });

  it('keeps the carried key context, so a following analysis needs no key', () => {
    const dominant = Chord.parse('Dm7').withKey(Key.major('C')).secondaryDominant();
    expect(dominant.key?.tonic.pitchClass).toBe(0);
    expect(dominant.roman(undefined, { applied: true })).toBe('V7/ii');
    expect(dominant.analyze().function).toBe('dominant');
  });

  it('carries no key when the chord carries none', () => {
    const dominant = Chord.parse('Dm7').secondaryDominant();
    expect(dominant.key).toBeUndefined();
    expect(() => dominant.roman()).toThrow();
  });

  it('spells the dominant of a flat-named chord with flats', () => {
    expect(Chord.parse('Eb').secondaryDominant().symbol()).toBe('Bb7');
  });

  it('tonicizes a borrowed chord that has no diatonic degree', () => {
    const bFlatSix = Chord.parse('Ab').withKey(Key.major('C'));
    expect(bFlatSix.secondaryDominant().symbol()).toBe('Eb7');
  });
});
