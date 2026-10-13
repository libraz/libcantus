/**
 * A key with some other number of tones than seven is a key the generators
 * write for.
 *
 * A pentatonic or a blues scale is where pops writes tunes, and `Key` treats
 * both as first-class, so an option typed to take a key takes those too. The
 * degrees they are harmonized in are the degrees of the parallel major — the
 * heptatonic frame the numerals and the tonicization targets are already
 * measured in — because a degree is one of seven and a five-tone scale has no
 * degree-for-degree frame of its own.
 */

import type { NoteEvent } from '@libraz/libcantus/core';
import { harmonizeMelody } from '@libraz/libcantus/generate';
import { Key } from '@libraz/libcantus/model';
import { scaleByName } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

/** C major pentatonic, and the major it is read against. */
const PENTATONIC = scaleByName('majorPentatonic', 0);

/** A phrase on the pentatonic's own tones. */
const MELODY: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 64, startBeat: 1, durationBeat: 1 },
  { pitch: 67, startBeat: 2, durationBeat: 1 },
  { pitch: 69, startBeat: 3, durationBeat: 1 },
  { pitch: 72, startBeat: 4, durationBeat: 2 },
];

describe('harmonizing a melody in a scale of other than seven tones', () => {
  it('takes the same key through the class the caller holds', () => {
    const named = Key.named('majorPentatonic', 'C');
    const result = harmonizeMelody({ melody: MELODY, key: named });
    expect(result.chords.length).toBeGreaterThan(0);
    expect(result.key.scale.modeMask12).toBe(PENTATONIC.modeMask12);
  });

  it('harmonizes a blues melody in the blues scale it is written in', () => {
    const blues = scaleByName('blues', 0);
    const result = harmonizeMelody({
      melody: [
        { pitch: 60, startBeat: 0, durationBeat: 1 },
        { pitch: 63, startBeat: 1, durationBeat: 1 },
        { pitch: 65, startBeat: 2, durationBeat: 2 },
      ],
      key: blues,
    });
    expect(result.chords.length).toBeGreaterThan(0);
  });
});
