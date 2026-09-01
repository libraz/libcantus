import { describe, expect, it } from 'vitest';
import {
  formatNote,
  Interval,
  type IntervalLike,
  InvalidInputError,
  intervalSemitones,
  Note,
  parseInterval,
  parseNote,
  toSpelledInterval,
  transposeByInterval,
} from '../src/index.js';

describe('parseInterval with a descending prefix', () => {
  it('leaves an ascending name unchanged', () => {
    expect(parseInterval('A4')).toEqual({ number: 4, quality: 'A', semitones: 6 });
  });

  it('negates the span and flags the direction', () => {
    expect(parseInterval('-A4')).toEqual({
      number: 4,
      quality: 'A',
      semitones: -6,
      descending: true,
    });
    expect(parseInterval('-m3')).toEqual({
      number: 3,
      quality: 'm',
      semitones: -3,
      descending: true,
    });
  });

  it('flags a descending unison, whose span cannot carry the direction', () => {
    const unison = parseInterval('-P1');
    expect(unison).toEqual({ number: 1, quality: 'P', semitones: 0, descending: true });
    // Not -0: an equality check against a computed 0 would otherwise fail.
    expect(Object.is(unison.semitones, 0)).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseInterval('  -m3  ')).toEqual(parseInterval('-m3'));
  });

  it('rejects a name that is not a quality and a number', () => {
    expect(() => parseInterval('-')).toThrow(/interval must be a quality/);
    expect(() => parseInterval('- m3')).toThrow(/interval must be a quality/);
  });
});

describe('transposing downward by a named interval', () => {
  it('keeps the spelling the interval names', () => {
    // A tritone down from G# is D as an augmented fourth, but C## as a
    // diminished fifth: the semitone count alone cannot choose between them.
    expect(formatNote(transposeByInterval(parseNote('G#'), parseInterval('-A4')))).toBe('D');
    expect(formatNote(transposeByInterval(parseNote('G#'), parseInterval('-d5')))).toBe('C##');
  });

  it('inverts an ascending transposition of the same name', () => {
    const up = transposeByInterval(parseNote('C4'), parseInterval('m3'));
    expect(formatNote(transposeByInterval(up, parseInterval('-m3')))).toBe('C4');
  });
});

describe('toSpelledInterval', () => {
  it('accepts a name, plain data, and an Interval alike', () => {
    const expected = { number: 4, quality: 'A', semitones: 6 };
    expect(toSpelledInterval('A4')).toEqual(expected);
    expect(toSpelledInterval(parseInterval('A4'))).toEqual(expected);
    expect(toSpelledInterval(Interval.parse('A4'))).toEqual(expected);
  });

  it('carries the direction through every form', () => {
    const expected = { number: 3, quality: 'm', semitones: -3, descending: true };
    expect(toSpelledInterval('-m3')).toEqual(expected);
    expect(toSpelledInterval(parseInterval('-m3'))).toEqual(expected);
    expect(toSpelledInterval(Interval.parse('-m3'))).toEqual(expected);
  });

  it('infers the direction from a negative span', () => {
    expect(toSpelledInterval({ number: 5, quality: 'P', semitones: -7 })).toEqual({
      number: 5,
      quality: 'P',
      semitones: -7,
      descending: true,
    });
  });

  it('omits the flag for an ascending interval', () => {
    expect(toSpelledInterval({ number: 5, quality: 'P', semitones: 7 })).not.toHaveProperty(
      'descending',
    );
  });

  it('rejects components that do not describe the same interval', () => {
    expect(() => toSpelledInterval({ number: 5, quality: 'P', semitones: 8 })).toThrow(
      /P5 spans 7 semitones; received 8/,
    );
    expect(() => toSpelledInterval({ number: 0, quality: 'P', semitones: 0 })).toThrow(
      /interval\.number/,
    );
  });

  it('rejects a value that is not interval-shaped', () => {
    expect(() => toSpelledInterval(7 as unknown as IntervalLike)).toThrow(InvalidInputError);
    expect(() => toSpelledInterval(7 as unknown as IntervalLike)).toThrow(/received number/);
    expect(() => toSpelledInterval('')).toThrow(InvalidInputError);
  });
});

describe('Interval direction', () => {
  it('reads the direction from a parsed name', () => {
    expect(Interval.parse('-A4').isDescending).toBe(true);
    expect(Interval.parse('A4').isDescending).toBe(false);
  });

  it('flips the direction without changing number or quality', () => {
    const down = Interval.parse('A4').negate();
    expect(down.isDescending).toBe(true);
    // The name carries the direction, so the text form names the interval it is
    // rather than its ascending twin.
    expect(down.name).toBe('-A4');
    expect(down.semitones).toBe(-6);
  });

  it('flips a zero-span unison, whose sign cannot record the direction', () => {
    const down = Interval.parse('P1').negate();
    expect(down.isDescending).toBe(true);
    expect(down.semitones).toBe(0);
    expect(down.negate().isDescending).toBe(false);
  });

  it('is its own inverse', () => {
    for (const name of ['A4', '-m3', 'P1', 'M7']) {
      const interval = Interval.parse(name);
      expect(interval.negate().negate().equals(interval)).toBe(true);
    }
  });

  it('round-trips a descending interval through JSON', () => {
    const original = Interval.parse('-m3');
    expect(Interval.fromJSON(original.toJSON()).equals(original)).toBe(true);
  });
});

/** Every interval name the grammar spells over a working range of numbers. */
function everyIntervalName(): string[] {
  const names: string[] = [];
  for (let number = 1; number <= 15; number += 1) {
    for (const quality of ['P', 'M', 'm', 'A', 'AA', 'd', 'dd', 'ddd']) {
      for (const prefix of ['', '-']) {
        names.push(`${prefix}${quality}${number}`);
      }
    }
  }
  return names;
}

describe('Interval text form', () => {
  it('leaves an ascending name as quality and number alone', () => {
    expect(Interval.parse('M3').name).toBe('M3');
    expect(`${Interval.parse('P5')}`).toBe('P5');
  });

  it('names a descending interval with the prefix its parser reads', () => {
    expect(Interval.parse('-m3').toString()).toBe('-m3');
    expect(Interval.between(Note.parse('C4'), Note.parse('A3')).toString()).toBe('-m3');
  });

  it('round-trips every name reachable from the parser', () => {
    let checked = 0;
    for (const name of everyIntervalName()) {
      const parsed = Interval.tryParse(name);
      if (!parsed.ok) {
        continue;
      }
      checked += 1;
      const interval = parsed.value;
      expect(Interval.parse(interval.toString()).equals(interval), name).toBe(true);
      expect(toSpelledInterval(interval.toString()), name).toEqual(interval.toJSON());
    }
    expect(checked).toBeGreaterThan(140);
  });

  it('round-trips every interval measured between two notes', () => {
    const notes = ['C4', 'Cb4', 'C#4', 'Dbb4', 'Eb3', 'F#5', 'B3', 'Bb2', 'A4', 'G##4'].map(
      (name) => Note.parse(name),
    );
    for (const a of notes) {
      for (const b of notes) {
        const interval = Interval.between(a, b);
        const label = `${a} -> ${b}`;
        expect(Interval.parse(interval.toString()).equals(interval), label).toBe(true);
      }
    }
  });

  it('inverts to the span its own number and quality name', () => {
    for (const name of everyIntervalName()) {
      const parsed = Interval.tryParse(name);
      if (!parsed.ok) {
        continue;
      }
      let inverted: Interval;
      try {
        inverted = parsed.value.invert();
      } catch {
        // An augmented octave inverts to a diminished unison, which no
        // measurement produces and the parser refuses by name.
        continue;
      }
      expect(inverted.semitones, name).toBe(intervalSemitones(inverted.number, inverted.quality));
    }
  });

  it('measures between notes at the edges of the octave range', () => {
    const low = Note.of('C', 0, -1);
    const high = Note.of('B', 0, 9);
    const measured = Interval.between(low, high);
    expect(measured.number).toBe(77);
    expect(low.transposeBy(measured).equals(high)).toBe(true);
  });

  it('agrees with the direction its data and comparisons report', () => {
    for (const name of ['-m3', '-P1', '-A4', 'dd2']) {
      const interval = Interval.parse(name);
      expect(interval.name.startsWith('-')).toBe(interval.isDescending);
      expect(interval.toJSON().descending === true).toBe(interval.isDescending);
      expect(interval.negate().name.startsWith('-')).toBe(!interval.isDescending);
    }
  });
});
