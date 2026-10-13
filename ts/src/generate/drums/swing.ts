import type { Feel } from './internal.js';

const SIXTEENTH = 0.25;
const EIGHTH = 0.5;
/** Delay of an off-beat 16th at full swing (triplet minus straight), in beats. */
const DELTA_16 = 1 / 3 - 1 / 4; // 0.08333...
/** Delay of an off-beat 8th at full swing, in beats. */
const DELTA_8 = (2 / 3 - 1 / 2) / 2 + (2 / 3 - 1 / 2) / 2; // 0.16667...

/** Grid resolution for swing quantization. */
export type SwingResolution = 'eighth' | 'sixteenth';

/**
 * Effective swing after applying the groove feel to a base swing amount.
 *
 * A feel names how far toward the triplet the off-beats sit, and the amount is
 * already that quantity — `'shuffle'` is the full triplet, `'swing'` a lighter
 * lean. Straight is straight whatever amount comes with it.
 */
export function effectiveSwing(feel: Feel, swingAmount: number): number {
  if (feel === 'straight') {
    return 0;
  }
  return Math.max(0, Math.min(1, swingAmount));
}

/**
 * The grid a resolution swings, as `[position, delay at full swing]` pairs
 * within one beat.
 *
 * The "a" 16th is the midpoint of the compressed second half of the beat
 * (between the swung "and" and the next downbeat), mirroring the "e" 16th in
 * the first half. Because DELTA_8 = 2 * DELTA_16, that midpoint reduces to a
 * single DELTA_16 delay off the straight position, so the "a" never overshoots
 * the downbeat and needs no clamp.
 */
const SWING_NODES: Readonly<Record<SwingResolution, readonly (readonly [number, number])[]>> =
  Object.freeze({
    eighth: [
      [0, 0],
      [EIGHTH, DELTA_8],
      [1, 0],
    ],
    sixteenth: [
      [0, 0],
      [SIXTEENTH, DELTA_16],
      [EIGHTH, DELTA_8],
      [3 * SIXTEENTH, DELTA_16],
      [1, 0],
    ],
  });

/**
 * Push an off-beat position toward its triplet placement.
 *
 * On-beat positions are returned unchanged and off-beat 8ths and 16ths are
 * delayed proportionally to the swing amount. A position between two grid slots
 * — a Euclidean kick on a five-step bar, a pattern from a caller's own grid — is
 * delayed by an interpolation of its neighbours' delays rather than snapped to
 * one of them: swing is a warp of the beat, so the order of what was written
 * survives it and nothing ever arrives earlier than it was written.
 *
 * @param startBeat Absolute position in beats.
 * @param swing Swing amount in [0, 1] (already feel-adjusted).
 * @param resolution Whether to swing the 16th or only the 8th grid.
 * @returns The swung position in beats, never earlier than `startBeat`.
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
  const nodes = SWING_NODES[resolution];

  for (let i = 1; i < nodes.length; i += 1) {
    const [from, fromDelay] = nodes[i - 1] ?? [0, 0];
    const [to, toDelay] = nodes[i] ?? [1, 0];
    if (offset < from || offset > to) {
      continue;
    }
    const span = to - from;
    const share = span <= 0 ? 0 : (offset - from) / span;
    const delay = fromDelay + (toDelay - fromDelay) * share;
    return startBeat + delay * clamped;
  }
  return startBeat;
}
