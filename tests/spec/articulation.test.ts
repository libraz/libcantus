import {
  ARTICULATIONS,
  type Articulation,
  assertNoteEvent,
  assertNoteEvents,
  BASS_4_STRING,
  InvalidInputError,
  type NoteEvent,
  playability,
} from '@libraz/libcantus/core';
import { type BassSegment, generateBassLine, generateDrums } from '@libraz/libcantus/generate';
import { Score } from '@libraz/libcantus/model';
import { majorKey, makeChord } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

const cMajor = majorKey(0);

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
