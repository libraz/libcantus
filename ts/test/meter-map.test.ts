import { describe, expect, it } from 'vitest';
import {
  barIndexAt,
  formatBarPosition,
  type MeterMap,
  metricWeight,
  resolveMeters,
} from '../src/core/meter/index.js';
import { shortestReading } from './support/growth.js';

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

  it('answers a piece-long sweep without rebuilding the map for each beat', () => {
    // Longer than any piece changes meter, and short enough that the cost the
    // sweep cannot avoid — reading the map once per question — stays well inside
    // the bound below while the cost it can avoid does not.
    const bars = 400;
    const map = everyBar(bars);
    const resolved = resolveMeters({ meters: map });
    /** The sweep, against a map resolved once or resolved for every question. */
    const sweep = (once: boolean): number => {
      let weight = 0;
      for (const entry of resolved) {
        const meters = once ? resolved : resolveMeters({ meters: map });
        weight += metricWeight(entry.startBeat, meters);
        barIndexAt(entry.startBeat, meters);
        formatBarPosition(entry.startBeat, meters);
      }
      return weight;
    };
    // Every entry is a downbeat, so the sweep really did read all of them, and
    // both readings answer the same thing — only their cost differs.
    expect(sweep(true)).toBe(3 * bars);
    expect(sweep(false)).toBe(3 * bars);
    const kept = shortestReading(() => sweep(true));
    const rebuilt = shortestReading(() => sweep(false));
    // A ratio against the same sweep rebuilding as it goes, rather than a
    // millisecond count: the suite runs its files side by side, so a wall-clock
    // bound states how busy the machine was as much as what the sweep costs,
    // and after the fact the two cannot be told apart. A ratio of two readings
    // taken moments apart says only what the index is worth.
    //
    // Reading the map is what trusting a caller's array costs, and the sweep
    // pays it once per question: an array the caller keeps says nothing about
    // whether it has been written to since it was validated. What the index
    // saves is everything derived from that read — the bar lengths, the running
    // bar count, the arrays holding them. An index that stopped being kept
    // would make the two sides the same work and bring the ratio to one, which
    // is what the bound separates from. How far above one the ratio sits
    // depends on the machine and on whether coverage is being collected — some
    // seven times faster uninstrumented, under three on a shared runner
    // counting every call — so the bound is placed to clear the collapse
    // rather than to state the distance.
    expect(rebuilt / Math.max(kept, 0.01)).toBeGreaterThan(1.5);
  });
});
