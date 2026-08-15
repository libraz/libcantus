import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { KeyScale } from '../src/core/types.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import {
  chordFromDegree,
  chordFromSpan,
  chordPitchClasses,
  chordToneRole,
  makeChord,
  spanFromChord,
} from '../src/theory/chord/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

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
