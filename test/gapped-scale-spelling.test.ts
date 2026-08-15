import { describe, expect, it } from 'vitest';
import { noteToPitchClass, parseNote } from '../src/core/pitch/index.js';
import { Key } from '../src/model/index.js';
import { majorKey, scaleByName, scaleTonesInDegreeOrder } from '../src/theory/scale/index.js';
import { noteNames, spellScale } from '../src/theory/spelling/index.js';

/** Every pitch class, so a spelling rule cannot pass by luck of the root. */
const ALL_ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** A root spelled on the sharp side for black keys, enough to spell from. */
const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** The natural roots, where a double accidental has no excuse. */
const NATURAL_ROOTS = [0, 2, 4, 5, 7, 9, 11];

/**
 * Gapped scales whose pitch content admits a letter per tone: every step is a
 * whole tone or wider, or the semitones sit where two letters can hold them.
 */
const ONE_LETTER_PER_TONE = [
  'majorPentatonic',
  'minorPentatonic',
  'wholeTone',
  'miyakoBushi',
  'ritsu',
  'minyo',
  'ryukyu',
];

/**
 * Gapped scales that no reading can give a letter apiece: the blues scale
 * sounds the fifth and the flattened fifth against a fourth that fixes the
 * letter below them, and the octatonic and chromatic sets have more tones than
 * there are letters.
 */
const LETTER_BOUND = ['blues', 'octatonicHalfWhole', 'octatonicWholeHalf', 'chromatic'];

/** Every gapped scale the register carries. */
const GAPPED_SCALES = [...ONE_LETTER_PER_TONE, ...LETTER_BOUND];

/** Spell a named scale from the given root, one entry per scale tone. */
function spell(name: string, root: string) {
  return spellScale(parseNote(root), scaleByName(name, noteToPitchClass(parseNote(root))));
}

/** Letter names of a named scale spelled from the given root. */
function names(name: string, root: string): string[] {
  return noteNames(spell(name, root));
}

describe('miyako-bushi spelling', () => {
  it.each([
    ['C', ['C', 'Db', 'F', 'G', 'Ab']],
    ['D', ['D', 'Eb', 'G', 'A', 'Bb']],
    ['E', ['E', 'F', 'A', 'B', 'C']],
    ['B', ['B', 'C', 'E', 'F#', 'G']],
  ] as const)('spells the semitone above the tonic as a second, from %s', (root, expected) => {
    expect(names('miyakoBushi', root)).toEqual([...expected]);
  });

  it('gives every tone its own letter at every root', () => {
    for (const rootPc of ALL_ROOTS) {
      const spelled = spell('miyakoBushi', ROOT_NAMES[rootPc] ?? 'C');
      expect(new Set(spelled.map((note) => note.letter)).size, `root ${rootPc}`).toBe(
        spelled.length,
      );
    }
  });

  it('sounds exactly the scale at every root', () => {
    for (const rootPc of ALL_ROOTS) {
      const key = scaleByName('miyakoBushi', rootPc);
      expect(spell('miyakoBushi', ROOT_NAMES[rootPc] ?? 'C').map(noteToPitchClass)).toEqual(
        scaleTonesInDegreeOrder(key),
      );
    }
  });

  it('reaches for no double accidental at a natural root', () => {
    for (const rootPc of NATURAL_ROOTS) {
      for (const note of spell('miyakoBushi', ROOT_NAMES[rootPc] ?? 'C')) {
        expect(Math.abs(note.alter), `root ${rootPc}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spells a flat tonic whose second needs a double flat rather than reuse the letter', () => {
    // Ab miyako-bushi has no natural letter left for its second: A is the
    // tonic's own. The scale keeps a letter per tone, as a heptatonic key does.
    expect(names('miyakoBushi', 'Ab')).toEqual(['Ab', 'Bbb', 'Db', 'Eb', 'Fb']);
    // Given only the pitch class, the key picks the tonic that spells lightest.
    expect(Key.named('miyakoBushi', 8).noteNames()).toEqual(['G#', 'A', 'C#', 'D#', 'E']);
  });
});

describe('the gapped scale family', () => {
  it.each(GAPPED_SCALES)('sounds exactly the pitch classes of %s at every root', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const key = scaleByName(name, rootPc);
      expect(
        spell(name, ROOT_NAMES[rootPc] ?? 'C').map(noteToPitchClass),
        `root ${rootPc}`,
      ).toEqual(scaleTonesInDegreeOrder(key));
    }
  });

  it.each(ONE_LETTER_PER_TONE)('gives %s one letter per tone at every root', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const spelled = spell(name, ROOT_NAMES[rootPc] ?? 'C');
      expect(new Set(spelled.map((note) => note.letter)).size, `root ${rootPc}`).toBe(
        spelled.length,
      );
    }
  });

  it.each(ONE_LETTER_PER_TONE)('spells %s plainly at a natural root', (name) => {
    for (const rootPc of NATURAL_ROOTS) {
      for (const note of spell(name, ROOT_NAMES[rootPc] ?? 'C')) {
        expect(Math.abs(note.alter), `${name} on ${rootPc}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(LETTER_BOUND)('spells %s tone by tone, plainly, when no letter is free', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const spelled = spell(name, ROOT_NAMES[rootPc] ?? 'C');
      // The letters cannot all differ, so the reading falls back to the lighter
      // accidental tone by tone — which is what keeps these scales readable.
      expect(new Set(spelled.map((note) => note.letter)).size, `${name} on ${rootPc}`).toBeLessThan(
        spelled.length,
      );
      for (const note of spelled) {
        expect(Math.abs(note.alter), `${name} on ${rootPc}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the conventional blues and octatonic spellings', () => {
    expect(names('blues', 'C')).toEqual(['C', 'Eb', 'F', 'Gb', 'G', 'Bb']);
    expect(names('octatonicHalfWhole', 'Bb')).toEqual(['Bb', 'B', 'Db', 'D', 'E', 'F', 'G', 'Ab']);
  });
});

describe('heptatonic spelling is untouched', () => {
  it('keeps the double-sharp leading tone of G# harmonic minor', () => {
    expect(Key.named('harmonicMinor', 'G#').noteNames()).toEqual([
      'G#',
      'A#',
      'B',
      'C#',
      'D#',
      'E',
      'F##',
    ]);
  });

  it('keeps the flat-side letters of Ab minor', () => {
    expect(Key.minor('Ab').noteNames()).toEqual(['Ab', 'Bb', 'Cb', 'Db', 'Eb', 'Fb', 'Gb']);
  });

  it('keeps a theoretical key spelled on its own letters', () => {
    expect(noteNames(spellScale(parseNote('Ebb'), majorKey(2)))).toEqual([
      'Ebb',
      'Fb',
      'Gb',
      'Abb',
      'Bbb',
      'Cb',
      'Db',
    ]);
  });
});
