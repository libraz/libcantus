import { describe, expect, it } from 'vitest';
import type { SpelledKey } from '../src/index.js';
import {
  dominantKeyOf,
  enharmonicKeyOf,
  formatNote,
  keyFromFifths,
  keyRelationBetween,
  keySignatureFifths,
  majorKey,
  minorKey,
  NATURAL_MINOR_MASK,
  parallelKeyOf,
  parseNote,
  relatedKeysOf,
  relativeKeyOf,
  scaleByName,
  subdominantKeyOf,
} from '../src/index.js';
import * as theory from '../src/theory/index.js';

/** Name a spelled key the way it is read aloud, e.g. `'Bb minor'`. */
function name(spelled: SpelledKey | null): string {
  if (spelled === null) {
    return 'none';
  }
  const mode = spelled.key.modeMask12 === NATURAL_MINOR_MASK ? 'minor' : 'major';
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
      const relative = relativeKeyOf(original.tonic, original.key);
      expect(name(relativeKeyOf(relative.tonic, relative.key)), `${fifths}`).toBe(name(original));
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
    expect(name(parallelKeyOf(cMinor.tonic, cMinor.key))).toBe('C major');
  });

  it('keeps the tonic spelling it was given', () => {
    // The circle of fifths would name this key Ab major; the caller said G#.
    expect(name(parallelKeyOf(parseNote('G#'), minorKey(8)))).toBe('G# major');
  });

  it('roots the returned key on the spelled tonic', () => {
    expect(parallelKeyOf(parseNote('Eb'), majorKey(3)).key).toEqual(minorKey(3));
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
        const other = enharmonicKeyOf(original.tonic, original.key);
        if (other === null) {
          continue;
        }
        expect(name(enharmonicKeyOf(other.tonic, other.key)), `${fifths}/${mode}`).toBe(
          name(original),
        );
      }
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
  const cMajor: SpelledKey = { tonic: parseNote('C'), key: majorKey(0) };

  it('reports every relation it knows', () => {
    expect(keyRelationBetween(cMajor, { tonic: parseNote('C'), key: majorKey(0) })).toBe('same');
    expect(
      keyRelationBetween(
        { tonic: parseNote('Db'), key: majorKey(1) },
        { tonic: parseNote('C#'), key: majorKey(1) },
      ),
    ).toBe('enharmonic');
    expect(keyRelationBetween(cMajor, { tonic: parseNote('A'), key: minorKey(9) })).toBe(
      'relative',
    );
    expect(keyRelationBetween(cMajor, { tonic: parseNote('C'), key: minorKey(0) })).toBe(
      'parallel',
    );
    expect(keyRelationBetween(cMajor, { tonic: parseNote('G'), key: majorKey(7) })).toBe(
      'dominant',
    );
    expect(keyRelationBetween(cMajor, { tonic: parseNote('F'), key: majorKey(5) })).toBe(
      'subdominant',
    );
    expect(keyRelationBetween(cMajor, { tonic: parseNote('E'), key: minorKey(4) })).toBe(
      'relativeOfDominant',
    );
    expect(keyRelationBetween(cMajor, { tonic: parseNote('D'), key: minorKey(2) })).toBe(
      'relativeOfSubdominant',
    );
  });

  it('returns null for an unrelated key', () => {
    expect(keyRelationBetween(cMajor, { tonic: parseNote('Eb'), key: minorKey(3) })).toBeNull();
    expect(keyRelationBetween(cMajor, { tonic: parseNote('B'), key: majorKey(11) })).toBeNull();
  });

  it('ignores the spelling of the second key beyond the identity test', () => {
    const eMajor: SpelledKey = { tonic: parseNote('E'), key: majorKey(4) };
    expect(keyRelationBetween(eMajor, { tonic: parseNote('C#'), key: minorKey(1) })).toBe(
      'relative',
    );
    expect(keyRelationBetween(eMajor, { tonic: parseNote('Db'), key: minorKey(1) })).toBe(
      'relative',
    );
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
