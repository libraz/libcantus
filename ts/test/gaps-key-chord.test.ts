import { describe, expect, it } from 'vitest';
import { explainRoman } from '../src/analyze/functional/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import { Chord, Key } from '../src/model/index.js';
import { chordScaleReport } from '../src/theory/chordscale/index.js';
import { realizeFiguredBass } from '../src/theory/figured-bass/index.js';
import {
  diatonicPitchClasses,
  majorKey,
  minorKey,
  scaleByName,
  scaleSystemOf,
  scaleTonesInDegreeOrder,
  supportsFunctionalHarmony,
} from '../src/theory/scale/index.js';
import { spellPitchClasses } from '../src/theory/spelling/index.js';

/**
 * The class methods that close the last gaps between `Key`/`Chord` and the
 * functions behind them. Each one is checked against the function it delegates
 * to on the same input, so a method that starts answering differently — a
 * dropped option, a coercion applied to the wrong argument — is caught here
 * rather than by a reader who trusted the two to agree.
 */

/** Keys spanning the three scale systems, plus a mask no built-in scale names. */
const KEYS = [
  Key.major('C'),
  Key.minor('A'),
  Key.named('dorian', 'D'),
  Key.named('harmonicMinor', 'A'),
  Key.named('majorPentatonic', 'C'),
  Key.of({ rootPc: 0, modeMask12: 0b000010000011 }),
];

describe('Key.pitchClasses', () => {
  it('answers in scale-degree order by default', () => {
    for (const key of KEYS) {
      expect(key.pitchClasses(), key.toString()).toEqual(scaleTonesInDegreeOrder(key.scale));
      expect(key.pitchClasses({}), key.toString()).toEqual(scaleTonesInDegreeOrder(key.scale));
    }
  });

  it('sorts the pitch classes when the ascending order is asked for', () => {
    for (const key of KEYS) {
      expect(key.pitchClasses({ order: 'ascending' }), key.toString()).toEqual(
        diatonicPitchClasses(key.scale),
      );
      expect(key.pitchClasses({ order: 'degree' }), key.toString()).toEqual(
        scaleTonesInDegreeOrder(key.scale),
      );
    }
  });

  it('reads the two orders apart on a scale that wraps past the octave', () => {
    const dorian = Key.named('dorian', 'D');
    expect(dorian.pitchClasses()).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(dorian.pitchClasses({ order: 'ascending' })).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('rejects an order it does not know', () => {
    expect(() => Key.major('C').pitchClasses({ order: 'sideways' as 'degree' })).toThrow(
      InvalidInputError,
    );
  });
});

describe('Key.system', () => {
  it('reads the mask the way the scale module reads it', () => {
    for (const key of KEYS) {
      expect(key.system(), key.toString()).toBe(scaleSystemOf(key.scale));
    }
    expect(Key.major('C').system()).toBe('common-practice');
    expect(Key.named('dorian', 'D').system()).toBe('modal');
    expect(Key.named('majorPentatonic', 'C').system()).toBe('non-functional');
  });

  it('reads a world scale by the Western scale that shares its mask', () => {
    // A key carries a mask, not a tradition, so maqam Hijaz reaches the class
    // as the phrygian dominant; the name-side reading stays with the function.
    expect(Key.named('hijaz', 'C').system()).toBe(scaleSystemOf(scaleByName('hijaz', 0)));
    expect(scaleSystemOf('hijaz')).toBe('non-functional');
  });

  it('has no system for a mask no built-in scale names', () => {
    // The method takes no argument, so this is its negative answer rather than
    // a rejection: a caller's own mask is named by nothing.
    const invented = Key.of({ rootPc: 0, modeMask12: 0b000010000011 });
    expect(invented.system()).toBeUndefined();
  });
});

describe('Key.supportsFunctionalHarmony', () => {
  it('agrees with the function on every system', () => {
    for (const key of KEYS) {
      expect(key.supportsFunctionalHarmony(), key.toString()).toBe(
        supportsFunctionalHarmony(key.scale),
      );
    }
    expect(Key.named('harmonicMinor', 'A').supportsFunctionalHarmony()).toBe(true);
    expect(Key.named('dorian', 'D').supportsFunctionalHarmony()).toBe(true);
    expect(Key.named('majorPentatonic', 'C').supportsFunctionalHarmony()).toBe(false);
  });

  it('leaves a mask no built-in scale names to functional analysis', () => {
    // The negative answer this method can give: unlike a named raga, an
    // unrecognized mask is analysed the way it always has been.
    expect(Key.of({ rootPc: 0, modeMask12: 0b000010000011 }).supportsFunctionalHarmony()).toBe(
      true,
    );
  });
});

describe('Key.spellPitchClasses', () => {
  const PCS = [0, 1, 3, 6, 10, 11];

  it('spells the same notes as the function, from the key own tonic', () => {
    for (const key of [Key.major('C'), Key.major('F'), Key.minor('C#'), Key.major('Db')]) {
      expect(
        key.spellPitchClasses(PCS).map((note) => note.data),
        key.toString(),
      ).toEqual(spellPitchClasses(PCS, key.tonic.data, key.scale));
    }
  });

  it('passes an explicit tonic through to the speller', () => {
    const key = Key.major('Db');
    const respelled = key.spellPitchClasses(PCS, 'C#');
    expect(respelled.map((note) => note.data)).toEqual(
      spellPitchClasses(PCS, parseNote('C#'), key.scale),
    );
    expect(respelled.map((note) => note.name)).not.toEqual(
      key.spellPitchClasses(PCS).map((note) => note.name),
    );
  });

  it('spells the chromatic neighbours of a scale tone apart', () => {
    expect(
      Key.major('F')
        .spellPitchClasses([10, 11])
        .map((note) => note.name),
    ).toEqual(['Bb', 'B']);
  });

  it('rejects a tonic that does not sound the key root', () => {
    expect(() => Key.major('Db').spellPitchClasses(PCS, 'D')).toThrow(InvalidInputError);
  });
});

describe('Chord.scaleReport', () => {
  const CHORDS = [Chord.of('C', 'maj7'), Chord.of('G', 'dom7'), Chord.parse('F#m7b5')];

  it('reports what the function reports', () => {
    for (const chord of CHORDS) {
      expect(chord.scaleReport(), chord.symbol()).toEqual(chordScaleReport(chord.data));
    }
  });

  it('passes the limit through', () => {
    const chord = Chord.of('G', 'dom7');
    expect(chord.scaleReport().length).toBeGreaterThan(1);
    expect(chord.scaleReport(1)).toEqual(chordScaleReport(chord.data, 1));
    expect(chord.scaleReport(1)).toHaveLength(1);
  });

  it('sorts the non-chord tones the way the report defines them', () => {
    const [best] = Chord.of('C', 'maj7').scaleReport(1);
    expect(best?.name).toBe('ionian');
    // The fourth may be passed through but not sounded: passing, not avoid.
    expect(best?.avoid).toEqual([]);
    expect(best?.passing).toEqual([5]);
    expect(best?.tensions).toEqual([2, 9]);
  });

  it('rejects a limit that is not a positive integer', () => {
    expect(() => Chord.of('C', 'maj7').scaleReport(0)).toThrow(RangeError);
  });
});

describe('Chord.explain', () => {
  const key = Key.major('C');

  it('explains the numeral the function explains', () => {
    for (const symbol of ['G7', 'D7', 'Am', 'Ab', 'C/E']) {
      const chord = Chord.parse(symbol);
      expect(chord.explain(key), symbol).toEqual(explainRoman(chord.data, key.scale));
    }
  });

  it('renders the numeral Chord.roman renders', () => {
    const chord = Chord.parse('G7');
    expect(chord.explain(key).roman).toBe(chord.roman(key));
    expect(chord.explain(key).rationale.length).toBeGreaterThan(0);
  });

  it('falls back to the carried key, and takes one in any key-shaped form', () => {
    const chord = Chord.parse('G7').withKey(key);
    expect(chord.explain()).toEqual(explainRoman(chord.data, key.scale));
    expect(Chord.parse('G7').explain('C major')).toEqual(chord.explain());
    expect(Chord.parse('G7').explain(majorKey(0))).toEqual(chord.explain());
  });

  it('passes the rendering options through', () => {
    const applied = Chord.parse('D7');
    expect(applied.explain(key).alternatives).toEqual([]);
    const explained = applied.explain(key, { alternatives: true });
    expect(explained).toEqual(explainRoman(applied.data, key.scale, { alternatives: true }));
    expect(explained.alternatives.length).toBeGreaterThan(0);
    expect(applied.explain(key, { applied: false }).roman).toBe(
      applied.roman(key, { applied: false }),
    );
  });

  it('rejects a chord with no key to be read in', () => {
    expect(() => Chord.parse('G7').explain()).toThrow(InvalidInputError);
  });
});

describe('Chord.fromFiguredBass', () => {
  it('builds the chord the function builds', () => {
    const cases = [
      { bass: 'B', figures: '6', key: majorKey(0) },
      { bass: 'D', figures: '43', key: majorKey(0) },
      { bass: 'G', figures: '#', key: minorKey(0) },
      { bass: 'F', figures: '', key: majorKey(0) },
    ] as const;
    for (const { bass, figures, key } of cases) {
      expect(Chord.fromFiguredBass(bass, figures, key).data, `${bass} ${figures}`).toEqual(
        Chord.fromData(realizeFiguredBass(parseNote(bass), figures, key)).data,
      );
    }
  });

  it('takes the bass and the key in every form the class API takes them', () => {
    const expected = Chord.fromFiguredBass('B', '6', majorKey(0));
    expect(Chord.fromFiguredBass(71, '6', 'C major').equals(expected)).toBe(true);
    expect(
      Chord.fromFiguredBass(Key.major('C').degree(7), '6', Key.major('C')).equals(expected),
    ).toBe(true);
  });

  it('round-trips against the figures a chord writes', () => {
    const key = Key.major('C');
    const chord = Chord.fromFiguredBass('B', '6', key);
    expect(chord.symbol()).toBe('G/B');
    expect(chord.figuredBass(key)).toBe('6');
    expect(chord.key).toBeUndefined();
    expect(chord.withKey(key).roman()).toBe('V6');
  });

  it('rejects figures that name no chord', () => {
    expect(() => Chord.fromFiguredBass('C', '54', 'C major')).toThrow(InvalidInputError);
    expect(() => Chord.fromFiguredBass('C', '54', 'C major')).toThrow(/names no chord/);
  });
});
