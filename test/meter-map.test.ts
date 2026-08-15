import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { MeterMap } from '../src/core/meter/index.js';
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
  resolveMeters,
} from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';

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
