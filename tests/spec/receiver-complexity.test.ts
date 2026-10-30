import {
  type ArrangementTrack,
  type ChordTimeline,
  chordTimelineFromChords,
} from '@libraz/libcantus/analyze';
import {
  type MeterMap,
  type NoteEvent,
  parseTimeSignature,
  type TempoMap,
} from '@libraz/libcantus/core';
import { Arrangement, Score } from '@libraz/libcantus/model';
import { majorKey, makeChord, spanFromChord } from '@libraz/libcantus/theory';
import { describe, expect, it } from 'vitest';

// Recording writes every call's arguments out in full, which is the cost these tests rule out.
const recording = process.env.CANTUS_RECORD !== undefined;

/** Receiver size the smaller measurement is made at. */
const SIZE = 2000;

/** The factor the receiver is grown by between the two measurements. */
const GROWTH = 4;

/** Calls made per timed run. */
const CALLS = 200;

/**
 * The cost of one run, in milliseconds, as the best of several runs.
 *
 * The best rather than the mean: a scheduling interruption can only make a run
 * slower, so the fastest of them is the one least contaminated by the machine.
 */
function cost(run: () => void): number {
  run();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * How much the cost of a run may grow when its receiver is quadrupled.
 *
 * A call that costs the same whatever the receiver holds stays at 1; one that
 * walks or re-sends the receiver grows by 4. A bound of 2 is under that and
 * leaves room for cache effects and garbage collection.
 */
const PER_CALL_TOLERANCE = 2;

/**
 * Slack added to the bound, in milliseconds.
 *
 * Lookups that are logarithmic or constant cost microseconds per run here, where
 * a ratio is timer noise rather than a growth rate.
 */
const SLACK_MS = 1;

/**
 * Assert that growing the receiver fourfold does not grow the cost of the run
 * by more than `tolerance` plus the slack.
 *
 * The smaller size is measured first, so a warm-up advantage works against the
 * assertion rather than for it.
 */
function expectBounded(
  label: string,
  tolerance: number,
  at: (n: number) => () => void,
  size = SIZE,
): void {
  const small = cost(at(size));
  const large = cost(at(size * GROWTH));
  expect(
    large,
    `${label}: ${size} took ${small.toFixed(2)}ms, ${size * GROWTH} took ${large.toFixed(2)}ms`,
  ).toBeLessThan(small * tolerance + SLACK_MS);
}

/** A score of n notes under a short tempo map and meter map. */
function scoreOf(n: number): Score {
  const notes: NoteEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    notes.push({ pitch: 48 + (i % 24), startBeat: i, durationBeat: 1 });
  }
  const meters: MeterMap = [
    { startBeat: 0, ts: parseTimeSignature('4/4') },
    { startBeat: 8, ts: parseTimeSignature('3/4') },
  ];
  const tempo: TempoMap = [
    { startBeat: 0, bpm: 120 },
    { startBeat: 4, bpm: 60 },
  ];
  return Score.of(notes, { meters, tempo, key: 'C major' });
}

/** A chord timeline of n one-beat spans. */
function timelineOf(n: number): ChordTimeline {
  const roots = [0, 5, 7, 0];
  return chordTimelineFromChords(
    Array.from({ length: n }, (_, i) =>
      spanFromChord(makeChord(roots[i % roots.length] ?? 0, 'maj'), i),
    ),
    n,
  );
}

/** The beats a run of calls visits: spread over the receiver, not at its front. */
function probes(span: number): number[] {
  return Array.from({ length: CALLS }, (_, i) => ((i * 7919) % span) + 0.25);
}

describe.skipIf(recording)('a call on a held receiver costs no more for a larger receiver', () => {
  it('reads Score#secondsAt in time independent of the score', () => {
    expectBounded('secondsAt', PER_CALL_TOLERANCE, (n) => {
      const score = scoreOf(n);
      const beats = probes(n);
      return () => {
        for (const beat of beats) {
          score.secondsAt(beat);
        }
      };
    });
  });

  it('reads Score#barAt in time independent of the score', () => {
    expectBounded('barAt', PER_CALL_TOLERANCE, (n) => {
      const score = scoreOf(n);
      const beats = probes(n);
      return () => {
        for (const beat of beats) {
          score.barAt(beat);
        }
      };
    });
  });

  it('reads ChordTimeline#at in time independent of the timeline', () => {
    expectBounded('ChordTimeline#at', PER_CALL_TOLERANCE, (n) => {
      const timeline = timelineOf(n);
      const beats = probes(n);
      return () => {
        for (const beat of beats) {
          timeline.at(beat);
        }
      };
    });
  });

  it('answers the probes the same at both sizes', () => {
    for (const size of [SIZE, SIZE * GROWTH]) {
      expect(scoreOf(size).barAt(1.25)).toEqual({ bar: 0, beat: 1.25 });
      expect(timelineOf(size).at(1.25)?.rootPc).toBe(5);
    }
  });
});

/** An arrangement of a harmony track and a melody track, `bars` bars long. */
function arrangementOf(bars: number): ArrangementTrack[] {
  const harmony: NoteEvent[] = [];
  const melody: NoteEvent[] = [];
  const roots = [48, 53, 55, 48];
  for (let bar = 0; bar < bars; bar += 1) {
    const root = roots[bar % roots.length] ?? 48;
    for (const interval of [0, 4, 7]) {
      harmony.push({ pitch: root + interval, startBeat: bar * 4, durationBeat: 4 });
    }
    for (let beat = 0; beat < 4; beat += 1) {
      melody.push({ pitch: 72 + ((bar + beat) % 5), startBeat: bar * 4 + beat, durationBeat: 1 });
    }
  }
  return [
    { name: 'harmony', role: 'harmony', notes: harmony },
    { name: 'melody', role: 'melody', notes: melody },
  ];
}

/** Edits per timed run of the editor cycle. */
const EDITS = 5;

/**
 * How much the cycle may grow when the arrangement is quadrupled.
 *
 * Linear growth is 4 and quadratic is 16; pure TS measures just under 4, so
 * eight leaves room for the wire cost of a surface without admitting a
 * quadratic path.
 */
const CYCLE_TOLERANCE = 8;

/** Bars in the smaller arrangement. */
const BARS = 50;

/**
 * An editor cycle: edit one melody note, then read the analysis and the conflicts.
 *
 * Each edit hands the previous result on, so the arrangement is analysed once
 * and every later edit is the incremental update of the one before it.
 */
function editorCycle(bars: number): () => void {
  const first = Arrangement.of(arrangementOf(bars), { key: majorKey(0) });
  return () => {
    let arrangement = first;
    for (let edit = 0; edit < EDITS; edit += 1) {
      const melody = arrangement.tracks[1]?.notes ?? [];
      const next = melody.map((note, index) =>
        index === edit ? { ...note, pitch: note.pitch === 72 ? 73 : 72 } : note,
      );
      arrangement = arrangement.update([{ trackIndex: 1, notes: next }]);
      expect(arrangement.analysis.segmentConfidence.length).toBeGreaterThan(0);
      expect(arrangement.conflicts).toBeDefined();
    }
  };
}

describe.skipIf(recording)(
  'an editor cycle grows no faster than linearly in the arrangement',
  () => {
    it('across updates and reads, quadrupling the arrangement stays under the linear-cost bound', () => {
      // The cycle reads the whole of its result, so it is linear in the arrangement.
      expectBounded('editor cycle', CYCLE_TOLERANCE, editorCycle, BARS);
    });
  },
);
