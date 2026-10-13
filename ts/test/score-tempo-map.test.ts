import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { Instrument } from '../src/model/instrument.js';
import { Score } from '../src/model/score.js';

/**
 * A shift from the open low string to the top of the neck: 24 frets, which is
 * comfortable over half a beat at 60 bpm and beyond the hand at 480.
 */
const LONG_SHIFT: NoteEvent[] = [
  { pitch: 28, startBeat: 0, durationBeat: 0.25 },
  { pitch: 67, startBeat: 0.5, durationBeat: 0.25 },
  { pitch: 28, startBeat: 8, durationBeat: 0.25 },
  { pitch: 67, startBeat: 8.5, durationBeat: 0.25 },
];

describe('a score reads its whole tempo map', () => {
  it('judges each passage at the tempo actually in force across it', () => {
    // The second pair sits after an eightfold tempo change. Read at the opening
    // tempo alone it is the same half-beat shift as the first pair and passes;
    // read through the map it is the same shift in an eighth of the time.
    const accelerating = Score.of(LONG_SHIFT, {
      tempo: [
        { startBeat: 0, bpm: 60 },
        { startBeat: 8, bpm: 480 },
      ],
    });
    const report = accelerating.playability(Instrument.bass4());
    const tooFast = report.issues.filter((issue) => issue.type === 'tooFast');
    expect(tooFast).toHaveLength(1);
    expect(tooFast[0]?.layer).toBe(3);
    // The beat the issue names is the score's own, not the restated one.
    expect(tooFast[0]?.startBeat).toBe(8.5);
    expect(tooFast[0]?.notes).toEqual([2, 3]);

    // The opening tempo applied to everything finds nothing, which is the
    // plausible but wrong answer.
    const openingOnly = Score.of(LONG_SHIFT, { tempo: 60 });
    expect(openingOnly.playability(Instrument.bass4()).issues).toEqual([]);

    // The passage's own tempo is what settles it: at 480 throughout, both pairs
    // are beyond the hand.
    const fastThroughout = Score.of(LONG_SHIFT, { tempo: 480 });
    expect(
      fastThroughout.playability(Instrument.bass4()).issues.filter((i) => i.type === 'tooFast'),
    ).toHaveLength(2);
  });

  it('reports the same difficulty as the elapsed time the tempo map gives', () => {
    const notes: NoteEvent[] = Array.from({ length: 16 }, (_, index) => ({
      pitch: 40 + (index % 5),
      startBeat: index * 0.5,
      durationBeat: 0.25,
    }));
    const constant = Score.of(notes, { tempo: 120 });
    const changing = Score.of(notes, {
      tempo: [
        { startBeat: 0, bpm: 120 },
        { startBeat: 4, bpm: 240 },
      ],
    });
    // The same notes take less wall-clock time under the change, so the same
    // movement is packed into fewer seconds and reads as harder.
    expect(changing.secondsAt(8)).toBeLessThan(constant.secondsAt(8));
    expect(changing.playability(Instrument.bass4()).difficulty).toBeGreaterThan(
      constant.playability(Instrument.bass4()).difficulty,
    );
  });

  it('leaves a constant-tempo score reading exactly as it did', () => {
    const constant = Score.of(LONG_SHIFT, { tempo: 60 });
    const asMap = Score.of(LONG_SHIFT, { tempo: [{ startBeat: 0, bpm: 60 }] });
    expect(asMap.playability(Instrument.bass4())).toEqual(constant.playability(Instrument.bass4()));
  });
});

describe('a score hands out ticks with no negative zero', () => {
  it('rounds an early pickup onto positive zero', () => {
    // A humanized pickup note lands a fraction of a tick before the downbeat.
    // `-0` and `0` key apart under `Object.is`, so a writer bucketing events by
    // tick would carry two beat 0s out of one score.
    const score = Score.of([{ pitch: 60, startBeat: -0.0005, durationBeat: 1 }]);
    const ticks = score.toTicks(480);
    expect(ticks[0]?.startBeat).toBe(0);
    expect(Object.is(ticks[0]?.startBeat, 0)).toBe(true);
    expect(ticks[0]?.durationBeat).toBe(480);
    // A pickup far enough before the downbeat is still a negative tick count.
    expect(
      Score.of([{ pitch: 60, startBeat: -1, durationBeat: 1 }]).toTicks(480)[0]?.startBeat,
    ).toBe(-480);
  });
});
