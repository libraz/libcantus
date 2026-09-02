import { describe, expect, it } from 'vitest';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
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
import { Instrument, Score } from '../src/model/index.js';

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

/**
 * A recorded accelerando: a tempo event every `every` beats, rising as it goes.
 *
 * This is what a MIDI import gives — a sequencer writes a tempo event per tick
 * through a ritardando, and the interoperability guide sends a caller here with
 * exactly that map.
 */
function accelerando(count: number, every = 1): TempoMap {
  return Array.from({ length: count }, (_, index) => ({
    startBeat: index * every,
    bpm: 60 + (index % 120),
  }));
}

describe('a tempo map is bounded and read once', () => {
  it('refuses a map longer than any piece declares', () => {
    // The map is read on every conversion asked of it, so an unbounded map is
    // an unbounded per-note cost. It is the map that is refused, not the work
    // built on it — the same bound the meter map takes.
    const huge = accelerando(100_001);
    expect(() => beatsToSeconds(0, huge)).toThrow(BudgetExceededError);
    expect(() => beatsToSeconds(0, huge)).toThrow(/tempo map count/);
    expect(() => secondsToBeats(0, huge)).toThrow(BudgetExceededError);
    expect(() => durationToSeconds(0, 1, huge)).toThrow(BudgetExceededError);
    expect(() => tempoAt(0, huge)).toThrow(BudgetExceededError);
    expect(() => beatsToSeconds(0, accelerando(100_000))).not.toThrow();
  });

  // Fifty thousand tempo events and fifty thousand notes: both inside every
  // bound the module states, and once the product of the two. The reading
  // restates every onset at the score's opening tempo, and each of those
  // restatements validated the whole map and then walked it from the origin to
  // the note's own beat. Held for the length of the pass, the map is read once.
  it('times a piece against a dense map without re-reading it per note', () => {
    const notes = Array.from({ length: 50_000 }, (_, index) => ({
      pitch: 48 + (index % 24),
      startBeat: index,
      durationBeat: 1,
    }));
    const score = Score.of(notes, { tempo: accelerando(50_000) });
    expect(score.playability(Instrument.guitar()).issues.length).toBeGreaterThanOrEqual(0);
  }, 5_000);

  // A map handed to a conversion is validated by it, and a caller converting
  // position after position hands over the same map every time. Validating it
  // afresh each time — the range of every tempo, the ordering of every onset,
  // and the messages built to describe them — costs the whole map per question.
  // A map already validated and unchanged since is recognised instead, which
  // leaves a comparison per entry rather than a validation.
  it('validates a map once however many positions are converted against it', () => {
    const map = accelerando(20_000);
    let last = 0;
    for (let beat = 0; beat < 20_000; beat += 1) {
      last = beatsToSeconds(beat, map);
    }
    expect(last).toBeGreaterThan(0);
  }, 5_000);

  it('re-validates a map the caller has written to since', () => {
    // The map is remembered by identity, so what makes the memo safe is that a
    // map whose entries no longer read as they did is validated again — and a
    // caller's array is theirs to write to.
    const map: { startBeat: number; bpm: number }[] = [
      { startBeat: 0, bpm: 120 },
      { startBeat: 4, bpm: 60 },
    ];
    expect(beatsToSeconds(8, map)).toBe(6);
    map[1] = { startBeat: 4, bpm: 0 };
    expect(() => beatsToSeconds(8, map)).toThrow(InvalidInputError);
    map[1] = { startBeat: 4, bpm: 240 };
    expect(beatsToSeconds(8, map)).toBe(3);
    // Shortening it is a change too: the memo compares the whole array.
    map.length = 1;
    expect(beatsToSeconds(8, map)).toBe(4);
  });

  it('reads the same times a segment-by-segment walk reads', () => {
    // The elapsed time to a beat is the sum of the whole segments before it and
    // the part of the one holding it, whether that sum is made per call or once
    // for the map.
    const map = accelerando(64, 2);
    for (const beat of [-3, 0, 1, 2.5, 63, 126, 200]) {
      let expected = 0;
      for (let index = 0; index < map.length; index += 1) {
        const event = map[index];
        const next = map[index + 1];
        if (event === undefined) {
          continue;
        }
        const start = index === 0 ? Number.NEGATIVE_INFINITY : event.startBeat;
        const end = next?.startBeat ?? Number.POSITIVE_INFINITY;
        const low = Math.max(Math.min(0, beat), start);
        const high = Math.min(Math.max(0, beat), end);
        if (high > low) {
          expected += ((high - low) * 60) / event.bpm;
        }
      }
      expect(beatsToSeconds(beat, map)).toBeCloseTo(beat < 0 ? -expected : expected, 9);
      expect(secondsToBeats(beatsToSeconds(beat, map), map)).toBeCloseTo(beat, 9);
    }
  });
});
