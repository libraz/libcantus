/**
 * Groove and humanization: nudging quantized note events toward a more human
 * feel, and capturing/replaying the timing-and-velocity "feel" of a
 * performance as a reusable groove template.
 *
 * Positions and durations are measured in quarter-note beats, matching the
 * library-wide convention. Randomness, where used, always goes through the
 * seeded PRNG from the `random` module so results are fully reproducible.
 */

import { beatsPerBar, metricWeight, type TimeSignature } from '../meter/index.js';
import { createRng } from '../random/index.js';
import type { NoteEvent } from '../types.js';

/** Options controlling {@link humanize}. */
export type HumanizeOptions = {
  /** Time signature used to derive metric accents. Default 4/4. */
  ts?: TimeSignature;
  /** Maximum timing jitter in quarter-note beats, applied as ±this value. Default 0.02. */
  timing?: number;
  /** Maximum velocity jitter (MIDI units), applied as ±this value. Default 8. */
  velocity?: number;
  /** How much louder strong beats get relative to weak ones, in MIDI velocity units. Default 12. */
  accent?: number;
  /** Velocity assumed for events with no `velocity` of their own. Default 80. */
  baseVelocity?: number;
  /** Seed for the deterministic PRNG. Default 0. */
  seed?: number;
};

/** Default time signature for {@link humanize} when none is given. */
const DEFAULT_TS: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_TIMING = 0.02;
const DEFAULT_VELOCITY_JITTER = 8;
const DEFAULT_ACCENT = 12;
const DEFAULT_BASE_VELOCITY = 80;
const MAX_METRIC_WEIGHT = 3;
const MIN_VELOCITY = 1;
const MAX_VELOCITY = 127;

/**
 * Humanize a sequence of note events by nudging their timing and velocity
 * with small, deterministic (seeded) randomness plus a metric-accent shape:
 * events on strong beats (see {@link metricWeight}) come out louder on
 * average than events on weak ones.
 *
 * Each returned event is a copy; `startBeat` is jittered within
 * `[-timing, +timing]` beats and clamped to be non-negative, and `velocity`
 * is the event's own velocity (or `baseVelocity` if it has none) plus an
 * accent term scaled by the event's metric weight plus a jitter within
 * `[-velocity, +velocity]`, clamped to `[1, 127]` and rounded. The metric
 * weight is computed from each event's original (pre-jitter) `startBeat`.
 * `pitch` and `durationBeat` pass through unchanged, and the output keeps the
 * input order.
 *
 * @param events The events to humanize.
 * @param opts Humanization options.
 * @returns Humanized copies of `events`, in input order.
 */
export function humanize(events: NoteEvent[], opts: HumanizeOptions = {}): NoteEvent[] {
  const ts = opts.ts ?? DEFAULT_TS;
  const timing = opts.timing ?? DEFAULT_TIMING;
  const velocityJitter = opts.velocity ?? DEFAULT_VELOCITY_JITTER;
  const accent = opts.accent ?? DEFAULT_ACCENT;
  const baseVelocity = opts.baseVelocity ?? DEFAULT_BASE_VELOCITY;
  const rng = createRng(opts.seed ?? 0);

  return events.map((event) => {
    const timingOffset = rng.float(-timing, timing);
    const startBeat = Math.max(0, event.startBeat + timingOffset);

    const weight = metricWeight(event.startBeat, ts);
    const accentBoost = (weight / MAX_METRIC_WEIGHT) * accent;
    const velocityOffset = rng.float(-velocityJitter, velocityJitter);
    const rawVelocity = (event.velocity ?? baseVelocity) + accentBoost + velocityOffset;
    const velocity = Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, Math.round(rawVelocity)));

    return {
      pitch: event.pitch,
      startBeat,
      durationBeat: event.durationBeat,
      velocity,
    };
  });
}

/** The recorded feel at a single grid slot: an average timing deviation and velocity. */
export type GrooveSlot = {
  /** Average `actualStartBeat - quantizedBeat` (in quarter-note beats) for events landing on this slot. */
  timingOffset: number;
  /** Average velocity of events landing on this slot; 0 if none did. */
  velocity: number;
};

/** A per-bar grid of timing and velocity deviations captured from a performance. */
export type GrooveTemplate = {
  /** Grid resolution: equal grid steps per quarter-note beat. */
  subdivision: number;
  /** Number of grid slots per bar (`beatsPerBar(ts) * subdivision`). */
  slotsPerBar: number;
  /** One entry per grid slot, in slot-index order (slot 0 is the downbeat). */
  slots: GrooveSlot[];
};

/**
 * Quantize a beat position to the nearest grid slot at the given subdivision,
 * within the bar that contains it.
 *
 * @param beat Absolute position in quarter-note beats.
 * @param barBeats Bar length in quarter-note beats.
 * @param subdivision Grid steps per quarter-note beat.
 * @param slotsPerBar Number of grid slots per bar.
 * @returns The quantized absolute beat and its 0-based slot index within the bar.
 */
function quantizeToGrid(
  beat: number,
  barBeats: number,
  subdivision: number,
  slotsPerBar: number,
): { quantizedBeat: number; slotIndex: number } {
  const barIndex = Math.floor(beat / barBeats);
  const modBeat = beat - barIndex * barBeats;
  let slotIndex = Math.round(modBeat * subdivision);
  let effectiveBarIndex = barIndex;
  // Rounding the last slot in a bar up to the grid step count means it
  // actually lands on the next bar's downbeat.
  if (slotIndex >= slotsPerBar) {
    slotIndex = 0;
    effectiveBarIndex += 1;
  }
  return {
    quantizedBeat: effectiveBarIndex * barBeats + slotIndex / subdivision,
    slotIndex,
  };
}

/**
 * Extract a groove template from a set of note events: for each grid slot,
 * the average timing deviation from the quantized grid and the average
 * velocity of events landing on it. Slots with no events default to
 * `{ timingOffset: 0, velocity: 0 }`.
 *
 * @param events The (typically "groovy", human-played) events to analyze.
 * @param ts The time signature, used to compute the bar length.
 * @param subdivision Grid resolution: equal grid steps per quarter-note beat.
 * @returns The extracted groove template.
 */
export function extractGrooveTemplate(
  events: NoteEvent[],
  ts: TimeSignature,
  subdivision: number,
): GrooveTemplate {
  const barBeats = beatsPerBar(ts);
  const slotsPerBar = Math.round(barBeats * subdivision);
  const offsetSums = new Array<number>(slotsPerBar).fill(0);
  const velocitySums = new Array<number>(slotsPerBar).fill(0);
  const counts = new Array<number>(slotsPerBar).fill(0);
  const velocityCounts = new Array<number>(slotsPerBar).fill(0);

  for (const event of events) {
    const { quantizedBeat, slotIndex } = quantizeToGrid(
      event.startBeat,
      barBeats,
      subdivision,
      slotsPerBar,
    );
    offsetSums[slotIndex] = (offsetSums[slotIndex] ?? 0) + (event.startBeat - quantizedBeat);
    counts[slotIndex] = (counts[slotIndex] ?? 0) + 1;
    // Only events that carry a velocity contribute to the velocity average, so a
    // velocity-less event does not pull the slot's recorded velocity toward zero.
    if (event.velocity !== undefined) {
      velocitySums[slotIndex] = (velocitySums[slotIndex] ?? 0) + event.velocity;
      velocityCounts[slotIndex] = (velocityCounts[slotIndex] ?? 0) + 1;
    }
  }

  const slots: GrooveSlot[] = [];
  for (let i = 0; i < slotsPerBar; i += 1) {
    const count = counts[i] ?? 0;
    if (count === 0) {
      slots.push({ timingOffset: 0, velocity: 0 });
      continue;
    }
    const velocityCount = velocityCounts[i] ?? 0;
    slots.push({
      timingOffset: (offsetSums[i] ?? 0) / count,
      velocity: velocityCount > 0 ? (velocitySums[i] ?? 0) / velocityCount : 0,
    });
  }

  return { subdivision, slotsPerBar, slots };
}

/**
 * Apply a groove template to a set of (typically quantized) note events: each
 * event is snapped to its grid slot and then offset by that slot's recorded
 * timing deviation, pushing stiff timing toward the template's feel.
 * Velocity is set to the slot's recorded average when it recorded any
 * (`velocity > 0`); otherwise the event's own velocity is left untouched.
 *
 * @param events The events to reshape.
 * @param template The groove template, from {@link extractGrooveTemplate}.
 * @param ts The time signature, used to compute the bar length.
 * @returns Reshaped copies of `events`, in input order.
 */
export function applyGrooveTemplate(
  events: NoteEvent[],
  template: GrooveTemplate,
  ts: TimeSignature,
): NoteEvent[] {
  const barBeats = beatsPerBar(ts);
  return events.map((event) => {
    const { quantizedBeat, slotIndex } = quantizeToGrid(
      event.startBeat,
      barBeats,
      template.subdivision,
      template.slotsPerBar,
    );
    const slot = template.slots[slotIndex];
    const startBeat = quantizedBeat + (slot?.timingOffset ?? 0);
    const velocity = slot && slot.velocity > 0 ? Math.round(slot.velocity) : event.velocity;

    return {
      pitch: event.pitch,
      startBeat,
      durationBeat: event.durationBeat,
      velocity,
    };
  });
}
