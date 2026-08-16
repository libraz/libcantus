/**
 * Where a slot grid starts when the music begins before the downbeat.
 *
 * Chord inference and key inference slice the same piece into slots of
 * different lengths, so they have to agree about where the piece starts or the
 * two answers describe different spans. They read the origin from here for that
 * reason: the same input can only have one first beat.
 */

const EPS = 1e-9;

/**
 * How far below beat 0 an onset may sit and still be read as beat 0.
 *
 * A recording or an export puts the first note a millibeat early; an upbeat
 * puts it a beat early. Only the second is a pickup, and reading the first as
 * one hands the analysis a whole slot of silence before the music. The bound is
 * the tolerance the rest of the library uses for played-not-quantized timing.
 */
const PICKUP_JITTER = 0.05;

/**
 * The grid a span is analyzed in: equal slots of `slotBeats` from `origin`, and
 * the beat the music itself starts on.
 */
export type GridOrigin = {
  /**
   * First beat of slot 0. Always a whole number of slots from beat 0, so the
   * grid's boundaries keep falling on the bar lines rather than being pushed
   * off them by the length of the upbeat.
   */
  origin: number;
  /**
   * First beat that sounds. Never earlier than `origin` and never later than 0,
   * so a pickup that is not a whole number of slots long is analyzed in a slot
   * that begins before it without being reported as sounding there.
   */
  startBeat: number;
};

/**
 * Place the slot grid for a span whose earliest onset is `firstOnset`.
 *
 * @param firstOnset The earliest onset of a sounding note, or 0 when none is
 *   earlier than the downbeat.
 * @param slotBeats Length of one slot in beats.
 * @returns The grid origin and the beat the music starts on.
 */
export function gridOriginOf(firstOnset: number, slotBeats: number): GridOrigin {
  // A pickup sounds before beat 0, so the grid has to start there too — but a
  // whole number of slots before it, or every slot boundary after the pickup
  // would sit off the bar lines by the length of the upbeat. Dropping those
  // notes instead would throw away the very bar that establishes the key.
  if (firstOnset >= -PICKUP_JITTER) {
    return { origin: 0, startBeat: 0 };
  }
  return { origin: Math.floor(firstOnset / slotBeats + EPS) * slotBeats, startBeat: firstOnset };
}
