import {
  analyzeChord,
  augmentedSixthKind,
  borrowedSource,
  Chord,
  chordToRoman,
  detectModulations,
  formatChordSymbol,
  functionOf,
  Key,
  modalInterchangePalette,
  Progression,
  pivotChords,
  resolveKey,
  romanToChord,
  substituteChord,
} from '@libraz/libcantus';
import { describe, expect, it } from 'vitest';

/** Keys written on the side of the circle their pitch classes do not read as. */
const RESPELLED_KEYS = ['Ab minor', 'Cb major', 'C# major', 'G# major'] as const;

/** Numerals covering diatonic, chromatic and altered predominant chords. */
const NUMERALS = ['I', 'ii', 'IV', 'V7', 'vi', 'bII', 'It6', 'Fr6', 'Ger6'] as const;

/** Each spelled key in the three forms a caller may hold it in. */
function keyForms(name: string): unknown[] {
  const resolved = resolveKey(name);
  return [name, Key.parse(name), { ...resolved.scale, tonic: resolved.tonic }];
}

describe('function and numbering read the key as written', () => {
  it('reads an augmented sixth of a respelled key as a predominant', () => {
    const chord = romanToChord('Ger6', 'Ab minor');
    expect(augmentedSixthKind(chord, 'Ab minor')).toBe('german');
    expect(functionOf(chord, 'Ab minor')).toBe('subdominant');
    expect(analyzeChord(chord, 'Ab minor').roman).toBe('Ger6');
    expect(analyzeChord(chord, 'Ab minor').function).toBe('subdominant');
  });

  it('gives analyzeChord the numeral chordToRoman gives, in every key form', () => {
    for (const name of RESPELLED_KEYS) {
      for (const numeral of NUMERALS) {
        const chord = romanToChord(numeral, name);
        for (const key of keyForms(name)) {
          const analysis = analyzeChord(chord, key as string);
          expect(analysis.roman).toBe(chordToRoman(chord, name));
          expect(analysis.function).toBe(functionOf(chord, name));
          if (augmentedSixthKind(chord, name) !== null) {
            expect(analysis.function).toBe('subdominant');
          }
        }
      }
    }
  });
});

describe('pivot chords number against the target key as written', () => {
  it('reads the shared chords of a respelled target key on its own letters', () => {
    const into = (from: string, to: string) =>
      pivotChords(from, to).map((pivot) => `${pivot.romanFrom}=${pivot.romanTo}`);
    expect(into('Cb major', 'Ab minor')).toContain('viio=iio');
    expect(into('C# major', 'G# major')).toEqual(expect.arrayContaining(['I=IV', 'V=I']));
    for (const from of RESPELLED_KEYS) {
      for (const to of RESPELLED_KEYS) {
        for (const pivot of pivotChords(from, to)) {
          expect(pivot.romanTo).toBe(chordToRoman(pivot.chord, to));
        }
      }
    }
  });

  it('reads a key class pivot the same way', () => {
    const pivots = Key.parse('Cb major').pivotsTo('Ab minor');
    expect(pivots.map((pivot) => pivot.romanTo)).toContain('iio');
  });
});

describe('reharmonization numbers its proposals in the key it was asked for', () => {
  it('reports the numeral and function chordToRoman and functionOf give', () => {
    for (const name of RESPELLED_KEYS) {
      for (const numeral of ['I', 'V7', 'IV', 'vi']) {
        for (const sub of substituteChord(romanToChord(numeral, name), name)) {
          expect(sub.roman).toBe(chordToRoman(sub.chord, name));
          expect(sub.function).toBe(functionOf(sub.chord, name));
        }
      }
    }
  });

  it('numbers and classifies the borrowed palette against the written key', () => {
    for (const name of RESPELLED_KEYS) {
      for (const borrowed of modalInterchangePalette(name)) {
        expect(borrowed.roman).toBe(chordToRoman(borrowed.chord, name));
        expect(borrowed.source).toBe(borrowedSource(borrowed.chord, name));
      }
    }
    const cSharp = modalInterchangePalette('C# major').map((borrowed) => borrowed.roman);
    expect(cSharp).toEqual(expect.arrayContaining(['i', 'bIII', 'bVI']));
  });
});

describe('a model chord reads an explicitly passed key on its own letters', () => {
  const cases = [
    { chord: Chord.of(8, 'maj').withKey(Key.major('E')), key: Key.major('Ab') },
    { chord: Chord.of(1, 'maj').withKey(Key.major('A')).invert(1), key: Key.minor('C') },
    { chord: Chord.of(6, 'dom7').withKey(Key.major('Db')), key: Key.major('B') },
  ];

  it('answers as the chord re-keyed and as the chord restored from JSON', () => {
    for (const { chord, key } of cases) {
      const rekeyed = chord.withKey(key);
      const restored = Chord.fromJSON(chord.toJSON());
      for (const other of [rekeyed, restored]) {
        const explicit = other === rekeyed ? undefined : key;
        expect(chord.roman(key)).toBe(other.roman(explicit));
        expect(chord.function(key)).toBe(other.function(explicit));
        expect(chord.analyze(key)).toEqual(other.analyze(explicit));
        expect(chord.borrowedSource(key)).toBe(other.borrowedSource(explicit));
        expect(chord.substitutions(key)).toEqual(other.substitutions(explicit));
      }
    }
    expect(cases[0]?.chord.roman(Key.major('Ab'))).toBe('I');
  });

  it('reads a progression of such chords the same way', () => {
    const progression = Progression.of(cases.map(({ chord }) => chord));
    const key = Key.major('Ab');
    expect(progression.roman(key)).toEqual(cases.map(({ chord }) => chord.withKey(key).roman()));
    expect(progression.analyze(key).chords).toEqual(progression.withKey(key).analyze().chords);
  });
});

describe('a chord built from a key keeps its key spelling', () => {
  it('formats through the free function as it prints', () => {
    const built = [
      [Key.major('Db').diatonicSeventh(5), 'Ab7'],
      [Key.major('Cb').chord(2), 'Dbm'],
      [Key.minor('Ab').diatonicTriad(7), 'Gb'],
    ] as const;
    for (const [chord, symbol] of built) {
      expect(chord.toString()).toBe(symbol);
      expect(formatChordSymbol(chord)).toBe(symbol);
    }
    const leading = Key.major('C#').diatonicTriad(7);
    expect(formatChordSymbol(leading)).toBe(leading.toString());
    expect(leading.toString().startsWith('B#')).toBe(true);
  });

  it('serializes a degree chord and its numeral alike through free functions', () => {
    const key = Key.major('Db');
    expect(formatChordSymbol(key.roman('V7'))).toBe(formatChordSymbol(key.diatonicSeventh(5)));
  });
});

describe('a progression keeps each chord its own key through JSON', () => {
  it('round-trips a keyless progression of chords in different keys', () => {
    const progression = Progression.of([
      Chord.of(1, 'maj').withKey(Key.major('Db')),
      Chord.of(6, 'maj').withKey(Key.major('C#')),
      Chord.of(7, 'maj'),
    ]);
    expect(progression.toString()).toBe('Db F# G');
    const restored = Progression.fromJSON(JSON.parse(JSON.stringify(progression)));
    expect(restored.toString()).toBe(progression.toString());
    expect(restored.equals(progression)).toBe(true);
    expect(restored.chords.map((chord) => chord.key?.toString())).toEqual(
      progression.chords.map((chord) => chord.key?.toString()),
    );
  });

  it('writes no per-chord keys when the progression carries one', () => {
    const progression = Progression.of([Chord.of(1, 'maj')], Key.major('Db'));
    expect(progression.toJSON().chordKeys).toBeUndefined();
    expect(Progression.of([Chord.of(1, 'maj')]).toJSON().chordKeys).toBeUndefined();
  });

  it('refuses per-chord keys that do not line up with the chords', () => {
    const data = Progression.of([Chord.of(1, 'maj').withKey(Key.major('Db'))]).toJSON();
    expect(() => Progression.fromJSON({ ...data, chordKeys: [] })).toThrow(
      'progression chord keys must hold one entry per chord (1); received 0',
    );
  });
});

describe('detectModulations ends at the last chord before beat 0', () => {
  it('does not stretch the region of a pickup-only chart to beat 0', () => {
    const chord = romanToChord('I', 'C major');
    const regions = detectModulations([{ startBeat: -2, endBeat: -1, chord }]);
    expect(regions.at(-1)?.endBeat).toBe(-1);
  });
});
