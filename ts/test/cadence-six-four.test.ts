import { describe, expect, it } from 'vitest';
import { isCadentialSixFour } from '../src/analyze/functional/cadence.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

/** C/G, the tonic triad of C major standing on the dominant bass. */
const sixFour = () => makeChord(0, 'maj', 7);

describe('isCadentialSixFour', () => {
  it('holds for the tonic six-four standing on the dominant it resolves to', () => {
    expect(isCadentialSixFour(sixFour(), makeChord(7, 'maj'), cMajor)).toBe(true);
    expect(isCadentialSixFour(sixFour(), makeChord(7, 'dom7'), cMajor)).toBe(true);
    // The minor key cadences on the same raised dominant.
    expect(isCadentialSixFour(makeChord(9, 'min', 4), makeChord(4, 'maj'), aMinor)).toBe(true);
  });

  it('refuses a six-four the bass leaves', () => {
    // The passing six-four of IV-I64-IV: the next chord is not the dominant.
    expect(isCadentialSixFour(sixFour(), makeChord(5, 'maj'), cMajor)).toBe(false);
    // A neighbouring six-four over the tonic bass.
    expect(isCadentialSixFour(sixFour(), makeChord(0, 'maj'), cMajor)).toBe(false);
  });

  it('refuses a tonic that is not standing on the dominant bass', () => {
    expect(isCadentialSixFour(makeChord(0, 'maj'), makeChord(7, 'maj'), cMajor)).toBe(false);
    expect(isCadentialSixFour(makeChord(0, 'maj', 4), makeChord(7, 'maj'), cMajor)).toBe(false);
  });

  it('refuses a six-four on any degree but the tonic', () => {
    // F/C to G: a subdominant six-four is not the cadential figure.
    expect(isCadentialSixFour(makeChord(5, 'maj', 0), makeChord(7, 'maj'), cMajor)).toBe(false);
  });
});
