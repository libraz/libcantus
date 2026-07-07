import { describe, expect, it } from 'vitest';
import {
  barPositionToBeat,
  beatsPerBar,
  beatToBarPosition,
  formatTimeSignature,
  isCompound,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
  pulsesPerBar,
  type TimeSignature,
  tuplet,
} from '../src/core/meter/index.js';

describe('time signatures', () => {
  it('parses and formats', () => {
    expect(parseTimeSignature('6/8')).toEqual({ numerator: 6, denominator: 8 });
    expect(formatTimeSignature({ numerator: 4, denominator: 4 })).toBe('4/4');
    expect(() => parseTimeSignature('4-4')).toThrow();
  });

  it('classifies compound meters', () => {
    expect(isCompound(parseTimeSignature('6/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('12/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('3/4'))).toBe(false);
    expect(isCompound(parseTimeSignature('3/8'))).toBe(false); // simple triple
  });

  it('classifies compound meters independent of the denominator', () => {
    // Compound is defined by a numerator that is a multiple of three above
    // three, so 6/4 (compound duple) and 9/8 are compound while the simple
    // 3/4 and 4/4 are not.
    expect(isCompound(parseTimeSignature('6/4'))).toBe(true);
    expect(isCompound(parseTimeSignature('9/8'))).toBe(true);
    expect(isCompound(parseTimeSignature('3/4'))).toBe(false);
    expect(isCompound(parseTimeSignature('4/4'))).toBe(false);
  });

  it('groups 6/4 as two dotted-half pulses', () => {
    const ts = parseTimeSignature('6/4');
    expect(beatsPerBar(ts)).toBe(6);
    expect(pulsesPerBar(ts)).toBe(2);
    expect(metricWeight(0, ts)).toBe(3); // downbeat
    expect(metricWeight(3, ts)).toBe(2); // second compound pulse (dotted half in)
    expect(metricWeight(1, ts)).toBe(0); // off-pulse subdivision
  });

  it('computes bar length and pulse count', () => {
    expect(beatsPerBar(parseTimeSignature('4/4'))).toBe(4);
    expect(beatsPerBar(parseTimeSignature('6/8'))).toBe(3);
    expect(pulsesPerBar(parseTimeSignature('4/4'))).toBe(4);
    expect(pulsesPerBar(parseTimeSignature('6/8'))).toBe(2);
  });
});

describe('bar positions', () => {
  it('splits an absolute beat into bar and offset in 4/4', () => {
    const ts = parseTimeSignature('4/4');
    expect(beatToBarPosition(6, ts)).toEqual({ bar: 1, beat: 2 });
    expect(barPositionToBeat({ bar: 1, beat: 2 }, ts)).toBe(6);
  });
});

describe('metric weight', () => {
  it('ranks 4/4 accents: downbeat > mid-bar > other beats > offbeats', () => {
    const ts = parseTimeSignature('4/4');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(2, ts)).toBe(2);
    expect(metricWeight(1, ts)).toBe(1);
    expect(metricWeight(3, ts)).toBe(1);
    expect(metricWeight(0.5, ts)).toBe(0);
    expect(isStrongBeat(0, ts)).toBe(true);
    expect(isStrongBeat(1, ts)).toBe(false);
  });

  it('treats a downbeat reached just below the bar boundary as strong', () => {
    const ts = parseTimeSignature('4/4');
    // Accumulated tuplet durations can land an epsilon below the next downbeat.
    expect(metricWeight(4 - 5e-10, ts)).toBe(3);
    expect(isStrongBeat(4 - 5e-10, ts)).toBe(true);
  });

  it('places the two dotted beats of 6/8', () => {
    const ts = parseTimeSignature('6/8');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1.5, ts)).toBe(2); // second compound beat
    expect(metricWeight(0.5, ts)).toBe(0); // subdivision
  });

  it('has no secondary strong pulse in 3/4', () => {
    const ts = parseTimeSignature('3/4');
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1, ts)).toBe(1);
    expect(metricWeight(2, ts)).toBe(1);
  });
});

describe('additive meter grouping', () => {
  it('treats 7/8 as flat equal pulses without a grouping', () => {
    const ts = parseTimeSignature('7/8');
    expect(pulsesPerBar(ts)).toBe(7);
    // Every eighth-note pulse (0.5 quarter apart) is a plain main pulse.
    expect(metricWeight(0, ts)).toBe(3);
    for (let pulse = 1; pulse < 7; pulse += 1) {
      expect(metricWeight(pulse * 0.5, ts)).toBe(1);
    }
    // Off-pulse subdivisions still weigh 0.
    expect(metricWeight(0.25, ts)).toBe(0);
  });

  it('accents the 2+2+3 group heads of 7/8 when grouped', () => {
    const ts: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
    // Group heads at pulse 0 (beat 0), pulse 2 (beat 1.0), pulse 4 (beat 2.0).
    expect(metricWeight(0, ts)).toBe(3); // downbeat
    expect(metricWeight(1.0, ts)).toBe(2); // head of second group
    expect(metricWeight(2.0, ts)).toBe(2); // head of third group
    // Non-head pulses weigh 1.
    expect(metricWeight(0.5, ts)).toBe(1);
    expect(metricWeight(1.5, ts)).toBe(1);
    expect(metricWeight(2.5, ts)).toBe(1);
    expect(metricWeight(3.0, ts)).toBe(1);
    expect(isStrongBeat(1.0, ts)).toBe(true);
    expect(isStrongBeat(0.5, ts)).toBe(false);
  });

  it('accents the 3+2 group head of 5/8 when grouped', () => {
    const ts: TimeSignature = { numerator: 5, denominator: 8, grouping: [3, 2] };
    // Group heads at pulse 0 (beat 0) and pulse 3 (beat 1.5).
    expect(metricWeight(0, ts)).toBe(3);
    expect(metricWeight(1.5, ts)).toBe(2);
    expect(metricWeight(0.5, ts)).toBe(1);
    expect(metricWeight(1.0, ts)).toBe(1);
    expect(metricWeight(2.0, ts)).toBe(1);
  });

  it('throws on a grouping that does not sum to the pulse count', () => {
    const ts: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 2] };
    // pulse index 0 short-circuits, but any later pulse validates the grouping.
    expect(() => metricWeight(0.5, ts)).toThrow();
  });
});

describe('tuplet', () => {
  it('splits a beat into an eighth-note triplet', () => {
    expect(tuplet(1, 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('rejects an invalid count', () => {
    expect(() => tuplet(1, 0)).toThrow();
  });
});
