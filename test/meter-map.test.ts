import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import type { MeterChange, MeterMap } from '../src/core/meter/index.js';
import {
  barIndexAt,
  barPositionToBeat,
  barStartBeat,
  beatsPerBarAt,
  beatToBarPosition,
  formatBarPosition,
  meterAt,
  metricWeight,
  parseTimeSignature,
  pulseBeats,
  resolveMeters,
} from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { assertMeterMap } from '../src/core/validation/index.js';

const COMMON = parseTimeSignature('4/4');
const WALTZ = parseTimeSignature('3/4');

/** Two bars of 4/4, then 3/4 from beat 8 on. */
const CHANGING: MeterMap = [
  { startBeat: 0, ts: COMMON },
  { startBeat: 8, ts: WALTZ },
];

/** A triad sounding across one bar. */
function triad(root: number, startBeat: number, durationBeat: number): NoteEvent[] {
  return [root, root + 4, root + 7].map((pitch) => ({ pitch, startBeat, durationBeat }));
}

describe('the meter in force at a beat', () => {
  it('reads the signature governing each side of a change', () => {
    expect(meterAt(0, CHANGING)).toEqual(COMMON);
    expect(meterAt(7.9, CHANGING)).toEqual(COMMON);
    expect(meterAt(8, CHANGING)).toEqual(WALTZ);
    expect(beatsPerBarAt(4, CHANGING)).toBe(4);
    expect(beatsPerBarAt(11, CHANGING)).toBe(3);
    // The first entry governs the beats before it too, so a pickup is read in
    // the signature the piece opens in.
    expect(meterAt(-1, CHANGING)).toEqual(COMMON);
  });

  it('keeps counting bars across the change', () => {
    expect([0, 4, 8, 11, 14].map((beat) => barIndexAt(beat, CHANGING))).toEqual([0, 1, 2, 3, 4]);
    expect(barIndexAt(-1, CHANGING)).toBe(-1);
    expect([2, 5, 9, 13].map((beat) => barStartBeat(beat, CHANGING))).toEqual([0, 4, 8, 11]);
    expect(beatToBarPosition(13, CHANGING)).toEqual({ bar: 3, beat: 2 });
    expect(barPositionToBeat({ bar: 3, beat: 2 }, CHANGING)).toBe(13);
    expect(formatBarPosition(13, CHANGING)).toBe('4.3');
  });
});

describe('metric weight under a meter change', () => {
  it('puts the bar lines where the meter in force puts them', () => {
    // Downbeats fall every four beats before the change and every three after.
    for (const downbeat of [0, 4, 8, 11, 14]) {
      expect(metricWeight(downbeat, CHANGING)).toBe(3);
    }
    // Beat 12 is a downbeat only to a reading stuck in 4/4.
    expect(metricWeight(12, CHANGING)).toBe(1);
    expect(metricWeight(12, COMMON)).toBe(3);
    // And beat 11 is a downbeat only to one that follows the change.
    expect(metricWeight(11, CHANGING)).toBe(3);
    expect(metricWeight(11, COMMON)).toBe(1);
  });

  it('accents the mid-bar of 4/4 and nothing of 3/4', () => {
    // 6 is the mid-bar of the second 4/4 bar; 3/4 has no secondary strong pulse
    // at all, so the same distance into a waltz bar weighs 1.
    expect(metricWeight(6, CHANGING)).toBe(2);
    expect(metricWeight(10, CHANGING)).toBe(1);
    expect(metricWeight(10, WALTZ)).toBe(1);
  });

  it('reads a one-element map exactly as the bare signature', () => {
    const single: MeterMap = [{ startBeat: 0, ts: COMMON }];
    for (let beat = 0; beat < 12; beat += 0.5) {
      expect(metricWeight(beat, single)).toBe(metricWeight(beat, COMMON));
    }
  });
});

describe('a map whose first entry is not written at beat 0', () => {
  /** The map a pickup is written as: the opening signature stated at the pickup. */
  const PICKUP: MeterMap = [{ startBeat: -1, ts: COMMON }];

  it('keeps beat 0 the downbeat of bar 0', () => {
    expect(barStartBeat(0, PICKUP)).toBe(0);
    expect(barIndexAt(0, PICKUP)).toBe(0);
    expect(metricWeight(0, PICKUP)).toBe(3);
    expect(formatBarPosition(0, PICKUP)).toBe('1.1');
    // The pickup itself is the bar before it, as it is under the bare signature.
    expect(barIndexAt(-1, PICKUP)).toBe(-1);
    expect(barStartBeat(-1, PICKUP)).toBe(-4);
    expect(formatBarPosition(-1, PICKUP)).toBe('0.4');
  });

  it('answers exactly as the bare signature does, at every offset', () => {
    for (const startBeat of [-1, -4, -2.5, 0, 3, 7]) {
      const map: MeterMap = [{ startBeat, ts: COMMON }];
      const name = `first entry at ${startBeat}`;
      for (let beat = -8; beat < 12; beat += 0.5) {
        expect(barStartBeat(beat, map), `${name} @${beat}`).toBe(barStartBeat(beat, COMMON));
        expect(barIndexAt(beat, map), `${name} @${beat}`).toBe(barIndexAt(beat, COMMON));
        expect(beatToBarPosition(beat, map), `${name} @${beat}`).toEqual(
          beatToBarPosition(beat, COMMON),
        );
        expect(metricWeight(beat, map), `${name} @${beat}`).toBe(metricWeight(beat, COMMON));
        expect(formatBarPosition(beat, map), `${name} @${beat}`).toBe(
          formatBarPosition(beat, COMMON),
        );
      }
      for (const bar of [-2, -1, 0, 1, 3]) {
        expect(barPositionToBeat({ bar, beat: 1 }, map), `${name} bar ${bar}`).toBe(
          barPositionToBeat({ bar, beat: 1 }, COMMON),
        );
      }
    }
  });

  it('starts a bar at every later change all the same', () => {
    // Only the opening signature is anchored at beat 0; a change still begins a
    // bar where it takes effect, cutting the bar it interrupts short.
    const map: MeterMap = [
      { startBeat: -1, ts: COMMON },
      { startBeat: 6, ts: WALTZ },
    ];
    expect([0, 4, 6, 9].map((beat) => barStartBeat(beat, map))).toEqual([0, 4, 6, 9]);
    expect([0, 4, 6, 9].map((beat) => barIndexAt(beat, map))).toEqual([0, 1, 2, 3]);
    expect(barPositionToBeat({ bar: 2, beat: 0 }, map)).toBe(6);
    expect(metricWeight(6, map)).toBe(3);
    expect(metricWeight(4, map)).toBe(3);
  });
});

describe('positions in a bar cut short by a meter change', () => {
  /** Two 4/4 bars, the second cut to two beats by a change on beat 6. */
  const CUT: MeterMap = [
    { startBeat: 0, ts: COMMON },
    { startBeat: 6, ts: COMMON },
  ];

  it('rolls a position past the end of a short bar into the next bar', () => {
    // Bar 2 is beats 4 and 5 only, so 5.999 rounds to the downbeat of bar 3 —
    // it can never be that bar's third beat, which the bar never reaches.
    expect(formatBarPosition(5.999, CUT)).toBe('3.1');
    expect(formatBarPosition(5, CUT)).toBe('2.2');
    expect(formatBarPosition(6, CUT)).toBe('3.1');
  });

  it('names only felt beats the bar containing them has', () => {
    const meters: MeterMap = [
      { startBeat: 0, ts: COMMON },
      { startBeat: 6, ts: WALTZ },
      { startBeat: 11, ts: parseTimeSignature('6/8') },
      { startBeat: 15.5, ts: COMMON },
    ];
    /** The real length of a bar, which a change can cut short. */
    const lengthOfBar = (bar: number) =>
      barPositionToBeat({ bar: bar + 1, beat: 0 }, meters) -
      barPositionToBeat({ bar, beat: 0 }, meters);
    for (let beat = 0; beat < 20; beat += 0.125) {
      const text = formatBarPosition(beat, meters);
      const [barText, beatText] = text.split('.') as [string, string];
      const bar = Number(barText) - 1;
      const feltBeat = Number(beatText.split('+')[0]);
      const pulse = pulseBeats(meterAt(barPositionToBeat({ bar, beat: 0 }, meters), meters));
      // 1-based felt beats, counted against the pulses the bar really holds.
      expect(feltBeat, `${beat} -> ${text}`).toBeGreaterThanOrEqual(1);
      expect(feltBeat, `${beat} -> ${text}`).toBeLessThanOrEqual(
        Math.ceil(lengthOfBar(bar) / pulse - 1e-9),
      );
    }
  });
});

describe('resolving the meter options', () => {
  it('takes a single signature as sugar for a one-element map', () => {
    expect(resolveMeters({ ts: WALTZ })).toEqual([{ startBeat: 0, ts: WALTZ }]);
    expect(resolveMeters({})).toEqual([{ startBeat: 0, ts: COMMON }]);
    expect(resolveMeters({ meters: CHANGING })).toEqual(CHANGING);
  });

  it('rejects naming the meter twice, and a malformed map', () => {
    expect(() => resolveMeters({ ts: COMMON, meters: CHANGING })).toThrow(RangeError);
    expect(() => resolveMeters({ meters: [] })).toThrow(RangeError);
    expect(() =>
      resolveMeters({
        meters: [
          { startBeat: 4, ts: COMMON },
          { startBeat: 0, ts: WALTZ },
        ],
      }),
    ).toThrow(RangeError);
    expect(() => resolveMeters({ meters: [{ startBeat: Number.NaN, ts: COMMON }] })).toThrow(
      RangeError,
    );
  });
});

describe('reading a long meter map', () => {
  /** A piece that changes meter on every bar, alternating 3/4 and 4/4. */
  function everyBar(bars: number): MeterMap {
    const map: MeterMap = [];
    let beat = 0;
    for (let bar = 0; bar < bars; bar += 1) {
      const numerator = (bar % 2) + 3;
      map.push({ startBeat: beat, ts: { numerator, denominator: 4 } });
      beat += numerator;
    }
    return map;
  }

  /** The entry in force at a beat, found by walking the map. */
  function entryByScan(map: MeterMap, beat: number): MeterChange | undefined {
    let found = map[0];
    for (const entry of map) {
      if (entry.startBeat <= beat + 1e-9) {
        found = entry;
      }
    }
    return found;
  }

  it('finds the same entry the walk finds, at and around every change', () => {
    const map = everyBar(64);
    const last = map[map.length - 1] as MeterChange;
    for (const entry of map) {
      for (const beat of [entry.startBeat - 0.5, entry.startBeat, entry.startBeat + 0.5]) {
        expect(meterAt(beat, map), `beat ${beat}`).toEqual(entryByScan(map, beat)?.ts);
      }
    }
    // Bar indices accumulate one per entry, since every entry is one bar long.
    expect(map.map((entry) => barIndexAt(entry.startBeat, map))).toEqual(map.map((_, i) => i));
    expect(map.map((entry) => barStartBeat(entry.startBeat, map))).toEqual(
      map.map((entry) => entry.startBeat),
    );
    expect(barPositionToBeat({ bar: map.length - 1, beat: 0 }, map)).toBe(last.startBeat);
    // Before the map and past its end, the outer entries keep governing.
    expect(meterAt(-4, map)).toEqual(map[0]?.ts);
    expect(barIndexAt(-1, map)).toBe(-1);
    expect(barIndexAt(last.startBeat + last.ts.numerator, map)).toBe(map.length);
  });

  it('answers a piece-long sweep without rebuilding the map for each beat', () => {
    // Longer than any piece changes meter, and short enough that the cost the
    // sweep cannot avoid — reading the map once per question — stays well inside
    // the bound below while the cost it can avoid does not.
    const bars = 5_000;
    const map = everyBar(bars);
    const meters = resolveMeters({ meters: map });
    const start = performance.now();
    let weight = 0;
    for (const entry of meters) {
      weight += metricWeight(entry.startBeat, meters);
      barIndexAt(entry.startBeat, meters);
      formatBarPosition(entry.startBeat, meters);
    }
    const elapsed = performance.now() - start;
    // Every entry is a downbeat, so the sweep really did read all of them.
    expect(weight).toBe(3 * bars);
    // Reading the map is what trusting a caller's array costs, and the sweep
    // pays it once per question: an array the caller keeps says nothing about
    // whether it has been written to since it was validated. What the index
    // saves is everything derived from that read — the bar lengths, the running
    // bar count, the arrays holding them — which costs some twenty-five times
    // the comparison does, and that is the distance this bound stands in.
    expect(elapsed).toBeLessThan(2000);
  });

  it('rejects a map longer than a piece can declare', () => {
    const tooMany: MeterMap = new Array<MeterChange>(100_001);
    for (let index = 0; index < tooMany.length; index += 1) {
      tooMany[index] = { startBeat: index * 4, ts: { numerator: 4, denominator: 4 } };
    }
    expect(() => resolveMeters({ meters: tooMany })).toThrow(BudgetExceededError);
    expect(() => resolveMeters({ meters: tooMany })).toThrow(/meters count/);
    expect(() => resolveMeters({ meters: tooMany.slice(0, 100_000) })).not.toThrow();
  });

  it('re-reads a map whose entries were written to in place', () => {
    /** Three 4/4 spans, freshly built so the edits below touch nothing else. */
    const map: MeterMap = [0, 8, 20].map((startBeat) => ({
      startBeat,
      ts: { numerator: 4, denominator: 4 },
    }));
    // Read once, which validates the map and builds the index the reads below
    // would otherwise answer out of.
    expect(meterAt(10, map)).toEqual({ numerator: 4, denominator: 4 });
    expect(barStartBeat(10, map)).toBe(8);
    (map[1] as MeterChange).ts.numerator = 3;
    // Every positional answer now comes from the 3/4 the entry holds: its bars
    // run 8, 11, 14, and none of them is derived from the 4/4 it used to hold.
    expect(meterAt(10, map)).toEqual({ numerator: 3, denominator: 4 });
    expect(beatsPerBarAt(11.5, map)).toBe(3);
    expect(barStartBeat(11.5, map)).toBe(11);
    expect(barIndexAt(11.5, map)).toBe(3);
    expect(formatBarPosition(12, map)).toBe('4.2');
    for (let beat = 8; beat < 20; beat += 0.5) {
      const barLength = beatsPerBarAt(beat, map);
      const barStart = barStartBeat(beat, map);
      expect((barStart - 8) % barLength, `@${beat}`).toBe(0);
      expect(beat - barStart, `@${beat}`).toBeLessThan(barLength);
    }
  });

  it('refuses a signature written into a validated map in place', () => {
    const map: MeterMap = [0, 8, 20].map((startBeat) => ({
      startBeat,
      ts: { numerator: 4, denominator: 4 },
    }));
    expect(meterAt(10, map)).toEqual({ numerator: 4, denominator: 4 });
    (map[1] as MeterChange).ts.numerator = 0;
    // Validation is not a thing the map passed once; it is a thing that holds of
    // the map as it now reads.
    expect(() => assertMeterMap(map)).toThrow(InvalidInputError);
    expect(() => meterAt(10, map)).toThrow(InvalidInputError);
    expect(() => metricWeight(10, map)).toThrow(InvalidInputError);
  });

  it('re-validates a grouping written into an entry after the fact', () => {
    const map: MeterMap = [{ startBeat: 0, ts: { numerator: 7, denominator: 8 } }];
    expect(metricWeight(1, map)).toBe(1);
    // A grouping summing to neither the pulse count nor the numerator is refused
    // here as it is on the way in, rather than weighed against a bar it does not
    // describe.
    (map[0] as MeterChange).ts.grouping = [2, 2, 2];
    expect(() => metricWeight(1, map)).toThrow(InvalidInputError);
    (map[0] as MeterChange).ts.grouping = [2, 2, 3];
    expect(metricWeight(1, map)).toBe(2);
  });

  it('re-reads a map that changed after it was validated', () => {
    const map = everyBar(8);
    expect(meterAt(0, map)).toEqual({ numerator: 3, denominator: 4 });
    map.push({ startBeat: Number.NaN, ts: { numerator: 4, denominator: 4 } });
    expect(() => meterAt(0, map)).toThrow(RangeError);
    map.pop();
    map[map.length - 1] = { startBeat: 1, ts: { numerator: 4, denominator: 4 } };
    expect(() => meterAt(0, map)).toThrow(RangeError);
  });
});

describe('the analysis entry points take a meter map', () => {
  /**
   * Two 4/4 bars then two 3/4 bars, one chord per bar: C, G, F, C. The bar
   * lines are at 0, 4, 8 and 11.
   */
  function changingMeterPiece(): NoteEvent[] {
    return [...triad(60, 0, 4), ...triad(67, 4, 4), ...triad(65, 8, 3), ...triad(60, 11, 3)];
  }

  it('follows the map through the chord timeline', () => {
    const { timeline } = chordTimelineFromNotes(changingMeterPiece(), { meters: CHANGING });
    expect(timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 4, 8, 11]);
    expect(timeline.segments.map((segment) => segment.chord.rootPc)).toEqual([0, 7, 5, 0]);
    expect(timeline.at(12)?.rootPc).toBe(0);
  });

  it('sizes the default chord window by the opening bar', () => {
    const notes = changingMeterPiece();
    const common = chordTimelineFromNotes(notes, { meters: CHANGING, segmentation: 'grid' });
    expect(common.timeline.segments[0]?.endBeat).toBe(4);
    const waltz = chordTimelineFromNotes(notes, { ts: WALTZ, segmentation: 'grid' });
    expect(waltz.timeline.segments[0]?.endBeat).toBe(3);
  });

  it('carries the map into the key timeline and the arrangement analysis', () => {
    const notes = changingMeterPiece();
    const analysis = analyzeArrangement([{ role: 'harmony', notes }], { meters: CHANGING });
    expect(analysis.timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 4, 8, 11]);
    expect(analysis.keys.length).toBeGreaterThan(0);
    expect(analysis.tracks[0]?.notes.length).toBe(notes.length);
  });

  it('rejects naming the meter twice at every entry point that takes it', () => {
    const notes = changingMeterPiece();
    expect(() => chordTimelineFromNotes(notes, { ts: COMMON, meters: CHANGING })).toThrow(
      RangeError,
    );
    expect(() => analyzeArrangement([{ notes }], { ts: COMMON, meters: CHANGING })).toThrow(
      RangeError,
    );
  });
});
