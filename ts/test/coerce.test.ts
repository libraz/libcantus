import { describe, expect, it } from 'vitest';
import { majorKey, toChordData, toKeyScale, toNoteData } from '../src/index.js';

/**
 * The three coercers that let a public entry point take a note, key, or chord
 * in whatever form the caller holds it — a name, plain data, or one of the
 * model classes — and read one shape back. They exist so that reading text
 * happens in exactly these places rather than being spread over every function
 * that accepts a chord, and so the layers below the model can read a class
 * through `toJSON` without importing it.
 */

describe('toNoteData', () => {
  it('hands back a value the caller cannot mutate into library state', () => {
    const source = { letter: 0, alter: 0, octave: 4 };
    const coerced = toNoteData(source);
    expect(coerced).not.toBe(source);
  });
});

describe('toKeyScale', () => {
  it('hands back a value the caller cannot mutate into library state', () => {
    const source = majorKey(0);
    expect(toKeyScale(source)).not.toBe(source);
  });
});

describe('toChordData', () => {
  it('hands back a value the caller cannot mutate into library state', () => {
    const source = { rootPc: 0, quality: 'maj' as const, intervals: [0, 4, 7] };
    const coerced = toChordData(source);
    expect(coerced).not.toBe(source);
    expect(coerced.intervals).not.toBe(source.intervals);
  });
});
