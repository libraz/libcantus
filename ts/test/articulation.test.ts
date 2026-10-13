import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import {
  assertNoteEvent,
  assertNoteEvents,
  dropSilentNotes,
} from '../src/core/validation/index.js';
import { generateFill } from '../src/generate/drums/fills.js';
import { DRUM_NOTES, HitList } from '../src/generate/drums/hit.js';

/** The four beats of a fill bar starting at beat 12, rendered on their own. */
function renderFill(fill: Parameters<typeof generateFill>[3]): HitList {
  const track = new HitList();
  for (let beat = 0; beat < 4; beat += 1) {
    generateFill(track, 12 + beat, beat, fill, 100);
  }
  return track;
}

describe('Articulation', () => {
  it('round-trips through generation', () => {
    const hits = renderFill('flamsAndDrags').hits;
    const ornamented = hits.filter((hit) => hit.articulation !== undefined);
    expect(ornamented.map((hit) => hit.articulation)).toEqual(['flam', 'drag', 'flam']);
    for (const hit of ornamented) {
      expect(hit.pitch).toBe(DRUM_NOTES.snare);
    }
  });

  it('is absent, not undefined, on a plain stroke', () => {
    for (const hit of renderFill('snareRoll').hits) {
      expect('articulation' in hit).toBe(false);
    }
  });

  it('is ignored by a reader that does not know it', () => {
    const plain: NoteEvent = { pitch: 38, startBeat: 0, durationBeat: 0.5, velocity: 90 };
    const ornamented: NoteEvent = { ...plain, articulation: 'ghost' };
    // Every core reader validates and passes the note through untouched: the
    // attribute is additional information, never a different note.
    expect(assertNoteEvent(ornamented)).toBe(ornamented);
    expect(assertNoteEvents([ornamented])).toHaveLength(1);
    expect(dropSilentNotes([ornamented])).toEqual([ornamented]);
    const asKnownFields = ({ pitch, startBeat, durationBeat, velocity }: NoteEvent): NoteEvent => ({
      pitch,
      startBeat,
      durationBeat,
      velocity,
    });
    expect(asKnownFields(ornamented)).toEqual(asKnownFields(plain));
  });
});

describe('flamsAndDrags', () => {
  it('carries its ornaments as attributes rather than as extra onsets', () => {
    const hits = renderFill('flamsAndDrags').hits;
    // Beat 0 and beat 1 are the shared fill lead-in (two hits each); the
    // archetype itself contributes a flammed and a dragged stroke on beat 2 and
    // a flammed stroke on beat 3. The grace notes those ornaments used to be
    // written as are gone, so the note count is lower by three.
    expect(hits).toHaveLength(7);
    const own = hits.filter((hit) => hit.startBeat >= 14);
    expect(own).toHaveLength(3);
    expect(own.map((hit) => hit.startBeat)).toEqual([14, 14.75, 15]);
  });

  it('never writes a grace note before the beat it ornaments', () => {
    for (const hit of renderFill('flamsAndDrags').hits) {
      expect(Number.isInteger(hit.startBeat * 4)).toBe(true);
    }
  });
});
