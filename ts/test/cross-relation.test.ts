import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/core/pitch/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { crossRelations } from '../src/theory/partwriting/cross-relation.js';
import { majorKey } from '../src/theory/scale/index.js';

const notes = (names: string[]) => names.map((name) => parseNote(name));

describe('crossRelations', () => {
  const key = majorKey(0);
  const chord = makeChord(0, 'maj');

  it('reports a pair once when the two voices trade F and F#', () => {
    // The outer voices hold F and F# on both sides, so the pair is met in both
    // directions and must come back as one entry.
    const from = { notes: notes(['F2', 'A3', 'C4', 'F#4']), chord };
    const to = { notes: notes(['F2', 'A3', 'D4', 'F#4']), chord };
    expect(crossRelations(from, to, key)).toHaveLength(1);
  });

  it('does not compare a voice with its own inflection', () => {
    const from = { notes: notes(['F2', 'A3', 'C4', 'F4']), chord };
    const to = { notes: notes(['F#2', 'A3', 'D4', 'D4']), chord };
    expect(crossRelations(from, to, key)).toEqual([]);
  });
});
