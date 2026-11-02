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
import { BEAT_EPS, HUMANIZE_ADJACENCY } from './adjacency.js';
import { firstSoundingBeat } from './form/internal.js';

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
  const startBeat = firstOnset < 0 && firstOnset > -HUMANIZE_ADJACENCY ? 0 : firstOnset;
  // The grid starts where the music does — but a whole number of slots from
  // beat 0, or every slot boundary would sit off the bar lines by however far
  // into a slot the first note falls. Dropping a pickup instead would throw
  // away the very bar that establishes the key.
  return { origin: Math.floor(startBeat / slotBeats + BEAT_EPS) * slotBeats, startBeat };
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
 * The beat the latest-ending note stops sounding on.
 *
 * Every analysed span's end reads from here. The reduction is seeded from
 * negative infinity: seeding it with 0 anchors a span to beat 0 and reports a
 * pickup lying wholly before the downbeat as ending on it.
 *
 * @param notes The sounding notes of the span.
 * @param fallback The beat to report when nothing sounds.
 * @returns The greatest `startBeat + durationBeat`, or `fallback` for an empty span.
 */
export function latestSoundingEnd(notes: readonly NoteEvent[], fallback = 0): number {
  if (notes.length === 0) {
    return fallback;
  }
  let end = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    end = Math.max(end, note.startBeat + note.durationBeat);
  }
  return end;
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

/**
 * The span a chord timeline and the notes under it share: where its bars start
 * and where the music stops sounding.
 *
 * The start is the bar-grid start of the earlier of the first onset and the
 * first segment; the end is the later of the last note's end and the last
 * segment's end, or 0 for neither.
 *
 * @param sounding The sounding notes of the span.
 * @param segments The timeline's chord segments, in beat order.
 * @param meter A single signature, or the piece's meter map.
 * @returns The span's first beat and the end of its music.
 */
export function timelineSpan(
  sounding: readonly NoteEvent[],
  segments: readonly { startBeat: number; endBeat: number }[],
  meter: MeterLike,
): { startBeat: number; notesEnd: number } {
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const firstOnset = firstSoundingBeat(sounding, firstSegment?.startBeat ?? 0);
  const startBeat = barGridStart(
    Math.min(firstOnset, firstSegment?.startBeat ?? firstOnset),
    meter,
  );
  const latestEnd = Math.max(
    lastSegment?.endBeat ?? Number.NEGATIVE_INFINITY,
    latestSoundingEnd(sounding, Number.NEGATIVE_INFINITY),
  );
  return { startBeat, notesEnd: Number.isFinite(latestEnd) ? latestEnd : 0 };
}
