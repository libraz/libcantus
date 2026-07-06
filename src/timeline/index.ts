import type { Chord } from '../chord/index.js';
import { makeChord } from '../chord/index.js';
import type { GeneratedChord } from '../progression/index.js';

/** A chord occupying a half-open beat span. */
export type ChordSegment = {
  startBeat: number;
  endBeat: number;
  chord: Chord;
};

/** A beat-indexed sequence of chord segments. */
export type ChordTimeline = {
  /** The chord sounding at a beat, or null when no segment covers it. */
  at: (beat: number) => Chord | null;
  segments: ChordSegment[];
};

/**
 * Build a chord timeline from placed chords.
 *
 * Each chord spans from its `startBeat` to the next chord's `startBeat`; the last
 * chord runs to `totalBeats`. `at(beat)` returns the covering segment's chord, or
 * null when the beat lies outside every segment.
 *
 * @param chords Placed chords in time order.
 * @param totalBeats End of the timeline in beats.
 * @returns A queryable chord timeline.
 */
export function chordTimelineFromChords(
  chords: GeneratedChord[],
  totalBeats: number,
): ChordTimeline {
  const sorted = [...chords].sort((a, b) => a.startBeat - b.startBeat);
  const segments: ChordSegment[] = sorted.map((gc, i) => {
    const next = sorted[i + 1];
    const endBeat = next ? next.startBeat : totalBeats;
    return { startBeat: gc.startBeat, endBeat, chord: makeChord(gc.rootPc, gc.quality, gc.bassPc) };
  });

  const at = (beat: number): Chord | null => {
    for (const seg of segments) {
      if (beat >= seg.startBeat && beat < seg.endBeat) {
        return seg.chord;
      }
    }
    return null;
  };

  return { at, segments };
}
