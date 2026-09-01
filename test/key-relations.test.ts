import { describe, expect, it } from 'vitest';
import type { ResolvedKey } from '../src/index.js';
import {
  diatonicLetterOf,
  dominantKeyOf,
  enharmonicKeyOf,
  formatNote,
  keyFromFifths,
  keyRelationBetween,
  keySignatureFifths,
  majorKey,
  minorKey,
  NAMED_SCALES,
  NATURAL_MINOR_MASK,
  noteToPitchClass,
  parallelKeyOf,
  parseNote,
  relatedKeysOf,
  relativeKeyOf,
  resolveKey,
  scaleByName,
  spelledKeyOf,
  subdominantKeyOf,
  WORLD_SCALES,
} from '../src/index.js';
import * as theory from '../src/theory/index.js';

/** Every scale the library names, the world scales included. */
const ALL_SCALE_NAMES = [...Object.keys(NAMED_SCALES), ...Object.keys(WORLD_SCALES)];

/** Name a spelled key the way it is read aloud, e.g. `'Bb minor'`. */
function name(spelled: ResolvedKey | null): string {
  if (spelled === null) {
    return 'none';
  }
  const mode = spelled.scale.modeMask12 === NATURAL_MINOR_MASK ? 'minor' : 'major';
  return `${formatNote(spelled.tonic)} ${mode}`;
}

describe('relativeKeyOf', () => {
  it('swaps mode without changing the signature', () => {
    expect(name(relativeKeyOf(parseNote('C'), majorKey(0)))).toBe('A minor');
    expect(name(relativeKeyOf(parseNote('A'), minorKey(9)))).toBe('C major');
  });

  it('spells the relative from the circle of fifths, not from the pitch class', () => {
    // Bb minor and A# minor sound alike; only Bb minor shares Db major's five flats.
    expect(name(relativeKeyOf(parseNote('Db'), majorKey(1)))).toBe('Bb minor');
    expect(name(relativeKeyOf(parseNote('G#'), minorKey(8)))).toBe('B major');
  });

  it('is its own inverse for every major key', () => {
    for (let fifths = -5; fifths <= 6; fifths += 1) {
      const original = keyFromFifths(fifths);
      const relative = relativeKeyOf(original.tonic, original.scale);
      expect(name(relativeKeyOf(relative.tonic, relative.scale)), `${fifths}`).toBe(name(original));
    }
  });

  it('reads a scale that is not a diatonic mode through its parallel signature', () => {
    // A harmonic minor is written with A minor's signature, so it relates to C major.
    expect(name(relativeKeyOf(parseNote('A'), scaleByName('harmonicMinor', 9)))).toBe('C major');
    expect(name(relativeKeyOf(parseNote('C'), scaleByName('majorPentatonic', 0)))).toBe('A minor');
  });
});

describe('parallelKeyOf', () => {
  it('swaps mode on the same tonic', () => {
    const cMinor = parallelKeyOf(parseNote('C'), majorKey(0));
    expect(name(cMinor)).toBe('C minor');
    expect(name(parallelKeyOf(cMinor.tonic, cMinor.scale))).toBe('C major');
  });

  it('keeps the tonic spelling it was given', () => {
    // The circle of fifths would name this key Ab major; the caller said G#.
    expect(name(parallelKeyOf(parseNote('G#'), minorKey(8)))).toBe('G# major');
  });

  it('roots the returned key on the spelled tonic', () => {
    expect(parallelKeyOf(parseNote('Eb'), majorKey(3)).scale).toEqual(minorKey(3));
  });
});

describe('dominantKeyOf and subdominantKeyOf', () => {
  it('steps one fifth in each direction', () => {
    expect(name(dominantKeyOf(parseNote('C'), majorKey(0)))).toBe('G major');
    expect(name(subdominantKeyOf(parseNote('C'), majorKey(0)))).toBe('F major');
  });

  it('keeps the spelling of a key with many sharps', () => {
    expect(name(dominantKeyOf(parseNote('F#'), majorKey(6)))).toBe('C# major');
    expect(name(subdominantKeyOf(parseNote('F#'), majorKey(6)))).toBe('B major');
  });

  it('stays in the minor mode', () => {
    expect(name(dominantKeyOf(parseNote('A'), minorKey(9)))).toBe('E minor');
    expect(name(subdominantKeyOf(parseNote('A'), minorKey(9)))).toBe('D minor');
  });

  it('moves a fifth from the tonic of a church mode, not from its signature', () => {
    // G mixolydian carries C major's empty signature; a step taken from the
    // signature would answer G major, a unison above, instead of D major.
    expect(name(dominantKeyOf(parseNote('G'), scaleByName('mixolydian', 7)))).toBe('D major');
    expect(name(subdominantKeyOf(parseNote('G'), scaleByName('mixolydian', 7)))).toBe('C major');
    expect(name(dominantKeyOf(parseNote('D'), scaleByName('dorian', 2)))).toBe('A minor');
    expect(name(subdominantKeyOf(parseNote('D'), scaleByName('dorian', 2)))).toBe('G minor');
  });

  it('travels a perfect fifth in every mode, on every tonic it is given', () => {
    const modes = [
      'ionian',
      'dorian',
      'phrygian',
      'lydian',
      'mixolydian',
      'aeolian',
      'locrian',
    ] as const;
    for (const mode of modes) {
      for (const tonicName of ['C', 'G', 'D', 'Eb', 'F#', 'Bb']) {
        const tonic = parseNote(tonicName);
        const key = scaleByName(mode, noteToPitchClass(tonic));
        const above = dominantKeyOf(tonic, key);
        const below = subdominantKeyOf(tonic, key);
        const where = `${tonicName} ${mode}`;
        // A fifth up is four letters up and seven semitones up; a fifth down is
        // the same move mirrored, which is what makes the two each other's
        // inverse on the spelling as well as on the sound.
        expect(diatonicLetterOf(above.tonic.letter), where).toBe(
          diatonicLetterOf(tonic.letter + 4),
        );
        expect(noteToPitchClass(above.tonic), where).toBe((noteToPitchClass(tonic) + 7) % 12);
        expect(diatonicLetterOf(below.tonic.letter), where).toBe(
          diatonicLetterOf(tonic.letter + 3),
        );
        expect(noteToPitchClass(below.tonic), where).toBe((noteToPitchClass(tonic) + 5) % 12);
        expect(formatNote(subdominantKeyOf(above.tonic, above.scale).tonic), where).toBe(tonicName);
        expect(formatNote(dominantKeyOf(below.tonic, below.scale).tonic), where).toBe(tonicName);
      }
    }
  });

  it('is a fifth and its own way back for every scale the library names', () => {
    // The mode a scale is answered in is the one its third names, but the
    // distance is measured from the tonic in every case, so the pair stays a
    // fifth apart and each takes the other's answer back to where it started.
    for (const scaleName of ALL_SCALE_NAMES) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const key = scaleByName(scaleName, rootPc);
        const tonic = spelledKeyOf(key).tonic;
        const where = `${scaleName}/${rootPc}`;
        const above = dominantKeyOf(tonic, key);
        const below = subdominantKeyOf(tonic, key);
        expect(diatonicLetterOf(above.tonic.letter), where).toBe(
          diatonicLetterOf(tonic.letter + 4),
        );
        expect(noteToPitchClass(above.tonic), where).toBe((rootPc + 7) % 12);
        expect(above.scale.rootPc, where).toBe(noteToPitchClass(above.tonic));
        expect(diatonicLetterOf(below.tonic.letter), where).toBe(
          diatonicLetterOf(tonic.letter + 3),
        );
        expect(noteToPitchClass(below.tonic), where).toBe((rootPc + 5) % 12);
        expect(below.scale.rootPc, where).toBe(noteToPitchClass(below.tonic));
        expect(formatNote(subdominantKeyOf(above.tonic, above.scale).tonic), where).toBe(
          formatNote(tonic),
        );
        expect(formatNote(dominantKeyOf(below.tonic, below.scale).tonic), where).toBe(
          formatNote(tonic),
        );
      }
    }
  });
});

describe('enharmonicKeyOf', () => {
  it('names the other spelling of a key that has one', () => {
    expect(name(enharmonicKeyOf(parseNote('Db'), majorKey(1)))).toBe('C# major');
    expect(name(enharmonicKeyOf(parseNote('F#'), majorKey(6)))).toBe('Gb major');
  });

  it('returns null for a key that is only written one way', () => {
    expect(enharmonicKeyOf(parseNote('C'), majorKey(0))).toBeNull();
    expect(enharmonicKeyOf(parseNote('A'), minorKey(9))).toBeNull();
    expect(enharmonicKeyOf(parseNote('D'), majorKey(2))).toBeNull();
  });

  it('is its own inverse wherever it answers', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const original = keyFromFifths(fifths, mode);
        const other = enharmonicKeyOf(original.tonic, original.scale);
        if (other === null) {
          continue;
        }
        expect(name(enharmonicKeyOf(other.tonic, other.scale)), `${fifths}/${mode}`).toBe(
          name(original),
        );
      }
    }
  });

  it('respells a modal key without moving it or flattening its scale', () => {
    // C# lydian is written Db lydian on the flat side: the same sounding key,
    // the same mask, and a tonic that still spells the root it was given.
    const lydian = scaleByName('lydian', 1);
    const other = enharmonicKeyOf(parseNote('C#'), lydian);
    expect(other).not.toBeNull();
    expect(formatNote((other as ResolvedKey).tonic)).toBe('Db');
    expect((other as ResolvedKey).scale.modeMask12).toBe(lydian.modeMask12);
    expect((other as ResolvedKey).scale.rootPc).toBe(1);
  });

  it('answers every named scale with a respelling of the same sound, or with nothing', () => {
    for (const scaleName of ALL_SCALE_NAMES) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const key = scaleByName(scaleName, rootPc);
        const spelled = spelledKeyOf(key);
        const other = enharmonicKeyOf(spelled.tonic, key);
        if (other === null) {
          continue;
        }
        const where = `${scaleName}/${rootPc}`;
        expect(noteToPitchClass(other.tonic), where).toBe(rootPc);
        expect(other.scale.rootPc, where).toBe(noteToPitchClass(other.tonic));
        expect(other.scale.modeMask12, where).toBe(key.modeMask12);
        // The answer is itself a spelling the key is written on, so the
        // relation takes it straight back.
        const back = enharmonicKeyOf(other.tonic, other.scale);
        expect(back === null ? 'none' : formatNote(back.tonic), where).toBe(
          formatNote(spelled.tonic),
        );
      }
    }
  });

  it('is the way back from a spelling no key is written on', () => {
    // D# major has nine sharps and Db minor eight flats, so neither is a key
    // anyone writes: from there the relation names the written twin rather
    // than another unwritten spelling. It is one-way for such a tonic — the
    // twin it names is written, so the twin itself has no second spelling.
    const outOfRange: [string, ResolvedKey][] = [
      ['D#', resolveKey({ tonic: parseNote('D#'), scale: majorKey(3) })],
      ['Db', resolveKey({ tonic: parseNote('Db'), scale: minorKey(1) })],
      ['Cb', resolveKey({ tonic: parseNote('Cb'), scale: minorKey(11) })],
    ];
    for (const [label, unwritten] of outOfRange) {
      const written = enharmonicKeyOf(unwritten.tonic, unwritten.scale);
      expect(written, label).not.toBeNull();
      const spelled = written as ResolvedKey;
      expect(noteToPitchClass(spelled.tonic), label).toBe(noteToPitchClass(unwritten.tonic));
      expect(spelled.scale.rootPc, label).toBe(noteToPitchClass(spelled.tonic));
      expect(spelled.scale.modeMask12, label).toBe(unwritten.scale.modeMask12);
      expect(formatNote(spelled.tonic), label).toBe(
        formatNote(spelledKeyOf(unwritten.scale).tonic),
      );
      expect(enharmonicKeyOf(spelled.tonic, spelled.scale), label).toBeNull();
    }
  });
});

describe('relatedKeysOf', () => {
  it('lists the six closely related keys in relation order', () => {
    expect(
      relatedKeysOf(parseNote('C'), majorKey(0)).map(
        (related) => `${related.relation} ${name(related)}`,
      ),
    ).toEqual([
      'relative A minor',
      'parallel C minor',
      'dominant G major',
      'subdominant F major',
      'relativeOfDominant E minor',
      'relativeOfSubdominant D minor',
    ]);
  });

  it('lists them for a minor key too', () => {
    expect(relatedKeysOf(parseNote('A'), minorKey(9)).map(name)).toEqual([
      'C major',
      'A major',
      'E minor',
      'D minor',
      'G major',
      'F major',
    ]);
  });
});

describe('keyRelationBetween', () => {
  const cMajor: ResolvedKey = resolveKey({ tonic: parseNote('C'), scale: majorKey(0) });

  it('reports every relation it knows', () => {
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('C'), scale: majorKey(0) })),
    ).toBe('same');
    expect(
      keyRelationBetween(
        resolveKey({ tonic: parseNote('Db'), scale: majorKey(1) }),
        resolveKey({ tonic: parseNote('C#'), scale: majorKey(1) }),
      ),
    ).toBe('enharmonic');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('A'), scale: minorKey(9) })),
    ).toBe('relative');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('C'), scale: minorKey(0) })),
    ).toBe('parallel');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('G'), scale: majorKey(7) })),
    ).toBe('dominant');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('F'), scale: majorKey(5) })),
    ).toBe('subdominant');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('E'), scale: minorKey(4) })),
    ).toBe('relativeOfDominant');
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('D'), scale: minorKey(2) })),
    ).toBe('relativeOfSubdominant');
  });

  it('returns null for an unrelated key', () => {
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('Eb'), scale: minorKey(3) })),
    ).toBeNull();
    expect(
      keyRelationBetween(cMajor, resolveKey({ tonic: parseNote('B'), scale: majorKey(11) })),
    ).toBeNull();
  });

  it('ignores the spelling of the second key beyond the identity test', () => {
    const eMajor: ResolvedKey = resolveKey({ tonic: parseNote('E'), scale: majorKey(4) });
    expect(
      keyRelationBetween(eMajor, resolveKey({ tonic: parseNote('C#'), scale: minorKey(1) })),
    ).toBe('relative');
    expect(
      keyRelationBetween(eMajor, resolveKey({ tonic: parseNote('Db'), scale: minorKey(1) })),
    ).toBe('relative');
  });

  it('reads a minor variant as the minor key it is a form of, from either side', () => {
    // A harmonic minor is the key detection reports for a minor cadence, and it
    // stands to C major exactly as A minor does — asked in either direction.
    const aHarmonic: ResolvedKey = resolveKey({
      tonic: parseNote('A'),
      scale: scaleByName('harmonicMinor', 9),
    });
    const aMelodic: ResolvedKey = resolveKey({
      tonic: parseNote('A'),
      scale: scaleByName('melodicMinor', 9),
    });
    expect(keyRelationBetween(aHarmonic, cMajor)).toBe('relative');
    expect(keyRelationBetween(cMajor, aHarmonic)).toBe('relative');
    expect(keyRelationBetween(cMajor, aMelodic)).toBe('relative');
    expect(
      keyRelationBetween(aHarmonic, resolveKey({ tonic: parseNote('A'), scale: minorKey(9) })),
    ).toBe('same');
  });

  it('answers from either side wherever the related keys name the other', () => {
    // Every relation in the table is either its own inverse or paired with the
    // one that undoes it, so a relation found in one direction is found back.
    const inverse = {
      same: 'same',
      enharmonic: 'enharmonic',
      relative: 'relative',
      parallel: 'parallel',
      dominant: 'subdominant',
      subdominant: 'dominant',
      relativeOfDominant: 'relativeOfSubdominant',
      relativeOfSubdominant: 'relativeOfDominant',
    } as const;
    const keys: ResolvedKey[] = [];
    for (let rootPc = 0; rootPc < 12; rootPc += 1) {
      for (const key of [
        majorKey(rootPc),
        minorKey(rootPc),
        scaleByName('harmonicMinor', rootPc),
        scaleByName('melodicMinor', rootPc),
      ]) {
        keys.push(spelledKeyOf(key));
      }
    }
    for (const a of keys) {
      for (const related of relatedKeysOf(a.tonic, a.scale)) {
        const back = keyRelationBetween(related, a);
        const forward = keyRelationBetween(a, related);
        const where = `${formatNote(a.tonic)}/${a.scale.modeMask12} -> ${related.relation}`;
        expect(forward, where).not.toBeNull();
        expect(back, where).toBe(inverse[forward as keyof typeof inverse]);
      }
    }
  });
});

describe('key signature entry points', () => {
  it('is reachable from the package root', () => {
    expect(keySignatureFifths(parseNote('Bb'), majorKey(10))).toBe(-2);
    expect(formatNote(keyFromFifths(-2).tonic)).toBe('Bb');
  });

  it('is reachable from the theory entry point', () => {
    expect(theory.keySignatureFifths(parseNote('Bb'), theory.majorKey(10))).toBe(-2);
    expect(formatNote(theory.keyFromFifths(-2).tonic)).toBe('Bb');
    expect(name(theory.relativeKeyOf(parseNote('C'), theory.majorKey(0)))).toBe('A minor');
  });
});
