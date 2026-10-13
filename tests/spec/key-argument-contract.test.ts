import * as api from '@libraz/libcantus';
import { Chord, InvalidInputError, Key, majorKey, Note, Progression } from '@libraz/libcantus';
import { describe, expect, it } from 'vitest';

const CADENCE = [Chord.parse('G7'), Chord.parse('C')];

describe('a key argument that names no key', () => {
  it('names the caller’s own parameter when an options bag arrives instead', () => {
    expect(() => Chord.parse('D7').explain({ alternatives: true } as never)).toThrow(
      /chord key must be a Key; received an object/,
    );
    expect(() => Chord.parse('D7').roman({ applied: true } as never)).toThrow(
      /chord key must be a Key; received an object/,
    );
    expect(() => new Progression(CADENCE).analyze({ alternatives: true } as never)).toThrow(
      /progression key must be a Key; received an object/,
    );
  });

  it('refuses a key-shaped value that resolves to no key', () => {
    expect(() => Chord.parse('D7').spell('invalid' as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').spell(null as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').spell({ scale: null } as never)).toThrow(InvalidInputError);
    expect(() => Chord.parse('D7').roman('H sharp major')).toThrow(InvalidInputError);
  });

  it('falls back to the carried key when none is passed', () => {
    expect(Chord.parse('G7').withKey('C major').roman()).toBe('V7');
    expect(() => Chord.parse('G7').roman()).toThrow(InvalidInputError);
  });
});

describe('a key reaches the scale functions in any form', () => {
  it('answers the scale-degree questions alike', () => {
    expect(api.isScaleTone(62, Key.major('C'))).toBe(true);
    expect(api.isScaleTone(62, 'C major')).toBe(true);
    expect(api.isScaleTone(61, Key.major('C'))).toBe(false);
    expect(api.diatonicPitchClasses(Key.major('C'))).toEqual(api.diatonicPitchClasses(majorKey(0)));
    expect(api.scaleTonesInDegreeOrder('C major')).toEqual(
      api.scaleTonesInDegreeOrder(majorKey(0)),
    );
    expect(api.diatonicPitchClasses('C major')).not.toEqual([]);
  });

  it('spells a scale from a name, a key/scale and a Key alike', () => {
    const fromData = api.noteNames(api.spellScale('C', majorKey(0)));
    expect(api.noteNames(api.spellScale('C', 'C major'))).toEqual(fromData);
    expect(api.noteNames(api.spellScale('C', Key.major('C')))).toEqual(fromData);
    expect(fromData).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('returns one note per scale tone, never an empty scale', () => {
    for (const scale of ['major', 'harmonicMinor', 'minorPentatonic', 'blues', 'wholeTone']) {
      const key = Key.named(scale as never, 'C');
      const degrees = api.spellScale('C', key);
      const tones = key.scale.modeMask12.toString(2).replace(/0/g, '').length;
      expect(degrees.length, scale).toBe(tones);
    }
  });

  it('names the parameter that is wrong', () => {
    expect(() => api.spellScale('C', 'not a key' as never)).toThrow(InvalidInputError);
    expect(() => api.spellScale('D', 'C major')).toThrow(/tonic/);
  });
});

describe('a key never claims a scale form its mask does not hold', () => {
  it('refuses a variant the mask does not support', () => {
    const majorScale = majorKey(0);
    expect(() =>
      Key.fromJSON({ scale: majorScale, tonic: { letter: 0, alter: 0 }, variant: 'harmonic' }),
    ).toThrow(InvalidInputError);
    expect(() =>
      Key.fromData({ scale: majorScale, tonic: { letter: 0, alter: 0 }, variant: 'melodic' }),
    ).toThrow(/variant melodic does not match the scale mask/);
    expect(() => new Key(majorScale, Note.parse('C'), 'natural')).toThrow(InvalidInputError);
    expect(() => new Key(api.scaleByName('harmonicMinor', 0), Note.parse('C'), 'major')).toThrow(
      InvalidInputError,
    );
    expect(() => new Key(majorScale, Note.parse('C'), 'modal')).toThrow(InvalidInputError);
    expect(() => new Key(majorScale, Note.parse('C'), 'unknown' as never)).toThrow(
      InvalidInputError,
    );
  });

  it('keeps the variants their mask does support, through a round trip', () => {
    const pairs = [
      ['major', majorKey(0)],
      ['natural', api.scaleByName('naturalMinor', 0)],
      ['harmonic', api.scaleByName('harmonicMinor', 0)],
      ['melodic', api.scaleByName('melodicMinor', 0)],
      ['modal', api.scaleByName('dorian', 0)],
    ] as const;
    for (const [variant, scale] of pairs) {
      const key = new Key(scale, Note.parse('C'), variant);
      expect(key.variant, variant).toBe(variant);
      expect(Key.fromJSON(key.toJSON()).toString(), variant).toBe(key.toString());
    }
  });
});
