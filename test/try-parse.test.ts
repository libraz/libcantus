import { describe, expect, it } from 'vitest';
import { InvalidInputError, isLibcantusError } from '../src/core/errors/index.js';
import {
  parseInterval,
  parseNote,
  tryParseInterval,
  tryParseNote,
} from '../src/core/pitch/index.js';
import { Chord } from '../src/model/index.js';
import { parseChordSymbol, tryParseChordSymbol } from '../src/theory/symbol/index.js';

/** The error a throwing parser raises, as the value it threw. */
function thrownBy(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('tryParseNote', () => {
  it('reads a name the throwing parser reads', () => {
    const result = tryParseNote('C#4');
    expect(result.ok && result.value).toEqual(parseNote('C#4'));
    expect(tryParseNote('B', { system: 'german' }).ok).toBe(true);
  });

  it('reports a name it cannot read instead of throwing', () => {
    const result = tryParseNote('C#b');
    expect(result.ok).toBe(false);
    expect(!result.ok && isLibcantusError(result.error)).toBe(true);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    // The message has to name what was typed, or an input field cannot explain
    // itself to the person typing.
    expect(!result.ok && result.error.message).toMatch(/C#b/);
  });

  it('reports a value that is not text at all', () => {
    const result = tryParseNote(42 as never);
    expect(!result.ok && result.error.message).toMatch(/must be a string/);
  });

  it('throws exactly what it reports', () => {
    const failure = tryParseNote('C#b');
    const thrown = thrownBy(() => parseNote('C#b'));
    expect(thrown).toBeInstanceOf(InvalidInputError);
    expect(!failure.ok && (thrown as Error).message).toBe(!failure.ok && failure.error.message);
  });
});

describe('tryParseInterval', () => {
  it('reads a name the throwing parser reads', () => {
    expect(tryParseInterval('m3')).toEqual({ ok: true, value: parseInterval('m3') });
    expect(tryParseInterval('-m3')).toEqual({ ok: true, value: parseInterval('-m3') });
  });

  it('reports a name that is not an interval', () => {
    const result = tryParseInterval('x9');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/quality followed by a number/);
  });

  it('reports a quality the number cannot take', () => {
    const result = tryParseInterval('M5');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/major/);
  });

  it('throws exactly what it reports', () => {
    const failure = tryParseInterval('M5');
    const thrown = thrownBy(() => parseInterval('M5'));
    expect(thrown).toBeInstanceOf(InvalidInputError);
    expect(!failure.ok && (thrown as Error).message).toBe(!failure.ok && failure.error.message);
  });
});

describe('tryParseChordSymbol', () => {
  it('reads a symbol the throwing parser reads', () => {
    expect(tryParseChordSymbol('Cmaj7')).toEqual({ ok: true, value: parseChordSymbol('Cmaj7') });
    expect(tryParseChordSymbol('H7', { system: 'german' }).ok).toBe(true);
  });

  it('reads the halfway-typed symbols an input field sees', () => {
    // Each of these is a prefix of `Cmaj7(#11)`, and only some of them are
    // chords; none of them may throw.
    for (const text of ['C', 'Cm', 'Cma', 'Cmaj', 'Cmaj7', 'Cmaj7(', 'Cmaj7(#', 'Cmaj7(#11)']) {
      expect(() => tryParseChordSymbol(text), text).not.toThrow();
    }
    expect(tryParseChordSymbol('Cmaj7(#').ok).toBe(false);
    expect(tryParseChordSymbol('Cmaj7(#11)').ok).toBe(true);
  });

  it('says which half of the symbol it could not read', () => {
    const root = tryParseChordSymbol('H7');
    expect(!root.ok && root.error.message).toMatch(/Invalid chord symbol: H7/);
    const quality = tryParseChordSymbol('Cfoo');
    expect(!quality.ok && quality.error.message).toMatch(/Unrecognized chord quality: Cfoo/);
  });

  it('reports an unknown notation system as the failure it is', () => {
    const result = tryParseChordSymbol('C', { system: 'klingon' as never });
    expect(!result.ok && result.error.message).toMatch(/system must be one of/);
  });

  it('throws exactly what it reports', () => {
    const failure = tryParseChordSymbol('Cfoo');
    const thrown = thrownBy(() => parseChordSymbol('Cfoo'));
    expect(thrown).toBeInstanceOf(InvalidInputError);
    expect(!failure.ok && (thrown as Error).message).toBe(!failure.ok && failure.error.message);
  });
});

describe('Chord.tryParse', () => {
  it('wraps the chord the throwing factory builds', () => {
    const result = Chord.tryParse('Bbmaj7');
    expect(result.ok && result.value.symbol()).toBe('Bbmaj7');
    expect(result.ok && result.value.data).toEqual(Chord.parse('Bbmaj7').data);
    expect(Chord.tryParse('H7', { system: 'german' }).ok).toBe(true);
  });

  it('reads a bracketed tension into the class API', () => {
    const result = Chord.tryParse('Cmaj7(#11)');
    expect(result.ok && result.value.intervals).toEqual([0, 4, 7, 11, 18]);
    expect(result.ok && result.value.symbol()).toBe('Cmaj7#11');
  });

  it('reports a symbol it cannot read instead of throwing', () => {
    const result = Chord.tryParse('Cfoo');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_INPUT');
    expect(!result.ok && result.error.message).toMatch(/Cfoo/);
  });

  it('throws exactly what it reports', () => {
    const failure = Chord.tryParse('Cfoo');
    const thrown = thrownBy(() => Chord.parse('Cfoo'));
    expect(thrown).toBeInstanceOf(InvalidInputError);
    expect(!failure.ok && (thrown as Error).message).toBe(!failure.ok && failure.error.message);
  });
});
