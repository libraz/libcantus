import { describe, expect, it } from 'vitest';
import { isLibcantusError } from '../src/core/errors/index.js';
import {
  detectNoteNameSystem,
  formatKeyName,
  formatNote,
  type Note,
  type NoteNameSystem,
  noteToPitchClass,
  parseKeyName,
  parseNote,
} from '../src/core/pitch/index.js';
import { Key } from '../src/model/index.js';

/** Every system a name can be written in, including the fixed-do alias. */
const SYSTEMS: NoteNameSystem[] = ['english', 'german', 'japanese', 'italian', 'fixedDo'];

/** The widest alteration the pitch module accepts, as `assertNote` bounds it. */
const MAX_ALTER = 6;

/** The pitch class a name denotes, which is what a naming test is really about. */
function pc(text: string, system?: NoteNameSystem): number {
  return noteToPitchClass(system === undefined ? parseNote(text) : parseNote(text, { system }));
}

describe('German note names', () => {
  it('reads H as the B natural and B as the B flat', () => {
    expect(parseNote('H', { system: 'german' })).toEqual({ letter: 6, alter: 0 });
    expect(parseNote('B', { system: 'german' })).toEqual({ letter: 6, alter: -1 });
    expect(pc('h', 'german')).toBe(11);
    expect(pc('b', 'german')).toBe(10);
  });

  it('reads -is as a sharp and -es as a flat', () => {
    expect(parseNote('fis')).toEqual({ letter: 3, alter: 1 });
    expect(parseNote('cis')).toEqual({ letter: 0, alter: 1 });
    expect(parseNote('des')).toEqual({ letter: 1, alter: -1 });
    expect(parseNote('ges')).toEqual({ letter: 4, alter: -1 });
    expect(parseNote('ces')).toEqual({ letter: 0, alter: -1 });
    expect(parseNote('his')).toEqual({ letter: 6, alter: 1 });
  });

  it('reads the elided flats es and as', () => {
    expect(parseNote('es')).toEqual({ letter: 2, alter: -1 });
    expect(parseNote('as')).toEqual({ letter: 5, alter: -1 });
    expect(pc('es')).toBe(3);
    expect(pc('as')).toBe(8);
  });

  it('reads double accidentals, including both written forms of A double flat', () => {
    expect(parseNote('fisis')).toEqual({ letter: 3, alter: 2 });
    expect(parseNote('eses')).toEqual({ letter: 2, alter: -2 });
    expect(parseNote('ceses')).toEqual({ letter: 0, alter: -2 });
    expect(parseNote('heses')).toEqual({ letter: 6, alter: -2 });
    expect(parseNote('ases')).toEqual({ letter: 5, alter: -2 });
    expect(parseNote('asas')).toEqual({ letter: 5, alter: -2 });
  });

  it('writes the elided and irregular forms back', () => {
    const german = { system: 'german' } as const;
    expect(formatNote(parseNote('Eb'), german)).toBe('es');
    expect(formatNote(parseNote('Ab'), german)).toBe('as');
    expect(formatNote(parseNote('Bb'), german)).toBe('b');
    expect(formatNote(parseNote('B'), german)).toBe('h');
    expect(formatNote(parseNote('Bbb'), german)).toBe('heses');
    expect(formatNote(parseNote('Abb'), german)).toBe('ases');
    expect(formatNote(parseNote('F##'), german)).toBe('fisis');
    expect(formatNote(parseNote('C#4'), german)).toBe('cis4');
  });

  it('ignores case, which only carries meaning in a key name', () => {
    expect(parseNote('GIS', { system: 'german' })).toEqual(parseNote('gis'));
    expect(parseNote('Es', { system: 'german' })).toEqual(parseNote('es'));
  });

  it('rejects names German does not write on the B letter', () => {
    expect(() => parseNote('bis', { system: 'german' })).toThrow(/Invalid note/);
    expect(() => parseNote('bes', { system: 'german' })).toThrow(/Invalid note/);
  });
});

describe('Japanese note names', () => {
  it('reads the katakana 音名', () => {
    const letters = ['ハ', 'ニ', 'ホ', 'ヘ', 'ト', 'イ', 'ロ'];
    expect(letters.map((text) => pc(text))).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('reads 嬰 as a sharp, 変 as a flat, and 重 as their doubling', () => {
    expect(parseNote('嬰ト')).toEqual({ letter: 4, alter: 1 });
    expect(parseNote('変ロ')).toEqual({ letter: 6, alter: -1 });
    expect(parseNote('重嬰ヘ')).toEqual({ letter: 3, alter: 2 });
    expect(parseNote('重変ホ')).toEqual({ letter: 2, alter: -2 });
    expect(pc('嬰ハ')).toBe(1);
    expect(pc('変イ')).toBe(8);
  });

  it('writes the doubled marks in their 重 form', () => {
    const japanese = { system: 'japanese' } as const;
    expect(formatNote(parseNote('G#'), japanese)).toBe('嬰ト');
    expect(formatNote(parseNote('Bb'), japanese)).toBe('変ロ');
    expect(formatNote(parseNote('F##'), japanese)).toBe('重嬰ヘ');
    expect(formatNote(parseNote('Ebb'), japanese)).toBe('重変ホ');
  });

  it('rejects marks that cancel each other out', () => {
    expect(() => parseNote('嬰変ト', { system: 'japanese' })).toThrow(/Invalid note/);
  });
});

describe('Italian and fixed-do note names', () => {
  it('reads the syllables and their accidental words', () => {
    expect(['do', 're', 'mi', 'fa', 'sol', 'la', 'si'].map((text) => pc(text))).toEqual([
      0, 2, 4, 5, 7, 9, 11,
    ]);
    expect(parseNote('sol diesis')).toEqual({ letter: 4, alter: 1 });
    expect(parseNote('si bemolle')).toEqual({ letter: 6, alter: -1 });
    expect(parseNote('do doppio diesis')).toEqual({ letter: 0, alter: 2 });
    expect(parseNote('mi doppio bemolle')).toEqual({ letter: 2, alter: -2 });
  });

  it('writes the syllables back', () => {
    const italian = { system: 'italian' } as const;
    expect(formatNote(parseNote('G#'), italian)).toBe('sol diesis');
    expect(formatNote(parseNote('Bb'), italian)).toBe('si bemolle');
    expect(formatNote(parseNote('C##'), italian)).toBe('do doppio diesis');
  });

  it('treats fixedDo as the same table under another name', () => {
    for (const text of ['C', 'G#', 'Bb', 'F##', 'Ebb']) {
      const note = parseNote(text);
      expect(formatNote(note, { system: 'fixedDo' })).toBe(formatNote(note, { system: 'italian' }));
      expect(parseNote('sol diesis', { system: 'fixedDo' })).toEqual(parseNote('G#'));
    }
  });

  it('rejects an accidental word with nothing to double', () => {
    expect(() => parseNote('do doppio', { system: 'italian' })).toThrow(/Invalid note/);
    expect(() => parseNote('do diesis bemolle', { system: 'italian' })).toThrow(/Invalid note/);
  });
});

describe('system auto-detection', () => {
  it('reads a name any two systems could claim as English', () => {
    // The rule the B/H clash forces: a bare English-looking name is English, so
    // `B` stays the B natural and German is chosen only on a German-only cue.
    expect(detectNoteNameSystem('B')).toBe('english');
    expect(pc('B')).toBe(11);
    expect(pc('B', 'german')).toBe(10);
    expect(detectNoteNameSystem('C')).toBe('english');
    expect(detectNoteNameSystem('Bb')).toBe('english');
  });

  it('chooses German on a German-only cue', () => {
    expect(detectNoteNameSystem('H')).toBe('german');
    expect(detectNoteNameSystem('fis')).toBe('german');
    expect(detectNoteNameSystem('es')).toBe('german');
    expect(detectNoteNameSystem('c moll')).toBe('german');
    expect(detectNoteNameSystem('C dur')).toBe('german');
    expect(pc('H')).toBe(11);
  });

  it('chooses Japanese and Italian by their own letters', () => {
    expect(detectNoteNameSystem('嬰ト')).toBe('japanese');
    expect(detectNoteNameSystem('嬰ト短調')).toBe('japanese');
    expect(detectNoteNameSystem('sol diesis')).toBe('italian');
    expect(detectNoteNameSystem('la minore')).toBe('italian');
  });

  it('throws rather than guess when a name mixes two systems', () => {
    // A German tonic under an English mode word: neither reading is the one
    // the writer meant, and there is no precedence rule that fits.
    let caught: unknown;
    try {
      parseKeyName('gis major');
    } catch (error) {
      caught = error;
    }
    expect(isLibcantusError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/mixes note-name systems/);
    expect((caught as Error).message).toMatch(/german/);
    expect((caught as Error).message).toMatch(/english/);
    expect(() => Key.parse('ハ moll')).toThrow(/mixes note-name systems/);
  });

  it('throws when no system reads the name', () => {
    expect(() => detectNoteNameSystem('Q')).toThrow(/no note-name system reads/);
    expect(() => parseNote('Q')).toThrow(/Invalid note/);
    expect(() => parseNote('')).toThrow(/Invalid note/);
    expect(() => detectNoteNameSystem(60 as never)).toThrow(/must be a string/);
  });

  it('rejects a system it has no table for', () => {
    expect(() => parseNote('C', { system: 'klingon' as never })).toThrow(/system must be one of/);
    expect(() => formatNote(parseNote('C'), { system: 'klingon' as never })).toThrow(
      /system must be one of/,
    );
  });
});

describe('note name round-trips', () => {
  it('writes and reads back every note the library can spell', () => {
    for (const system of SYSTEMS) {
      for (let letter = 0; letter <= 6; letter += 1) {
        for (let alter = -MAX_ALTER; alter <= MAX_ALTER; alter += 1) {
          const note: Note = { letter, alter };
          const name = formatNote(note, { system });
          expect(parseNote(name, { system }), `${system} ${name}`).toEqual(note);
        }
      }
    }
  });

  it('keeps the octave through the round-trip', () => {
    for (const system of SYSTEMS) {
      for (const octave of [-1, 0, 4, 9]) {
        for (const alter of [-2, -1, 0, 1, 2]) {
          const note: Note = { letter: 6, alter, octave };
          const name = formatNote(note, { system });
          expect(parseNote(name, { system }), `${system} ${name}`).toEqual(note);
        }
      }
    }
  });

  it('leaves English names exactly as they were', () => {
    for (const text of ['C', 'C#4', 'Bb', 'F##3', 'Ebb2', 'G-1']) {
      expect(formatNote(parseNote(text))).toBe(text);
    }
    expect(parseNote('Fx3')).toEqual({ letter: 3, alter: 2, octave: 3 });
    expect(() => parseNote('C#b4')).toThrow(/Invalid note/);
  });
});

describe('key names', () => {
  it('parses the German exercise heading verbatim', () => {
    const key = Key.parse('gis moll');
    expect(key.tonic.name).toBe('G#');
    expect(key.isMinor).toBe(true);
    expect(key.toString()).toBe('G# minor');
    expect(key.toString({ system: 'german' })).toBe('gis moll');
  });

  it('reads the mode from German case when no mode word is written', () => {
    expect(Key.parse('Gis').toString()).toBe('G# major');
    expect(Key.parse('gis').toString()).toBe('G# minor');
    expect(Key.parse('H').toString()).toBe('B major');
    expect(Key.parse('h').toString()).toBe('B minor');
  });

  it('lets an explicit mode word outrank the case it disagrees with', () => {
    // `C moll` is written all the time; the word is what the writer said.
    expect(Key.parse('C moll').toString()).toBe('C minor');
    expect(Key.parse('c dur').toString()).toBe('C major');
  });

  it('accepts the hyphenated German form', () => {
    expect(Key.parse('gis-Moll').toString()).toBe('G# minor');
    expect(Key.parse('Es-Dur').toString()).toBe('Eb major');
  });

  it('reads a German mode word as the German note table', () => {
    expect(Key.parse('B dur').toString()).toBe('Bb major');
    expect(Key.parse('B major').toString()).toBe('B major');
    expect(Key.parse('H dur').toString()).toBe('B major');
    expect(Key.parse('B', { system: 'german' }).toString()).toBe('Bb major');
    expect(Key.parse('b', { system: 'german' }).toString()).toBe('Bb minor');
  });

  it('names a bare tonic major in every system but German', () => {
    expect(Key.parse('C').toString()).toBe('C major');
    expect(Key.parse('c').toString()).toBe('C major');
    expect(Key.parse('ハ').toString()).toBe('C major');
    expect(Key.parse('do').toString()).toBe('C major');
  });

  it('parses and writes the Japanese and Italian forms', () => {
    expect(Key.parse('嬰ト短調').toString()).toBe('G# minor');
    expect(Key.parse('ハ長調').toString()).toBe('C major');
    expect(Key.parse('変ロ長調').toString()).toBe('Bb major');
    expect(Key.parse('la minore').toString()).toBe('A minor');
    expect(Key.parse('si bemolle maggiore').toString()).toBe('Bb major');
  });

  it('writes a key in every system', () => {
    const gSharpMinor = Key.minor('G#');
    expect(gSharpMinor.toString({ system: 'english' })).toBe('G# minor');
    expect(gSharpMinor.toString({ system: 'german' })).toBe('gis moll');
    expect(gSharpMinor.toString({ system: 'japanese' })).toBe('嬰ト短調');
    expect(gSharpMinor.toString({ system: 'italian' })).toBe('sol diesis minore');
    expect(gSharpMinor.toString({ system: 'fixedDo' })).toBe('sol diesis minore');
    expect(Key.major('Eb').toString({ system: 'german' })).toBe('Es dur');
    expect(Key.major('C').toString({ system: 'japanese' })).toBe('ハ長調');
  });

  it('round-trips a key through every system', () => {
    const keys = [
      Key.major('C'),
      Key.minor('G#'),
      Key.major('Eb'),
      Key.minor('Bb'),
      Key.major('B'),
    ];
    for (const system of SYSTEMS) {
      for (const key of keys) {
        const name = key.toString({ system });
        const parsed = Key.parse(name, { system });
        expect(parsed.tonic.name, name).toBe(key.tonic.name);
        expect(parsed.isMinor, name).toBe(key.isMinor);
      }
    }
  });

  it('reports the free functions and the class alike', () => {
    expect(parseKeyName('gis moll')).toEqual({ tonic: { letter: 4, alter: 1 }, mode: 'minor' });
    expect(formatKeyName({ tonic: parseNote('G#'), mode: 'minor' })).toBe('G# minor');
    expect(formatKeyName({ tonic: parseNote('G#'), mode: 'minor' }, { system: 'german' })).toBe(
      'gis moll',
    );
    expect(formatKeyName({ tonic: parseNote('Bb'), mode: 'major' }, { system: 'german' })).toBe(
      'B dur',
    );
  });

  it('rejects a key name that is not one', () => {
    expect(() => parseKeyName('Q major')).toThrow(/Invalid key name/);
    expect(() => parseKeyName('C4 major')).toThrow(/carries no octave/);
    expect(() => parseKeyName('C moll', { system: 'english' })).toThrow(/not a english key name/);
    expect(() => parseKeyName(60 as never)).toThrow(/must be a string/);
    expect(() => formatKeyName({ tonic: parseNote('C'), mode: 'lydian' as never })).toThrow(
      /key.mode must be one of/,
    );
  });

  it('names a detected scale form in English only', () => {
    // The variant qualifier is an English word; the other systems name the
    // tonic and mode alone rather than inventing one.
    const harmonic = Key.detectBest([57, 59, 60, 62, 64, 65, 68]);
    expect(harmonic?.toString()).toBe('A harmonic minor');
    expect(harmonic?.toString({ system: 'german' })).toBe('a moll');
  });
});
