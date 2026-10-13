import { describe, expect, it } from 'vitest';
import { metricGridUnit, metricWeight, pulseBeats } from '../src/core/meter/index.js';

describe('the metric grid a meter states', () => {
  it('steps by one main pulse, whatever the pulse is', () => {
    for (const ts of ['4/4', '3/4', '6/8', '9/8', '12/8', '2+2+3/8']) {
      expect(metricGridUnit(ts), ts).toBe(pulseBeats(ts));
    }
  });

  it('steps by a whole division of every signature a map names', () => {
    const changes = [
      { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
      { startBeat: 8, ts: { numerator: 6, denominator: 8 } },
    ];
    // A quarter and a dotted quarter share a half-beat step, and nothing longer.
    expect(metricGridUnit(changes)).toBe(0.5);
  });

  it('steps onto a change that does not fall on a bar line', () => {
    const changes = [
      { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
      { startBeat: 4.25, ts: { numerator: 4, denominator: 4 } },
    ];
    // Both spans are quarter-note pulses, but the second span's pulses sit a
    // quarter of a beat off the first's, so a step of one quarter lands on none
    // of them.
    const unit = metricGridUnit(changes);
    expect(unit).toBe(0.25);
    for (const change of changes) {
      const steps = (change.startBeat - 0) / unit;
      expect(Math.abs(steps - Math.round(steps)), `change at ${change.startBeat}`).toBeLessThan(
        1e-9,
      );
      const pulses = pulseBeats(change.ts) / unit;
      expect(Math.abs(pulses - Math.round(pulses)), `pulse of ${change.startBeat}`).toBeLessThan(
        1e-9,
      );
    }
  });

  it('reads an onset written a hair off a beat as unmeasured', () => {
    // A grid dividing that hair costs a slot per step of the piece and lands on
    // nothing anyone plays, so the pulses keep the step they state.
    const changes = [
      { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
      { startBeat: 4.000001, ts: { numerator: 4, denominator: 4 } },
    ];
    expect(metricGridUnit(changes)).toBe(1);
  });
});

describe('4/4 segmentation is what it was', () => {
  it('reports the default 4/4 grid at one quarter', () => {
    expect(metricGridUnit('4/4')).toBe(1);
  });

  it('weighs the pulses of a compound bar where the grid steps', () => {
    // The weights the search discounts by and the grid it steps on come from the
    // same reading of the meter: every grid step is a weighted position.
    for (const ts of ['4/4', '3/4', '6/8', '12/8']) {
      const unit = metricGridUnit(ts);
      for (let step = 0; step < 8; step += 1) {
        expect(metricWeight(step * unit, ts), `${ts} step ${step}`).toBeGreaterThan(0);
      }
    }
  });
});
