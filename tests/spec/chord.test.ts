import { secondaryDominant } from '@libraz/libcantus/analyze';
import { InvalidInputError } from '@libraz/libcantus/core';
import {
  type ChordSpan,
  chordFromDegree,
  chordFromSpan,
  chordPitchClasses,
  chordToneRole,
  diatonicSeventh,
  diatonicTriad,
  formatChordSymbol,
  isChordMember,
  majorKey,
  makeChord,
  spanFromChord,
} from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

const cMajor = majorKey(0);

describe('chordFromDegree', () => {
  it('builds a maj7 chord on the tonic', () => {
    const chord = chordFromDegree(1, 'maj7', cMajor);
    expect(chord.rootPc).toBe(0);
    expect(chordPitchClasses(chord)).toEqual([0, 4, 7, 11]);
  });

  it('builds a dominant seventh on the fifth degree', () => {
    const chord = chordFromDegree(5, 'dom7', cMajor);
    expect(chord.rootPc).toBe(7);
    expect(chordPitchClasses(chord)).toEqual([2, 5, 7, 11]);
  });
});

describe('chords built from a key', () => {
  it('spell their root the way the key writes it', () => {
    expect(formatChordSymbol(diatonicSeventh(5, majorKey(8)))).toBe('Eb7');
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((d) => formatChordSymbol(diatonicTriad(d, majorKey(3)))),
    ).toEqual(['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim']);
    expect(formatChordSymbol(secondaryDominant(4, majorKey(3)))).toBe('Eb7');
    expect(formatChordSymbol(chordFromDegree(1, 'maj7', 'Eb major'))).toBe('Ebmaj7');
  });

  it('follow the spelled tonic, not the pitch classes alone', () => {
    expect(formatChordSymbol(diatonicTriad(1, 'Ab minor'))).toBe('Abm');
    expect(formatChordSymbol(diatonicTriad(1, 'G# minor'))).toBe('G#m');
    expect(formatChordSymbol(secondaryDominant(3, 'Ab minor'))).toBe('Gb7');
    expect(formatChordSymbol(secondaryDominant(3, 'G# minor'))).toBe('F#7');
  });
});

describe('chordPitchClasses', () => {
  it('reduces augmented triads to pitch classes', () => {
    const chord = chordFromDegree(1, 'aug', cMajor);
    expect(chordPitchClasses(chord)).toEqual([0, 4, 8]);
  });
});

describe('chordToneRole', () => {
  const cMaj7 = chordFromDegree(1, 'maj7', cMajor);

  it('identifies the third', () => {
    expect(chordToneRole(4, cMaj7)).toBe('third');
  });

  it('identifies the seventh', () => {
    expect(chordToneRole(11, cMaj7)).toBe('seventh');
  });

  it('identifies the root and fifth', () => {
    expect(chordToneRole(0, cMaj7)).toBe('root');
    expect(chordToneRole(7, cMaj7)).toBe('fifth');
  });

  it('returns null for a non-chord-tone interval', () => {
    expect(chordToneRole(2, cMaj7)).toBeNull();
  });
});

describe('chordFromSpan', () => {
  it('reads a span without intervals exactly as makeChord builds it', () => {
    expect(chordFromSpan({ rootPc: 0, quality: 'maj7', startBeat: 0 })).toEqual(
      makeChord(0, 'maj7'),
    );
    expect(chordFromSpan({ rootPc: 5, quality: 'maj', startBeat: 4, bassPc: 7 })).toEqual(
      makeChord(5, 'maj', 7),
    );
  });

  it('keeps a template the quality union cannot name', () => {
    const span: ChordSpan = { rootPc: 0, quality: 'maj7', startBeat: 0, intervals: [0, 4, 11, 18] };
    const chord = chordFromSpan(span);
    expect(chord.intervals).toEqual([0, 4, 11, 18]);
    expect(chord.quality).toBe('maj7');
    expect(chordPitchClasses(chord)).toEqual([0, 4, 6, 11]);
  });

  it('copies the template, so the chord and the span never share an array', () => {
    const span: ChordSpan = { rootPc: 0, quality: 'maj', startBeat: 0, intervals: [0, 4, 7] };
    const chord = chordFromSpan(span);
    chord.intervals.push(14);
    expect(span.intervals).toEqual([0, 4, 7]);
    span.intervals?.push(21);
    expect(chord.intervals).toEqual([0, 4, 7, 14]);
  });

  it('rejects a template that is not a list of semitone offsets', () => {
    const base = { rootPc: 0, quality: 'maj', startBeat: 0 } as const;
    const holed = new Array<number>(3);
    holed[0] = 0;
    holed[2] = 7;
    expect(() => chordFromSpan({ ...base, intervals: 7 as never })).toThrow(/must be an array/);
    expect(() => chordFromSpan({ ...base, intervals: [] })).toThrow(/at least one interval/);
    expect(() => chordFromSpan({ ...base, intervals: [0, 4.5, 7] })).toThrow(InvalidInputError);
    expect(() => chordFromSpan({ ...base, intervals: holed })).toThrow(/received undefined/);
    expect(() => chordFromSpan({ ...base, intervals: [0, 4, 999] })).toThrow(InvalidInputError);
  });

  it('rejects an invalid root or quality as makeChord does', () => {
    expect(() => chordFromSpan({ rootPc: Number.NaN, quality: 'maj', startBeat: 0 })).toThrow(
      InvalidInputError,
    );
    expect(() => chordFromSpan({ rootPc: 0, quality: 'nope' as never, startBeat: 0 })).toThrow(
      /Unknown chord quality/,
    );
  });
});

describe('spanFromChord', () => {
  it('omits the template for a chord its quality already describes', () => {
    const span = spanFromChord(makeChord(0, 'maj7'), 4);
    expect(span).toEqual({ rootPc: 0, quality: 'maj7', startBeat: 4 });
    expect('intervals' in span).toBe(false);
    expect(spanFromChord(makeChord(5, 'maj', 7), 0)).toEqual({
      rootPc: 5,
      quality: 'maj',
      startBeat: 0,
      bassPc: 7,
    });
  });

  it('records a template that departs from the quality', () => {
    const chord = makeChord(0, 'maj7');
    chord.intervals = [0, 4, 11, 18];
    expect(spanFromChord(chord, 8)).toEqual({
      rootPc: 0,
      quality: 'maj7',
      startBeat: 8,
      intervals: [0, 4, 11, 18],
    });
  });

  it('copies the template, so the span and the chord never share an array', () => {
    const chord = makeChord(0, 'maj7');
    chord.intervals = [0, 4, 11, 18];
    const span = spanFromChord(chord, 0);
    span.intervals?.push(21);
    expect(chord.intervals).toEqual([0, 4, 11, 18]);
  });

  it('round-trips a custom template back into the same chord', () => {
    const chord = makeChord(2, 'min7', 5);
    chord.intervals = [0, 3, 10, 17];
    expect(chordFromSpan(spanFromChord(chord, 12))).toEqual(chord);
  });

  it('rejects a non-finite startBeat and an unknown quality', () => {
    expect(() => spanFromChord(makeChord(0, 'maj'), Number.NaN)).toThrow(/startBeat/);
    expect(() =>
      spanFromChord({ rootPc: 0, quality: 'nope' as never, intervals: [0, 4, 7] }, 0),
    ).toThrow(/Unknown chord quality/);
  });
});

describe('chord fields read as JS reads them', () => {
  const maj7 = makeChord(0, 'maj7');

  it('sums the root with each interval before reading the pitch', () => {
    expect(() => isChordMember(60, { ...maj7, rootPc: '3' as never })).toThrow(
      'pitch must be finite; received 30',
    );
    expect(isChordMember(60, { ...maj7, rootPc: null as never })).toBe(true);
    expect(() => chordToneRole(60, { ...maj7, rootPc: null as never })).toThrow(
      'pitch must be finite; received null',
    );
  });

  it('reads the slash bass unless it is left out', () => {
    expect(() =>
      chordPitchClasses({ ...maj7, bassPc: '3' as never }, { includeBass: true }),
    ).toThrow('pitch must be finite; received 3');
    expect(chordPitchClasses({ ...maj7, bassPc: '3' as never }, { includeBass: false })).toEqual([
      0, 4, 7, 11,
    ]);
  });

  it('iterates the intervals of a role', () => {
    expect(() => chordToneRole(60, majorKey(0) as never)).toThrow(
      'chord.intervals is not iterable',
    );
  });

  it('names only a text quality', () => {
    expect(() => makeChord(0, 5 as never)).toThrow('Unknown chord quality: 5');
    expect(() => makeChord(0, ['maj'] as never)).toThrow('Unknown chord quality: maj');
    expect(() => chordFromDegree(1, 5 as never, majorKey(0))).toThrow('Unknown chord quality: 5');
    expect(() => makeChord(0, Symbol('s') as never)).toThrow('Unknown chord quality: Symbol(s)');
  });
});
