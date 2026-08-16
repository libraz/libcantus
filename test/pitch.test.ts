import { describe, expect, it } from 'vitest';
import type { Note, SpelledInterval } from '../src/core/pitch/index.js';
import {
  formatNote,
  intervalSemitones,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseInterval,
  parseNote,
  spelledInterval,
  toSpelledInterval,
  transposeByInterval,
  transposeNote,
} from '../src/core/pitch/index.js';

describe('parseNote / formatNote', () => {
  it('round-trips common spellings', () => {
    for (const text of ['C', 'C#4', 'Bb', 'F##3', 'Ebb2', 'G-1']) {
      expect(formatNote(parseNote(text))).toBe(text);
    }
  });

  it('parses double sharps written with x', () => {
    expect(parseNote('Fx3')).toEqual({ letter: 3, alter: 2, octave: 3 });
  });

  it('rejects invalid text', () => {
    // 'H' is no longer among these: it is the German B natural, which
    // `parseNote` reads once a name can be written in another system.
    expect(() => parseNote('Q')).toThrow();
    expect(() => parseNote('')).toThrow();
    expect(() => parseNote(60 as never)).toThrow(/note must be a string/);
  });

  it('rejects contradictory mixed accidentals but allows same-direction stacks', () => {
    expect(() => parseNote('C#b4')).toThrow();
    expect(() => parseNote('Bb#')).toThrow();
    expect(() => parseNote('Cxb')).toThrow();
    expect(parseNote('C##4')).toEqual({ letter: 0, alter: 2, octave: 4 });
    expect(parseNote('Ebb2')).toEqual({ letter: 2, alter: -2, octave: 2 });
  });
});

describe('pitch-class and MIDI conversion', () => {
  it('distinguishes enharmonics in spelling but shares a pitch class', () => {
    expect(noteToPitchClass(parseNote('G#'))).toBe(8);
    expect(noteToPitchClass(parseNote('Ab'))).toBe(8);
  });

  it('places middle C at MIDI 60', () => {
    expect(noteToMidi(parseNote('C4'))).toBe(60);
    expect(noteToMidi(parseNote('A4'))).toBe(69);
  });

  it('names MIDI numbers with the requested spelling', () => {
    expect(formatNote(midiToNote(61, 'sharp'))).toBe('C#4');
    expect(formatNote(midiToNote(61, 'flat'))).toBe('Db4');
    expect(formatNote(midiToNote(60))).toBe('C4');
  });

  it('requires an octave for MIDI conversion', () => {
    expect(() => noteToMidi(parseNote('C'))).toThrow();
  });

  it('names the MIDI range boundaries', () => {
    expect(formatNote(midiToNote(0))).toBe('C-1');
    expect(formatNote(midiToNote(127))).toBe('G9');
    expect(noteToMidi(midiToNote(0))).toBe(0);
    expect(noteToMidi(midiToNote(127))).toBe(127);
  });

  it('extrapolates out-of-range MIDI numbers without clamping, staying invertible', () => {
    // Negative and >127 inputs are not clamped; they extend the octave grid and
    // remain an exact inverse of noteToMidi.
    expect(formatNote(midiToNote(-1))).toBe('B-2');
    expect(formatNote(midiToNote(128))).toBe('G#9');
    for (const midi of [-12, -1, 128, 200]) {
      expect(noteToMidi(midiToNote(midi))).toBe(midi);
    }
  });

  it('rounds fractional MIDI numbers to the nearest integer', () => {
    expect(noteToMidi(midiToNote(60.4))).toBe(60);
    expect(noteToMidi(midiToNote(60.6))).toBe(61);
  });
});

describe('chromatic transposition', () => {
  it('restores spelling and octave after an inverse transposition', () => {
    for (const name of ['C4', 'D4', 'G#4', 'Bb3']) {
      for (const semitones of [-19, -12, -6, -1, 0, 1, 6, 12, 19]) {
        const moved = transposeNote(parseNote(name), semitones);
        expect(formatNote(transposeNote(moved, -semitones)), `${name} / ${semitones}`).toBe(name);
      }
    }
  });
});

describe('spelledInterval', () => {
  it('distinguishes augmented fourth from diminished fifth', () => {
    const aug4 = spelledInterval(parseNote('C4'), parseNote('F#4'));
    expect(aug4).toMatchObject({ number: 4, quality: 'A', semitones: 6 });
    const dim5 = spelledInterval(parseNote('C4'), parseNote('Gb4'));
    expect(dim5).toMatchObject({ number: 5, quality: 'd', semitones: 6 });
  });

  it('names common intervals', () => {
    expect(spelledInterval(parseNote('C4'), parseNote('E4'))).toMatchObject({
      number: 3,
      quality: 'M',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('Eb4'))).toMatchObject({
      number: 3,
      quality: 'm',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('G4'))).toMatchObject({
      number: 5,
      quality: 'P',
    });
    expect(spelledInterval(parseNote('C4'), parseNote('C5'))).toMatchObject({
      number: 8,
      quality: 'P',
      semitones: 12,
    });
  });

  it('detects the augmented second in harmonic minor', () => {
    const aug2 = spelledInterval(parseNote('Ab4'), parseNote('B4'));
    expect(aug2).toMatchObject({ number: 2, quality: 'A', semitones: 3 });
  });

  it('carries a sign for descending intervals', () => {
    const down = spelledInterval(parseNote('G4'), parseNote('C4'));
    expect(down.semitones).toBe(-7);
    expect(down.number).toBe(5);
  });

  it('retains descending letter direction when an enharmonic interval spans zero semitones', () => {
    const from = parseNote('Fb4');
    const to = parseNote('E4');
    const interval = spelledInterval(from, to);
    expect(interval).toMatchObject({ number: 2, quality: 'd', semitones: 0, descending: true });
    expect(formatNote(transposeByInterval(from, interval))).toBe('E4');
  });

  it('round-trips a matrix of altered note pairs through their spelled interval', () => {
    const names = [
      'Cbb4',
      'Cb4',
      'C4',
      'C#4',
      'C##4',
      'Ebb4',
      'Eb4',
      'E4',
      'E#4',
      'E##4',
      'Fb4',
      'F4',
      'F#4',
      'F##4',
      'Bbb4',
      'Bb4',
      'B4',
      'B#4',
      'B##4',
    ];
    for (const fromName of names) {
      for (const toName of names) {
        const from = parseNote(fromName);
        const to = parseNote(toName);
        const interval = spelledInterval(from, to);
        expect(formatNote(transposeByInterval(from, interval)), `${fromName} -> ${toName}`).toBe(
          toName,
        );
      }
    }
  });

  it('accepts and reapplies its own compound interval across the supported octave range', () => {
    const from = parseNote('C-100');
    const to = parseNote('C100');
    expect(formatNote(transposeByInterval(from, spelledInterval(from, to)))).toBe('C100');
  });

  it('names a compound alteration by the direction the letters move', () => {
    // C# up to Dbb steps up one letter but down one semitone. Reading the span
    // as a magnitude calls that a minor second, which is the interval between
    // two entirely different notes.
    expect(spelledInterval(parseNote('C#4'), parseNote('Dbb4'))).toMatchObject({
      number: 2,
      quality: 'dd',
      semitones: -1,
    });
    // The ordinary ascending and descending cases are unchanged.
    expect(spelledInterval(parseNote('C4'), parseNote('Db4'))).toMatchObject({
      number: 2,
      quality: 'm',
      semitones: 1,
    });
    expect(spelledInterval(parseNote('G4'), parseNote('C4'))).toMatchObject({
      number: 5,
      quality: 'P',
      semitones: -7,
    });
  });

  it('signs semitones by pitch direction, not letter direction', () => {
    const down = spelledInterval(parseNote('C4'), parseNote('Cb4'));
    expect(down).toMatchObject({ number: 1, quality: 'A', semitones: -1 });
    const up = spelledInterval(parseNote('C4'), parseNote('C#4'));
    expect(up).toMatchObject({ number: 1, quality: 'A', semitones: 1 });
  });

  describe('same-letter descending semitones (octaveless)', () => {
    it('returns a descending augmented unison, not a garbage augmentation stack', () => {
      // Regression: octave lift used to be upward-only, so a same-letter
      // downward step wrapped to +11 semitones and stacked eleven "A"s.
      for (const [from, to] of [
        ['E', 'Eb'],
        ['F#', 'F'],
        ['C', 'Cb'],
      ] as const) {
        expect(spelledInterval(parseNote(from), parseNote(to))).toMatchObject({
          number: 1,
          quality: 'A',
          semitones: -1,
        });
      }
    });

    it('leaves ascending same-letter steps unchanged', () => {
      for (const [from, to] of [
        ['Eb', 'E'],
        ['F', 'F#'],
        ['Cb', 'C'],
      ] as const) {
        expect(spelledInterval(parseNote(from), parseNote(to))).toMatchObject({
          number: 1,
          quality: 'A',
          semitones: 1,
        });
      }
    });
  });

  describe('pitch-class branch (octaveless notes)', () => {
    it('keeps wraparound intervals consistent with the ascending number', () => {
      expect(spelledInterval(parseNote('Ab'), parseNote('G#'))).toMatchObject({
        number: 7,
        quality: 'A',
        semitones: 12,
      });
      expect(spelledInterval(parseNote('C'), parseNote('B#'))).toMatchObject({
        number: 7,
        quality: 'A',
        semitones: 12,
      });
      expect(spelledInterval(parseNote('Dbb'), parseNote('C#'))).toMatchObject({
        number: 7,
        quality: 'AA',
        semitones: 13,
      });
    });

    it('measures simple intervals within a single ascending octave', () => {
      expect(spelledInterval(parseNote('B'), parseNote('C'))).toMatchObject({
        number: 2,
        quality: 'm',
        semitones: 1,
      });
      expect(spelledInterval(parseNote('C'), parseNote('C'))).toMatchObject({
        number: 1,
        quality: 'P',
        semitones: 0,
      });
      expect(spelledInterval(parseNote('C'), parseNote('G'))).toMatchObject({
        number: 5,
        quality: 'P',
        semitones: 7,
      });
    });
  });
});

/** Every note the property tests below measure intervals between. */
function sampleNotes(): Note[] {
  const notes: Note[] = [];
  for (let letter = 0; letter <= 6; letter += 1) {
    for (let alter = -2; alter <= 2; alter += 1) {
      for (const octave of [3, 4, 5]) {
        notes.push({ letter, alter, octave });
      }
      notes.push({ letter, alter });
    }
  }
  return notes;
}

/** The note pairs `spelledInterval` accepts: both octaved, or neither. */
function samplePairs(): [Note, Note][] {
  const notes = sampleNotes();
  const pairs: [Note, Note][] = [];
  for (const a of notes) {
    for (const b of notes) {
      if ((a.octave === undefined) === (b.octave === undefined)) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

const label = (note: Note) => formatNote(note);

describe('the canonical shape of a spelled interval', () => {
  const pairs = samplePairs();

  it('carries the descending key only when the interval descends', () => {
    for (const [a, b] of pairs) {
      const interval = spelledInterval(a, b);
      // The letters decide the direction; the span decides it only where the
      // letters do not move, since a descending unison spans zero semitones.
      const ladder = (note: Note) => note.letter + 7 * (note.octave ?? 0);
      const steps =
        a.octave === undefined ? (((b.letter - a.letter) % 7) + 7) % 7 : ladder(b) - ladder(a);
      const descends = steps < 0 || (steps === 0 && interval.semitones < 0);
      expect(interval.descending, `${label(a)} -> ${label(b)}`).toBe(descends ? true : undefined);
      expect(Object.keys(interval).sort().join(','), `${label(a)} -> ${label(b)}`).toBe(
        descends ? 'descending,number,quality,semitones' : 'number,quality,semitones',
      );
    }
  });

  it('produces the same object as the name and the normalizer do', () => {
    for (const [a, b] of pairs) {
      const measured = spelledInterval(a, b);
      // Idempotent: resolving measured data returns it unchanged, so a value
      // that crosses an entry point keeps the shape it was given.
      expect(toSpelledInterval(measured), `${label(a)} -> ${label(b)}`).toEqual(measured);
      expect(toSpelledInterval({ ...measured }), `${label(a)} -> ${label(b)}`).toEqual(measured);
    }
  });

  it('agrees with the parsed name for an ascending interval', () => {
    for (const [a, b] of pairs) {
      const measured = spelledInterval(a, b);
      if (measured.descending !== undefined || measured.semitones < 0) {
        continue;
      }
      const parsed = tryParse(`${measured.quality}${measured.number}`);
      if (parsed === null) {
        continue;
      }
      expect(parsed, `${label(a)} -> ${label(b)}`).toEqual(measured);
    }
  });

  it('matches the documented example exactly, not merely partially', () => {
    expect(spelledInterval(parseNote('C4'), parseNote('G4'))).toEqual(parseInterval('P5'));
    expect(spelledInterval(parseNote('C4'), parseNote('G4'))).toEqual({
      number: 5,
      quality: 'P',
      semitones: 7,
    });
    expect('descending' in spelledInterval(parseNote('C4'), parseNote('G4'))).toBe(false);
  });
});

/** The interval of that name, or null where the name names none. */
function tryParse(name: string): SpelledInterval | null {
  try {
    return parseInterval(name);
  } catch {
    return null;
  }
}

describe('interval identities', () => {
  it('reapplies every measured interval back onto its own source note', () => {
    for (const [a, b] of samplePairs()) {
      expect(transposeByInterval(a, spelledInterval(a, b)), `${label(a)} -> ${label(b)}`).toEqual(
        b,
      );
    }
  });

  it('measures back every interval it can name', () => {
    // `dd2` is left out: it is the one name in this grid whose interval is
    // narrowed past a zero span, so its true span is -1 while
    // `intervalSemitones` reports the magnitude 1 and applying it lands a
    // semitone high. Carrying the sign through would have to reach every
    // magnitude comparison built on that function.
    const narrowedPastZero = new Set(['dd2']);
    const from = parseNote('C4');
    let names = 0;
    for (let number = 1; number <= 15; number += 1) {
      for (const quality of ['P', 'M', 'm', 'A', 'AA', 'd', 'dd'] as const) {
        const name = `${quality}${number}`;
        const parsed = tryParse(name);
        if (parsed === null || narrowedPastZero.has(name)) {
          continue;
        }
        names += 1;
        const measured = spelledInterval(from, transposeByInterval(from, parsed));
        expect({ number: measured.number, quality: measured.quality }, name).toEqual({
          number: parsed.number,
          quality: parsed.quality,
        });
      }
    }
    expect(names).toBeGreaterThan(70);
  });

  it('spans the whole MIDI range in both directions', () => {
    const low = midiToNote(0);
    const high = midiToNote(127);
    const up = spelledInterval(low, high);
    expect(up.number).toBe(75);
    // The widest interval the library measures has to survive the entry point
    // that resolves interval data, or the class API is narrower than the
    // functions it wraps.
    expect(toSpelledInterval(up)).toEqual(up);
    expect(transposeByInterval(low, up)).toEqual(high);
    const down = spelledInterval(high, low);
    expect(down.descending).toBe(true);
    expect(transposeByInterval(high, down)).toEqual(low);
  });
});

describe('interval names the library refuses', () => {
  it('rejects a diminished unison, which no measurement produces', () => {
    // C down to Cb is a descending augmented unison; a diminished unison would
    // report the same span as the augmented one and transpose the wrong way.
    expect(() => intervalSemitones(1, 'd')).toThrow(/unison cannot be diminished/);
    expect(() => intervalSemitones(1, 'dd')).toThrow(/unison cannot be diminished/);
    expect(() => parseInterval('d1')).toThrow(/unison cannot be diminished/);
    expect(() => toSpelledInterval('dd1')).toThrow(/unison cannot be diminished/);
    expect(spelledInterval(parseNote('C4'), parseNote('Cb4'))).toEqual({
      number: 1,
      quality: 'A',
      semitones: -1,
      descending: true,
    });
    expect(parseInterval('-A1')).toEqual({
      number: 1,
      quality: 'A',
      semitones: -1,
      descending: true,
    });
  });

  it('names the interval without an ordinal it would spell wrong', () => {
    for (const [number, quality] of [
      [2, 'P'],
      [3, 'P'],
      [21, 'P'],
      [5, 'M'],
    ] as const) {
      expect(() => intervalSemitones(number, quality)).toThrow(
        new RegExp(`interval of ${number} cannot be ${quality === 'P' ? 'perfect' : 'major'}`),
      );
      expect(() => intervalSemitones(number, quality)).not.toThrow(/\dth/);
    }
  });

  it('accepts every number a measurement can produce and nothing wider', () => {
    // A 75th is ten octaves and a fifth, which is the whole MIDI range.
    expect(intervalSemitones(75, 'P')).toBe(127);
    expect(() => intervalSemitones(76, 'P')).toThrow(/\[1, 75\]/);
    expect(() => intervalSemitones(0, 'P')).toThrow(/\[1, 75\]/);
  });
});

describe('a note the library will not invent a letter for', () => {
  it('refuses a letter outside C..B rather than reducing it silently', () => {
    // Building a note by letter arithmetic used to produce a value that printed
    // like a library-made note but compared unequal to it.
    for (const letter of [-1, 7, 9, 1000]) {
      expect(() => formatNote({ letter, alter: 0, octave: 4 })).toThrow(
        /letter must be an integer in \[0, 6\]/,
      );
      expect(() => noteToMidi({ letter, alter: 0, octave: 4 })).toThrow(/\[0, 6\]/);
      expect(() => noteToPitchClass({ letter, alter: 0 })).toThrow(/\[0, 6\]/);
      expect(() => spelledInterval({ letter, alter: 0 }, { letter: 0, alter: 0 })).toThrow(
        /\[0, 6\]/,
      );
      expect(() => transposeByInterval({ letter, alter: 0 }, parseInterval('P5'))).toThrow(
        /\[0, 6\]/,
      );
    }
  });

  it('returns notes whose letter is already reduced', () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      for (const spelling of ['sharp', 'flat'] as const) {
        const note = midiToNote(midi, spelling);
        expect(note.letter, `${midi} ${spelling}`).toBeGreaterThanOrEqual(0);
        expect(note.letter, `${midi} ${spelling}`).toBeLessThanOrEqual(6);
      }
    }
    for (const [a, b] of samplePairs()) {
      const moved = transposeByInterval(a, spelledInterval(a, b));
      expect(moved.letter, `${label(a)} -> ${label(b)}`).toBeGreaterThanOrEqual(0);
      expect(moved.letter, `${label(a)} -> ${label(b)}`).toBeLessThanOrEqual(6);
    }
    for (const semitones of [-24, -13, -1, 0, 1, 13, 24]) {
      const moved = transposeNote(parseNote('Ab4'), semitones);
      expect(moved.letter, `${semitones}`).toBeGreaterThanOrEqual(0);
      expect(moved.letter, `${semitones}`).toBeLessThanOrEqual(6);
    }
  });
});

describe('a spelling side the table does not carry', () => {
  it('rejects it instead of quietly naming the black key the other way', () => {
    // The default and the two names the table carries are unchanged.
    expect(formatNote(midiToNote(61))).toBe('C#4');
    expect(formatNote(midiToNote(61, undefined))).toBe('C#4');
    expect(formatNote(midiToNote(61, 'sharp'))).toBe('C#4');
    expect(formatNote(midiToNote(61, 'flat'))).toBe('Db4');
    // Anything else used to fall through to the flat table without saying so.
    for (const side of ['natural', 'Sharp', 'flats', '', null, 7]) {
      expect(() => midiToNote(61, side as never), String(side)).toThrow(
        /midi spelling must be one of sharp, flat/,
      );
    }
  });

  it('rejects it on the transposition that forwards it too', () => {
    expect(formatNote(transposeNote(parseNote('Ab4'), 2, { spelling: 'sharp' }))).toBe('A#4');
    expect(() => transposeNote(parseNote('Ab4'), 2, { spelling: 'natural' as never })).toThrow(
      /midi spelling must be one of sharp, flat/,
    );
    expect(() => transposeNote(parseNote('Ab'), 2, { spelling: 'natural' as never })).toThrow(
      /midi spelling must be one of sharp, flat/,
    );
  });
});
