import { describe, expect, it } from 'vitest';
import { analyzeRhythm, RHYTHM_IOI_BINS } from '../src/analyze/rhythm/index.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import type { NoteEvent } from '../src/core/types.js';

/** A run of quarter notes, one beat apart, starting at `startBeat`. */
function quarters(count: number, startBeat = 0): NoteEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    pitch: 60,
    startBeat: startBeat + i,
    durationBeat: 1,
  }));
}

describe('analyzeRhythm on four straight quarters in 4/4', () => {
  const result = analyzeRhythm(quarters(4), { ts: '4/4' });

  it('reads a density of one onset per pulse and no rest', () => {
    expect(result.startBeat).toBe(0);
    expect(result.endBeat).toBe(4);
    expect(result.bars).toBe(1);
    expect(result.onsets).toBe(4);
    expect(result.onsetDensity).toBe(4);
    expect(result.restRatio).toBe(0);
  });

  it('has no syncopation: every onset lands on a pulse', () => {
    expect(result.syncopation).toBe(0);
  });

  it('is fully on grid', () => {
    expect(result.offGridRatio).toBe(0);
  });

  it('counts every onset into the single bar it falls in', () => {
    expect(result.barOnsets).toEqual([4]);
  });

  it('reads the downbeat, the two secondary pulses and the mid-bar pulse by their metricWeight-derived level', () => {
    // Levels: beat0 downbeat -> metricWeight 3 + 2 = 5; beat1, beat3 plain
    // pulses -> metricWeight 1 + 2 = 3; beat2 secondary pulse -> metricWeight
    // 2 + 2 = 4. Two onsets share level 3, one each at 4 and 5.
    expect(result.onsetLevels).toEqual([0, 0, 0, 0.5, 0.25, 0.25]);
  });

  it('bins every one-beat interval into the same inter-onset-interval slot', () => {
    expect(RHYTHM_IOI_BINS[8]).toBe(1);
    const expected = new Array(RHYTHM_IOI_BINS.length).fill(0);
    expected[8] = 1;
    expect(result.interOnsetShares).toEqual(expected);
  });

  it('places all of its mass on the four pulse slots of a single 4/4 profile', () => {
    expect(result.barPositions).toHaveLength(1);
    const profile = result.barPositions[0];
    expect(profile?.ts).toEqual({ numerator: 4, denominator: 4 });
    expect(profile?.slotsPerBar).toBe(48);
    expect(profile?.onsets).toBe(4);
    const expectedShares = new Array(48).fill(0);
    expectedShares[0] = 0.25;
    expectedShares[12] = 0.25;
    expectedShares[24] = 0.25;
    expectedShares[36] = 0.25;
    expect(profile?.shares).toEqual(expectedShares);
  });
});

describe('analyzeRhythm on straight eighth notes in 6/8', () => {
  // Six eighth notes (half a beat apart) fill one 6/8 bar exactly.
  const notes: NoteEvent[] = Array.from({ length: 6 }, (_, i) => ({
    pitch: 62,
    startBeat: i * 0.5,
    durationBeat: 0.5,
  }));
  const result = analyzeRhythm(notes, { ts: '6/8' });

  it('reads six onsets over one compound bar', () => {
    expect(result.bars).toBe(1);
    expect(result.onsets).toBe(6);
    expect(result.onsetDensity).toBe(6);
    expect(result.restRatio).toBe(0);
    expect(result.offGridRatio).toBe(0);
  });

  it('weighs the two dotted-quarter pulses above the plain eighths between them', () => {
    // beat0 downbeat -> 5, beat1.5 secondary pulse -> 4, the four eighths in
    // between (0.5, 1, 2, 2.5) are the pulse's first subdivision -> 1 each.
    expect(result.onsetLevels).toEqual([0, 4 / 6, 0, 0, 1 / 6, 1 / 6]);
  });

  it('has no syncopation: every onset lands on a pulse or its own subdivision', () => {
    expect(result.syncopation).toBe(0);
  });

  it('sizes its bar-position profile to the compound bar', () => {
    expect(result.barPositions).toHaveLength(1);
    expect(result.barPositions[0]?.ts).toEqual({ numerator: 6, denominator: 8 });
    expect(result.barPositions[0]?.slotsPerBar).toBe(36);
  });
});

describe('analyzeRhythm on an eighth-note triplet', () => {
  // Three onsets evenly filling one beat land exactly on the twelfth grid
  // (slots 0, 4, 8 of 12), so none of them read as off grid.
  const notes: NoteEvent[] = [
    { pitch: 60, startBeat: 0, durationBeat: 1 / 3 },
    { pitch: 62, startBeat: 1 / 3, durationBeat: 1 / 3 },
    { pitch: 64, startBeat: 2 / 3, durationBeat: 1 / 3 },
  ];

  it('reads all three onsets as on grid', () => {
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.onsets).toBe(3);
    expect(result.offGridRatio).toBe(0);
  });
});

describe('analyzeRhythm across a meter change', () => {
  // Two 4/4 bars of quarter notes followed by one 3/4 bar of quarter notes:
  // 11 onsets over exactly 3 bars.
  const meters = [
    { startBeat: 0, ts: { numerator: 4, denominator: 4 } },
    { startBeat: 8, ts: { numerator: 3, denominator: 4 } },
  ];
  const result = analyzeRhythm(quarters(11), { meters });

  it('counts the real bar length across the change', () => {
    expect(result.bars).toBe(3);
    expect(result.onsets).toBe(11);
    expect(result.onsetDensity).toBeCloseTo(11 / 3, 9);
  });

  it('splits the onsets into the bars each meter actually gives them', () => {
    expect(result.barOnsets).toEqual([4, 4, 3]);
  });

  it('reads two bar-position profiles, one per time signature', () => {
    expect(result.barPositions).toHaveLength(2);
    const fourFour = result.barPositions.find((p) => p.ts.numerator === 4);
    const threeFour = result.barPositions.find((p) => p.ts.numerator === 3);
    expect(fourFour?.onsets).toBe(8);
    expect(threeFour?.onsets).toBe(3);
  });
});

describe('analyzeRhythm with rests', () => {
  // One beat sounds, one beat rests, twice over: half the bar is silent.
  const notes: NoteEvent[] = [
    { pitch: 60, startBeat: 0, durationBeat: 1 },
    { pitch: 60, startBeat: 2, durationBeat: 1 },
  ];
  const result = analyzeRhythm(notes, { ts: '4/4', totalBeats: 4 });

  it('reads half the bar as rest', () => {
    expect(result.onsets).toBe(2);
    expect(result.bars).toBe(1);
    expect(result.restRatio).toBe(0.5);
  });
});

describe('analyzeRhythm with a pickup', () => {
  // A one-beat pickup followed by a note filling the rest of the bar: the span
  // runs from the pickup's own onset to the end of the bar, with no rest.
  const notes: NoteEvent[] = [
    { pitch: 60, startBeat: -1, durationBeat: 1 },
    { pitch: 62, startBeat: 0, durationBeat: 4 },
  ];
  const result = analyzeRhythm(notes, { ts: '4/4' });

  it('starts the span at the pickup and counts the fractional bar it opens', () => {
    expect(result.startBeat).toBe(-1);
    expect(result.endBeat).toBe(4);
    expect(result.bars).toBeCloseTo(1.25, 9);
    expect(result.onsets).toBe(2);
    expect(result.onsetDensity).toBeCloseTo(1.6, 9);
    expect(result.restRatio).toBe(0);
  });
});

describe('analyzeRhythm and off-grid onsets', () => {
  it('reads a humanized onset within tolerance as on grid', () => {
    // A quarter note struck three hundredths of a beat late is still read at
    // its intended slot.
    const notes = [...quarters(3), { pitch: 60, startBeat: 3.03, durationBeat: 1 }];
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.offGridRatio).toBe(0);
  });

  it('reads an onset more than 1/32 beat from every slot as off grid', () => {
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 1.035 },
      { pitch: 62, startBeat: 1.035, durationBeat: 2.965 },
    ];
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.offGridRatio).toBe(0.5);
  });

  it('reads a thirty-second note as off grid: it sits halfway between two slots', () => {
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 0.375 },
      { pitch: 62, startBeat: 0.375, durationBeat: 3.625 },
    ];
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.onsets).toBe(2);
    expect(result.offGridRatio).toBe(0.5);
  });

  it('folds two simultaneous onsets into one', () => {
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0, durationBeat: 4 },
      { pitch: 64, startBeat: 0, durationBeat: 4 },
    ];
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.onsets).toBe(1);
    expect(result.barOnsets).toEqual([1]);
  });
});

describe('analyzeRhythm and syncopation', () => {
  it('is positive when a weak onset ties across a stronger, unattacked pulse', () => {
    // A note attacked on the sixteenth off-beat (beat 0.75, level 0) sustains
    // past the following pulse (beat 1, level 3) before the next onset.
    const notes: NoteEvent[] = [
      { pitch: 60, startBeat: 0.75, durationBeat: 1 },
      { pitch: 62, startBeat: 1.75, durationBeat: 2.25 },
    ];
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.syncopation).toBeGreaterThan(0);
  });

  it('reaches its normalizer exactly when every syncopatable position is eaten', () => {
    // Eight weak (sixteenth-off, level 0) onsets, each tied across exactly one
    // stronger grid position before the next one attacks: every position the
    // normalizer counts is claimed by exactly one onset, so the ratio is 1.
    const positions = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25];
    const notes: NoteEvent[] = positions.map((beat) => ({
      pitch: 60,
      startBeat: beat,
      durationBeat: 0.1,
    }));
    // The last onset's own sustain has to reach past the bar line (beat 4) for
    // that downbeat to fall inside its window too.
    notes.push({ pitch: 60, startBeat: 3.75, durationBeat: 0.26 });
    const result = analyzeRhythm(notes, { ts: '4/4' });
    expect(result.syncopation).toBeCloseTo(1, 9);
  });
});

describe('analyzeRhythm on an empty span', () => {
  it('reads an all-zero record when nothing sounds', () => {
    const result = analyzeRhythm([]);
    expect(result.startBeat).toBe(0);
    expect(result.endBeat).toBe(0);
    expect(result.bars).toBe(0);
    expect(result.onsets).toBe(0);
    expect(result.onsetDensity).toBe(0);
    expect(result.barOnsets).toEqual([]);
    expect(result.onsetLevels).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.barPositions).toEqual([]);
    expect(result.interOnsetShares).toEqual(new Array(RHYTHM_IOI_BINS.length).fill(0));
    expect(result.restRatio).toBe(0);
    expect(result.syncopation).toBe(0);
    expect(result.offGridRatio).toBe(0);
  });

  it('reads the same record for notes that never sound', () => {
    const result = analyzeRhythm([{ pitch: 60, startBeat: 0, durationBeat: 0 }]);
    expect(result.onsets).toBe(0);
  });
});

describe('analyzeRhythm budget', () => {
  it('refuses a span whose bar count would exceed the budget', () => {
    const notes: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    const call = () => analyzeRhythm(notes, { ts: '4/4', totalBeats: 1_000_000, budget: 10 });
    expect(call).toThrow(BudgetExceededError);
    expect(call).toThrow(/rhythm analysis slots/);
  });
});

describe('analyzeRhythm option rejection', () => {
  it('refuses both ts and meters at once', () => {
    const call = () =>
      analyzeRhythm(quarters(1), {
        ts: '4/4',
        meters: [{ startBeat: 0, ts: { numerator: 3, denominator: 4 } }],
      });
    expect(call).toThrow(InvalidInputError);
  });

  it('refuses a negative budget', () => {
    const call = () => analyzeRhythm(quarters(1), { budget: -1 });
    expect(call).toThrow(InvalidInputError);
  });

  it('refuses a note that never resolves to an array', () => {
    const call = () => analyzeRhythm({} as unknown as NoteEvent[]);
    expect(call).toThrow(InvalidInputError);
  });
});
