/**
 * The words two layers use for the same musical concept.
 *
 * Each case here reads one musical figure through two layers and asserts they
 * call it the same thing. A layer-local test cannot catch this: both sides pass
 * their own suites while a caller putting the two answers side by side gets a
 * note-level reading and a chord-level reading that do not line up.
 */
import { describe, expect, it } from 'vitest';
import { hypermeter } from '../src/analyze/form/index.js';
import { parallelKey } from '../src/analyze/functional/index.js';
import { gridOriginOf } from '../src/analyze/grid.js';
import { parseNote } from '../src/core/pitch/index.js';
import {
  majorKey,
  minorKey,
  parallelKeyOf,
  scaleTonesInDegreeOrder,
} from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

describe('what counts as a pickup is one question, answered in one place', () => {
  const block = (pitches: number[], at: number, len: number) =>
    pitches.map((pitch) => ({ pitch, startBeat: at, durationBeat: len }));
  // Harmony turning at bars 3, 7 and 11: four-bar groups in phase 3, which is
  // the phase that would put a group head on a pickup bar if one were read.
  const material = (firstAt: number) => [
    ...block([60, 64, 67], firstAt, 4),
    ...[4, 8].flatMap((at) => block([60, 64, 67], at, 4)),
    ...[12, 16, 20, 24].flatMap((at) => block([65, 69, 72], at, 4)),
    ...[28, 32, 36, 40].flatMap((at) => block([67, 71, 74], at, 4)),
    ...[44, 48, 52, 56].flatMap((at) => block([60, 64, 67], at, 4)),
  ];

  it('reads a note a millibeat early as the downbeat it is playing', () => {
    // The slot grids of chord and key inference answer this way ...
    expect(gridOriginOf(-0.001, 4).startBeat).toBe(0);
    // ... and the bar grid of form analysis has to answer the same, or a
    // performance exported from a DAW gets a silent bar the score never had.
    expect(hypermeter(material(-0.001))).toEqual(hypermeter(material(0)));
  });
});

describe('the two parallel-key functions name the same key', () => {
  it('agrees on the pitch classes, whatever the representation', () => {
    for (const [name, key] of [
      ['C major', cMajor],
      ['A minor', minorKey(9)],
    ] as const) {
      const plain = parallelKey(key);
      const spelled = parallelKeyOf(parseNote(name.split(' ')[0] as string), key);
      expect(spelled.scale.rootPc, name).toBe(plain.rootPc);
      expect(scaleTonesInDegreeOrder(spelled.scale), name).toEqual(scaleTonesInDegreeOrder(plain));
    }
  });
});
