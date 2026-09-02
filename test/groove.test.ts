import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  applyGrooveTemplate,
  extractGrooveTemplate,
  type GrooveTemplate,
  humanize,
} from '../src/generate/groove/index.js';

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
    const a = humanize(events, { ctx: { seed: 7 } });
    const b = humanize(events, { ctx: { seed: 7 } });
    expect(a).toEqual(b);
  });

  it('generally differs across seeds', () => {
    const base = humanize(events, { ctx: { seed: 1 } });
    let differing = 0;
    for (let seed = 2; seed <= 20; seed += 1) {
      const other = humanize(events, { ctx: { seed: seed } });
      if (JSON.stringify(other) !== JSON.stringify(base)) {
        differing += 1;
      }
    }
    expect(differing).toBeGreaterThan(15);
  });

  it('takes its seed from the generation context, and nowhere else', () => {
    // The context is the only place a seed can be named, so a bare number and
    // the object it stands for have to mean the same thing here as everywhere.
    expect(humanize(events, { ctx: 7 })).toEqual(humanize(events, { ctx: { seed: 7 } }));
    // The tempo travels beside the seed without disturbing it.
    expect(humanize(events, { ctx: { seed: 0, bpm: 96 } })).toEqual(
      humanize(events, { ctx: { seed: 0 } }),
    );
    // A context carrying nothing but a tempo is the default seed, not a refusal.
    expect(humanize(events, { ctx: { bpm: 96 } })).toEqual(humanize(events, { ctx: { seed: 0 } }));
    // And the seed is what actually moves the part.
    expect(humanize(events, { ctx: { seed: 7 }, timing: 0.04 })).not.toEqual(
      humanize(events, { ctx: { seed: 8 }, timing: 0.04 }),
    );
  });

  it('draws by position, so an inserted note leaves the others where they were', () => {
    // The coupling positional addressing exists to remove: with draws taken in
    // array order, one note added at the front redraws the whole part.
    const before = humanize(events, { ctx: { seed: 3 }, timing: 0.04 });
    const inserted = humanize([{ pitch: 61, startBeat: -0.25, durationBeat: 0.5 }, ...events], {
      ctx: { seed: 3 },
      timing: 0.04,
    });
    expect(inserted.slice(1)).toEqual(before);
  });

  it('keeps two parts of one context independent', () => {
    // Two parts doubling the same line: humanizing them under one name would
    // give both the same jitter, which is a flanged unison rather than two
    // players.
    const lead = humanize(events, { ctx: { seed: 11 }, part: 'lead' });
    const double = humanize(events, { ctx: { seed: 11 }, part: 'double' });
    expect(double).not.toEqual(lead);
    // Naming the same part twice is the same part, and reports the same thing.
    expect(humanize(events, { ctx: { seed: 11 }, part: 'lead' })).toEqual(lead);
  });

  it('keeps timing jitter within the configured bound', () => {
    const timing = 0.03;
    for (let seed = 0; seed < 30; seed += 1) {
      const result = humanize(events, { ctx: { seed: seed }, timing });
      for (let i = 0; i < result.length; i += 1) {
        const original = events[i] as NoteEvent;
        const shifted = result[i] as NoteEvent;
        // Events start well away from 0, so the >= 0 clamp never engages.
        expect(Math.abs(shifted.startBeat - original.startBeat)).toBeLessThanOrEqual(timing + 1e-9);
      }
    }
  });

  it('lets timing jitter cross beat 0 instead of piling notes onto it', () => {
    // A pickup and the downbeat it leads into. Flooring the jitter at 0 would
    // report both at beat 0 — one sound where the input has two.
    const acrossZero = makeEvents([-0.5, 0]);
    for (let seed = 0; seed < 30; seed += 1) {
      const result = humanize(acrossZero, { ctx: { seed: seed }, timing: 0.05 });
      const onsets = result.map((event) => event.startBeat);
      expect(new Set(onsets).size).toBe(onsets.length);
      expect(onsets[0]).toBeLessThan(onsets[1] as number);
      expect(onsets[0]).toBeLessThan(0);
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
      const result = humanize(plain, {
        ctx: { seed: seed },
        velocity: velocityJitter,
        accent,
        baseVelocity,
      });
      for (const event of result) {
        expect(event.velocity).toBeGreaterThanOrEqual(1);
        expect(event.velocity).toBeLessThanOrEqual(127);
        expect(event.velocity).toBeGreaterThanOrEqual(baseVelocity - velocityJitter - 1);
        expect(event.velocity).toBeLessThanOrEqual(baseVelocity + accent + velocityJitter + 1);
      }
    }
  });

  it('preserves pitch and duration', () => {
    const result = humanize(events, { ctx: { seed: 3 } });
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
      const strongResult = humanize(strongBeats, { ctx: { seed: seed } });
      const weakResult = humanize(weakBeats, { ctx: { seed: seed } });
      strongTotal += strongResult.reduce((sum, e) => sum + (e.velocity ?? 0), 0);
      weakTotal += weakResult.reduce((sum, e) => sum + (e.velocity ?? 0), 0);
    }
    expect(strongTotal / (seeds * strongBeats.length)).toBeGreaterThan(
      weakTotal / (seeds * weakBeats.length),
    );
  });

  it('keeps a two-note pickup two notes', () => {
    // A whole-beat upbeat, a half-beat upbeat and the downbeat: onsets the
    // validator accepts, and onsets the analysis side reads as bar -1. If the
    // jitter is floored at 0 the two upbeats arrive together on the downbeat,
    // and no later pass can tell there was a pickup at all.
    const pickup = makeEvents([-1, -0.5, 0]);
    for (let seed = 0; seed < 30; seed += 1) {
      const played = humanize(pickup, { ctx: { seed: seed }, timing: 0.02 });
      const onsets = played.map((event) => event.startBeat);
      expect(new Set(onsets).size).toBe(3);
      expect(onsets[0]).toBeLessThan(onsets[1] as number);
      expect(onsets[1]).toBeLessThan(onsets[2] as number);
      expect(onsets[0]).toBeCloseTo(-1, 1);
      expect(onsets[1]).toBeCloseTo(-0.5, 1);
    }
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

  it('defaults unvisited slots to a null-velocity sentinel', () => {
    const template = extractGrooveTemplate(makeEvents([0]), FOUR_FOUR, 4);
    for (let i = 1; i < template.slotsPerBar; i += 1) {
      expect(template.slots[i]).toEqual({ timingOffset: 0, velocity: null });
    }
  });

  it('stores its time signature', () => {
    const template = extractGrooveTemplate(makeEvents([0]), FOUR_FOUR, 4);
    expect(template.ts).toEqual(FOUR_FOUR);
  });

  it('records a real velocity of 0 rather than treating it as unrecorded', () => {
    const events: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 0 }];
    const template = extractGrooveTemplate(events, FOUR_FOUR, 4);
    expect(template.slots[0]?.velocity).toBe(0);
  });

  it('averages velocity per slot', () => {
    const events: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1, velocity: 60 },
      { pitch: 60, startBeat: 4, durationBeat: 1, velocity: 100 },
    ];
    const template = extractGrooveTemplate(events, FOUR_FOUR, 4);
    expect(template.slots[0]?.velocity).toBeCloseTo(80, 6);
  });

  it('keeps a stable per-bar slot table when the grid does not divide the meter', () => {
    const ts = parseTimeSignature('7/8');
    const template = extractGrooveTemplate(makeEvents([0, 3.5, 7]), ts, 3);
    expect(template.slotsPerBar).toBe(11);
    expect(template.slots).toHaveLength(11);
    expect(() => applyGrooveTemplate(makeEvents([0, 3.5, 7]), template, ts)).not.toThrow();
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
      slots: new Array(16).fill(null).map(() => ({ timingOffset: 0, velocity: null })),
    };
    const quantized: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 55 }];
    const result = applyGrooveTemplate(quantized, template, FOUR_FOUR);
    expect(result[0]?.velocity).toBe(55);
  });

  it('lets a laid-back downbeat slot push the note before beat 0', () => {
    const template: GrooveTemplate = {
      subdivision: 4,
      slotsPerBar: 16,
      slots: [
        { timingOffset: -0.01, velocity: null },
        ...new Array(15).fill(null).map(() => ({ timingOffset: 0, velocity: null })),
      ],
    };
    const applied = applyGrooveTemplate(
      [{ pitch: 36, startBeat: 0, durationBeat: 1, velocity: 100 }],
      template,
      FOUR_FOUR,
    );
    // The recorded feel is the same one every other slot gets: an onset before
    // beat 0 is where the template says the note is played, and the validator
    // accepts it, so it re-enters the pipeline unchanged.
    expect(applied[0]?.startBeat).toBeCloseTo(-0.01, 10);
    expect(() => humanize(applied)).not.toThrow();
  });

  it('keeps a pickup a pickup', () => {
    // The two upbeats belong to the bar before the first, so they quantize
    // against that bar's grid. Flooring their onsets at 0 would stack them on
    // the downbeat, which is where the pickup stops being one.
    const template: GrooveTemplate = {
      subdivision: 4,
      slotsPerBar: 16,
      slots: new Array(16).fill(null).map(() => ({ timingOffset: 0.02, velocity: null })),
    };
    const pickup: NoteEvent[] = [-1, -0.5, 0].map((startBeat) => ({
      pitch: 60,
      startBeat,
      durationBeat: 0.5,
      velocity: 90,
    }));
    const applied = applyGrooveTemplate(pickup, template, FOUR_FOUR);
    expect(applied.map((event) => event.startBeat)).toEqual([-0.98, -0.48, 0.02]);
  });

  it('applies a genuine velocity-0 slot instead of leaving the event untouched', () => {
    // A slot that recorded a real velocity of 0 must survive extract + apply.
    const groovy: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1, velocity: 0 }];
    const template = extractGrooveTemplate(groovy, FOUR_FOUR, 4);
    expect(template.slots[0]?.velocity).toBe(0);

    const quantized: NoteEvent[] = [{ pitch: 72, startBeat: 0, durationBeat: 1, velocity: 100 }];
    const result = applyGrooveTemplate(quantized, template, FOUR_FOUR);
    expect(result[0]?.velocity).toBe(0);
  });

  it('rejects applying a template under a different meter than it was extracted', () => {
    const template = extractGrooveTemplate(makeEvents([0, 1, 2, 3]), FOUR_FOUR, 4);
    const threeFour = parseTimeSignature('3/4');
    expect(() => applyGrooveTemplate(makeEvents([0, 1, 2]), template, threeFour)).toThrow();
  });

  it('accepts applying a template under the matching meter', () => {
    const template = extractGrooveTemplate(makeEvents([0, 1, 2, 3]), FOUR_FOUR, 4);
    expect(() => applyGrooveTemplate(makeEvents([0, 1, 2, 3]), template, FOUR_FOUR)).not.toThrow();
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

describe('groove-template meter validation', () => {
  it('keeps even an extremely short valid meter usable', () => {
    const template = extractGrooveTemplate(makeEvents([0]), {
      numerator: 1,
      denominator: 1_000_000,
    });
    expect(template.slotsPerBar).toBeGreaterThanOrEqual(1);
  });
});

describe('a groove template written by hand', () => {
  /** A template of `slotsPerBar` slots, every one of them silent and on the beat. */
  function flat(subdivision: number, slotsPerBar: number): GrooveTemplate {
    return {
      subdivision,
      slotsPerBar,
      slots: Array.from({ length: slotsPerBar }, () => ({ timingOffset: 0, velocity: null })),
    };
  }

  const target: NoteEvent[] = [
    { pitch: 36, startBeat: 0, durationBeat: 1, velocity: 80 },
    { pitch: 38, startBeat: 2.5, durationBeat: 1, velocity: 80 },
  ];

  it('is refused when its slot count is not the bar it will be read against', () => {
    // Eight slots at a sixteenth-note subdivision is half a 4/4 bar. Every check
    // the template already carried passes: the count is a positive integer, the
    // array is that long, and no meter is declared to disagree with. The note on
    // beat 2.5 then quantizes to slot 10, wraps to slot 0, and sounds a bar and
    // a half beat late.
    expect(() => applyGrooveTemplate(target, flat(4, 8), FOUR_FOUR)).toThrow(/slotsPerBar/);
  });

  it('is taken when its slot count is the bar it will be read against', () => {
    const applied = applyGrooveTemplate(target, flat(4, 16), FOUR_FOUR);
    expect(applied.map((event) => event.startBeat)).toEqual([0, 2.5]);
  });

  it('is refused a slot that carries a timing offset nothing can be placed at', () => {
    const template = flat(4, 16);
    (template.slots[0] as { timingOffset: number }).timingOffset = Number.NaN;
    expect(() => applyGrooveTemplate(target, template, FOUR_FOUR)).toThrow(/timingOffset/);
  });

  it('is refused a slot that carries a velocity no note event can hold', () => {
    for (const velocity of [200, -5]) {
      const template = flat(4, 16);
      (template.slots[0] as { velocity: number | null }).velocity = velocity;
      expect(() => applyGrooveTemplate(target, template, FOUR_FOUR)).toThrow(/velocity/);
    }
  });

  it('never returns a note the library would refuse to read back', () => {
    // The output is this library's own, so every field on it has to hold: the
    // function surface returning a broken array and the class surface throwing
    // on the same input were two answers to one question.
    const template = extractGrooveTemplate(
      makeEvents([0, 0.51, 1.02, 1.48, 2.03, 2.49, 3.01, 3.52], 90),
      FOUR_FOUR,
    );
    const applied = applyGrooveTemplate(target, template, FOUR_FOUR);
    for (const event of applied) {
      expect(Number.isFinite(event.startBeat)).toBe(true);
      expect(event.velocity === undefined || Number.isInteger(event.velocity)).toBe(true);
      expect(event.velocity ?? 0).toBeGreaterThanOrEqual(0);
      expect(event.velocity ?? 0).toBeLessThanOrEqual(127);
    }
  });
});
