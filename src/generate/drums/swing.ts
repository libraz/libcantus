import type { Feel } from './internal.js';

const SIXTEENTH = 0.25;
const EIGHTH = 0.5;
const HALF_16TH = 0.125;
/** Delay of an off-beat 16th at full swing (triplet minus straight), in beats. */
const DELTA_16 = 1 / 3 - 1 / 4; // 0.08333...
/** Delay of an off-beat 8th at full swing, in beats. */
const DELTA_8 = (2 / 3 - 1 / 2) / 2 + (2 / 3 - 1 / 2) / 2; // 0.16667...

/** Grid resolution for swing quantization. */
export type SwingResolution = 'eighth' | 'sixteenth';

/** Effective swing after applying the groove feel to a base swing amount. */
export function effectiveSwing(feel: Feel, swingAmount: number): number {
  if (feel === 'straight') {
    return 0;
  }
  if (feel === 'shuffle') {
    return Math.min(1, swingAmount * 1.5);
  }
  return swingAmount;
}

/**
 * Push an off-beat position toward its triplet placement.
 *
 * On-beat positions are returned unchanged; off-beat 8ths and 16ths are delayed
 * proportionally to the swing amount.
 *
 * @param startBeat Absolute position in beats.
 * @param swing Swing amount in [0, 1] (already feel-adjusted).
 * @param resolution Whether to swing the 16th or only the 8th grid.
 * @returns The swung position in beats.
 */
export function quantizeSwing(
  startBeat: number,
  swing: number,
  resolution: SwingResolution,
): number {
  const clamped = Math.max(0, Math.min(1, swing));
  if (clamped <= 0) {
    return startBeat;
  }
  const base = Math.floor(startBeat);
  const offset = startBeat - base;

  if (resolution === 'sixteenth') {
    if (offset >= HALF_16TH && offset < SIXTEENTH + HALF_16TH) {
      return base + SIXTEENTH + DELTA_16 * clamped;
    }
    if (offset >= SIXTEENTH + HALF_16TH && offset < EIGHTH + HALF_16TH) {
      return base + EIGHTH + DELTA_8 * clamped;
    }
    if (offset >= EIGHTH + HALF_16TH && offset < 3 * SIXTEENTH + HALF_16TH) {
      // The "a" 16th is the midpoint of the compressed second half of the beat
      // (between the swung "and" and the next downbeat), mirroring the "e" 16th
      // in the first half. Because DELTA_8 = 2 * DELTA_16, that midpoint reduces
      // to a single DELTA_16 delay off the straight position, so the "a" never
      // overshoots the downbeat and needs no clamp. At the default shuffle feel
      // (swing 0.75) this lands near 0.8125 rather than the doubly-swung 0.9375.
      return base + 3 * SIXTEENTH + DELTA_16 * clamped;
    }
    return startBeat;
  }

  if (offset >= SIXTEENTH && offset < 3 * SIXTEENTH) {
    return base + EIGHTH + DELTA_8 * clamped;
  }
  return startBeat;
}
