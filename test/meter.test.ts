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
  tuplet,
} from '../src/meter/index.js';

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

describe('tuplet', () => {
  it('splits a beat into an eighth-note triplet', () => {
    expect(tuplet(1, 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('rejects an invalid count', () => {
    expect(() => tuplet(1, 0)).toThrow();
  });
});
