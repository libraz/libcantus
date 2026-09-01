import { describe, expect, it } from 'vitest';
import {
  formatNote,
  Interval,
  instrumentTransposition,
  Key,
  Note,
  parseInterval,
  parseNote,
  TRANSPOSING_INSTRUMENTS,
  type TransposingInstrumentName,
  toSoundingPitch,
  toWrittenPitch,
} from '../src/index.js';

/** Every instrument the table carries, for the mechanical checks below. */
const INSTRUMENTS = Object.keys(TRANSPOSING_INSTRUMENTS) as TransposingInstrumentName[];

/** Written notes chosen to exercise letters, double accidentals and registers. */
const WRITTEN = ['C4', 'D#4', 'Fb3', 'B#5', 'Abb4', 'G2', 'C', 'F#'];

describe('toSoundingPitch', () => {
  it('sounds a clarinet in A a minor third lower, spelled by the interval', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'clarinetA'))).toBe('A3');
    // The letter moves by the interval's diatonic number, so a written D# sounds
    // on the letter B — a semitone count alone could answer C natural instead.
    expect(formatNote(toSoundingPitch(parseNote('D#4'), 'clarinetA'))).toBe('B#3');
    expect(formatNote(toSoundingPitch(parseNote('D4'), 'clarinetA'))).toBe('B3');
  });

  it('sounds the B flat instruments in their own registers', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'clarinetBb'))).toBe('Bb3');
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'trumpetBb'))).toBe('Bb3');
    // The tenor saxophone reads the same key an octave up, so it sounds a major
    // ninth below rather than a major second.
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'tenorSax'))).toBe('Bb2');
  });

  it('sounds the F instruments a perfect fifth lower', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'hornF'))).toBe('F3');
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'englishHorn'))).toBe('F3');
  });

  it('sounds a trumpet in D a major second higher', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'trumpetD'))).toBe('D4');
  });

  it('separates the E flat instruments by octave and by direction', () => {
    // Same key, three registers: the sopranino clarinet sounds above the part,
    // the alto saxophone a major sixth below, the baritone an octave below that.
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'clarinetEb'))).toBe('Eb4');
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'altoSax'))).toBe('Eb3');
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'baritoneSax'))).toBe('Eb2');
  });

  it('moves the octave for the pure octave transposers', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'piccolo'))).toBe('C5');
    expect(formatNote(toSoundingPitch(parseNote('C4'), 'doubleBass'))).toBe('C3');
    expect(formatNote(toSoundingPitch(parseNote('E4'), 'guitar'))).toBe('E3');
    expect(formatNote(toSoundingPitch(parseNote('Bb1'), 'contrabassoon'))).toBe('Bb0');
  });

  it('leaves a note with no octave octave-less, whichever way the octave moves', () => {
    const piccolo = toSoundingPitch(parseNote('C'), 'piccolo');
    expect(formatNote(piccolo)).toBe('C');
    expect(piccolo.octave).toBeUndefined();
    const doubleBass = toSoundingPitch(parseNote('Eb'), 'doubleBass');
    expect(formatNote(doubleBass)).toBe('Eb');
    expect(doubleBass.octave).toBeUndefined();
    // An octave-less clarinet part still moves: only the register is missing.
    expect(formatNote(toSoundingPitch(parseNote('C'), 'clarinetA'))).toBe('A');
  });
});

describe('toWrittenPitch', () => {
  it('writes a concert pitch as the note the player reads', () => {
    expect(formatNote(toWrittenPitch(parseNote('A3'), 'clarinetA'))).toBe('C4');
    expect(formatNote(toWrittenPitch(parseNote('Eb3'), 'altoSax'))).toBe('C4');
    // The same concert pitch, read in three different registers of one key.
    expect(formatNote(toWrittenPitch(parseNote('Eb3'), 'baritoneSax'))).toBe('C5');
    expect(formatNote(toWrittenPitch(parseNote('Eb3'), 'clarinetEb'))).toBe('C3');
    expect(formatNote(toWrittenPitch(parseNote('Eb2'), 'baritoneSax'))).toBe('C4');
  });

  it.each(INSTRUMENTS)('%s converts written -> sounding -> written unchanged', (instrument) => {
    for (const name of WRITTEN) {
      const written = parseNote(name);
      const sounding = toSoundingPitch(written, instrument);
      expect(formatNote(toWrittenPitch(sounding, instrument)), name).toBe(name);
    }
  });

  it.each(INSTRUMENTS)('%s converts sounding -> written -> sounding unchanged', (instrument) => {
    for (const name of WRITTEN) {
      const sounding = parseNote(name);
      const written = toWrittenPitch(sounding, instrument);
      expect(formatNote(toSoundingPitch(written, instrument)), name).toBe(name);
    }
  });
});

describe('instrumentTransposition', () => {
  it('reports the written-to-sounding interval', () => {
    expect(instrumentTransposition('clarinetA')).toEqual({
      number: 3,
      quality: 'm',
      semitones: -3,
      descending: true,
    });
    expect(instrumentTransposition('clarinetEb')).toEqual({
      number: 3,
      quality: 'm',
      semitones: 3,
      descending: false,
    });
    expect(instrumentTransposition('piccolo')).toEqual({
      number: 8,
      quality: 'P',
      semitones: 12,
      descending: false,
    });
    // The compound interval, not its simple reduction: the octave is the point.
    expect(instrumentTransposition('baritoneSax')).toEqual({
      number: 13,
      quality: 'M',
      semitones: -21,
      descending: true,
    });
  });

  it('accepts a transposition the table does not carry', () => {
    expect(formatNote(toSoundingPitch(parseNote('C4'), '-m3'))).toBe('A3');
    expect(formatNote(toSoundingPitch(parseNote('C4'), parseInterval('-m3')))).toBe('A3');
    expect(formatNote(toSoundingPitch(parseNote('C4'), Interval.parse('-m3')))).toBe('A3');
    // An alto flute in G, which the table leaves out.
    expect(formatNote(toWrittenPitch(parseNote('G3'), '-P4'))).toBe('C4');
  });

  it('rejects a value that is neither an instrument nor an interval', () => {
    expect(() => instrumentTransposition('clarinetBB')).toThrow(/unknown transposing instrument/);
    expect(() => instrumentTransposition('constructor')).toThrow(/unknown transposing instrument/);
  });
});

describe('Key.forInstrument', () => {
  it('writes the part higher than it sounds', () => {
    // Direction: the written key is transposed away from the sounding one. A B
    // flat instrument sounds a major second lower than it reads, so its part is
    // written a major second HIGHER: concert C major is read as D major.
    expect(Key.major('C').forInstrument('clarinetBb').toString()).toBe('D major');
    expect(Key.major('C').forInstrument('trumpetBb').toString()).toBe('D major');
    // Concert Eb major, up a major second, spelled by the interval.
    expect(Key.major('Eb').forInstrument('clarinetBb').toString()).toBe('F major');
    // A horn in F sounds a fifth lower, so it reads a fifth higher.
    expect(Key.major('C').forInstrument('hornF').toString()).toBe('G major');
    expect(Key.minor('D').forInstrument('clarinetA').toString()).toBe('F minor');
    expect(Key.major('C').forInstrument('altoSax').toString()).toBe('A major');
  });

  it('leaves the key alone for an octave transposer, which has no register', () => {
    expect(Key.major('C').forInstrument('piccolo').toString()).toBe('C major');
    expect(Key.minor('F#').forInstrument('doubleBass').toString()).toBe('F# minor');
  });

  it('reads a written key back as the key it sounds in', () => {
    // The other direction of the same table: a part written in C major on a
    // clarinet in A sounds in A major.
    expect(Key.major('C').transposeBy(instrumentTransposition('clarinetA')).toString()).toBe(
      'A major',
    );
    expect(
      Key.major('D')
        .forInstrument('clarinetBb')
        .transposeBy(instrumentTransposition('clarinetBb'))
        .toString(),
    ).toBe('D major');
  });

  it('keeps the mode mask, so a named scale survives the transposition', () => {
    const written = Key.named('harmonicMinor', 'A').forInstrument('clarinetBb');
    expect(written.noteNames()).toEqual(['B', 'C#', 'D', 'E', 'F#', 'G', 'A#']);
  });

  it('agrees with the note conversion it is built on', () => {
    const concert = Key.major('C');
    const written = concert.forInstrument('altoSax');
    expect(written.tonic.name).toBe(new Note(toWrittenPitch(concert.tonic.data, 'altoSax')).name);
  });
});
