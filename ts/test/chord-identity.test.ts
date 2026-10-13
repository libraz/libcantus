import { describe, expect, it } from 'vitest';
import { detectChordBest } from '../src/analyze/detect/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { Chord } from '../src/model/chord.js';
import {
  type ChordQuality,
  chordQualities,
  chordSpecIntervals,
  chordSpecOf,
} from '../src/theory/chord/index.js';
import { formatChordSymbol, parseChordSymbol } from '../src/theory/symbol/index.js';

describe('two accidentals against one degree are two tones', () => {
  it('parses the altered dominant with both its ninths', () => {
    expect(parseChordSymbol('C7(b9,#9)').intervals).toEqual([0, 4, 7, 10, 13, 15]);
  });

  it('reads the same chord whichever order the figures are written in', () => {
    expect(parseChordSymbol('C7(#9,b9)').intervals).toEqual(
      parseChordSymbol('C7(b9,#9)').intervals,
    );
  });

  it('writes both figures back and reads them as the same tones', () => {
    const symbol = formatChordSymbol(parseChordSymbol('C7(b9,#9)'));
    expect(symbol).toBe('C7(b9,#9)');
    expect(parseChordSymbol(symbol).intervals).toEqual([0, 4, 7, 10, 13, 15]);
  });

  it('keeps both alterations of a spec written as data', () => {
    expect(
      chordSpecIntervals({
        rootPc: 0,
        base: 'maj',
        seventh: 'min7',
        alterations: [
          { degree: 9, alter: -1 },
          { degree: 9, alter: 1 },
        ],
        additions: [],
        omissions: [],
      }),
    ).toEqual([0, 4, 7, 10, 13, 15]);
  });

  it('reads a chord carrying both ninths back as a spec that states them', () => {
    const spec = chordSpecOf({ rootPc: 0, quality: 'dom7', intervals: [0, 4, 7, 10, 13, 15] });
    expect(spec.alterations).toEqual([
      { degree: 9, alter: -1 },
      { degree: 9, alter: 1 },
    ]);
  });

  it('lets a written figure replace the unaltered tone a stack implied', () => {
    expect(parseChordSymbol('C11b9').intervals).toEqual([0, 7, 10, 13, 17]);
  });
});

describe('an omitted degree is not evidence against a quality name', () => {
  it('reads a fifth-less dominant as a dominant seventh', () => {
    expect(Chord.parse('G7no5').roman('C major')).toBe('V7');
  });

  it('keeps the major seventh of a fifth-less major seventh chord', () => {
    expect(Chord.parse('Cmaj7no5').quality).toBe('maj7');
  });

  it('keeps the dominant seventh of a third-less dominant', () => {
    expect(Chord.parse('C7omit3').quality).toBe('dom7');
  });

  it('leaves a chord with no omission under the name it already had', () => {
    expect(Chord.parse('C7').quality).toBe('dom7');
    expect(Chord.parse('Cmaj7').quality).toBe('maj7');
    expect(Chord.parse('Cm7b5').quality).toBe('m7b5');
  });
});

describe('the quality names are enumerated in the order the source declares', () => {
  it('opens with the plain triads', () => {
    expect(chordQualities().slice(0, 4)).toEqual(['maj', 'min', 'dim', 'aug']);
  });

  it('leaves the numeric names where they are written', () => {
    const order = chordQualities();
    const at = (quality: ChordQuality): number => order.indexOf(quality);
    expect(at('6')).toBeGreaterThan(at('augMaj7'));
    expect(at('5')).toBeGreaterThan(at('13'));
    expect(at('11')).toBeGreaterThan(at('7b13'));
    expect(at('13')).toBeGreaterThan(at('11'));
  });

  it('resolves the major and minor forms of one shape to parallel names', () => {
    expect(Chord.parse('C7add6').quality).toBe('dom7');
    expect(Chord.parse('Cm7add6').quality).toBe('min7');
  });
});

describe('the eleventh settles with the third the same way in every spelling', () => {
  it('drops the third of a dominant eleventh however it is written', () => {
    for (const symbol of ['C11', 'C11b9', 'C11#9']) {
      expect(parseChordSymbol(symbol).intervals).not.toContain(4);
    }
  });

  it('keeps the eleventh chord itself unchanged by a further tension figure', () => {
    expect(parseChordSymbol('C11').intervals).toEqual([0, 7, 10, 14, 17]);
    expect(parseChordSymbol('C11#9').intervals).toEqual([0, 7, 10, 15, 17]);
  });

  it('reads the two spellings of a major eleventh alike', () => {
    expect(parseChordSymbol('CM11').intervals).toEqual(parseChordSymbol('Cmaj11').intervals);
  });

  it('leaves a minor third and a raised eleventh alone', () => {
    expect(parseChordSymbol('Cm11').intervals).toContain(3);
    expect(parseChordSymbol('Cmaj7#11').intervals).toContain(4);
  });
});

describe('a chord names a role only for a tone it sounds', () => {
  it('gives no root to a chord that leaves its root out', () => {
    const chord = Chord.parse('C7omit1');
    expect(chord.contains(60)).toBe(false);
    expect(chord.roleOf(60)).toBeNull();
  });

  it('still names the roles the chord does sound', () => {
    const chord = Chord.parse('C7omit1');
    expect(chord.roleOf(64)).toBe('third');
    expect(chord.roleOf(67)).toBe('fifth');
    expect(chord.roleOf(70)).toBe('seventh');
  });
});

describe('a chord is built only from a quality the tables name', () => {
  it('rejects an unknown quality where the chord is made', () => {
    expect(() =>
      Chord.fromData({ rootPc: 0, quality: 'Maj7' as ChordQuality, intervals: [0, 4, 7, 11] }),
    ).toThrow(InvalidInputError);
    expect(() =>
      Chord.fromData({ rootPc: 0, quality: 'Maj7' as ChordQuality, intervals: [0, 4, 7, 11] }),
    ).toThrow(/Unknown chord quality: Maj7/);
  });
});

describe('a bass equal to the root is root position', () => {
  it('equals the same chord built with no bass', () => {
    expect(Chord.of('C', 'maj', 0).equals(Chord.of('C', 'maj'))).toBe(true);
  });

  it('serializes without the redundant bass', () => {
    expect(Chord.of('C', 'maj', 0).toJSON().bassPc).toBeUndefined();
    expect(Chord.of('C', 'maj', 0).symbol()).toBe('C');
    expect(Chord.parse('C/C').symbol()).toBe('C');
  });

  it('is reflexive under a root-position inversion', () => {
    const chord = Chord.parse('Cmaj7');
    expect(chord.invert(0).equals(chord)).toBe(true);
    expect(chord.invert(4).equals(chord)).toBe(true);
  });
});

describe('detection names a pitch-class set the same way at every transposition', () => {
  /** Sets that map onto themselves under transposition have no one root. */
  const SYMMETRIC = new Set(['0,3,6,9', '0,4,8']);
  const SETS = [
    [0, 4, 7],
    [0, 3, 7],
    [0, 4, 7, 9],
    [0, 3, 7, 10],
    [0, 4, 7, 10],
    [0, 4, 7, 11],
    [0, 3, 6, 10],
    [0, 3, 6, 9],
    [0, 4, 8],
    [0, 2, 4, 7, 9],
  ];

  it('reports the same quality, on the transposed root', () => {
    for (const set of SETS) {
      const first = detectChordBest(set, { input: 'pitchClass' });
      expect(first).not.toBeNull();
      for (let n = 1; n < 12; n += 1) {
        const moved = set.map((pc) => (pc + n) % 12);
        const best = detectChordBest(moved, { input: 'pitchClass' });
        expect(best).not.toBeNull();
        expect(best?.quality, `${set.join(',')} up ${n}`).toBe(first?.quality);
        if (!SYMMETRIC.has(set.join(','))) {
          expect(best?.rootPc, `${set.join(',')} up ${n}`).toBe(((first?.rootPc ?? 0) + n) % 12);
        }
      }
    }
  });

  it('reads a minor seventh chord as one at either transposition', () => {
    expect(detectChordBest([9, 0, 4, 7])?.quality).toBe(detectChordBest([2, 5, 9, 0])?.quality);
  });

  it('still prefers the reading with the chord root in the bass', () => {
    expect(detectChordBest([55, 59, 62, 64])).toMatchObject({ rootPc: 7, quality: '6' });
  });
});
