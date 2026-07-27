import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { tensionCurve } from '../src/analyze/arrange/tension.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { beatsPerBar, type TimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { generateBassLine } from '../src/generate/bass/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const COMMON: TimeSignature = { numerator: 4, denominator: 4 };
const COMPOUND: TimeSignature = { numerator: 6, denominator: 8 };
/** An aksak 7/8, grouped 2+2+3 in quaver units. */
const ADDITIVE: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };

/** Two bars of steady eighth notes over a C major triad. */
function triadNotes(beats: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let beat = 0; beat < beats; beat += 0.5) {
    notes.push({
      pitch: [60, 64, 67][Math.round(beat * 2) % 3] ?? 60,
      startBeat: beat,
      durationBeat: 0.5,
    });
  }
  return notes;
}

describe('the meter reaches the analysis entry points', () => {
  it('sizes the default chord window by the bar of the given meter', () => {
    // The default harmonic rhythm is one bar, and a 6/8 bar is three quarter
    // notes rather than four, so the segment boundaries have to move. The
    // harmony here changes every three beats, which only a 6/8 window follows.
    const notes: NoteEvent[] = [];
    for (let bar = 0; bar < 4; bar += 1) {
      const pitches = bar % 2 === 0 ? [60, 64, 67] : [67, 71, 74];
      for (const pitch of pitches) {
        notes.push({ pitch, startBeat: bar * 3, durationBeat: 3 });
      }
    }
    const compound = chordTimelineFromNotes(notes, { ts: COMPOUND });
    expect(compound.timeline.segments.map((segment) => segment.startBeat)).toEqual([0, 3, 6, 9]);
    expect(compound.timeline.segments.map((segment) => segment.chord.rootPc)).toEqual([0, 7, 0, 7]);
    // The same notes read in 4/4 land on four-beat windows instead.
    const common = chordTimelineFromNotes(notes, { ts: COMMON });
    expect(common.timeline.segments[0]?.endBeat).toBe(beatsPerBar(COMMON));
    expect(common.timeline.segments.map((segment) => segment.startBeat)).not.toEqual([0, 3, 6, 9]);
  });

  it('accepts an additive metre through the arrangement analysis', () => {
    const notes = triadNotes(14);
    for (const ts of [COMPOUND, ADDITIVE]) {
      const analysis = analyzeArrangement([{ role: 'harmony', notes }], { ts });
      expect(analysis.tracks[0]?.notes.length).toBe(notes.length);
      expect(() => tensionCurve([{ role: 'harmony', notes }], { ts, step: 1 })).not.toThrow();
    }
  });

  it('places bass onsets on the felt beats of the given meter', () => {
    const segments = [
      { startBeat: 0, endBeat: 3, chord: makeChord(0, 'maj') },
      { startBeat: 3, endBeat: 6, chord: makeChord(7, 'maj') },
    ];
    const line = generateBassLine({
      segments,
      key: majorKey(0),
      style: 'root',
      ts: COMPOUND,
      seed: 1,
    });
    expect(line.length).toBeGreaterThan(0);
    for (const note of line) {
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(6);
    }
    // A dotted-quarter pulse means onsets land on multiples of 1.5, not 1.
    expect(line.every((note) => Math.abs((note.startBeat / 1.5) % 1) < 1e-9)).toBe(true);
  });

  it('writes a counter line against a compound-meter melody', () => {
    const melody: NoteEvent[] = [
      { pitch: 72, startBeat: 0, durationBeat: 1.5 },
      { pitch: 71, startBeat: 1.5, durationBeat: 1.5 },
      { pitch: 67, startBeat: 3, durationBeat: 3 },
    ];
    for (const ts of [COMPOUND, ADDITIVE]) {
      const line = generateCounterMelody({
        melody,
        chordAt: () => makeChord(0, 'maj'),
        key: majorKey(0),
        ts,
      });
      for (const note of line) {
        expect(note.durationBeat).toBeGreaterThan(0);
        expect(note.pitch).toBeLessThan(72);
      }
    }
  });
});
