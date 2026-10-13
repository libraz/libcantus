import { describe, expect, it } from 'vitest';
import {
  chordTimelineFromNotes,
  type Key,
  keyTimelineFromNotes,
  type NoteEvent,
  prevailingKeyOf,
  Score,
} from '../src/index.js';
import { keyIdentity } from '../src/model/key.js';

/**
 * The library publishes one engine twice: as standalone functions, and as the
 * classes of `src/model`. The claim the guides make for that pair is that the
 * two are the same thing — that reaching for a class costs no capability and
 * changes no answer.
 *
 * Every case here holds a class method against the function it delegates to,
 * on the same input: the class result unwrapped to plain data, against what the
 * function returns. Where a method carries options through, the case passes a
 * non-default set, since a method that quietly drops an option answers exactly
 * like the default it fell back to. Where a method generates, the two sides are
 * driven from the same seed, which is the strongest statement the pair admits.
 */

/** A tonic-dominant-tonic phrase, long enough for the form analyses to read. */
const PHRASE: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 2, velocity: 96 },
  { pitch: 64, startBeat: 2, durationBeat: 2, velocity: 80 },
  { pitch: 67, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 71, startBeat: 6, durationBeat: 2, velocity: 72 },
  { pitch: 62, startBeat: 8, durationBeat: 4, velocity: 90 },
  { pitch: 60, startBeat: 12, durationBeat: 4, velocity: 100 },
];

describe('Score', () => {
  const score = Score.of(PHRASE, { meters: '4/4', tempo: 100 });

  it('infers the harmony and the keys the analyses infer from the same notes', () => {
    const found = chordTimelineFromNotes(score.notes, { meters: score.meters });
    expect(score.timeline().segments).toEqual(found.timeline.segments);
    expect(score.timeline().keys).toEqual(found.keys);
    expect(score.keys()).toEqual(keyTimelineFromNotes(score.notes, { meters: score.meters }));
    expect(keyIdentity(score.key() as Key)).toEqual(prevailingKeyOf(score.keys()));
  });
});
