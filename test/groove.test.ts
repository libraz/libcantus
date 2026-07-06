import { describe, expect, it } from 'vitest';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  type GrooveTemplate,
  humanize,
} from '../src/groove/index.js';
import { parseTimeSignature } from '../src/meter/index.js';
import type { NoteEvent } from '../src/types.js';

const FOUR_FOUR = parseTimeSignature('4/4');

function makeEvents(startBeats: number[], velocity = 90): NoteEvent[] {
  return startBeats.map((startBeat) => ({
    pitch: 60,
    startBeat,
    durationBeat: 0.5,
    velocity,
  }));
}

describe('humanize', () => {
  const events = makeEvents([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);

  it('is deterministic for the same seed', () => {
    const a = humanize(events, { seed: 7 });
    const b = humanize(events, { seed: 7 });
    expect(a).toEqual(b);
  });

  it('generally differs across seeds', () => {
    const base = humanize(events, { seed: 1 });
    let differing = 0;
    for (let seed = 2; seed <= 20; seed += 1) {
      const other = humanize(events, { seed });
      if (JSON.stringify(other) !== JSON.stringify(base)) {
        differing += 1;
      }
    }
    expect(differing).toBeGreaterThan(15);
  });

  it('keeps timing jitter within the configured bound', () => {
    const timing = 0.03;
    for (let seed = 0; seed < 30; seed += 1) {
      const result = humanize(events, { seed, timing });
      for (let i = 0; i < result.length; i += 1) {
        const original = events[i] as NoteEvent;
        const shifted = result[i] as NoteEvent;
        // Events start well away from 0, so the >= 0 clamp never engages.
        expect(Math.abs(shifted.startBeat - original.startBeat)).toBeLessThanOrEqual(timing + 1e-9);
      }
    }
  });

  it('clamps timing jitter so startBeat never goes negative', () => {
    const nearZero = makeEvents([0, 0.005]);
    for (let seed = 0; seed < 30; seed += 1) {
      const result = humanize(nearZero, { seed, timing: 0.5 });
      for (const event of result) {
        expect(event.startBeat).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps velocity within [1, 127] and within the configured jitter/accent bounds', () => {
    const velocityJitter = 8;
    const accent = 12;
    const baseVelocity = 80;
    const plain: NoteEvent[] = [0, 0.5, 1, 1.5].map((startBeat) => ({
      pitch: 60,
      startBeat,
      durationBeat: 0.5,
    }));
    for (let seed = 0; seed < 30; seed += 1) {
      const result = humanize(plain, { seed, velocity: velocityJitter, accent, baseVelocity });
      for (const event of result) {
        expect(event.velocity).toBeGreaterThanOrEqual(1);
        expect(event.velocity).toBeLessThanOrEqual(127);
        expect(event.velocity).toBeGreaterThanOrEqual(baseVelocity - velocityJitter - 1);
        expect(event.velocity).toBeLessThanOrEqual(baseVelocity + accent + velocityJitter + 1);
      }
    }
  });

  it('preserves pitch and duration', () => {
    const result = humanize(events, { seed: 3 });
    for (let i = 0; i < result.length; i += 1) {
      expect(result[i]?.pitch).toBe(events[i]?.pitch);
      expect(result[i]?.durationBeat).toBe(events[i]?.durationBeat);
    }
  });

  it('makes strong beats louder on average than weak beats', () => {
    const strongBeats = makeEvents([0, 4, 8, 12], 80);
    const weakBeats = makeEvents([0.5, 4.5, 8.5, 12.5], 80);
    let strongTotal = 0;
    let weakTotal = 0;
    const seeds = 100;
    for (let seed = 0; seed < seeds; seed += 1) {
      const strongResult = humanize(strongBeats, { seed });
      const weakResult = humanize(weakBeats, { seed });
      strongTotal += strongResult.reduce((sum, e) => sum + (e.velocity ?? 0), 0);
      weakTotal += weakResult.reduce((sum, e) => sum + (e.velocity ?? 0), 0);
    }
    expect(strongTotal / (seeds * strongBeats.length)).toBeGreaterThan(
      weakTotal / (seeds * weakBeats.length),
    );
  });
});

describe('extractGrooveTemplate', () => {
  it('recovers a known late-feel offset', () => {
    const subdivision = 4;
    const lateBy = 0.05;
    // Quarter-note grid positions across two bars, each played lateBy late.
    const positions = [0, 1, 2, 3, 4, 5, 6, 7];
    const events = makeEvents(positions.map((p) => p + lateBy));
    const template = extractGrooveTemplate(events, FOUR_FOUR, subdivision);

    // Quarter notes land on every `subdivision`-th slot (slot 0, 4, 8, ...).
    for (let i = 0; i < template.slotsPerBar; i += subdivision) {
      const slot = template.slots[i];
      expect(slot?.timingOffset).toBeCloseTo(lateBy, 6);
    }
  });

  it('defaults unvisited slots to zero', () => {
    const template = extractGrooveTemplate(makeEvents([0]), FOUR_FOUR, 4);
    for (let i = 1; i < template.slotsPerBar; i += 1) {
      expect(template.slots[i]).toEqual({ timingOffset: 0, velocity: 0 });
    }
  });

  it('averages velocity per slot', () => {
    const events: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 60 },
      { pitch: 60, startBeat: 4, durationBeat: 1, velocity: 100 },
    ];
    const template = extractGrooveTemplate(events, FOUR_FOUR, 4);
    expect(template.slots[0]?.velocity).toBeCloseTo(80, 6);
  });
});

describe('applyGrooveTemplate', () => {
  it('moves a quantized event onto the template offset and sets its velocity', () => {
    const subdivision = 4;
    const lateBy = 0.05;
    const groovy = makeEvents(
      [0, 1, 2, 3].map((p) => p + lateBy),
      100,
    );
    const template = extractGrooveTemplate(groovy, FOUR_FOUR, subdivision);

    const quantized = makeEvents([0, 1, 2, 3], 60);
    const result = applyGrooveTemplate(quantized, template, FOUR_FOUR);

    for (let i = 0; i < result.length; i += 1) {
      const event = result[i] as NoteEvent;
      const originalQuantized = quantized[i] as NoteEvent;
      expect(event.startBeat).toBeCloseTo(originalQuantized.startBeat + lateBy, 6);
      expect(event.velocity).toBeCloseTo(100, 6);
      expect(event.pitch).toBe(originalQuantized.pitch);
      expect(event.durationBeat).toBe(originalQuantized.durationBeat);
    }
  });

  it('leaves velocity untouched when the slot recorded none', () => {
    const template: GrooveTemplate = {
      subdivision: 4,
      slotsPerBar: 16,
      slots: new Array(16).fill(null).map(() => ({ timingOffset: 0, velocity: 0 })),
    };
    const quantized: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 55 }];
    const result = applyGrooveTemplate(quantized, template, FOUR_FOUR);
    expect(result[0]?.velocity).toBe(55);
  });

  it('round-trips a groovy feel through extract + apply on a stiff line', () => {
    const subdivision = 4;
    const groovyOffsets = [0.03, -0.02, 0.05, 0.01, -0.04, 0.02, 0.04, -0.01];
    const groovy = makeEvents(
      [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((p, i) => p + (groovyOffsets[i] ?? 0)),
      95,
    );
    const template = extractGrooveTemplate(groovy, FOUR_FOUR, subdivision);

    const quantized = makeEvents([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 60);
    const humanized = applyGrooveTemplate(quantized, template, FOUR_FOUR);

    for (let i = 0; i < humanized.length; i += 1) {
      const groovyEvent = groovy[i] as NoteEvent;
      const humanizedEvent = humanized[i] as NoteEvent;
      expect(Math.abs(humanizedEvent.startBeat - groovyEvent.startBeat)).toBeLessThan(1e-6);
    }
  });
});
