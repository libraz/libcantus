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

import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { Key } from '../src/model/key.js';
import { scaleByName, scaleTonesInDegreeOrder } from '../src/theory/scale/index.js';
import { heptatonicFrameOf } from '../src/theory/tendency/index.js';

/** C major pentatonic, and the major it is read against. */
const PENTATONIC = scaleByName('majorPentatonic', 0);
const FRAME_TONES = scaleTonesInDegreeOrder(heptatonicFrameOf(PENTATONIC));

/** A phrase on the pentatonic's own tones. */
const MELODY: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 1 },
  { pitch: 64, startBeat: 1, durationBeat: 1 },
  { pitch: 67, startBeat: 2, durationBeat: 1 },
  { pitch: 69, startBeat: 3, durationBeat: 1 },
  { pitch: 72, startBeat: 4, durationBeat: 2 },
];

describe('harmonizing a melody in a scale of other than seven tones', () => {
  it('answers with chords instead of refusing the key', () => {
    const result = harmonizeMelody({ melody: MELODY, key: PENTATONIC });
    expect(result.chords.length).toBeGreaterThan(0);
    for (const chord of result.chords) {
      expect(FRAME_TONES).toContain(chord.rootPc);
    }
  });

  it('numbers a chord degree in the frame its root was read from', () => {
    // The degree and the root are two halves of one chord: reading them in
    // different degree spaces is what made the sixth degree answer with the
    // first, and it cannot be seen in a chord that has only one of them.
    const result = harmonizeMelody({
      melody: MELODY,
      key: PENTATONIC,
      reharmonize: 'secondaryDominant',
    });
    for (const chord of result.chords) {
      if (chord.degree === undefined || chord.secondaryDominant) {
        continue;
      }
      expect(chord.rootPc, `degree ${chord.degree}`).toBe(FRAME_TONES[chord.degree - 1]);
    }
  });

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

describe('writing a progression in a scale of other than seven tones', () => {
  it('reads every preset degree in the heptatonic frame', () => {
    const chords = generateProgression({ bars: 4, key: PENTATONIC, style: 'dance', ctx: 1 });
    expect(chords).toHaveLength(4);
    for (const chord of chords) {
      expect(FRAME_TONES).toContain(chord.rootPc);
      if (chord.degree !== undefined) {
        expect(chord.rootPc, `degree ${chord.degree}`).toBe(FRAME_TONES[chord.degree - 1]);
      }
    }
  });

  it('writes the same chords as the major the degrees are read in', () => {
    // The frame is the parallel major, so a preset written in degrees comes out
    // as the same progression in both keys: the pentatonic narrows the melody,
    // not the harmony a numeral names.
    const pentatonic = generateProgression({
      bars: 4,
      key: PENTATONIC,
      style: 'dance',
      ctx: 1,
    });
    const major = generateProgression({
      bars: 4,
      key: heptatonicFrameOf(PENTATONIC),
      style: 'dance',
      ctx: 1,
    });
    expect(pentatonic).toEqual(major);
  });
});
