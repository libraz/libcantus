import { describe, expect, it } from 'vitest';
import { Voicing } from '../src/model/voicing.js';
import { SATB_RANGES } from '../src/theory/voicing/index.js';

/** A four-voice C major chord, and the D minor that follows it in fifths. */
const TONIC = [48, 55, 64, 72];

describe('plain data', () => {
  it('hands out its pitches as a copy, not its own state', () => {
    const voicing = Voicing.of(TONIC);
    expect(voicing.data).not.toBe(voicing.data);
    expect(voicing.data).toEqual(voicing.data);
    expect(voicing.pitches).not.toBe(voicing.pitches);
    voicing.data[0] = 0;
    voicing.pitches[1] = 0;
    expect(voicing.pitches).toEqual(TONIC);
  });
});

describe('realizing a chord', () => {
  it('hands out the SATB ranges as a copy of the shared table', () => {
    expect(Voicing.satbRanges).toEqual(SATB_RANGES.map((range) => ({ ...range })));
    expect(Voicing.satbRanges).not.toBe(Voicing.satbRanges);
    const ranges = Voicing.satbRanges;
    const first = ranges[0] as { min: number };
    first.min = 0;
    expect(Voicing.satbRanges[0]?.min).toBe(SATB_RANGES[0]?.min);
  });
});
