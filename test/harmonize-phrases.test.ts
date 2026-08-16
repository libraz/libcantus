import { describe, expect, it } from 'vitest';
import { phrasesFromTimeline } from '../src/analyze/form/index.js';
import { detectCadence } from '../src/analyze/functional/index.js';
import { chordTimelineFromChords } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Quarter notes from `at`, one per pitch. */
function quarters(pitches: number[], at: number): NoteEvent[] {
  return pitches.map((pitch, index) => ({
    pitch,
    startBeat: at + index,
    durationBeat: 1,
  }));
}

/**
 * Two four-bar phrases, each closing on the tonic: the shape a period has, and
 * the one a single cadence at the end under-reads. The first phrase reaches its
 * tonic over a rising line, so nothing but the phrasing asks for an arrival
 * there.
 */
const melody: NoteEvent[] = [
  ...quarters([60, 62, 64, 65], 0),
  ...quarters([67, 69, 67, 65], 4),
  ...quarters([64, 65, 67, 69], 8),
  ...quarters([65, 69, 72, 72], 12),
  ...quarters([72, 71, 69, 67], 16),
  ...quarters([65, 64, 62, 60], 20),
  ...quarters([62, 64, 65, 67], 24),
  ...quarters([71, 74, 72, 72], 28),
];

/** The chords sounding either side of `beat`, in the harmonized result. */
function around(chords: { rootPc: number; quality: string; startBeat: number }[], beat: number) {
  const arrival = chords.filter((chord) => chord.startBeat < beat).at(-1);
  const approach = chords.filter((chord) => chord.startBeat < (arrival?.startBeat ?? 0)).at(-1);
  return { approach, arrival };
}

describe('harmonizing a line with more than one phrase in it', () => {
  it('cadences at each phrase end the caller names', () => {
    const result = harmonizeMelody({
      melody,
      key: cMajor,
      ts: { numerator: 4, denominator: 4 },
      phraseEnds: [16],
    });
    const { approach, arrival } = around(result.chords, 16);
    expect(approach).toBeDefined();
    // The phrase closes on the tonic, and the chord before it is one that
    // cadences onto the tonic rather than a chord the line merely passed
    // through.
    expect(arrival?.rootPc).toBe(0);
    const cadence = detectCadence(
      makeChord(approach?.rootPc ?? 0, 'maj'),
      makeChord(arrival?.rootPc ?? 0, 'maj'),
      cMajor,
    );
    expect(cadence.type).not.toBeNull();
    // The line still closes where it ends, whatever it did in the middle.
    expect(around(result.chords, 32).arrival?.rootPc).toBe(0);
  });

  it('is the phrasing that puts the arrival there', () => {
    // The same melody without the phrase ends holds one harmony across the
    // close: nothing in the notes alone asks for an arrival mid-line.
    const opts = { melody, key: cMajor, ts: { numerator: 4, denominator: 4 } };
    const plain = around(harmonizeMelody(opts).chords, 16);
    const phrased = around(harmonizeMelody({ ...opts, phraseEnds: [16] }).chords, 16);
    expect(phrased.arrival?.startBeat).not.toBe(plain.arrival?.startBeat);
  });

  it('takes the phrase ends the analysis reports, as the documentation says', () => {
    // The documented workflow: label the line, let the form layer find its
    // phrases, and hand their ends straight to the harmonizer.
    const timeline = chordTimelineFromChords(
      [
        { rootPc: 0, quality: 'maj', startBeat: 0 },
        { rootPc: 7, quality: 'maj', startBeat: 8 },
        { rootPc: 0, quality: 'maj', startBeat: 12 },
        { rootPc: 5, quality: 'maj', startBeat: 16 },
        { rootPc: 7, quality: 'maj', startBeat: 24 },
        { rootPc: 0, quality: 'maj', startBeat: 28 },
      ],
      32,
    );
    const phrases = phrasesFromTimeline(timeline, melody, { key: cMajor });
    const phraseEnds = phrases.map((phrase) => phrase.endBeat);
    expect(phraseEnds.length).toBeGreaterThan(1);
    const result = harmonizeMelody({ melody, key: cMajor, phraseEnds });
    // Every named end is covered by a chord, and the last one closes the line.
    for (const end of phraseEnds) {
      expect(around(result.chords, end).arrival).toBeDefined();
    }
    expect(around(result.chords, phraseEnds.at(-1) ?? 32).arrival?.rootPc).toBe(0);
  });

  it('leaves a call that names no phrase ends exactly as it was', () => {
    const opts = { melody, key: cMajor, ts: { numerator: 4, denominator: 4 } };
    expect(harmonizeMelody({ ...opts, phraseEnds: [] })).toEqual(harmonizeMelody(opts));
  });

  it('rejects a phrase end that is not a number', () => {
    expect(() => harmonizeMelody({ melody, key: cMajor, phraseEnds: [Number.NaN] })).toThrowError();
  });
});
