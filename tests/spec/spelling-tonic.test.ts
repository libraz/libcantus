import { InvalidInputError, parseNote } from '@libraz/libcantus/core';
import { majorKey, spellScale } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

describe('the tonic a spelling function is given', () => {
  it('answers the way the class API answers', () => {
    // `new Key(scale, tonic)` has always refused the pair; the functional API
    // silently accepted it, so the two surfaces disagreed about the same input.
    expect(() => spellScale(parseNote('B'), majorKey(6))).toThrow(InvalidInputError);
    expect(() => spellScale(parseNote('Gb'), majorKey(6))).not.toThrow();
  });
});
