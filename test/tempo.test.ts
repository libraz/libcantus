import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import {
  beatsToSeconds,
  beatsToTicks,
  durationToSeconds,
  secondsToBeats,
  type TempoMap,
  tempoAt,
  ticksToBeats,
} from '../src/core/tempo/index.js';
import { assertNoteEvent } from '../src/core/validation/index.js';

const CONSTANT: TempoMap = [{ startBeat: 0, bpm: 120 }];
const CHANGING: TempoMap = [
  { startBeat: 0, bpm: 120 },
  { startBeat: 4, bpm: 60 },
  { startBeat: 8, bpm: 180 },
];

describe('beats to seconds', () => {
  it('converts at a constant tempo', () => {
    expect(beatsToSeconds(0, CONSTANT)).toBe(0);
    expect(beatsToSeconds(4, CONSTANT)).toBe(2);
    expect(beatsToSeconds(1, CONSTANT)).toBe(0.5);
  });

  it('sums the segments a span crosses rather than using the tempo at the query', () => {
    // 4 beats at 120 (2 s) + 4 beats at 60 (4 s); reading the whole span at 60
    // would give 8 s.
    expect(beatsToSeconds(8, CHANGING)).toBe(6);
    expect(beatsToSeconds(10, CHANGING)).toBeCloseTo(6 + 2 / 3, 12);
  });

  it('lands exactly on a tempo change', () => {
    expect(beatsToSeconds(4, CHANGING)).toBe(2);
  });

  it('measures time from the first event of the map', () => {
    const late: TempoMap = [
      { startBeat: 4, bpm: 120 },
      { startBeat: 8, bpm: 60 },
    ];
    expect(beatsToSeconds(4, late)).toBe(0);
    expect(beatsToSeconds(12, late)).toBe(6);
    expect(secondsToBeats(0, late)).toBe(4);
  });

  it('reads a beat before the map begins at the opening tempo', () => {
    // The map's first event is the time origin, so a beat before it has run a
    // negative amount of time — which is what a pickup has done. The opening
    // tempo governs it; the map names no other one.
    const late: TempoMap = [{ startBeat: 4, bpm: 120 }];
    expect(beatsToSeconds(3, late)).toBe(-0.5);
    expect(durationToSeconds(3, 1, late)).toBe(0.5);
    expect(tempoAt(3, late)).toBe(120);
  });

  it('rejects a non-finite beat', () => {
    expect(() => beatsToSeconds(Number.NaN, CONSTANT)).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(Number.POSITIVE_INFINITY, CONSTANT)).toThrow(InvalidInputError);
  });
});

describe('seconds to beats', () => {
  it('inverts the constant case', () => {
    expect(secondsToBeats(2, CONSTANT)).toBe(4);
    expect(secondsToBeats(0, CONSTANT)).toBe(0);
  });

  it('round-trips through every tempo segment', () => {
    for (const map of [CONSTANT, CHANGING]) {
      for (const beat of [0, 0.25, 1, 3.75, 4, 5.5, 8, 8.125, 12, 100.5]) {
        expect(secondsToBeats(beatsToSeconds(beat, map), map)).toBeCloseTo(beat, 9);
      }
    }
  });

  it('round-trips seconds back to seconds', () => {
    for (const seconds of [0, 0.1, 1.5, 2, 6, 6.25, 30]) {
      expect(beatsToSeconds(secondsToBeats(seconds, CHANGING), CHANGING)).toBeCloseTo(seconds, 9);
    }
  });

  it('extrapolates past the last tempo event with that tempo', () => {
    // 6 s reaches beat 8; 180 bpm then adds three beats per second.
    expect(secondsToBeats(7, CHANGING)).toBe(11);
  });

  it('walks back from the origin when the seconds are negative', () => {
    // A DAW that reports a pickup's position in wall-clock time reports it
    // before the origin, and the conversion has to come back with the beat.
    expect(secondsToBeats(-1, CONSTANT)).toBe(-2);
    expect(secondsToBeats(-0.5, CONSTANT)).toBe(-1);
    expect(() => secondsToBeats(Number.NaN, CONSTANT)).toThrow(InvalidInputError);
    expect(() => secondsToBeats(Number.NEGATIVE_INFINITY, CONSTANT)).toThrow(InvalidInputError);
  });
});

describe('durations in seconds', () => {
  it('matches the difference of two elapsed times', () => {
    for (const [start, length] of [
      [0, 4],
      [2, 4],
      [3.5, 0.5],
      [4, 8],
      [9, 3],
    ] as const) {
      expect(durationToSeconds(start, length, CHANGING)).toBeCloseTo(
        beatsToSeconds(start + length, CHANGING) - beatsToSeconds(start, CHANGING),
        9,
      );
    }
  });

  it('spans a tempo change', () => {
    // 2 beats at 120 (1 s) + 2 beats at 60 (2 s).
    expect(durationToSeconds(2, 4, CHANGING)).toBe(3);
  });

  it('reports zero for an empty span', () => {
    expect(durationToSeconds(2, 0, CHANGING)).toBe(0);
  });

  it('rejects a negative length', () => {
    expect(() => durationToSeconds(2, -1, CHANGING)).toThrow(InvalidInputError);
  });
});

describe('tempo lookup', () => {
  it('reads the tempo in effect', () => {
    expect(tempoAt(0, CHANGING)).toBe(120);
    expect(tempoAt(3.99, CHANGING)).toBe(120);
    expect(tempoAt(4, CHANGING)).toBe(60);
    expect(tempoAt(100, CHANGING)).toBe(180);
  });
});

describe('tempo map validation', () => {
  it('rejects an empty or non-array map', () => {
    expect(() => beatsToSeconds(0, [])).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(0, undefined as unknown as TempoMap)).toThrow(InvalidInputError);
  });

  it('rejects a hole in the map', () => {
    const sparse = new Array<{ startBeat: number; bpm: number }>(2);
    sparse[1] = { startBeat: 0, bpm: 120 };
    expect(() => beatsToSeconds(0, sparse)).toThrow(InvalidInputError);
  });

  it('rejects an unsorted map rather than sorting it', () => {
    const unsorted: TempoMap = [
      { startBeat: 4, bpm: 60 },
      { startBeat: 0, bpm: 120 },
    ];
    expect(() => beatsToSeconds(4, unsorted)).toThrow(InvalidInputError);
  });

  it('rejects two events on the same beat', () => {
    const repeated: TempoMap = [
      { startBeat: 0, bpm: 120 },
      { startBeat: 0, bpm: 60 },
    ];
    expect(() => beatsToSeconds(0, repeated)).toThrow(InvalidInputError);
  });

  it('rejects a non-positive or absurd tempo', () => {
    expect(() => beatsToSeconds(0, [{ startBeat: 0, bpm: 0 }])).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(0, [{ startBeat: 0, bpm: -120 }])).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(0, [{ startBeat: 0, bpm: Number.NaN }])).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(0, [{ startBeat: 0, bpm: 1001 }])).toThrow(InvalidInputError);
  });

  it('keeps every conversion finite by refusing a tempo below the floor', () => {
    // A denormal tempo used to pass validation and then hand back Infinity,
    // which `secondsToBeats` refuses in turn — so the round trip broke on a map
    // the module had already called valid.
    const denormal: TempoMap = [{ startBeat: 0, bpm: Number.MIN_VALUE }];
    expect(() => beatsToSeconds(1, denormal)).toThrow(InvalidInputError);
    expect(() => beatsToSeconds(1, [{ startBeat: 0, bpm: 0.09 }])).toThrow(InvalidInputError);
    const slowest: TempoMap = [{ startBeat: 0, bpm: 0.1 }];
    expect(Number.isFinite(beatsToSeconds(1, slowest))).toBe(true);
    expect(beatsToSeconds(1, slowest)).toBe(600);
    expect(secondsToBeats(beatsToSeconds(1, slowest), slowest)).toBeCloseTo(1, 9);
  });

  it('states the bound it rejects a tempo against in plain decimals', () => {
    // The message is what a host shows the person holding the broken project
    // file, so the bounds in it have to be numbers they can act on.
    expect(() => beatsToSeconds(0, [{ startBeat: 0, bpm: 0 }])).toThrow(/\[0\.1, 1000\]/);
  });

  it('accepts a negative onset, because a tempo is marked on the pickup', () => {
    // The module doc used to send a caller with a pickup here — "move the
    // origin" — and this is the map that instruction produces.
    const fromPickup: TempoMap = [{ startBeat: -1, bpm: 120 }];
    expect(beatsToSeconds(-1, fromPickup)).toBe(0);
    expect(beatsToSeconds(0, fromPickup)).toBe(0.5);
    expect(() => beatsToSeconds(0, [{ startBeat: Number.NaN, bpm: 120 }])).toThrow(
      InvalidInputError,
    );
    expect(() => beatsToSeconds(0, [{ startBeat: Number.NEGATIVE_INFINITY, bpm: 120 }])).toThrow(
      InvalidInputError,
    );
  });
});

describe('ticks', () => {
  it('converts at the common resolutions', () => {
    for (const ppq of [96, 480, 960]) {
      expect(beatsToTicks(1, ppq)).toBe(ppq);
      expect(beatsToTicks(1.5, ppq)).toBe(ppq * 1.5);
      expect(beatsToTicks(0.25, ppq)).toBe(ppq / 4);
      expect(ticksToBeats(ppq, ppq)).toBe(1);
      expect(ticksToBeats(ppq * 4, ppq)).toBe(4);
    }
    expect(beatsToTicks(1.5, 480)).toBe(720);
  });

  it('round-trips a beat that lands on the grid', () => {
    for (const ppq of [96, 480, 960]) {
      for (const beat of [0, 0.5, 1, 2.25, 7.75, 64]) {
        expect(ticksToBeats(beatsToTicks(beat, ppq), ppq)).toBe(beat);
      }
    }
  });

  it('quantizes a beat that does not land on the grid', () => {
    // A triplet eighth at PPQ 96 is 16 ticks; at PPQ 100 it is not representable.
    expect(beatsToTicks(1 / 3, 96)).toBe(32);
    expect(beatsToTicks(1 / 3, 100)).toBe(33);
  });

  it('rejects invalid ticks and resolutions', () => {
    expect(() => beatsToTicks(Number.NaN, 480)).toThrow(InvalidInputError);
    expect(() => beatsToTicks(Number.POSITIVE_INFINITY, 480)).toThrow(InvalidInputError);
    expect(() => beatsToTicks(1, 0)).toThrow(InvalidInputError);
    expect(() => beatsToTicks(1, 480.5)).toThrow(InvalidInputError);
    expect(() => ticksToBeats(1.5, 480)).toThrow(InvalidInputError);
    expect(() => ticksToBeats(Number.NaN, 480)).toThrow(InvalidInputError);
    expect(() => ticksToBeats(480, -1)).toThrow(InvalidInputError);
  });

  it('carries a pickup across the MIDI boundary and back', () => {
    // A tick count is a position, and a position before the first downbeat is
    // negative. Rejecting it would leave a pickup no way through the export.
    expect(beatsToTicks(-1, 480)).toBe(-480);
    expect(ticksToBeats(-480, 480)).toBe(-1);
    for (const ppq of [96, 480, 960]) {
      for (const beat of [-4, -1, -0.5, -0.25, 0, 0.5, 7.75]) {
        expect(ticksToBeats(beatsToTicks(beat, ppq), ppq)).toBe(beat);
      }
    }
  });

  it('rounds a beat just before the downbeat to positive zero', () => {
    // A humanized or slightly early pickup note rounds down onto the downbeat.
    // `-0` and `0` are the same tick, but they key apart under `Object.is`, so
    // a writer bucketing events by tick would see two beat 0s.
    expect(Object.is(beatsToTicks(-0.0005, 480), 0)).toBe(true);
    expect(Object.is(beatsToTicks(-0.0005, 960), 0)).toBe(true);
    expect(Object.is(beatsToTicks(-0, 480), 0)).toBe(true);
    // A beat far enough before the downbeat is still a negative tick count.
    expect(beatsToTicks(-0.5, 480)).toBe(-240);
  });
});

describe('the tempo domain covers the onsets the library accepts', () => {
  /** A tempo marked on the downbeat, with a one-beat pickup before it. */
  const PICKUP_BEAT = -1;

  it('never rejects an onset only for being negative', () => {
    // `assertNoteEvent` accepts a pickup's onset, so the conversions a caller
    // reaches for next have to accept it too — otherwise a piece the library
    // reads cannot be exported or timed.
    expect(() =>
      assertNoteEvent({ pitch: 60, startBeat: PICKUP_BEAT, durationBeat: 1 }),
    ).not.toThrow();
    expect(() => beatsToSeconds(PICKUP_BEAT, CONSTANT)).not.toThrow();
    expect(() => durationToSeconds(PICKUP_BEAT, 1, CONSTANT)).not.toThrow();
    expect(() => tempoAt(PICKUP_BEAT, CONSTANT)).not.toThrow();
    expect(() => beatsToTicks(PICKUP_BEAT, 480)).not.toThrow();
    expect(beatsToSeconds(PICKUP_BEAT, CONSTANT)).toBeLessThan(0);
    expect(beatsToTicks(PICKUP_BEAT, 480)).toBeLessThan(0);
  });

  it('integrates additively across the origin', () => {
    for (const map of [CONSTANT, CHANGING]) {
      for (const [start, length] of [
        [-4, 2],
        [-1, 1],
        [-1, 6],
        [-0.5, 0.25],
        [-2, 12],
      ] as const) {
        expect(beatsToSeconds(start, map) + durationToSeconds(start, length, map)).toBeCloseTo(
          beatsToSeconds(start + length, map),
          9,
        );
      }
      // The origin is where the clock reads zero, whichever side is asked.
      expect(beatsToSeconds(map[0]?.startBeat ?? 0, map)).toBe(0);
    }
  });

  it('round-trips a negative beat through seconds', () => {
    for (const map of [CONSTANT, CHANGING]) {
      for (const beat of [-8, -4, -1, -0.5, -0.125]) {
        expect(secondsToBeats(beatsToSeconds(beat, map), map)).toBeCloseTo(beat, 9);
      }
    }
  });

  it('keeps elapsed time rising with the beat across the origin', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const beat of [-8, -4, -1, -0.5, 0, 0.5, 4, 8, 12]) {
      const seconds = beatsToSeconds(beat, CHANGING);
      expect(seconds).toBeGreaterThan(previous);
      previous = seconds;
    }
  });
});
