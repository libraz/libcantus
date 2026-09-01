/**
 * Where a slot grid starts: the beat the music itself begins on.
 *
 * Chord inference, key inference and the tension curve slice the same piece
 * into slots of different lengths, so they have to agree about where the piece
 * starts or the three answers describe different spans. They read the origin
 * from here for that reason: the same input can only have one first beat,
 * whether it arrives before the downbeat as a pickup or well after it as an
 * excerpt lifted from the middle of a piece.
 */

import type { MeterLike } from '../core/meter/index.js';
import { beatsPerBarAt } from '../core/meter/index.js';
import type { NoteEvent } from '../core/types.js';
import { firstSoundingBeat } from './form/internal.js';

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
   * off them by the length of the upbeat or by where the excerpt was cut.
   */
  origin: number;
  /**
   * First beat that sounds. Never earlier than `origin` and never a whole slot
   * later than it, so a span whose first note falls inside a slot rather than
   * on its boundary is analyzed in a slot that begins before it without being
   * reported as sounding there.
   */
  startBeat: number;
};

/**
 * Place the slot grid for a span whose earliest onset is `firstOnset`.
 *
 * @param firstOnset The earliest onset of a sounding note.
 * @param slotBeats Length of one slot in beats.
 * @returns The grid origin and the beat the music starts on.
 */
export function gridOriginOf(firstOnset: number, slotBeats: number): GridOrigin {
  // A note a millibeat before the downbeat is playing it rather than
  // anticipating it, and reading it as a pickup would hand the analysis a whole
  // silent slot ahead of the music.
  const startBeat = firstOnset < 0 && firstOnset > -PICKUP_JITTER ? 0 : firstOnset;
  // The grid starts where the music does — but a whole number of slots from
  // beat 0, or every slot boundary would sit off the bar lines by however far
  // into a slot the first note falls. Dropping a pickup instead would throw
  // away the very bar that establishes the key.
  return { origin: Math.floor(startBeat / slotBeats + EPS) * slotBeats, startBeat };
}

/**
 * Place the slot grid for the notes themselves.
 *
 * This is the one derivation of an analysed span's origin. Seeding a minimum
 * with 0 instead — the shape each reader would otherwise write for itself —
 * anchors every analysis to beat 0, so an excerpt lifted from bar 9 is reported
 * as starting there and as holding eight bars of silence it never had. The form
 * analyses already answer from {@link firstSoundingBeat}, and this is the same
 * answer placed on a slot grid.
 *
 * @param notes The sounding notes of the span. Notes that never sound are the
 *   caller's to drop; a span with none starts at beat 0.
 * @param slotBeats Length of one slot in beats.
 * @returns The grid origin and the beat the music starts on.
 */
export function gridForNotes(notes: readonly NoteEvent[], slotBeats: number): GridOrigin {
  return gridOriginOf(firstSoundingBeat(notes), slotBeats);
}

/**
 * First beat of a span read in bars, with the pickup rule applied.
 *
 * The bar is the slot the form analyses work in, so phrases, sections and
 * hypermeter answer the pickup question from here rather than from a raw
 * minimum of their own. Three readings of one piece that disagree about where
 * bar 1 begins are not three opinions: an export that puts the first note a
 * millibeat early would give one of them a pickup the other two never saw.
 *
 * @param firstOnset The earliest onset of the span, from
 *   {@link firstSoundingBeat}.
 * @param meter A single signature, or the piece's meter map.
 * @returns The beat the span's bars are counted from.
 */
export function barGridStart(firstOnset: number, meter: MeterLike): number {
  return gridOriginOf(firstOnset, beatsPerBarAt(firstOnset, meter)).startBeat;
}
