/**
 * The spans the harmony may change on, and where the melody's notes fall in
 * them.
 *
 * A chord change lands on the grid the harmonic rhythm names, cut again at
 * every beat the caller marked as a phrase end. Everything here is about that
 * grid: where its boundaries are, which notes close on them, and which of them
 * a phrase ends in.
 */

import { BEAT_EPS } from '../../analyze/adjacency.js';
import type { MeterLike } from '../../core/meter/index.js';
import { isStrongBeat } from '../../core/meter/index.js';
import { assertGenerationBudget } from '../../core/validation/index.js';
import type { ChordSpan } from '../progression/index.js';
import type { MelodyNote, Segment } from './internal.js';
import { classifyMelodyTones } from './nct.js';

/**
 * The beats the chord grid may change on: the harmonic rhythm's own boundaries,
 * plus every named phrase end that falls inside the melody.
 *
 * A named end lands on a boundary that is already there for most callers, and
 * naming one that is not adds it rather than moving the grid, so the slots after
 * a phrase end stay where the harmonic rhythm put them.
 */
export function gridBounds(
  segmentStart: number,
  hr: number,
  gridCount: number,
  ends: readonly number[],
): number[] {
  const bounds: number[] = [];
  for (let s = 0; s <= gridCount; s += 1) {
    bounds.push(segmentStart + s * hr);
  }
  const last = segmentStart + gridCount * hr;
  for (const end of ends) {
    if (end > segmentStart + BEAT_EPS && end < last - BEAT_EPS) {
      bounds.push(end);
    }
  }
  bounds.sort((a, b) => a - b);
  return bounds.filter(
    (beat, index) => index === 0 || beat - (bounds[index - 1] ?? beat) > BEAT_EPS,
  );
}
/**
 * The note each named phrase closes on: the last one to begin before the beat
 * the phrase ends at.
 */
export function closingNoteIndices(
  spans: readonly { startBeat: number; endBeat: number }[],
  ends: readonly number[],
): Set<number> {
  const closing = new Set<number>();
  for (const end of ends) {
    let index = -1;
    let start = Number.NEGATIVE_INFINITY;
    for (const [i, span] of spans.entries()) {
      if (span.startBeat < end - BEAT_EPS && span.startBeat >= start) {
        start = span.startBeat;
        index = i;
      }
    }
    if (index >= 0) {
      closing.add(index);
    }
  }
  return closing;
}
/** The index of the segment a beat sounds in: the last boundary at or before it. */
export function segmentIndexAt(bounds: readonly number[], beat: number): number {
  let low = 0;
  let high = bounds.length - 2;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((bounds[mid] ?? 0) <= beat) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
/**
 * Collapse runs of the same chord into one span.
 *
 * The harmonic rhythm sets the grid the search may change chords on, not a
 * requirement to change on every slot; repeating a slot's chord is the same
 * harmony held longer, and reporting it once is what a chart shows.
 */
export function mergeRepeats(spans: ChordSpan[]): ChordSpan[] {
  const merged: ChordSpan[] = [];
  for (const span of spans) {
    const prev = merged.at(-1);
    if (
      prev &&
      prev.rootPc === span.rootPc &&
      prev.quality === span.quality &&
      prev.degree === span.degree &&
      prev.secondaryDominant === span.secondaryDominant
    ) {
      continue;
    }
    merged.push(span);
  }
  return merged;
}
/**
 * Segments that close and therefore have to cadence.
 *
 * The melody handed to the harmonizer closes at its end, so its last segment
 * always cadences. A caller who knows where the phrases of a longer line fall —
 * `phrasesFromTimeline` finds them — names their ends as beats, and the segment
 * each end falls in cadences too, so one call harmonizes the whole line instead
 * of the caller harmonizing each phrase and joining the results. Every cadence
 * term reads the boundaries from here.
 *
 * The named ends are returned apart from the melody's own close because they ask
 * for more than it does: naming a beat asks for a cadence there, and a cadence
 * is a chord change into the close.
 */
export function phraseEndSegments(
  segments: readonly Segment[],
  ends: readonly number[],
): { closing: Set<number>; named: Set<number> } {
  const closing = new Set(segments.length > 0 ? [segments.length - 1] : []);
  const named = new Set<number>();
  for (const end of ends) {
    // The phrase closes in the segment its last beat sounds in, which is the
    // last segment beginning before that beat — a boundary landing exactly on a
    // segment start belongs to the phrase that ended, not the one starting.
    let index = -1;
    for (let s = 0; s < segments.length; s += 1) {
      if ((segments[s]?.startBeat ?? 0) < end - BEAT_EPS) {
        index = s;
      }
    }
    if (index >= 0) {
      closing.add(index);
      named.add(index);
    }
  }
  return { closing, named };
}

/** A melody note as the search reads it: snapped to the pulse it plays. */
export type MelodySpan = {
  startBeat: number;
  endBeat: number;
};

/**
 * Cut the melody into the spans a chord may change on, and fill each with what
 * sounds in it.
 *
 * Three steps that only make sense together: the grid the harmonic rhythm and
 * the caller's phrase ends name, the notes each of its slots holds, and which
 * of those notes a chord is actually answerable for — the structural ones,
 * since a passing note is an ornament of the harmony rather than a statement
 * of it. Written out inside the entry point, none of the three could be put to
 * a question of its own.
 *
 * @param spans The melody's notes, snapped to the pulse.
 * @param melody The same notes, for the ornament classifier.
 * @param ts The meter the melody is read in, in any form a caller writes one.
 * @param grid Where the melody starts and ends, and how often the chord may
 *   change.
 * @param phraseEnds Beats the caller named as phrase closes.
 * @param budget Upper bound on the work this may do.
 * @returns The segments, the grid boundaries they were cut on, the beat that
 *   grid is anchored at, and the phrase ends falling inside the melody.
 */
export function buildSegments(
  spans: readonly MelodySpan[],
  melody: readonly MelodyNote[],
  ts: MeterLike,
  grid: { start: number; end: number; harmonicRhythm: number },
  phraseEnds: readonly number[],
  budget?: number,
): { segments: Segment[]; innerEnds: number[]; bounds: number[]; segmentStart: number } {
  const melodyStart = grid.start;
  const melodyEnd = grid.end;
  const hr = grid.harmonicRhythm;
  const segmentStart = Math.floor(melodyStart / hr) * hr;
  const gridCount = Math.max(1, Math.ceil((melodyEnd - segmentStart) / hr));
  assertGenerationBudget(gridCount, 'harmonic segments', budget);
  // Only a beat inside the melody names a close inside it. A beat at or beyond
  // the melody's end names the close the melody already has, and one at or
  // before the grid's first boundary names no slot at all, so neither may reach
  // the grid, the cadence points, or the tones read as structural: passing the
  // end of the last phrase along with the ends of the others — which is what
  // `phrasesFromTimeline` returns — harmonizes the line exactly as naming the
  // inner closes alone does.
  const innerEnds = phraseEnds.filter(
    (end) => end > segmentStart + BEAT_EPS && end < melodyEnd - BEAT_EPS,
  );
  // The grid the search may change chords on: the harmonic rhythm, anchored at
  // the melody's first slot boundary, divided again at every beat the caller
  // named as a phrase end. A named end falling inside a slot cuts it, so the
  // slot a phrase closes in ends where the phrase does instead of running on
  // into the next one, and the grid then resumes on its own boundaries — which
  // is what keeps the chord changes after the boundary on the barline.
  const bounds = gridBounds(segmentStart, hr, gridCount, innerEnds);
  const segCount = bounds.length - 1;
  assertGenerationBudget(segCount, 'harmonic segments', budget);
  const segments: Segment[] = Array.from({ length: segCount }, (_, s) => {
    const startBeat = bounds[s] ?? segmentStart;
    const endBeat = bounds[s + 1] ?? startBeat + hr;
    return {
      startBeat,
      endBeat,
      beats: endBeat - startBeat,
      noteIndices: [],
      costNotes: [],
      weight: 0,
    };
  });
  // Associate each note only with the windows it actually spans: each note is
  // visited once per window it covers, and no temporary note objects are
  // allocated.
  let memberships = 0;
  for (const [index, span] of spans.entries()) {
    const first = segmentIndexAt(bounds, span.startBeat);
    let lastExclusive = first;
    while (
      lastExclusive < segCount &&
      (bounds[lastExclusive] ?? 0) < span.endBeat - Number.EPSILON
    ) {
      lastExclusive += 1;
    }
    memberships += Math.max(0, lastExclusive - first);
    assertGenerationBudget(memberships, 'note-to-segment memberships', budget);
    for (let segment = first; segment < lastExclusive; segment += 1) {
      segments[segment]?.noteIndices.push(index);
    }
  }

  // Classify the ornaments before any chord exists, and keep only the structural
  // tones in each slot's emission term. Transposing a melody moves every note
  // alike, so the figures are the same at every placement and are found once —
  // and so is the metric weight of each note in each slot it sounds in.
  const tones = classifyMelodyTones(melody, ts);
  // The classifier reads a note against the notes on either side of it, and
  // knows nothing of phrases: the melody's own last note is structural because
  // nothing follows it, but the note closing a phrase inside the line has the
  // next phrase's first note after it and is heard as an ornament of it — a
  // close on the tonic between two supertonics reads as a lower neighbour. A
  // phrase's last note is structural for the same reason the melody's last note
  // is, so the closes the caller named are put back.
  const phraseClosingNotes = closingNoteIndices(spans, innerEnds);
  for (const segment of segments) {
    const structural = segment.noteIndices.filter(
      (idx) => tones[idx]?.ornamental !== true || phraseClosingNotes.has(idx),
    );
    const costIndices = structural.length > 0 ? structural : segment.noteIndices;
    let closingStart = Number.NEGATIVE_INFINITY;
    for (const index of costIndices) {
      const span = spans[index];
      if (!span) {
        continue;
      }
      const overlapStart = Math.max(span.startBeat, segment.startBeat);
      const overlap = Math.min(span.endBeat, segment.endBeat) - overlapStart;
      if (overlap <= 0) {
        continue;
      }
      const weight = Math.max(0.25, overlap);
      segment.costNotes.push({ index, weight, strong: isStrongBeat(overlapStart, ts) });
      segment.weight += weight;
      // The tone a phrase closes on is the last one to start, which is not the
      // last one listed when a note held from earlier is still sounding under it.
      if (span.startBeat >= closingStart) {
        closingStart = span.startBeat;
        segment.closingIndex = index;
      }
    }
  }
  return { segments, innerEnds, bounds, segmentStart };
}
