import { describe, expect, it } from 'vitest';
import {
  Chord,
  InvalidInputError,
  Key,
  majorKey,
  minorKey,
  Note,
  parseChordSymbol,
  parseNote,
  toChordData,
  toKeyScale,
  toNoteData,
  toSpelledInterval,
} from '../src/index.js';

/**
 * The three coercers that let a public entry point take a note, key, or chord
 * in whatever form the caller holds it — a name, plain data, or one of the
 * model classes — and read one shape back. They exist so that reading text
 * happens in exactly these places rather than being spread over every function
 * that accepts a chord, and so the layers below the model can read a class
 * through `toJSON` without importing it.
 */

describe('toNoteData', () => {
  it('reads a note name', () => {
    expect(toNoteData('Eb4')).toEqual({ letter: 2, alter: -1, octave: 4 });
    expect(toNoteData('C')).toEqual({ letter: 0, alter: 0 });
  });

  it('reads a number as MIDI, spelled the way midiToNote spells it', () => {
    expect(toNoteData(60)).toEqual({ letter: 0, alter: 0, octave: 4 });
    // Sharps, the same side `Note.fromMidi` takes without being asked.
    expect(toNoteData(61)).toEqual({ letter: 0, alter: 1, octave: 4 });
    expect(toNoteData(61)).toEqual(Note.fromMidi(61).data);
  });

  it('reads plain note data, carrying an octave only when there is one', () => {
    expect(toNoteData({ letter: 3, alter: 1 })).toEqual({ letter: 3, alter: 1 });
    expect(toNoteData({ letter: 3, alter: 1, octave: 2 })).toEqual({
      letter: 3,
      alter: 1,
      octave: 2,
    });
  });

  it('reads a model class through its toJSON', () => {
    const note = Note.fromMidi(63, 'flat');
    expect(toNoteData(note)).toEqual(note.toJSON());
  });

  it('hands back a value the caller cannot mutate into library state', () => {
    const source = { letter: 0, alter: 0, octave: 4 };
    const coerced = toNoteData(source);
    expect(coerced).not.toBe(source);
  });

  it('agrees with the parser on every form of the same note', () => {
    for (const name of ['C', 'F#3', 'Bbb5', 'G##0']) {
      const parsed = parseNote(name);
      expect(toNoteData(name)).toEqual(parsed);
      expect(toNoteData(parsed)).toEqual(parsed);
      expect(toNoteData(Note.parse(name))).toEqual(parsed);
    }
  });

  it('refuses what is not a note', () => {
    expect(() => toNoteData('H#b')).toThrow(InvalidInputError);
    expect(() => toNoteData({ letter: 7, alter: 0 })).toThrow(RangeError);
    expect(() => toNoteData({ letter: 0, alter: 99 })).toThrow(RangeError);
    expect(() => toNoteData({ letter: 0, alter: 0, octave: 1.5 })).toThrow(RangeError);
    expect(() => toNoteData(Number.NaN)).toThrow(RangeError);
    expect(() => toNoteData(null as unknown as string)).toThrow(InvalidInputError);
    expect(() => toNoteData(true as unknown as string)).toThrow(InvalidInputError);
  });
});

describe('toKeyScale', () => {
  it('reads a key name in its natural mode', () => {
    expect(toKeyScale('C major')).toEqual(toKeyScale(majorKey(0)));
    expect(toKeyScale('A minor')).toEqual(toKeyScale(minorKey(9)));
    expect(toKeyScale('gis moll')).toEqual(toKeyScale(minorKey(8)));
    expect(toKeyScale('嬰ト短調')).toEqual(toKeyScale(minorKey(8)));
  });

  it('reads exactly the names a key field reads, and no shorthand of its own', () => {
    // The coercer delegates to `parseKeyName` rather than adding syntax, so
    // every entry point that takes a key accepts the same names — and a form
    // the parser does not know stays unknown here too.
    expect(toKeyScale('C')).toEqual(toKeyScale(majorKey(0)));
    expect(() => toKeyScale('Am')).toThrow(InvalidInputError);
  });

  it('reads plain key data', () => {
    expect(toKeyScale(majorKey(5))).toEqual(toKeyScale(majorKey(5)));
  });

  it('reads the plain form a key serializes to, not only the class itself', () => {
    // A project file holds a key as this record, so reading one back has to be
    // the same call as passing the class it was written from.
    const key = Key.named('harmonicMinor', 'Ab');
    const data = key.toJSON();
    expect(toKeyScale(data)).toEqual(toKeyScale(key));
    expect(toKeyScale(JSON.parse(JSON.stringify(key)))).toEqual(toKeyScale(key));
  });

  it('reads a model class through its toJSON', () => {
    const key = Key.minor('F#');
    expect(toKeyScale(key)).toEqual(key.scale);
  });

  it('reduces a root outside 0..11 to a pitch class', () => {
    expect(toKeyScale({ rootPc: 14, modeMask12: majorKey(0).modeMask12 }).rootPc).toBe(2);
    expect(toKeyScale({ rootPc: -1, modeMask12: majorKey(0).modeMask12 }).rootPc).toBe(11);
  });

  it('hands back a value the caller cannot mutate into library state', () => {
    const source = majorKey(0);
    expect(toKeyScale(source)).not.toBe(source);
  });

  it('refuses a mask that excludes its own root', () => {
    // Every scale contains its tonic; a mask without bit 0 names no key and
    // would otherwise degrade into wrong degrees far from here.
    expect(() => toKeyScale({ rootPc: 0, modeMask12: 0b101010110100 })).toThrow(InvalidInputError);
  });

  it('refuses what is not a key', () => {
    expect(() => toKeyScale('gis dur moll')).toThrow(InvalidInputError);
    expect(() => toKeyScale({ rootPc: 0, modeMask12: 0 })).toThrow(RangeError);
    expect(() => toKeyScale({ rootPc: Number.NaN, modeMask12: majorKey(0).modeMask12 })).toThrow(
      RangeError,
    );
    expect(() => toKeyScale(null as unknown as string)).toThrow(InvalidInputError);
    expect(() => toKeyScale(7 as unknown as string)).toThrow(InvalidInputError);
  });
});

describe('toChordData', () => {
  it('reads a chord symbol', () => {
    expect(toChordData('Cmaj7')).toEqual(parseChordSymbol('Cmaj7'));
    expect(toChordData('C/G').bassPc).toBe(7);
  });

  it('reads plain chord data', () => {
    const data = { rootPc: 0, quality: 'maj' as const, intervals: [0, 4, 7] };
    expect(toChordData(data)).toEqual(data);
  });

  it('reads a model class through its toJSON', () => {
    const chord = Chord.parse('Dm7');
    expect(toChordData(chord)).toEqual(chord.toJSON());
  });

  it('reduces root and bass to pitch classes', () => {
    const wide = toChordData({ rootPc: 25, quality: 'maj', intervals: [0, 4, 7], bassPc: 19 });
    expect(wide.rootPc).toBe(1);
    expect(wide.bassPc).toBe(7);
  });

  it('carries a spelling hint through rather than deriving or dropping one', () => {
    // The hint records how the chord is written, decided where the key was
    // known. Re-deriving it here would overrule that decision.
    const hinted = toChordData({
      rootPc: 6,
      quality: 'maj',
      intervals: [0, 4, 7],
      rootSpelling: { letter: 2, alter: -1 },
    });
    expect(hinted.rootSpelling).toEqual({ letter: 2, alter: -1 });
    expect(toChordData({ rootPc: 6, quality: 'maj', intervals: [0, 4, 7] }).rootSpelling).toBe(
      undefined,
    );
  });

  it('hands back a value the caller cannot mutate into library state', () => {
    const source = { rootPc: 0, quality: 'maj' as const, intervals: [0, 4, 7] };
    const coerced = toChordData(source);
    expect(coerced).not.toBe(source);
    expect(coerced.intervals).not.toBe(source.intervals);
  });

  it('refuses what is not a chord', () => {
    expect(() => toChordData('Cmaj7(#')).toThrow(InvalidInputError);
    expect(() => toChordData({ rootPc: Number.NaN, quality: 'maj', intervals: [0] })).toThrow(
      RangeError,
    );
    expect(() => toChordData({ rootPc: 0, quality: 'maj', intervals: [0, Number.NaN] })).toThrow(
      RangeError,
    );
    expect(() =>
      toChordData({ rootPc: 0, quality: 'maj', intervals: undefined as unknown as number[] }),
    ).toThrow(InvalidInputError);
    expect(() => toChordData(null as unknown as string)).toThrow(InvalidInputError);
    expect(() => toChordData(42 as unknown as string)).toThrow(InvalidInputError);
  });
});

describe('the coercers agree across the forms of one value', () => {
  it('reads a class, its data, and its text the same way', () => {
    const note = Note.parse('Ab3');
    expect(toNoteData(note)).toEqual(toNoteData(note.data));
    expect(toNoteData(note)).toEqual(toNoteData('Ab3'));

    const key = Key.major('Eb');
    expect(toKeyScale(key)).toEqual(toKeyScale(key.scale));
    expect(toKeyScale(key)).toEqual(toKeyScale('Eb major'));

    const chord = Chord.parse('F#m7b5');
    expect(toChordData(chord)).toEqual(toChordData(chord.data));
    expect(toChordData(chord).intervals).toEqual(toChordData('F#m7b5').intervals);
  });

  it('reads an instance the way the interval coercer already did', () => {
    // `toSpelledInterval` set the pattern these three follow: an instance is
    // read through `toJSON`, never by its type, so a value crossing a module
    // boundary is enough on its own.
    const interval = Note.parse('C4').intervalTo(Note.parse('G4'));
    expect(toSpelledInterval(interval)).toEqual(interval.toJSON());
  });
});
