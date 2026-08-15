import { describe, expect, it } from 'vitest';
import type { KeyMode } from '../src/index.js';
import { Interval, InvalidInputError, Key, parseInterval } from '../src/index.js';

/** The twelve major keys, each on the tonic spelling the pitch class is written with. */
const MAJOR_KEYS: Key[] = Array.from({ length: 12 }, (_, pc) => Key.major(pc));

/** The twelve minor keys, spelled the same way. */
const MINOR_KEYS: Key[] = Array.from({ length: 12 }, (_, pc) => Key.minor(pc));

/** Every plain key paired with its mode, for properties that need the mode back. */
const ALL_KEYS: { key: Key; mode: KeyMode }[] = [
  ...MAJOR_KEYS.map((key) => ({ key, mode: 'major' as const })),
  ...MINOR_KEYS.map((key) => ({ key, mode: 'minor' as const })),
];

describe('Key.fifths', () => {
  it('counts the sharps and flats of the signature a key is written with', () => {
    expect(Key.major('C').fifths).toBe(0);
    expect(Key.major('Db').fifths).toBe(-5);
    expect(Key.minor('G#').fifths).toBe(5);
    expect(Key.minor('A').fifths).toBe(0);
  });

  it('gives a modal key the signature its notes are actually written with', () => {
    // D dorian is the white notes, so it takes C major's empty signature;
    // C lydian raises the fourth, which is the one sharp of G major.
    expect(Key.named('dorian', 'D').fifths).toBe(0);
    expect(Key.named('lydian', 'C').fifths).toBe(1);
  });

  it('leaves an altered minor scale on its parallel natural-minor signature', () => {
    // The G# of A harmonic minor is an accidental, not part of the signature.
    expect(Key.named('harmonicMinor', 'A').fifths).toBe(0);
  });
});

describe('Key.fromFifths', () => {
  it('builds the major key of a signature by default and the minor key on request', () => {
    expect(Key.fromFifths(-2).toString()).toBe('Bb major');
    expect(Key.fromFifths(-2, 'minor').toString()).toBe('G minor');
  });

  it('spells the tonic the way the key is written', () => {
    expect(Key.fromFifths(-7).toString()).toBe('Cb major');
    expect(Key.fromFifths(7).toString()).toBe('C# major');
    expect(Key.fromFifths(5, 'minor').toString()).toBe('G# minor');
    expect(Key.fromFifths(-5, 'minor').toString()).toBe('Bb minor');
  });

  it('round trips every written signature in both modes', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (const mode of ['major', 'minor'] as const) {
        const key = Key.fromFifths(fifths, mode);
        expect(key.fifths, `${fifths}/${mode}`).toBe(fifths);
        expect(Key.fromFifths(key.fifths, mode).toString(), `${fifths}/${mode}`).toBe(
          key.toString(),
        );
      }
    }
  });
});

describe('Key.relative', () => {
  it('reads the same signature in the other mode', () => {
    expect(Key.major('C').relative().toString()).toBe('A minor');
    expect(Key.minor('A').relative().toString()).toBe('C major');
  });

  it('spells the new tonic from the circle of fifths, not from the pitch class', () => {
    // Bb minor and A# minor sound alike; only Bb minor shares Db major's five flats.
    expect(Key.major('Db').relative().toString()).toBe('Bb minor');
    expect(Key.minor('G#').relative().toString()).toBe('B major');
  });

  it('is its own inverse for every major and minor key', () => {
    for (const { key } of ALL_KEYS) {
      expect(key.relative().relative().toString(), `${key}`).toBe(key.toString());
    }
  });
});

describe('Key.parallel', () => {
  it('swaps the mode on the same tonic', () => {
    expect(Key.major('C').parallel().toString()).toBe('C minor');
    expect(Key.minor('C').parallel().toString()).toBe('C major');
  });

  it('keeps the tonic spelling it was given', () => {
    // The circle of fifths would name this key Ab major; the tonic says G#.
    expect(Key.minor('G#').parallel().toString()).toBe('G# major');
  });

  it('is its own inverse for every major and minor key', () => {
    for (const { key } of ALL_KEYS) {
      expect(key.parallel().parallel().toString(), `${key}`).toBe(key.toString());
    }
  });
});

describe('Key.dominantKey and Key.subdominantKey', () => {
  it('steps one fifth in each direction, keeping the mode', () => {
    expect(Key.major('C').dominantKey().toString()).toBe('G major');
    expect(Key.major('C').subdominantKey().toString()).toBe('F major');
    expect(Key.minor('A').dominantKey().toString()).toBe('E minor');
    expect(Key.minor('A').subdominantKey().toString()).toBe('D minor');
  });

  it('moves the signature by exactly one accidental', () => {
    for (const { key } of ALL_KEYS) {
      expect(key.dominantKey().fifths, `${key}`).toBe(key.fifths + 1);
      expect(key.subdominantKey().fifths, `${key}`).toBe(key.fifths - 1);
    }
  });
});

describe('Key.enharmonic', () => {
  it('names the other written spelling of a key that has one', () => {
    expect(Key.major('Db').enharmonic()?.toString()).toBe('C# major');
    expect(Key.minor('G#').enharmonic()?.toString()).toBe('Ab minor');
  });

  it('answers null for a key that is only written one way', () => {
    expect(Key.major('C').enharmonic()).toBeNull();
    expect(Key.minor('A').enharmonic()).toBeNull();
  });
});

describe('Key.relatedKeys', () => {
  it('lists the six closely related keys of C major in relation order', () => {
    expect(
      Key.major('C')
        .relatedKeys()
        .map((related) => `${related.relation}: ${related.key}`),
    ).toEqual([
      'relative: A minor',
      'parallel: C minor',
      'dominant: G major',
      'subdominant: F major',
      'relativeOfDominant: E minor',
      'relativeOfSubdominant: D minor',
    ]);
  });

  it('agrees with the individual relation accessors', () => {
    for (const { key } of ALL_KEYS) {
      const related = new Map(key.relatedKeys().map((entry) => [entry.relation, entry.key]));
      expect(related.get('relative')?.toString(), `${key}`).toBe(key.relative().toString());
      expect(related.get('parallel')?.toString(), `${key}`).toBe(key.parallel().toString());
      expect(related.get('dominant')?.toString(), `${key}`).toBe(key.dominantKey().toString());
      expect(related.get('subdominant')?.toString(), `${key}`).toBe(
        key.subdominantKey().toString(),
      );
    }
  });
});

describe('Key.relationTo', () => {
  it('reports identity, enharmonic spelling, and the named relations', () => {
    const cMajor = Key.major('C');
    expect(cMajor.relationTo(cMajor)).toBe('same');
    expect(Key.major('Db').relationTo(Key.major('C#'))).toBe('enharmonic');
    expect(cMajor.relationTo(Key.minor('A'))).toBe('relative');
    expect(cMajor.relationTo(Key.minor('C'))).toBe('parallel');
    expect(cMajor.relationTo(Key.major('G'))).toBe('dominant');
    expect(cMajor.relationTo(Key.major('F'))).toBe('subdominant');
    expect(cMajor.relationTo(Key.minor('E'))).toBe('relativeOfDominant');
    expect(cMajor.relationTo(Key.minor('D'))).toBe('relativeOfSubdominant');
  });

  it('answers null for an unrelated key', () => {
    expect(Key.major('C').relationTo(Key.minor('Eb'))).toBeNull();
    expect(Key.major('C').relationTo(Key.major('B'))).toBeNull();
  });

  it('recognizes its own relative and parallel for every major and minor key', () => {
    for (const { key } of ALL_KEYS) {
      expect(key.relationTo(key), `${key}`).toBe('same');
      expect(key.relationTo(key.relative()), `${key}`).toBe('relative');
      expect(key.relationTo(key.parallel()), `${key}`).toBe('parallel');
    }
  });
});

describe('Key.degree', () => {
  it('counts from 1, so degree 1 is the tonic', () => {
    expect(Key.major('C').degree(1).name).toBe('C');
    expect(Key.minor('A').degree(1).name).toBe('A');
    expect(Key.major('Db').degree(1).name).toBe('Db');
    expect(Key.minor('G#').degree(1).name).toBe('G#');
  });

  it('names the degree a musician would name', () => {
    expect(Key.minor('A').degree(4).name).toBe('D');
    expect(Key.minor('G#').degree(7).name).toBe('F#');
    expect(Key.major('C').degree(5).name).toBe('G');
  });

  it('walks the whole spelled scale', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => Key.major('Db').degree(n).name)).toEqual(
      Key.major('Db').noteNames(),
    );
  });

  it('follows an altered scale rather than the natural minor', () => {
    // A harmonic minor raises the seventh, so degree 7 is G# and not G.
    expect(Key.named('harmonicMinor', 'A').degree(7).name).toBe('G#');
  });

  it('rejects a degree outside 1..7 and a non-integer degree', () => {
    const key = Key.major('C');
    expect(() => key.degree(0)).toThrow(InvalidInputError);
    expect(() => key.degree(8)).toThrow(InvalidInputError);
    expect(() => key.degree(1.5)).toThrow(/degree/);
    expect(() => key.degree(-1)).toThrow(RangeError);
  });

  it('bounds a pentatonic key by its own five degrees', () => {
    expect(Key.named('majorPentatonic', 'C').degree(5).name).toBe('A');
    expect(() => Key.named('majorPentatonic', 'C').degree(6)).toThrow(InvalidInputError);
  });
});

describe('Key.keyOnDegree', () => {
  it('reads the mode off the diatonic triad on that degree', () => {
    expect(Key.minor('A').keyOnDegree(4).toString()).toBe('D minor');
    expect(Key.major('C').keyOnDegree(4).toString()).toBe('F major');
    expect(Key.major('C').keyOnDegree(5).toString()).toBe('G major');
  });

  it('takes an explicit mode over the inferred one', () => {
    expect(Key.minor('A').keyOnDegree(4, 'major').toString()).toBe('D major');
    expect(Key.major('C').keyOnDegree(5, 'minor').toString()).toBe('G minor');
  });

  it('reads a diminished triad as a minor key', () => {
    // The triad on the leading tone of C major is B diminished.
    expect(Key.major('C').keyOnDegree(7).toString()).toBe('B minor');
    expect(Key.minor('A').keyOnDegree(2).toString()).toBe('B minor');
  });

  it('names every degree of C major and A minor', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => Key.major('C').keyOnDegree(n).toString())).toEqual([
      'C major',
      'D minor',
      'E minor',
      'F major',
      'G major',
      'A minor',
      'B minor',
    ]);
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => Key.minor('A').keyOnDegree(n).toString())).toEqual([
      'A minor',
      'B minor',
      'C major',
      'D minor',
      'E minor',
      'F major',
      'G major',
    ]);
  });

  it('keeps the spelling of the degree it is rooted on', () => {
    expect(Key.major('Db').keyOnDegree(4).toString()).toBe('Gb major');
    expect(Key.minor('G#').keyOnDegree(4).toString()).toBe('C# minor');
  });
});

describe('Key.keyHavingTonicAsDegree', () => {
  it('names the key this key sits on a degree of', () => {
    expect(Key.minor('D').keyHavingTonicAsDegree(4).toString()).toBe('A minor');
    expect(Key.major('F').keyHavingTonicAsDegree(4).toString()).toBe('C major');
    expect(Key.major('G').keyHavingTonicAsDegree(5).toString()).toBe('C major');
  });

  it('defaults to the mode of this key and takes an explicit one', () => {
    expect(Key.minor('D').keyHavingTonicAsDegree(4, 'major').toString()).toBe('A major');
    expect(Key.major('D').keyHavingTonicAsDegree(4, 'minor').toString()).toBe('A minor');
  });

  it('rejects a degree outside the seven of a major or minor key', () => {
    expect(() => Key.major('C').keyHavingTonicAsDegree(0)).toThrow(InvalidInputError);
    expect(() => Key.major('C').keyHavingTonicAsDegree(8)).toThrow(InvalidInputError);
    expect(() => Key.major('C').keyHavingTonicAsDegree(2.5)).toThrow(/degree/);
  });

  it('inverts keyOnDegree for every degree of every major and minor key', () => {
    // keyOnDegree may change mode from degree to degree, so the way back has to
    // be told which mode the original key was in.
    for (const { key, mode } of ALL_KEYS) {
      for (let n = 1; n <= 7; n += 1) {
        expect(
          key.keyOnDegree(n).keyHavingTonicAsDegree(n, mode).toString(),
          `${key} degree ${n}`,
        ).toBe(key.toString());
      }
    }
  });
});

describe('Key.transposeBy', () => {
  it('spells the tonic by the diatonic number of the interval', () => {
    expect(Key.minor('D').transposeBy('A4').toString()).toBe('G# minor');
    expect(Key.minor('G#').transposeBy('-A4').toString()).toBe('D minor');
  });

  it('distinguishes the augmented fourth from the diminished fifth', () => {
    expect(Key.minor('D').transposeBy('A4').toString()).toBe('G# minor');
    expect(Key.minor('D').transposeBy('d5').toString()).toBe('Ab minor');
    expect(Key.major('C').transposeBy('A4').toString()).toBe('F# major');
    expect(Key.major('C').transposeBy('d5').toString()).toBe('Gb major');
  });

  it('accepts a name, plain interval data, and an Interval alike', () => {
    const key = Key.minor('D');
    expect(key.transposeBy('A4').toString()).toBe('G# minor');
    expect(key.transposeBy(parseInterval('A4')).toString()).toBe('G# minor');
    expect(key.transposeBy(Interval.parse('A4')).toString()).toBe('G# minor');
  });

  it('keeps the scale shape, moving only the tonic', () => {
    const moved = Key.named('harmonicMinor', 'A').transposeBy('m3');
    expect(moved.toString()).toBe('C minor');
    expect(moved.scale.modeMask12).toBe(Key.named('harmonicMinor', 'A').scale.modeMask12);
    expect(moved.noteNames()).toEqual(['C', 'D', 'Eb', 'F', 'G', 'Ab', 'B']);
  });

  it('is the identity for a perfect unison and round trips through the negated interval', () => {
    const interval = Interval.parse('A4');
    for (const key of MAJOR_KEYS) {
      expect(key.transposeBy('P1').toString(), `${key}`).toBe(key.toString());
      expect(key.transposeBy(interval).transposeBy(interval.negate()).toString(), `${key}`).toBe(
        key.toString(),
      );
      expect(key.transposeBy('m3').transposeBy('-m3').toString(), `${key}`).toBe(key.toString());
    }
  });

  it('rejects a value that does not describe a spelled interval', () => {
    expect(() => Key.major('C').transposeBy('Q9')).toThrow(InvalidInputError);
  });
});

describe('Key.transpose', () => {
  it('respells a key the semitone count would drive past seven accidentals', () => {
    // Db up a semitone is D major, not the ten flats of Ebb major.
    expect(Key.major('Db').transpose(1).toString()).toBe('D major');
    expect(Key.major('Gb').transpose(1).toString()).toBe('G major');
    expect(Key.major('B').transpose(1).toString()).toBe('C major');
  });

  it('leaves a key that is already written exactly as it is', () => {
    // F# major has six sharps, so it is inside the range and stays put.
    expect(Key.major('C').transpose(6).toString()).toBe('F# major');
    expect(Key.major('C').transpose(2).toString()).toBe('D major');
    expect(Key.minor('A').transpose(3).toString()).toBe('C minor');
  });

  it('is the identity for zero semitones across every major key', () => {
    for (const key of MAJOR_KEYS) {
      expect(key.transpose(0).toString(), `${key}`).toBe(key.toString());
    }
  });

  it('keeps every transposed major key inside a written signature', () => {
    for (const key of MAJOR_KEYS) {
      for (let semitones = -12; semitones <= 12; semitones += 1) {
        const moved = key.transpose(semitones);
        expect(moved.rootPc, `${key} + ${semitones}`).toBe(
          (((key.rootPc + semitones) % 12) + 12) % 12,
        );
        expect(Math.abs(moved.fifths), `${key} + ${semitones}`).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe('Key.intervalTo', () => {
  it('measures the ascending interval between the two tonics', () => {
    expect(Key.major('C').intervalTo(Key.major('Eb')).name).toBe('m3');
    expect(Key.major('C').intervalTo(Key.major('F#')).name).toBe('A4');
    expect(Key.major('C').intervalTo(Key.major('Gb')).name).toBe('d5');
  });

  it('is a perfect unison from a key to itself', () => {
    expect(Key.major('C').intervalTo(Key.major('C')).name).toBe('P1');
    expect(Key.minor('G#').intervalTo(Key.minor('G#')).name).toBe('P1');
  });

  it('names the interval that transposeBy needs to reach the other key', () => {
    for (const key of MAJOR_KEYS) {
      const target = Key.major('Eb');
      expect(key.transposeBy(key.intervalTo(target)).tonic.name, `${key}`).toBe('Eb');
    }
  });
});

describe('modulation chain', () => {
  // "A piece's key modulates to the key whose tonic is the fourth degree of its
  // relative key, is then transposed up an augmented fourth, and the result is
  // G# minor. What was the original key?" The answer is C major.

  it('works the chain backwards from G# minor to C major', () => {
    const result = Key.minor('G#');
    const beforeTransposition = result.transposeBy('-A4');
    expect(beforeTransposition.toString()).toBe('D minor');
    const relativeOfOriginal = beforeTransposition.keyHavingTonicAsDegree(4);
    expect(relativeOfOriginal.toString()).toBe('A minor');
    expect(relativeOfOriginal.relative().toString()).toBe('C major');
  });

  it('works the chain forwards from C major to G# minor', () => {
    const original = Key.major('C');
    const relative = original.relative();
    expect(relative.toString()).toBe('A minor');
    const modulated = relative.keyOnDegree(4);
    expect(modulated.toString()).toBe('D minor');
    expect(modulated.transposeBy('A4').toString()).toBe('G# minor');
  });

  it('states the chain as a single expression in both directions', () => {
    expect(Key.minor('G#').transposeBy('-A4').keyHavingTonicAsDegree(4).relative().toString()).toBe(
      'C major',
    );
    expect(Key.major('C').relative().keyOnDegree(4).transposeBy('A4').toString()).toBe('G# minor');
  });
});
