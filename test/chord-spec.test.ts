import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { ChordBase, ChordSeventh, ChordSpec } from '../src/theory/chord/index.js';
import {
  chordFromSpec,
  chordPitchClasses,
  chordQualities,
  chordSpecIntervals,
  chordSpecOf,
  chordSpecQuality,
  makeChord,
} from '../src/theory/chord/index.js';
import { formatChordSymbol, parseChordSymbol } from '../src/theory/symbol/index.js';

/** A spec with the parts a caller does not care about left empty. */
function spec(parts: Partial<ChordSpec> & Pick<ChordSpec, 'base'>): ChordSpec {
  return { rootPc: 0, alterations: [], additions: [], omissions: [], ...parts };
}

describe('chordSpecIntervals', () => {
  it('derives the tones of a chord no quality name covers', () => {
    expect(
      chordSpecIntervals(
        spec({
          base: 'maj',
          seventh: 'min7',
          alterations: [
            { degree: 9, alter: -1 },
            { degree: 11, alter: 1 },
          ],
        }),
      ),
    ).toEqual([0, 4, 7, 10, 13, 18]);
  });

  it('reads an added degree as the tone it is, not as a tension', () => {
    expect(chordSpecIntervals(spec({ base: 'sus4', additions: [9] }))).toEqual([0, 5, 7, 14]);
    expect(chordSpecIntervals(spec({ base: 'maj', additions: [6, 9] }))).toEqual([0, 4, 7, 9, 14]);
  });

  it('takes a tone away where the chord omits one', () => {
    expect(chordSpecIntervals(spec({ base: 'maj', seventh: 'min7', omissions: [5] }))).toEqual([
      0, 4, 10,
    ]);
    expect(
      chordSpecIntervals(
        spec({
          base: 'maj',
          seventh: 'min7',
          alterations: [
            { degree: 9, alter: 0 },
            { degree: 11, alter: 0 },
          ],
          omissions: [3],
        }),
      ),
    ).toEqual([0, 7, 10, 14, 17]);
  });

  it('folds an altered fifth into the base that already names it', () => {
    const raised = spec({ base: 'maj', seventh: 'min7', alterations: [{ degree: 5, alter: 1 }] });
    expect(chordSpecIntervals(raised)).toEqual(
      chordSpecIntervals(spec({ base: 'aug', seventh: 'min7' })),
    );
    expect(chordSpecQuality(raised)).toBe('aug7');
    const lowered = spec({ base: 'min', alterations: [{ degree: 5, alter: -1 }] });
    expect(chordSpecQuality(lowered)).toBe('dim');
  });

  it('reads an unaltered upper degree over a seventh-less chord as an addition', () => {
    const ninth = spec({ base: 'maj', alterations: [{ degree: 9, alter: 0 }] });
    expect(chordSpecQuality(ninth)).toBe('add9');
    expect(chordSpecIntervals(ninth)).toEqual([0, 4, 7, 14]);
  });

  it('rejects a part the model does not define', () => {
    expect(() => chordFromSpec(spec({ base: 'power5' as never }))).toThrow(/chord spec base/);
    expect(() =>
      chordFromSpec(spec({ base: 'maj', alterations: [{ degree: 7 as never, alter: 0 }] })),
    ).toThrow(/alteration degree/);
    expect(() => chordFromSpec(spec({ base: 'maj', omissions: [9] }))).toThrow(/omission/);
  });
});

/**
 * The public entry points that read a caller's spec, discovered from source so
 * the sweep below cannot fall behind the module. A function is listed here when
 * its first parameter is a `ChordSpec` and the package exports it; a new one
 * fails this test until it is given a row in `SPEC_ENTRIES`.
 */
function publicSpecEntries(): string[] {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  const surface = read('src/theory/index.ts');
  const declared = ['src/theory/chord/spec.ts', 'src/theory/chord/index.ts'].flatMap((path) => [
    ...read(path).matchAll(/^export function (\w+)\(\s*spec: ChordSpec/gm),
  ]);
  return declared
    .map((match) => match[1] ?? '')
    .filter((name) => new RegExp(`\\b${name},`).test(surface))
    .sort();
}

const SPEC_ENTRIES: Record<string, (input: ChordSpec) => unknown> = {
  chordFromSpec,
  chordSpecIntervals,
  chordSpecQuality,
};

/** Specs whose fields are outside the model, each named by what is wrong. */
const MALFORMED_SPECS: [string, ChordSpec][] = [
  ['not an object at all', null as unknown as ChordSpec],
  ['a non-finite root', spec({ base: 'maj', rootPc: Number.NaN })],
  ['a non-finite slash bass', spec({ base: 'maj', bassPc: Number.POSITIVE_INFINITY })],
  ['a base no table names', spec({ base: 'bogus' as ChordBase })],
  ['a base inherited from the prototype', spec({ base: 'toString' as ChordBase })],
  ['a seventh no table names', spec({ base: 'maj', seventh: 'bogus7' as ChordSeventh })],
  ['a non-array alterations', spec({ base: 'maj', alterations: 'none' as never })],
  ['a hole in alterations', spec({ base: 'maj', alterations: [undefined as never] })],
  [
    'a degree the chord cannot alter',
    spec({ base: 'maj', alterations: [{ degree: 7, alter: 0 }] }),
  ],
  [
    'an alteration wider than a semitone',
    spec({ base: 'maj', alterations: [{ degree: 9, alter: 2 }] }),
  ],
  ['a non-array additions', spec({ base: 'maj', additions: 9 as never })],
  ['a missing additions', spec({ base: 'maj', additions: undefined as never })],
  ['a degree the chord cannot add', spec({ base: 'maj', additions: [7] })],
  ['a non-array omissions', spec({ base: 'maj', omissions: {} as never })],
  ['a missing omissions', spec({ base: 'maj', omissions: undefined as never })],
  ['a degree the chord cannot omit', spec({ base: 'maj', omissions: [9] })],
];

/** Every spec the model does define, as the parts a caller can combine. */
function validSpecs(): ChordSpec[] {
  const bases: ChordBase[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'power'];
  const sevenths: (ChordSeventh | undefined)[] = [undefined, 'maj7', 'min7', 'dim7'];
  const alterationSets: ChordSpec['alterations'][] = [
    [],
    [{ degree: 5, alter: -1 }],
    [{ degree: 5, alter: 1 }],
    [
      { degree: 9, alter: -1 },
      { degree: 11, alter: 1 },
    ],
    [
      { degree: 9, alter: 0 },
      { degree: 13, alter: 0 },
    ],
    [{ degree: 13, alter: -1 }],
  ];
  const additionSets = [[], [6], [9], [6, 9], [11, 13]];
  const omissionSets = [[], [1], [3], [5], [3, 5]];
  const out: ChordSpec[] = [];
  for (const base of bases) {
    for (const seventh of sevenths) {
      for (const alterations of alterationSets) {
        for (const additions of additionSets) {
          for (const omissions of omissionSets) {
            const built = spec({ base, alterations, additions, omissions });
            out.push(seventh === undefined ? built : { ...built, seventh });
          }
        }
      }
    }
  }
  return out;
}

describe('every public entry point that reads a spec checks it first', () => {
  it('discovers the spec-reading entry points from the package surface', () => {
    expect(publicSpecEntries()).toEqual(Object.keys(SPEC_ENTRIES).sort());
  });

  it.each(MALFORMED_SPECS)('rejects %s at every entry point', (_label, malformed) => {
    for (const [name, entry] of Object.entries(SPEC_ENTRIES)) {
      let caught: unknown;
      try {
        entry(malformed);
      } catch (error) {
        caught = error;
      }
      // Naming the failure is the point: a built-in TypeError from inside the
      // derivation is what the documented isLibcantusError pattern cannot see.
      expect(caught, `${name} accepted it`).toBeInstanceOf(InvalidInputError);
    }
  });

  it('returns finite ascending offsets and a real quality name for every spec it accepts', () => {
    const names = new Set<string>(chordQualities());
    for (const valid of validSpecs()) {
      const intervals = chordSpecIntervals(valid);
      const label = JSON.stringify(valid);
      expect(Array.isArray(intervals), label).toBe(true);
      expect(
        intervals.every((offset) => Number.isInteger(offset)),
        label,
      ).toBe(true);
      expect(
        intervals.every((offset, index) => index === 0 || offset > (intervals[index - 1] ?? 0)),
        label,
      ).toBe(true);
      expect(names.has(chordSpecQuality(valid)), label).toBe(true);
    }
  });
});

describe('the alias table', () => {
  it('gives every quality name the intervals it always had', () => {
    // The names and their templates are the library's own vocabulary, so the
    // spec model is checked against the chords it has to keep building.
    expect(makeChord(0, 'maj7').intervals).toEqual([0, 4, 7, 11]);
    expect(makeChord(0, '11').intervals).toEqual([0, 7, 10, 14, 17]);
    expect(makeChord(0, '7alt').intervals).toEqual([0, 4, 8, 10, 15]);
    expect(makeChord(0, '6/9').intervals).toEqual([0, 4, 7, 9, 14]);
    expect(makeChord(0, '5').intervals).toEqual([0, 7]);
  });

  it('reads every named chord back as the same name', () => {
    for (const quality of chordQualities()) {
      const chord = makeChord(0, quality);
      expect(chordSpecQuality(chordSpecOf(chord)), quality).toBe(quality);
    }
  });

  it('rebuilds every named chord from the spec it was read as', () => {
    for (const quality of chordQualities()) {
      const chord = makeChord(2, quality, 5);
      const rebuilt = chordFromSpec(chordSpecOf(chord));
      expect(rebuilt, quality).toEqual(chord);
    }
  });
});

describe('chordSpecOf', () => {
  it('reads a parsed chord structurally', () => {
    expect(chordSpecOf(parseChordSymbol('C7(b9,#11)'))).toMatchObject({
      rootPc: 0,
      base: 'maj',
      seventh: 'min7',
      alterations: [
        { degree: 9, alter: -1 },
        { degree: 11, alter: 1 },
      ],
    });
    expect(chordSpecOf(parseChordSymbol('Csus4(add9)'))).toMatchObject({
      base: 'sus4',
      additions: [9],
    });
  });

  it('names the tones a chord leaves out', () => {
    const chord = makeChord(0, 'dom7');
    chord.intervals = [0, 4, 10];
    expect(chordSpecOf(chord).omissions).toEqual([5]);
  });

  it('falls back to the quality when a template has no structural reading', () => {
    const chord = makeChord(0, 'maj7');
    // A cluster is not a chord this model can describe, so the name is all
    // there is left to read it by.
    chord.intervals = [0, 1, 2];
    expect(chordSpecOf(chord)).toMatchObject({ base: 'maj', seventh: 'maj7' });
  });

  it('carries the root and slash bass of the chord it read', () => {
    expect(chordSpecOf(makeChord(7, 'min7', 10))).toMatchObject({ rootPc: 7, bassPc: 10 });
  });
});

describe('bracketed tensions', () => {
  const cases: [string, number[], string][] = [
    ['Cmaj7(#11)', [0, 4, 7, 11, 18], 'Cmaj7#11'],
    ['C7(b9,#11)', [0, 4, 7, 10, 13, 18], 'C7(b9,#11)'],
    ['C7(13)', [0, 4, 7, 10, 21], 'C7(13)'],
    ['Csus4(add9)', [0, 5, 7, 14], 'Csus4(add9)'],
    ['C-Δ9', [0, 3, 7, 11, 14], 'CmMaj9'],
    ['C-∆9', [0, 3, 7, 11, 14], 'CmMaj9'],
  ];

  for (const [symbol, intervals, formatted] of cases) {
    it(`reads ${symbol}`, () => {
      const chord = parseChordSymbol(symbol);
      expect(chord.rootPc).toBe(0);
      expect(chord.intervals).toEqual(intervals);
      expect(formatChordSymbol(chord)).toBe(formatted);
      // What it writes must read back as the same chord.
      expect(parseChordSymbol(formatted).intervals).toEqual(intervals);
    });
  }

  it('reads the same chord whether the figures are bracketed or bare', () => {
    const pairs: [string, string][] = [
      ['C7(b9)', 'C7b9'],
      ['C7(#5)', 'C7#5'],
      ['Cm7(b5)', 'Cm7b5'],
      ['C(add9)', 'Cadd9'],
      ['Cmaj7(#11)', 'Cmaj7#11'],
    ];
    for (const [bracketed, bare] of pairs) {
      expect(parseChordSymbol(bracketed), bracketed).toEqual(parseChordSymbol(bare));
    }
  });

  it('reads the alternative spellings of one quality as one chord', () => {
    expect(parseChordSymbol('CmMaj9')).toEqual(parseChordSymbol('C-Δ9'));
    expect(parseChordSymbol('CM7')).toEqual(parseChordSymbol('Cmaj7'));
    expect(parseChordSymbol('CΔ')).toEqual(parseChordSymbol('Cmaj7'));
    expect(parseChordSymbol('Calt')).toEqual(parseChordSymbol('C7alt'));
  });

  it('still refuses text that names no chord', () => {
    for (const symbol of ['Cfoo', 'Cmaj7(', 'Cmaj7(#11', 'C7(zz)', 'C7((9))', 'Es']) {
      expect(() => parseChordSymbol(symbol), symbol).toThrow(/chord/);
    }
  });

  it('reports the nearest quality name for a chord no name covers', () => {
    // Nothing is lost by it: the tones and the spec still carry the alterations,
    // and the symbol is written from those rather than from this name.
    expect(parseChordSymbol('C7(b9,#11)').quality).toBe('7b9');
    expect(parseChordSymbol('C7(13)').quality).toBe('dom7');
    expect(parseChordSymbol('Csus4(add9)').quality).toBe('sus4');
    expect(parseChordSymbol('C7(b9,#11)').intervals).toEqual([0, 4, 7, 10, 13, 18]);
  });

  it('sounds every tone the figures name', () => {
    expect(chordPitchClasses(parseChordSymbol('C7(b9,#11)'))).toEqual([0, 1, 4, 6, 7, 10]);
    expect(chordPitchClasses(parseChordSymbol('C7(13)'))).toEqual([0, 4, 7, 9, 10]);
  });
});

describe('symbol round-trip through the spec', () => {
  it('writes and reads back every quality name, with and without a bass', () => {
    for (const quality of chordQualities()) {
      for (const bassPc of [undefined, 4]) {
        const symbol = formatChordSymbol(makeChord(0, quality, bassPc));
        const reparsed = parseChordSymbol(symbol);
        expect(reparsed.quality, symbol).toBe(quality);
        expect(reparsed.intervals, symbol).toEqual(makeChord(0, quality).intervals);
        expect(reparsed.bassPc, symbol).toBe(bassPc);
        expect(formatChordSymbol(reparsed), symbol).toBe(symbol);
      }
    }
  });

  it('writes a chord built from a spec so it reads back as itself', () => {
    const built = chordFromSpec(
      spec({
        base: 'min',
        seventh: 'min7',
        alterations: [
          { degree: 9, alter: 0 },
          { degree: 11, alter: 1 },
        ],
      }),
    );
    const symbol = formatChordSymbol(built);
    expect(symbol).toBe('Cm9(#11)');
    expect(parseChordSymbol(symbol).intervals).toEqual(built.intervals);
  });

  it('writes the harmony rather than the omission', () => {
    // A symbol that spelled out its own omissions would not read as a chart's:
    // a fifth-less dominant is still written as one.
    const chord = parseChordSymbol('Ab7');
    chord.intervals = [0, 4, 10];
    expect(formatChordSymbol(chord)).toBe('Ab7');
  });
});
