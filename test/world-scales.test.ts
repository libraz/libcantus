import { describe, expect, it } from 'vitest';
import { noteToPitchClass, parseNote } from '../src/core/pitch/index.js';
import type { KeyScale } from '../src/core/types.js';
import {
  DOUBLE_HARMONIC_MASK,
  diatonicPitchClasses,
  MARWA_MASK,
  MINOR_PENTATONIC_MASK,
  MIYAKO_BUSHI_MASK,
  majorKey,
  NAMED_SCALES,
  namedScaleMask,
  PHRYGIAN_DOMINANT_MASK,
  PURVI_MASK,
  RITSU_MASK,
  RYUKYU_MASK,
  resolveScaleName,
  SCALE_ALIASES,
  SCALE_SYSTEMS,
  scaleByName,
  scaleSystemOf,
  scaleTonesInDegreeOrder,
  supportsFunctionalHarmony,
  TODI_MASK,
  WORLD_SCALES,
} from '../src/theory/scale/index.js';
import { noteNames, spellScale } from '../src/theory/spelling/index.js';

/**
 * The mask every entry of `NAMED_SCALES` carried before the world scales were
 * added, in the order the register listed them. Adding a scale must not move or
 * re-tune one of these, and only a table written out by hand can prove it.
 */
const ESTABLISHED_MASKS: readonly (readonly [string, number])[] = [
  ['major', 2741],
  ['ionian', 2741],
  ['naturalMinor', 1453],
  ['aeolian', 1453],
  ['harmonicMinor', 2477],
  ['melodicMinor', 2733],
  ['dorian', 1709],
  ['phrygian', 1451],
  ['lydian', 2773],
  ['mixolydian', 1717],
  ['locrian', 1387],
  ['lydianDominant', 1749],
  ['mixolydianB13', 1461],
  ['locrianNatural2', 1389],
  ['altered', 1371],
  ['phrygianDominant', 1459],
  ['majorPentatonic', 661],
  ['minorPentatonic', 1193],
  ['blues', 1257],
  ['wholeTone', 1365],
  ['octatonicHalfWhole', 1755],
  ['octatonicWholeHalf', 2925],
  ['chromatic', 4095],
];

/** Semitone offsets above the root, as each tradition states the scale. */
const WORLD_SCALE_OFFSETS: readonly (readonly [string, readonly number[]])[] = [
  ['miyakoBushi', [0, 1, 5, 7, 8]],
  ['ritsu', [0, 2, 5, 7, 9]],
  ['minyo', [0, 3, 5, 7, 10]],
  ['ryukyu', [0, 4, 5, 7, 11]],
  ['ajam', [0, 2, 4, 5, 7, 9, 11]],
  ['nahawand', [0, 2, 3, 5, 7, 8, 10]],
  ['kurd', [0, 1, 3, 5, 7, 8, 10]],
  ['hijaz', [0, 1, 4, 5, 7, 8, 10]],
  ['hijazkar', [0, 1, 4, 5, 7, 8, 11]],
  ['bilaval', [0, 2, 4, 5, 7, 9, 11]],
  ['khamaj', [0, 2, 4, 5, 7, 9, 10]],
  ['kafi', [0, 2, 3, 5, 7, 9, 10]],
  ['asavari', [0, 2, 3, 5, 7, 8, 10]],
  ['bhairavi', [0, 1, 3, 5, 7, 8, 10]],
  ['bhairav', [0, 1, 4, 5, 7, 8, 11]],
  ['kalyan', [0, 2, 4, 6, 7, 9, 11]],
  ['marwa', [0, 1, 4, 6, 7, 9, 11]],
  ['purvi', [0, 1, 4, 6, 7, 8, 11]],
  ['todi', [0, 1, 3, 6, 7, 8, 11]],
];

/** Every pitch class, so a spelling rule cannot pass by luck of the root. */
const ALL_ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** A root spelled on the sharp side for black keys, enough to spell from. */
const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** The scale's pitch classes rooted on `rootPc`, sorted ascending. */
function expectedPitchClasses(offsets: readonly number[], rootPc: number): number[] {
  return [...offsets.map((offset) => (rootPc + offset) % 12)].sort((a, b) => a - b);
}

describe('world scale pitch content', () => {
  it.each(WORLD_SCALE_OFFSETS)('%s holds its pitch classes from two roots', (name, offsets) => {
    // D and A: one white-key root and one a fifth away, so a mask rotated the
    // wrong way cannot agree with the expectation by symmetry.
    for (const rootPc of [2, 9]) {
      expect(diatonicPitchClasses(scaleByName(name, rootPc))).toEqual(
        expectedPitchClasses(offsets, rootPc),
      );
    }
  });

  it('registers every world scale under a mask with the root bit set', () => {
    for (const [name, offsets] of WORLD_SCALE_OFFSETS) {
      const mask = namedScaleMask(name);
      expect(mask, name).toBe(offsets.reduce((acc, offset) => acc | (1 << offset), 1));
      expect(mask, name).toBeLessThan(0b1_0000_0000_0000);
    }
  });

  it('shares the Japanese folk scale with the minor pentatonic and Hijaz with the phrygian dominant', () => {
    // Same twelve pitch classes, different traditions: the entries exist so a
    // caller can name the tradition, not because the sets differ.
    expect(WORLD_SCALES.minyo).toBe(MINOR_PENTATONIC_MASK);
    expect(WORLD_SCALES.hijaz).toBe(PHRYGIAN_DOMINANT_MASK);
    expect(WORLD_SCALES.hijazkar).toBe(DOUBLE_HARMONIC_MASK);
    expect(WORLD_SCALES.bhairav).toBe(DOUBLE_HARMONIC_MASK);
  });

  it('gives the Japanese and Hindustani sets that are not Western modes their own masks', () => {
    expect(WORLD_SCALES.miyakoBushi).toBe(MIYAKO_BUSHI_MASK);
    expect(WORLD_SCALES.ritsu).toBe(RITSU_MASK);
    expect(WORLD_SCALES.ryukyu).toBe(RYUKYU_MASK);
    expect(WORLD_SCALES.marwa).toBe(MARWA_MASK);
    expect(WORLD_SCALES.purvi).toBe(PURVI_MASK);
    expect(WORLD_SCALES.todi).toBe(TODI_MASK);
    const distinct = new Set(Object.values(NAMED_SCALES));
    for (const mask of [
      MIYAKO_BUSHI_MASK,
      RITSU_MASK,
      RYUKYU_MASK,
      MARWA_MASK,
      PURVI_MASK,
      TODI_MASK,
    ]) {
      expect(distinct.has(mask)).toBe(false);
    }
  });
});

describe('world scale spelling', () => {
  /** Letter names of a scale spelled from a root given by name. */
  function spell(name: string, root: string): string[] {
    const rootPc = noteToPitchClass(parseNote(root));
    return noteNames(spellScale(parseNote(root), scaleByName(name, rootPc)));
  }

  it.each([
    // The pentatonics of Japanese traditional music.
    ['miyakoBushi', 'E', ['E', 'F', 'A', 'B', 'C']],
    ['miyakoBushi', 'B', ['B', 'C', 'E', 'F#', 'G']],
    ['ritsu', 'D', ['D', 'E', 'G', 'A', 'B']],
    ['ritsu', 'Bb', ['Bb', 'C', 'Eb', 'F', 'G']],
    ['minyo', 'A', ['A', 'C', 'D', 'E', 'G']],
    ['minyo', 'Eb', ['Eb', 'Gb', 'Ab', 'Bb', 'Db']],
    ['ryukyu', 'C', ['C', 'E', 'F', 'G', 'B']],
    ['ryukyu', 'D', ['D', 'F#', 'G', 'A', 'C#']],
    // The maqamat that a twelve-tone mask can hold.
    ['hijaz', 'D', ['D', 'Eb', 'F#', 'G', 'A', 'Bb', 'C']],
    ['hijaz', 'G', ['G', 'Ab', 'B', 'C', 'D', 'Eb', 'F']],
    ['hijazkar', 'C', ['C', 'Db', 'E', 'F', 'G', 'Ab', 'B']],
    ['hijazkar', 'A', ['A', 'Bb', 'C#', 'D', 'E', 'F', 'G#']],
    ['nahawand', 'C', ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb']],
    ['kurd', 'E', ['E', 'F', 'G', 'A', 'B', 'C', 'D']],
    ['ajam', 'F', ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']],
    // The thaats of Hindustani classical music.
    ['bhairav', 'C', ['C', 'Db', 'E', 'F', 'G', 'Ab', 'B']],
    ['bhairav', 'D', ['D', 'Eb', 'F#', 'G', 'A', 'Bb', 'C#']],
    ['todi', 'C', ['C', 'Db', 'Eb', 'F#', 'G', 'Ab', 'B']],
    ['todi', 'G', ['G', 'Ab', 'Bb', 'C#', 'D', 'Eb', 'F#']],
    ['marwa', 'C', ['C', 'Db', 'E', 'F#', 'G', 'A', 'B']],
    ['marwa', 'D', ['D', 'Eb', 'F#', 'G#', 'A', 'B', 'C#']],
    ['purvi', 'C', ['C', 'Db', 'E', 'F#', 'G', 'Ab', 'B']],
    ['purvi', 'E', ['E', 'F', 'G#', 'A#', 'B', 'C', 'D#']],
    ['bilaval', 'G', ['G', 'A', 'B', 'C', 'D', 'E', 'F#']],
    ['kafi', 'D', ['D', 'E', 'F', 'G', 'A', 'B', 'C']],
    ['kalyan', 'F', ['F', 'G', 'A', 'B', 'C', 'D', 'E']],
  ] as const)('spells %s from %s', (name, root, expected) => {
    expect(spell(name, root)).toEqual([...expected]);
  });

  it.each(WORLD_SCALE_OFFSETS)('names exactly the pitch classes of %s at every root', (name) => {
    for (const rootPc of ALL_ROOTS) {
      const key = scaleByName(name, rootPc);
      const spelled = spellScale(parseNote(ROOT_NAMES[rootPc] ?? 'C'), key);
      expect(spelled.map(noteToPitchClass), `${name} on ${rootPc}`).toEqual(
        scaleTonesInDegreeOrder(key),
      );
    }
  });

  it.each(WORLD_SCALE_OFFSETS)(
    'spells %s without a double accidental at a natural root',
    (name) => {
      // A gapped scale must not reach for a double flat where a plain letter
      // says the same pitch: the seven natural roots are where that shows.
      for (const rootPc of [0, 2, 4, 5, 7, 9, 11]) {
        const spelled = spellScale(parseNote(ROOT_NAMES[rootPc] ?? 'C'), scaleByName(name, rootPc));
        for (const note of spelled) {
          expect(Math.abs(note.alter), `${name} on ${rootPc}`).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it('gives every heptatonic world scale one letter per degree at every root', () => {
    for (const [name, offsets] of WORLD_SCALE_OFFSETS) {
      if (offsets.length !== 7) {
        continue;
      }
      for (const rootPc of ALL_ROOTS) {
        const spelled = spellScale(parseNote(ROOT_NAMES[rootPc] ?? 'C'), scaleByName(name, rootPc));
        expect(new Set(spelled.map((note) => note.letter)).size, `${name} on ${rootPc}`).toBe(7);
      }
    }
  });

  it('gives the anhemitonic Japanese pentatonics one letter per degree at every root', () => {
    // The spelling layer picks a gapped scale's letters one tone at a time, by
    // lightest accidental, which is enough for a scale whose steps are a whole
    // tone or wider. Miyako-bushi's semitone above the tonic is the case that
    // rule cannot place, so it is spelled here from the roots where it can.
    for (const name of ['ritsu', 'minyo', 'ryukyu']) {
      for (const rootPc of ALL_ROOTS) {
        const spelled = spellScale(parseNote(ROOT_NAMES[rootPc] ?? 'C'), scaleByName(name, rootPc));
        expect(new Set(spelled.map((note) => note.letter)).size, `${name} on ${rootPc}`).toBe(5);
      }
    }
  });
});

describe('scale systems', () => {
  it('classifies every built-in scale', () => {
    for (const name of [...Object.keys(NAMED_SCALES), ...Object.keys(WORLD_SCALES)]) {
      expect(SCALE_SYSTEMS[name as keyof typeof SCALE_SYSTEMS], name).toBeDefined();
    }
  });

  it.each([
    ['major', 'common-practice'],
    ['harmonicMinor', 'common-practice'],
    ['melodicMinor', 'common-practice'],
    ['dorian', 'modal'],
    ['phrygianDominant', 'modal'],
    ['altered', 'modal'],
    ['majorPentatonic', 'non-functional'],
    ['blues', 'non-functional'],
    ['wholeTone', 'non-functional'],
    ['chromatic', 'non-functional'],
    ['miyakoBushi', 'non-functional'],
    ['ryukyu', 'non-functional'],
    ['hijaz', 'non-functional'],
    ['bhairav', 'non-functional'],
    ['todi', 'non-functional'],
  ] as const)('puts %s in the %s system', (name, system) => {
    expect(scaleSystemOf(name)).toBe(system);
  });

  it('answers an alias the same way as the name it stands for', () => {
    expect(scaleSystemOf('okinawan')).toBe(scaleSystemOf('ryukyu'));
    expect(scaleSystemOf('hicaz')).toBe(scaleSystemOf('hijaz'));
  });

  it('applies functional harmony to the Western scales and not to the others', () => {
    expect(supportsFunctionalHarmony('major')).toBe(true);
    expect(supportsFunctionalHarmony('harmonicMinor')).toBe(true);
    expect(supportsFunctionalHarmony('dorian')).toBe(true);
    expect(supportsFunctionalHarmony('miyakoBushi')).toBe(false);
    expect(supportsFunctionalHarmony('hijazkar')).toBe(false);
    expect(supportsFunctionalHarmony('marwa')).toBe(false);
    expect(supportsFunctionalHarmony('blues')).toBe(false);
  });

  it('reads a KeyScale by its mask', () => {
    expect(scaleSystemOf(majorKey(0))).toBe('common-practice');
    expect(scaleSystemOf(scaleByName('dorian', 2))).toBe('modal');
    expect(supportsFunctionalHarmony(majorKey(0))).toBe(true);
    expect(supportsFunctionalHarmony(scaleByName('ryukyu', 0))).toBe(false);
    expect(supportsFunctionalHarmony(scaleByName('todi', 5))).toBe(false);
  });

  it('answers a mask shared with a Western scale under the Western reading', () => {
    // Maqam Nahawand and the natural minor are the same twelve pitch classes.
    // The name carries the tradition; the mask on its own cannot, so a caller
    // that has only a KeyScale is told what that mask means in the register the
    // rest of the library analyses in.
    expect(scaleSystemOf('nahawand')).toBe('non-functional');
    expect(scaleSystemOf(scaleByName('nahawand', 0))).toBe('common-practice');
  });

  it('splits functional harmony the same way for a mask a Western scale shares', () => {
    // Maqam Hijaz and the phrygian dominant are the same seven pitch classes,
    // so the name declines functional analysis and the bare mask — which is
    // read the Western way, as a mode — accepts it.
    expect(supportsFunctionalHarmony('hijaz')).toBe(false);
    expect(scaleSystemOf(scaleByName('hijaz', 0))).toBe('modal');
    expect(supportsFunctionalHarmony(scaleByName('hijaz', 0))).toBe(true);
  });

  it('leaves a mask that names no built-in scale undecided', () => {
    const invented: KeyScale = { rootPc: 0, modeMask12: 0b000000000111 };
    expect(scaleSystemOf(invented)).toBeUndefined();
    // Nothing is known about it, so it keeps being analysed as it always was.
    expect(supportsFunctionalHarmony(invented)).toBe(true);
  });

  it('rejects an unknown scale name rather than calling it non-functional', () => {
    expect(() => scaleSystemOf('notAScale')).toThrow(RangeError);
    expect(() => supportsFunctionalHarmony('notAScale')).toThrow(RangeError);
  });
});

describe('scale aliases', () => {
  it.each([
    ['inakaBushi', 'minyo'],
    ['okinawan', 'ryukyu'],
    ['hicaz', 'hijaz'],
    ['doubleHarmonic', 'hijazkar'],
    ['bilawal', 'bilaval'],
    ['marva', 'marwa'],
    ['poorvi', 'purvi'],
  ] as const)('resolves %s to %s', (alias, canonical) => {
    expect(resolveScaleName(alias)).toBe(canonical);
    expect(namedScaleMask(alias)).toBe(namedScaleMask(canonical));
    expect(scaleByName(alias, 7)).toEqual(scaleByName(canonical, 7));
  });

  it('resolves a canonical name to itself', () => {
    expect(resolveScaleName('dorian')).toBe('dorian');
    expect(resolveScaleName('ryukyu')).toBe('ryukyu');
  });

  it('points every alias at a scale that exists', () => {
    for (const [alias, canonical] of Object.entries(SCALE_ALIASES)) {
      expect(namedScaleMask(canonical), alias).toBeDefined();
      expect(Object.hasOwn(NAMED_SCALES, alias) || Object.hasOwn(WORLD_SCALES, alias)).toBe(false);
    }
  });

  it('resolves nothing for an unknown name or an inherited property', () => {
    expect(resolveScaleName('bogus')).toBeUndefined();
    expect(resolveScaleName('constructor')).toBeUndefined();
    expect(resolveScaleName('toString')).toBeUndefined();
    expect(namedScaleMask('constructor')).toBeUndefined();
  });
});

describe('the established scale register', () => {
  it('still carries every mask it carried before, unmoved', () => {
    const names = Object.keys(NAMED_SCALES);
    expect(names.slice(0, ESTABLISHED_MASKS.length)).toEqual(
      ESTABLISHED_MASKS.map(([name]) => name),
    );
    for (const [name, mask] of ESTABLISHED_MASKS) {
      expect(NAMED_SCALES[name as keyof typeof NAMED_SCALES], name).toBe(mask);
    }
  });

  it('keeps the world scales in their own register', () => {
    for (const name of Object.keys(WORLD_SCALES)) {
      expect(Object.hasOwn(NAMED_SCALES, name), name).toBe(false);
    }
    expect(Object.isFrozen(WORLD_SCALES)).toBe(true);
    expect(Object.isFrozen(SCALE_ALIASES)).toBe(true);
    expect(Object.isFrozen(SCALE_SYSTEMS)).toBe(true);
  });
});
