import { clampVel, GM } from './internal.js';

/** A single percussion onset. */
export type DrumHit = {
  pitch: number;
  startBeat: number;
  durationBeat: number;
  velocity: number;
};

/** Rounding used to key onsets by beat: a 128th note, finer than any grid used. */
const ONSET_KEY_SCALE = 128;

/**
 * Accumulator for drum onsets with velocity clamping and simple lookups.
 *
 * Onsets are indexed by (pitch, quantized beat) as they are added. The lookups
 * run inside the per-bar loop, so scanning the accumulated hits made the whole
 * generator quadratic in bar count — a few thousand bars took seconds.
 */
export class HitList {
  readonly hits: DrumHit[] = [];
  /** Onset keys already occupied, as `pitch:quantizedBeat`. */
  readonly #onsets = new Set<string>();

  /** Append a hit, clamping velocity and dropping non-positive positions. */
  add(pitch: number, startBeat: number, durationBeat: number, velocity: number): void {
    const beat = Math.max(0, startBeat);
    this.hits.push({
      pitch,
      startBeat: beat,
      durationBeat,
      velocity: clampVel(velocity),
    });
    this.#onsets.add(onsetKey(pitch, beat));
  }

  /** Whether a hit of this pitch already starts exactly at `startBeat`. */
  hasOnset(pitch: number, startBeat: number): boolean {
    return this.#onsets.has(onsetKey(pitch, startBeat));
  }

  /** True when a crash already sits within a 16th of `startBeat`. */
  hasCrashNear(startBeat: number): boolean {
    // The window is a 16th, and every grid in use is at least a 128th, so it is
    // enough to probe the quantized positions inside it.
    const steps = Math.round(0.25 * ONSET_KEY_SCALE);
    for (let step = 0; step < steps; step += 1) {
      if (this.#onsets.has(onsetKey(GM.CRASH, startBeat + step / ONSET_KEY_SCALE))) {
        return true;
      }
    }
    return false;
  }
}

/** Key an onset by pitch and quantized beat. */
function onsetKey(pitch: number, startBeat: number): string {
  return `${pitch}:${Math.round(startBeat * ONSET_KEY_SCALE)}`;
}
