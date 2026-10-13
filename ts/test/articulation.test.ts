import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  ARTICULATIONS,
  type Articulation,
  BASS_4_STRING,
  playability,
} from '../src/core/instrument/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  assertNoteEvent,
  assertNoteEvents,
  dropSilentNotes,
} from '../src/core/validation/index.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { generateFill } from '../src/generate/drums/fills.js';
import { DRUM_NOTES, HitList } from '../src/generate/drums/hit.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { Score } from '../src/model/score.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** The four beats of a fill bar starting at beat 12, rendered on their own. */
function renderFill(fill: Parameters<typeof generateFill>[3]): HitList {
  const track = new HitList();
  for (let beat = 0; beat < 4; beat += 1) {
    generateFill(track, 12 + beat, beat, fill, 100);
  }
  return track;
}

describe('Articulation', () => {
  it('names every technique the library can carry', () => {
    expect([...ARTICULATIONS]).toEqual([
      'accent',
      'ghost',
      'staccato',
      'legato',
      'slide',
      'hammer',
      'mute',
      'flam',
      'drag',
      'roll',
      'choke',
      'open',
    ]);
  });

  it('round-trips through generation', () => {
    const hits = renderFill('flamsAndDrags').hits;
    const ornamented = hits.filter((hit) => hit.articulation !== undefined);
    expect(ornamented.map((hit) => hit.articulation)).toEqual(['flam', 'drag', 'flam']);
    for (const hit of ornamented) {
      expect(hit.pitch).toBe(DRUM_NOTES.snare);
    }
  });

  it('reaches a caller of generateDrums', () => {
    // Sweep seeds until the into-chorus fill selection lands on the flammed
    // archetype; the point is that the attribute survives the whole generator,
    // not that a particular seed picks it.
    const articulations = new Set<Articulation>();
    for (let seed = 0; seed < 40; seed += 1) {
      for (const hit of generateDrums({
        bars: 2,
        ctx: { bpm: 120, complexity: { rhythmic: 0.7 }, seed: seed },
        style: 'breakbeat',
        section: 'verse',
        nextSection: 'chorus',
        fills: true,
      })) {
        if (hit.articulation !== undefined) {
          articulations.add(hit.articulation);
        }
      }
    }
    expect(articulations).toContain('flam');
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

  it('is refused when it names no technique the library carries', () => {
    // The cast is the point: a JSON import or a JavaScript caller holds no
    // closed type, so the name arrives unchecked and the run-time check is the
    // only thing standing between it and the rest of the library.
    const unknown = {
      pitch: 38,
      startBeat: 0,
      durationBeat: 0.5,
      articulation: 'sforzando',
    } as unknown as NoteEvent;
    expect(() => assertNoteEvent(unknown)).toThrow(InvalidInputError);
    expect(() => assertNoteEvent(unknown)).toThrow(/articulation/);
    expect(() => assertNoteEvents([unknown])).toThrow(InvalidInputError);
    expect(() => Score.of([unknown])).toThrow(InvalidInputError);
    expect(() => Score.fromJSON({ ...Score.empty().toJSON(), notes: [unknown] })).toThrow(
      InvalidInputError,
    );
    // The instrument is never consulted, so the unknown name reaches no report:
    // it is an input error, not the musical claim that a bass cannot play it.
    expect(() => playability([unknown], BASS_4_STRING)).toThrow(InvalidInputError);
  });

  it('still reads a known technique the instrument lacks as a playability issue', () => {
    // The other side of the same line: `flam` is a technique, and a bass not
    // offering it is a fact about the bass rather than about the input.
    const report = playability(
      [{ pitch: 40, startBeat: 0, durationBeat: 1, articulation: 'flam' }],
      BASS_4_STRING,
    );
    expect(report.issues.map((issue) => issue.type)).toEqual(['articulationUnavailable']);
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

describe('generateBassLine with an instrument', () => {
  const segments: BassSegment[] = [
    { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
    { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
  ];

  it('leaves the output unchanged when no instrument is given', () => {
    // Pinned from the behaviour before instruments existed: octave 1 puts the
    // line on C1 and G1, octave 0 an octave below that, both under the lowest
    // string of any bass.
    expect(generateBassLine({ segments, key: cMajor, octave: 1 }).map((n) => n.pitch)).toEqual([
      24, 31,
    ]);
    expect(generateBassLine({ segments, key: cMajor, octave: 0 }).map((n) => n.pitch)).toEqual([
      12, 19,
    ]);
  });
});
