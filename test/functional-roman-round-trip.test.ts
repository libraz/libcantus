import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AugmentedSixthKind } from '../src/analyze/functional/index.js';
import {
  augmentedSixthChord,
  chordToRoman,
  romanToChord,
  tonicizableDegrees,
} from '../src/analyze/functional/index.js';
import type { ChordQuality } from '../src/theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey, scaleByName, toKeyScale } from '../src/theory/scale/index.js';
import { unionMembers } from './support/signatures.js';
import { SRC } from './support/source-files.js';

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

/**
 * The augmented sixths as the declaration lists them, so a fourth kind is
 * round-tripped here the day it is named rather than the day somebody
 * remembers to add it to a list.
 */
function augmentedSixthKinds(): AugmentedSixthKind[] {
  return unionMembers(
    path.join(SRC, 'analyze/functional/augmented-sixth.ts'),
    'AugmentedSixthKind',
  ) as AugmentedSixthKind[];
}

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

  /**
   * The keys written on the far side of the circle from what their pitches read
   * as, where a numeral rendered against the pitch classes alone would be
   * measuring letters the key never writes.
   */
  const FAR_SIDE_KEYS = ['Ab minor', 'D# minor', 'Cb major', 'F# major'] as const;

  it.each(FAR_SIDE_KEYS)('round-trips every augmented sixth in %s', (name) => {
    const kinds = augmentedSixthKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const chord = augmentedSixthChord(kind, name);
      const roman = chordToRoman(chord, name);
      expect(romanToChord(roman, name), `${kind} in ${name} renders ${roman}`).toEqual(chord);
    }
  });

  it.each(FAR_SIDE_KEYS)('round-trips an applied numeral in %s', (name) => {
    // The applied reading builds its local key from the degree it tonicizes,
    // and that key is written on a letter the caller's key uses; the numeral
    // has to come back the same whichever side of the circle the key is on.
    for (const roman of ['V7/V', 'viio/V', 'V65/V']) {
      const chord = romanToChord(roman, name);
      expect(chordToRoman(chord, name, { applied: true }), `${roman} in ${name}`).toBe(roman);
    }
  });

  it.each(FAR_SIDE_KEYS)('round-trips an applied augmented sixth in %s', (name) => {
    const key = toKeyScale(name);
    // The targets are the degrees the key itself says can be tonicized, so a
    // degree that becomes one is covered without being written down here. The
    // tonic is not among them: the augmented sixth over the home key is that
    // key's own chord, which needs no slash.
    const targets = tonicizableDegrees(key).filter((degree) => degree.degreeNumber !== 1);
    expect(targets.length).toBeGreaterThan(0);
    const kinds = augmentedSixthKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const degree of targets) {
      // The target is written under the numeral its own diatonic triad renders
      // as, which is where the applied numeral takes its case from.
      const target = chordToRoman(makeChord(degree.rootPc, degree.lower ? 'min' : 'maj'), name);
      for (const kind of kinds) {
        // The symbol likewise comes from the rendering of the chord itself.
        const symbol = chordToRoman(augmentedSixthChord(kind, name), name);
        const roman = `${symbol}/${target}`;
        const chord = romanToChord(roman, name);
        expect(chordToRoman(chord, name, { applied: true }), `${roman} in ${name}`).toBe(roman);
        // Reading it is what `applied` asks for: without it the chord is named
        // against the home key, as every other tonicizing chord is.
        expect(chordToRoman(chord, name), `${roman} in ${name}`).not.toContain('/');
      }
    }
  });

  it('reads an applied augmented sixth only from a chord that spells one', () => {
    const cMajor = majorKey(0);
    // The French sixth is the one kind a stack of thirds spells correctly on its
    // own, so a bare 7b5 chord with its lowered fifth in the bass sounds exactly
    // like the French sixth of some degree without saying so in its letters. A
    // chord bringing no letters keeps the simpler reading.
    const bare = makeChord(9, '7b5');
    bare.bassPc = 3;
    expect(chordToRoman(bare, cMajor, { applied: true })).toBe('V7b5/ii');
    // The same pitch classes over the same bass, carrying the letters that spell
    // the augmented sixth, do read as one.
    const spelled = romanToChord('Fr6/V', cMajor);
    expect(spelled.rootPc).toBe(bare.rootPc);
    expect(spelled.bassPc).toBe(bare.bassPc);
    expect(chordToRoman(spelled, cMajor, { applied: true })).toBe('Fr6/V');
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
