import { describe, expect, it } from 'vitest';
import { chordToRoman, romanToChord } from '../src/analyze/functional/index.js';
import type { ChordQuality } from '../src/theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName } from '../src/theory/scale/index.js';

/** The qualities a numeral spells losslessly in root position and inverted. */
const QUALITIES: ChordQuality[] = ['maj', 'min', 'dim', 'aug', 'dom7', 'dim7', 'm7b5'];

/** One key of every shape a numeral is measured against, on assorted tonics. */
const KEYS = [
  { name: 'C major', key: majorKey(0) },
  { name: 'A minor', key: minorKey(9) },
  { name: 'D dorian', key: scaleByName('dorian', 2) },
  { name: 'E phrygian', key: scaleByName('phrygian', 4) },
  { name: 'F lydian', key: scaleByName('lydian', 5) },
  { name: 'G mixolydian', key: scaleByName('mixolydian', 7) },
  { name: 'B locrian', key: scaleByName('locrian', 11) },
  { name: 'C harmonic minor', key: scaleByName('harmonicMinor', 0) },
  { name: 'C melodic minor', key: scaleByName('melodicMinor', 0) },
  { name: 'C major pentatonic', key: scaleByName('majorPentatonic', 0) },
];

describe('chordToRoman and romanToChord are mutual inverses', () => {
  it.each(KEYS)('round-trips every root, quality and inversion in $name', ({ key }) => {
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      for (const quality of QUALITIES) {
        const plain = makeChord(rootPc, quality);
        for (let inversion = 0; inversion < plain.intervals.length; inversion += 1) {
          const chord = makeChord(rootPc, quality);
          if (inversion > 0) {
            chord.bassPc = (rootPc + (chord.intervals[inversion] ?? 0)) % 12;
          }
          const roman = chordToRoman(chord, key);
          const parsed = romanToChord(roman, key);
          const where = `${roman} for ${rootPc} ${quality} inversion ${inversion}`;
          expect(parsed.rootPc, where).toBe(rootPc);
          expect(parsed.quality, where).toBe(quality);
          expect(chordPitchClasses(parsed), where).toEqual(chordPitchClasses(chord));
          if (inversion > 0) {
            expect(parsed.bassPc, where).toBe(chord.bassPc);
          }
        }
      }
    }
  });

  it.each(KEYS)('never renders two roots onto one numeral in $name', ({ key }) => {
    for (const quality of QUALITIES) {
      const byNumeral = new Map<string, number>();
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const roman = chordToRoman(makeChord(rootPc, quality), key);
        const held = byNumeral.get(roman);
        expect(held, `${roman} names both ${held} and ${rootPc}`).toBeUndefined();
        byNumeral.set(roman, rootPc);
      }
    }
  });
});

/**
 * The diminished-family qualities and the numeral stem each renders with. All
 * three stand on the raised leading tone under a bare seventh-degree numeral.
 */
const DIMINISHED_FAMILY = [
  ['dim', 'o'],
  ['dim7', 'o7'],
  ['m7b5', 'ø7'],
] as const;

describe('the seventh degree of a key that lowers it', () => {
  it('separates the subtonic from the raised leading tone in every minor key', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const key = minorKey(tonic);
      const subtonic = (tonic + 10) % 12;
      const leadingTone = (tonic + 11) % 12;
      for (const [quality, stem] of DIMINISHED_FAMILY) {
        expect(chordToRoman(makeChord(subtonic, quality), key), `subtonic in ${tonic}`).toBe(
          `bvii${stem}`,
        );
        expect(chordToRoman(makeChord(leadingTone, quality), key), `leading tone in ${tonic}`).toBe(
          `vii${stem}`,
        );
      }
    }
  });

  it('keeps the figured inversions of the subtonic diminished chord apart', () => {
    const aMinor = minorKey(9);
    // G dim7 over Bb, the subtonic chord in first inversion.
    const chord = makeChord(7, 'dim7');
    chord.bassPc = 10;
    expect(chordToRoman(chord, aMinor)).toBe('bviio65');
    expect(romanToChord('bviio65', aMinor)).toMatchObject({ rootPc: 7, quality: 'dim7' });
  });

  it('reads the half-diminished seventh on the same root as its family', () => {
    const aMinor = minorKey(9);
    // The bare numeral names one root per key, whatever seventh quality stands
    // on it: G#ø7 and G#o7 are both the leading-tone chord, differing only in
    // the colour of the sixth degree above.
    expect(chordToRoman(makeChord(8, 'm7b5'), aMinor)).toBe('viiø7');
    expect(chordToRoman(makeChord(7, 'm7b5'), aMinor)).toBe('bviiø7');
    expect(romanToChord('viiø7', aMinor).rootPc).toBe(8);
    expect(romanToChord('bviiø7', aMinor).rootPc).toBe(7);
  });

  it('leaves qualities outside the diminished family literal', () => {
    const aMinor = minorKey(9);
    // Only the diminished family carries the raised-leading-tone convention, so
    // the subtonic keeps its bare numeral for every other quality.
    expect(chordToRoman(makeChord(7, 'maj'), aMinor)).toBe('VII');
    expect(chordToRoman(makeChord(7, 'min7'), aMinor)).toBe('vii7');
    expect(romanToChord('vii7', aMinor).rootPc).toBe(7);
  });
});
