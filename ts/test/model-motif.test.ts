import { describe, expect, it } from 'vitest';
import { Motif } from '../src/model/motif.js';

/** The seed motif the equivalence checks are made against. */
function subject(): Motif {
  return Motif.generate({ key: 'C major', bars: 2, ctx: { seed: 5 } });
}

describe('Motif plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const motif = subject();
    expect(motif.data).not.toBe(motif.data);
    expect(motif.data).toEqual(motif.data);
    expect(motif.data.notes[0]).not.toBe(motif.data.notes[0]);
    expect(motif.notes).not.toBe(motif.notes);
  });
});
