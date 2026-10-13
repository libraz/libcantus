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
 * letter below them, and the chromatic set has more tones than any number of
 * doublings could hold.
 */
const LETTER_BOUND = ['blues', 'chromatic'];

/**
 * The eight-note scales, which fit the seven letters with exactly one of them
 * written twice.
 */
const DOUBLED_LETTER = ['octatonicHalfWhole', 'octatonicWholeHalf'];

/** How many letter names a spelling has to share out. */
const DIATONIC_LETTERS = 7;

/** Every gapped scale the register carries. */
const GAPPED_SCALES = [...ONE_LETTER_PER_TONE, ...LETTER_BOUND, ...DOUBLED_LETTER];

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

  it.each(LETTER_BOUND)('spells %s plainly when no letter is free', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const spelled = spell(name, ROOT_NAMES[rootPc] ?? 'C');
      // The letters cannot all differ, so one of them carries two tones — which
      // is what keeps these scales readable at a single accidental apiece.
      expect(new Set(spelled.map((note) => note.letter)).size, `${name} on ${rootPc}`).toBeLessThan(
        spelled.length,
      );
      for (const note of spelled) {
        expect(Math.abs(note.alter), `${name} on ${rootPc}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(DOUBLED_LETTER)('gives %s all seven letters, one of them twice', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const spelled = spell(name, ROOT_NAMES[rootPc] ?? 'C');
      // Eight tones onto seven letters: every letter is used, and exactly one
      // of them twice, so no tone is pushed onto a letter another already holds
      // while a third goes unwritten.
      expect(new Set(spelled.map((note) => note.letter)).size, `${name} on ${rootPc}`).toBe(
        DIATONIC_LETTERS,
      );
      expect(spelled.length - DIATONIC_LETTERS, `${name} on ${rootPc}`).toBe(1);
    }
  });

  it.each(DOUBLED_LETTER)('spells %s plainly at a natural root', (name) => {
    for (const rootPc of NATURAL_ROOTS) {
      for (const note of spell(name, ROOT_NAMES[rootPc] ?? 'C')) {
        expect(Math.abs(note.alter), `${name} on ${rootPc}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('writes the seventh of a dominant-sounding octatonic scale as a seventh', () => {
    // The doubling falls where the scale is chromatic — on the pair a ninth
    // above the tonic — and never on the seventh, which would leave the tone
    // ten semitones up reading as an augmented sixth over a dominant chord.
    for (const rootPc of ALL_ROOTS) {
      const root = ROOT_NAMES[rootPc] ?? 'C';
      const spelled = spell('octatonicHalfWhole', root);
      const tonic = parseNote(root);
      const seventh = spelled.find((note) => noteToPitchClass(note) === (rootPc + 10) % 12);
      expect(seventh, `root ${root}`).toBeDefined();
      const letters = ((((seventh?.letter ?? 0) - tonic.letter) % 7) + 7) % 7;
      expect(letters, `root ${root}`).toBe(6);
    }
  });

  it('keeps the conventional blues and octatonic spellings', () => {
    expect(names('blues', 'C')).toEqual(['C', 'Eb', 'F', 'Gb', 'G', 'Bb']);
    expect(names('octatonicHalfWhole', 'Bb')).toEqual(['Bb', 'Cb', 'Db', 'D', 'E', 'F', 'G', 'Ab']);
    expect(names('octatonicHalfWhole', 'C')).toEqual(['C', 'Db', 'Eb', 'E', 'F#', 'G', 'A', 'Bb']);
    expect(names('octatonicWholeHalf', 'C')).toEqual(['C', 'D', 'Eb', 'F', 'Gb', 'Ab', 'A', 'B']);
  });
});

describe('a gapped scale inside a diatonic mode keeps the mode letters', () => {
  it.each([
    ['Ab', ['Ab', 'Cb', 'Db', 'Eb', 'Gb']],
    ['Db', ['Db', 'Fb', 'Gb', 'Ab', 'Cb']],
    ['Gb', ['Gb', 'Bbb', 'Cb', 'Db', 'Fb']],
    ['C', ['C', 'Eb', 'F', 'G', 'Bb']],
    ['E', ['E', 'G', 'A', 'B', 'D']],
  ] as const)('spells the minor pentatonic on %s by its degrees', (root, expected) => {
    // A scale with no major third reads the tone three semitones above the
    // tonic as its third, whatever that letter costs: the minor third of Ab is
    // the Cb of Ab minor, never the B that would read as an augmented second.
    expect(names('minorPentatonic', root)).toEqual([...expected]);
  });

  it('spells the flat-side seventh of a minor pentatonic as a seventh', () => {
    expect(names('minorPentatonic', 'Gb')).toContain('Fb');
    expect(names('minorPentatonic', 'Cb')).toContain('Bbb');
  });

  it('keeps the letters of the parent mode for every gapped scale inside one', () => {
    for (const name of ONE_LETTER_PER_TONE) {
      for (const rootPc of ALL_ROOTS) {
        const root = ROOT_NAMES[rootPc] ?? 'C';
        const tonic = parseNote(root);
        for (const note of spell(name, root)) {
          const letters = (((note.letter - tonic.letter) % 7) + 7) % 7;
          const offset = (((noteToPitchClass(note) - rootPc) % 12) + 12) % 12;
          // Every tone reads as a plain degree above the tonic: a major, minor
          // or perfect interval, never an augmented or diminished one — the
          // whole-tone scale excepted, which no mode holds.
          const plain = [0, 2, 4, 5, 7, 9, 11][letters] ?? 0;
          const deviation = ((((offset - plain) % 12) + 18) % 12) - 6;
          const label = `${name} on ${root}: ${letters} letters, ${offset} semitones`;
          if (name !== 'wholeTone') {
            expect([0, -1], label).toContain(deviation);
          }
        }
      }
    }
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
