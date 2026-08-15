import { describe, expect, it } from 'vitest';
import {
  DORIAN_MASK,
  formatNote,
  HARMONIC_MINOR_MASK,
  keyRelationBetween,
  keySignatureFifths,
  MAJOR_MASK,
  MELODIC_MINOR_MASK,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  relativeKeyOf,
  scaleByName,
  spelledKeyOf,
  WHOLE_TONE_MASK,
} from '../src/index.js';
import * as theory from '../src/theory/index.js';
import * as scale from '../src/theory/scale/index.js';

/** The spelled tonic of a key, as it is written. */
function tonicOf(key: { rootPc: number; modeMask12: number }): string {
  return formatNote(spelledKeyOf(key).tonic);
}

describe('spelledKeyOf', () => {
  it('spells every major key the way its signature is written', () => {
    // Each tonic is the one whose signature is closest to C major: pitch class
    // 1 is Db (five flats), not C# (seven sharps), and pitch class 11 is B
    // (five sharps), not Cb (seven flats).
    expect(Array.from({ length: 12 }, (_, pc) => tonicOf(majorKey(pc)))).toEqual([
      'C',
      'Db',
      'D',
      'Eb',
      'E',
      'F',
      // Pitch class 6 is a genuine tie — F# is +6 and Gb is -6, six accidentals
      // either way — and the scan runs from the flat end, so Gb wins.
      'Gb',
      'G',
      'Ab',
      'A',
      'Bb',
      'B',
    ]);
  });

  it('spells every minor key the way its signature is written', () => {
    // Pitch class 8 is G# (five sharps) rather than Ab (seven flats), and pitch
    // class 10 is Bb (five flats) rather than A# (seven sharps).
    expect(Array.from({ length: 12 }, (_, pc) => tonicOf(minorKey(pc)))).toEqual([
      'C',
      'C#',
      'D',
      // Pitch class 3 is the minor-mode tie: D# is +6 and Eb is -6, so the same
      // flat-end scan gives Eb, which is also the spelling in common use.
      'Eb',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'Bb',
      'B',
    ]);
  });

  it('agrees with the signature the key is written with', () => {
    for (const key of [majorKey(1), majorKey(11), minorKey(8), minorKey(3)]) {
      const spelled = spelledKeyOf(key);
      expect(
        Math.abs(keySignatureFifths(spelled.tonic, key)),
        formatNote(spelled.tonic),
      ).toBeLessThanOrEqual(7);
    }
    expect(keySignatureFifths(spelledKeyOf(majorKey(1)).tonic, majorKey(1))).toBe(-5);
    expect(keySignatureFifths(spelledKeyOf(minorKey(8)).tonic, minorKey(8))).toBe(5);
  });

  it('spells gis moll on G# and keeps the scale it was given', () => {
    // G# harmonic minor is written with G# minor's five sharps and its seventh
    // as an accidental; the mask must come back untouched, not flattened to
    // natural minor and not respelled as Ab.
    for (const mask of [HARMONIC_MINOR_MASK, MELODIC_MINOR_MASK]) {
      const key = { rootPc: 8, modeMask12: mask };
      const spelled = spelledKeyOf(key);
      expect(formatNote(spelled.tonic), `mask ${mask}`).toBe('G#');
      expect(spelled.key).toBe(key);
      expect(spelled.key.modeMask12).toBe(mask);
      expect(keySignatureFifths(spelled.tonic, key)).toBe(5);
    }
    expect(tonicOf(scaleByName('harmonicMinor', 8))).toBe('G#');
  });

  it('answers for a church mode and for a scale with no third', () => {
    // D dorian has a minor third, so it is spelled from the minor circle: D.
    expect(tonicOf({ rootPc: 2, modeMask12: DORIAN_MASK })).toBe('D');
    // The whole-tone scale has a major third and so counts as major; on pitch
    // class 6 that is the major tie again.
    expect(tonicOf({ rootPc: 0, modeMask12: WHOLE_TONE_MASK })).toBe('C');
    expect(tonicOf({ rootPc: 6, modeMask12: WHOLE_TONE_MASK })).toBe('Gb');
    // A mask with neither third — root and fifth alone — falls back to major.
    expect(tonicOf({ rootPc: 7, modeMask12: 0b000010000001 })).toBe('G');
  });

  it('normalises a root outside [0, 11] instead of refusing it', () => {
    expect(tonicOf({ rootPc: -1, modeMask12: MAJOR_MASK })).toBe('B');
    expect(tonicOf({ rootPc: 13, modeMask12: MAJOR_MASK })).toBe('Db');
    expect(tonicOf({ rootPc: -25, modeMask12: NATURAL_MINOR_MASK })).toBe('B');
    // The key still comes back as it was passed, unnormalised root and all.
    expect(spelledKeyOf({ rootPc: -1, modeMask12: MAJOR_MASK }).key.rootPc).toBe(-1);
  });

  it('feeds the key relations', () => {
    for (let pc = 0; pc < 12; pc += 1) {
      for (const key of [majorKey(pc), minorKey(pc)]) {
        const spelled = spelledKeyOf(key);
        const relative = relativeKeyOf(spelled.tonic, spelled.key);
        expect(keyRelationBetween(spelled, relative), formatNote(spelled.tonic)).toBe('relative');
      }
    }
  });

  it('is reachable from the theory and scale barrels', () => {
    expect(formatNote(theory.spelledKeyOf(theory.majorKey(1)).tonic)).toBe('Db');
    expect(formatNote(scale.spelledKeyOf(scale.minorKey(8)).tonic)).toBe('G#');
  });
});
