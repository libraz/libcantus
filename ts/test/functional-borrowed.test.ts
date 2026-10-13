import { describe, expect, it } from 'vitest';
import { parallelKey } from '../src/analyze/functional/index.js';
import { MAJOR_MASK, majorKey, minorKey, NATURAL_MINOR_MASK } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const aMinor = minorKey(9);

describe('parallelKey', () => {
  it('mirrors major to natural minor and back on the same tonic', () => {
    expect(parallelKey(cMajor)).toEqual({ rootPc: 0, modeMask12: NATURAL_MINOR_MASK });
    expect(parallelKey(aMinor)).toEqual({ rootPc: 9, modeMask12: MAJOR_MASK });
  });
});
