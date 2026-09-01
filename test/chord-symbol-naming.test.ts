import { describe, expect, it } from 'vitest';
import type { NoteNameSystem } from '../src/core/pitch/index.js';
import { Chord } from '../src/model/index.js';
import { type ChordQuality, chordQualities, makeChord } from '../src/theory/chord/index.js';
import {
  formatChordSymbol,
  parseChordSymbol,
  transposeChordSymbol,
} from '../src/theory/symbol/index.js';

/** Every system a symbol can be written in, including the fixed-do alias. */
const SYSTEMS: NoteNameSystem[] = ['english', 'german', 'japanese', 'italian', 'fixedDo'];

/** The reading a symbol must have: root, quality, and any slash bass. */
type Reading = { rootPc: number; quality: ChordQuality; bassPc?: number };

describe('German chord symbols', () => {
  it('reads H as the B natural and B as the B flat', () => {
    expect(parseChordSymbol('H7', { system: 'german' })).toMatchObject({
      rootPc: 11,
      quality: 'dom7',
    });
    expect(parseChordSymbol('B', { system: 'german' })).toMatchObject({
      rootPc: 10,
      quality: 'maj',
    });
    expect(parseChordSymbol('Hm7b5', { system: 'german' })).toMatchObject({
      rootPc: 11,
      quality: 'm7b5',
    });
  });

  it('reads the elided and -is affixed roots', () => {
    expect(parseChordSymbol('Es', { system: 'german' })).toMatchObject({
      rootPc: 3,
      quality: 'maj',
    });
    expect(parseChordSymbol('As7', { system: 'german' })).toMatchObject({
      rootPc: 8,
      quality: 'dom7',
    });
    expect(parseChordSymbol('Fis', { system: 'german' })).toMatchObject({
      rootPc: 6,
      quality: 'maj',
    });
    expect(parseChordSymbol('Cism7', { system: 'german' })).toMatchObject({
      rootPc: 1,
      quality: 'min7',
    });
  });

  it('reads a slash bass in the same system as the root', () => {
    const chord = parseChordSymbol('Ges/B', { system: 'german' });
    expect(chord).toMatchObject({ rootPc: 6, quality: 'maj', bassPc: 10 });
    expect(chord.rootSpelling).toEqual({ letter: 4, alter: -1 });
    expect(chord.bassSpelling).toEqual({ letter: 6, alter: -1 });
    expect(formatChordSymbol(chord)).toBe('Gb/Bb');
  });

  it('takes the longest root that leaves a quality behind', () => {
    // `As` is the A flat and `sus4` a quality, so both readings of `Asus4` are
    // spellable; only one of them leaves a suffix this module knows.
    expect(parseChordSymbol('Asus4', { system: 'german' })).toMatchObject({
      rootPc: 9,
      quality: 'sus4',
    });
    expect(parseChordSymbol('Assus4', { system: 'german' })).toMatchObject({
      rootPc: 8,
      quality: 'sus4',
    });
    expect(parseChordSymbol('Esus2', { system: 'german' })).toMatchObject({
      rootPc: 4,
      quality: 'sus2',
    });
    expect(parseChordSymbol('Essus2', { system: 'german' })).toMatchObject({
      rootPc: 3,
      quality: 'sus2',
    });
  });

  it('ignores the case of the root, which only the quality suffix decides', () => {
    expect(parseChordSymbol('fism7', { system: 'german' })).toEqual(
      parseChordSymbol('Fism7', { system: 'german' }),
    );
    expect(parseChordSymbol('h', { system: 'german' })).toEqual(
      parseChordSymbol('H', { system: 'german' }),
    );
  });

  it('writes the root capitalized, the way a chart does', () => {
    const german = { system: 'german' } as const;
    expect(formatChordSymbol(parseChordSymbol('B7'), german)).toBe('H7');
    expect(formatChordSymbol(parseChordSymbol('Bb'), german)).toBe('B');
    expect(formatChordSymbol(parseChordSymbol('Eb'), german)).toBe('Es');
    expect(formatChordSymbol(parseChordSymbol('Ab7'), german)).toBe('As7');
    expect(formatChordSymbol(parseChordSymbol('F#m7'), german)).toBe('Fism7');
    expect(formatChordSymbol(parseChordSymbol('Gb/Bb'), german)).toBe('Ges/B');
  });

  it('transposes a symbol inside its own system', () => {
    const german = { system: 'german' } as const;
    expect(transposeChordSymbol('H7', 1, german)).toBe('C7');
    expect(transposeChordSymbol('Ges/B', 0, german)).toBe('Ges/B');
    expect(transposeChordSymbol('B', 2, german)).toBe('C');
  });
});

describe('the other notation systems', () => {
  it('reads and writes Japanese roots', () => {
    expect(parseChordSymbol('嬰ハm7', { system: 'japanese' })).toMatchObject({
      rootPc: 1,
      quality: 'min7',
    });
    expect(formatChordSymbol(parseChordSymbol('Bb7'), { system: 'japanese' })).toBe('変ロ7');
    expect(formatChordSymbol(parseChordSymbol('C/G'), { system: 'japanese' })).toBe('ハ/ト');
  });

  it('reads and writes Italian and fixed-do roots', () => {
    expect(parseChordSymbol('si bemolle7', { system: 'italian' })).toMatchObject({
      rootPc: 10,
      quality: 'dom7',
    });
    expect(formatChordSymbol(parseChordSymbol('G#m7'), { system: 'italian' })).toBe('sol diesism7');
    expect(parseChordSymbol('la6/9/do', { system: 'fixedDo' })).toMatchObject({
      rootPc: 9,
      quality: '6/9',
      bassPc: 0,
    });
  });

  it('rejects a system it has no table for', () => {
    expect(() => parseChordSymbol('C', { system: 'klingon' as never })).toThrow(
      /system must be one of/,
    );
    expect(() => formatChordSymbol(makeChord(0, 'maj'), { system: 'klingon' as never })).toThrow(
      /system must be one of/,
    );
  });
});

describe('a chord symbol never guesses its system', () => {
  it('reads B as the B natural and refuses H without a system', () => {
    expect(parseChordSymbol('B').rootPc).toBe(11);
    expect(parseChordSymbol('B', { system: 'english' }).rootPc).toBe(11);
    expect(parseChordSymbol('B', { system: 'german' }).rootPc).toBe(10);
    expect(() => parseChordSymbol('H')).toThrow(/Invalid chord symbol/);
    expect(() => parseChordSymbol('H7')).toThrow(/Invalid chord symbol/);
    expect(() => parseChordSymbol('Es')).toThrow(/Unrecognized chord quality/);
  });

  it('writes English when no system is named', () => {
    expect(formatChordSymbol(parseChordSymbol('B7'))).toBe('B7');
    expect(formatChordSymbol(parseChordSymbol('B7'), { system: 'english' })).toBe('B7');
  });
});

describe('the English default is unchanged', () => {
  /** Every symbol the chord-symbol suite parses, with the reading it must keep. */
  const READINGS: [string, Reading][] = [
    ['Cmaj', { rootPc: 0, quality: 'maj' }],
    ['C#m7', { rootPc: 1, quality: 'min7' }],
    ['C♯m7', { rootPc: 1, quality: 'min7' }],
    ['Db/Ab', { rootPc: 1, quality: 'maj', bassPc: 8 }],
    ['D♭/A♭', { rootPc: 1, quality: 'maj', bassPc: 8 }],
    ['Cxm7', { rootPc: 2, quality: 'min7' }],
    ['C/F𝄪', { rootPc: 0, quality: 'maj', bassPc: 7 }],
    ['BbmMaj9', { rootPc: 10, quality: 'minMaj9' }],
    ['BbmMaj11', { rootPc: 10, quality: 'minMaj11' }],
    ['BbmMaj13', { rootPc: 10, quality: 'minMaj13' }],
    ['Cmaj7', { rootPc: 0, quality: 'maj7' }],
    ['F#m7b5', { rootPc: 6, quality: 'm7b5' }],
    ['Bb7', { rootPc: 10, quality: 'dom7' }],
    ['C/G', { rootPc: 0, quality: 'maj', bassPc: 7 }],
    ['C6/9', { rootPc: 0, quality: '6/9' }],
    ['A-', { rootPc: 9, quality: 'min' }],
    ['G7#11', { rootPc: 7, quality: '7#11' }],
    ['C6/9/E', { rootPc: 0, quality: '6/9', bassPc: 4 }],
    ['cmaj7', { rootPc: 0, quality: 'maj7' }],
    ['f#m7b5', { rootPc: 6, quality: 'm7b5' }],
    ['bb7', { rootPc: 10, quality: 'dom7' }],
    ['c/g', { rootPc: 0, quality: 'maj', bassPc: 7 }],
    ['Ab/C', { rootPc: 8, quality: 'maj', bassPc: 0 }],
    ['G7sus4', { rootPc: 7, quality: '7sus4' }],
    ['G7sus', { rootPc: 7, quality: '7sus4' }],
    ['G9sus4', { rootPc: 7, quality: '11' }],
    ['C7b5', { rootPc: 0, quality: '7b5' }],
    ['G7alt', { rootPc: 7, quality: '7alt' }],
    ['Galt', { rootPc: 7, quality: '7alt' }],
    ['G13b9', { rootPc: 7, quality: '13b9' }],
    ['Am11', { rootPc: 9, quality: 'min11' }],
    ['Am13', { rootPc: 9, quality: 'min13' }],
    ['Cmaj13', { rootPc: 0, quality: 'maj13' }],
    ['Cmaj7#11', { rootPc: 0, quality: 'maj7#11' }],
    ['Cmadd9', { rootPc: 0, quality: 'minAdd9' }],
    ['Cm6/9', { rootPc: 0, quality: 'min6/9' }],
    ['C6add9', { rootPc: 0, quality: '6/9' }],
    ['Ao', { rootPc: 9, quality: 'dim' }],
    ['Ao7', { rootPc: 9, quality: 'dim7' }],
    ['Ah7', { rootPc: 9, quality: 'm7b5' }],
    ['A°7', { rootPc: 9, quality: 'dim7' }],
    ['Aø7', { rootPc: 9, quality: 'm7b5' }],
  ];

  /** Symbols the suite pins as writing themselves back unaltered. */
  const STABLE = [
    'Cmaj7',
    'Cm7',
    'C7',
    'Cdim7',
    'Cm7b5',
    'Csus4',
    'C6/9',
    'Caug',
    'C/G',
    'F#m7b5',
    'G7',
    'Dm7b5',
    'Bbmaj7',
    'Ebm7',
    'Ab7',
    'Dbm7b5',
    'Gbmaj7',
    'Ab/C',
    'Eb7/Db',
    'Bbm7/Ab',
    'C6/9/E',
    'Bb6/9/D',
  ];

  it.each(READINGS)('reads %s exactly as it did', (symbol, reading) => {
    expect(parseChordSymbol(symbol)).toMatchObject(reading);
    // Naming the default system explicitly must not change a single reading.
    expect(parseChordSymbol(symbol, { system: 'english' })).toEqual(parseChordSymbol(symbol));
  });

  it.each(STABLE)('writes %s back byte for byte', (symbol) => {
    const chord = parseChordSymbol(symbol);
    expect(formatChordSymbol(chord)).toBe(symbol);
    expect(formatChordSymbol(chord, { system: 'english' })).toBe(symbol);
  });

  it('keeps the flat preference and its overrides', () => {
    expect(formatChordSymbol(parseChordSymbol('F#m7'), { flats: true })).toBe('Gbm7');
    expect(formatChordSymbol(parseChordSymbol('Bb7'), { flats: false })).toBe('A#7');
    expect(formatChordSymbol(parseChordSymbol('bbm7'))).toBe('Bbm7');
    expect(formatChordSymbol(makeChord(0, '6/9', 4))).toBe('C6/9/E');
    expect(transposeChordSymbol('C/G', 5, { flats: true })).toBe('F/C');
    expect(transposeChordSymbol('Cmaj7', 2)).toBe('Dmaj7');
  });

  it('writes and reads back the whole vocabulary as before', () => {
    for (const quality of chordQualities()) {
      for (const bassPc of [undefined, 4]) {
        const symbol = formatChordSymbol(makeChord(0, quality, bassPc));
        const parsed = parseChordSymbol(symbol);
        expect(parsed, symbol).toEqual(parseChordSymbol(symbol, { system: 'english' }));
        expect(formatChordSymbol(parsed), symbol).toBe(symbol);
      }
    }
  });
});

describe('chord symbol round-trips', () => {
  const symbols = [
    'C',
    'Cm7',
    'Bb7',
    'B7',
    'F#m7b5',
    'Eb/Bb',
    'Absus4',
    'Asus4',
    'C6/9/E',
    'Gb/Bb',
    'Cmaj7#11',
  ];

  it.each(SYSTEMS)('writes and reads back every symbol in %s', (system) => {
    for (const symbol of symbols) {
      const chord = parseChordSymbol(symbol);
      const written = formatChordSymbol(chord, { system });
      expect(parseChordSymbol(written, { system }), `${system} ${written}`).toEqual(chord);
      // Writing what was just read must reproduce the same text, not merely a
      // symbol that happens to parse back.
      expect(formatChordSymbol(parseChordSymbol(written, { system }), { system })).toBe(written);
    }
  });

  it('names the same chord in every system', () => {
    const chord = parseChordSymbol('Bb7');
    expect(formatChordSymbol(chord)).toBe('Bb7');
    expect(formatChordSymbol(chord, { system: 'german' })).toBe('B7');
    expect(formatChordSymbol(chord, { system: 'japanese' })).toBe('変ロ7');
    expect(formatChordSymbol(chord, { system: 'italian' })).toBe('si bemolle7');
    expect(formatChordSymbol(chord, { system: 'fixedDo' })).toBe('si bemolle7');
  });
});

describe('the class API threads the system through', () => {
  it('parses and writes a German symbol', () => {
    const german = { system: 'german' } as const;
    expect(Chord.parse('H7', german).symbol()).toBe('B7');
    expect(Chord.parse('H7', german).symbol(german)).toBe('H7');
    expect(Chord.parse('B', german).rootPc).toBe(10);
    expect(Chord.parse('B').rootPc).toBe(11);
    expect(Chord.parse('Ges/B', german).symbol(german)).toBe('Ges/B');
  });

  it('keeps the transposed spelling in the system it was written in', () => {
    const german = { system: 'german' } as const;
    expect(Chord.parse('Es', german).transpose(2).symbol(german)).toBe('F');
    expect(Chord.parse('Es', german).secondaryDominant().symbol(german)).toBe('B7');
  });
});

describe('a transposed chord names a root a chart writes', () => {
  it('respells rather than walking the letters off the vocabulary', () => {
    expect(Chord.parse('Ab').transpose(1).symbol()).toBe('A');
    expect(Chord.parse('Bbmaj7').transpose(1).symbol()).toBe('Bmaj7');
    expect(Chord.parse('Ab/Eb').transpose(1).symbol()).toBe('A/E');
    expect(Chord.parse('C#').transpose(11).symbol()).toBe('C');
  });

  it('sounds the transposed pitch classes it names', () => {
    for (const text of ['Bbmaj7', 'Ab/Eb', 'Db', 'Eb7', 'C#m7']) {
      const source = Chord.parse(text);
      for (let semitones = -11; semitones <= 11; semitones += 1) {
        const moved = Chord.parse(source.transpose(semitones).symbol());
        const label = `${text} ${semitones}`;
        expect(moved.rootPc, label).toBe((source.rootPc + semitones + 24) % 12);
        expect([...moved.pitchClasses()].sort(), label).toEqual(
          source
            .pitchClasses()
            .map((pc) => (pc + semitones + 24) % 12)
            .sort(),
        );
      }
    }
  });

  it('moves the tone spellings with the root it respelled', () => {
    const chord = Chord.fromJSON({
      ...Chord.parse('Bb').toJSON(),
      toneSpellings: [
        { letter: 6, alter: -1 },
        { letter: 1, alter: 0 },
        { letter: 3, alter: 0 },
      ],
    });
    const moved = chord.transpose(1).toJSON();
    // The root reads B, so the tones have to read B D# F# rather than staying
    // on the letters a C flat root would have taken.
    expect(moved.rootSpelling).toEqual({ letter: 6, alter: 0 });
    expect(moved.toneSpellings).toEqual([
      { letter: 6, alter: 0 },
      { letter: 1, alter: 1 },
      { letter: 3, alter: 1 },
    ]);
  });

  it('leaves a whole-octave transposition spelled as it was', () => {
    for (const semitones of [-12, 0, 12]) {
      expect(Chord.parse('Cb').transpose(semitones).symbol(), `${semitones}`).toBe('Cb');
    }
  });

  it('still spells by the interval when one is named', () => {
    // The interval form picks letters from the diatonic number, so it keeps
    // the distinction between an augmented fourth and a diminished fifth.
    expect(Chord.parse('C').transposeBy('A4').symbol()).toBe('F#');
    expect(Chord.parse('C').transposeBy('d5').symbol()).toBe('Gb');
  });
});
