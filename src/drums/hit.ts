import { clampVel } from './internal.js';

/** A single percussion onset. */
export type DrumHit = {
  pitch: number;
  startBeat: number;
  durationBeat: number;
  velocity: number;
};

/** Accumulator for drum onsets with velocity clamping and simple lookups. */
export class HitList {
  readonly hits: DrumHit[] = [];

  /** Append a hit, clamping velocity and dropping non-positive positions. */
  add(pitch: number, startBeat: number, durationBeat: number, velocity: number): void {
    this.hits.push({
      pitch,
      startBeat: Math.max(0, startBeat),
      durationBeat,
      velocity: clampVel(velocity),
    });
  }

  /** True when a crash already sits within a 16th of `startBeat`. */
  hasCrashNear(startBeat: number): boolean {
    return this.hits.some(
      (h) => h.pitch === 49 && h.startBeat >= startBeat && h.startBeat < startBeat + 0.25,
    );
  }
}
