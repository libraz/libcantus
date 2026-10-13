import { describe, expect, it } from 'vitest';
import { chordToRoman } from '../src/analyze/functional/index.js';
import { prevailingKeyOf } from '../src/analyze/keys/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Chord } from '../src/model/chord.js';
import { Key, keyIdentity } from '../src/model/key.js';
import { Progression } from '../src/model/progression.js';
import { Timeline } from '../src/model/timeline.js';
import type { ChordSpan } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, resolveKey } from '../src/theory/scale/index.js';

/**
 * The timed harmony class: the contracts every model class holds, the three
 * ways a timeline is built, and — the point of the class — that every
 * analytical member answers exactly what calling the underlying function on the
 * same input answers.
 */

/** `I - IV - V7 - I`, one chord per bar, as the generators hand chords over. */
const SPANS: readonly ChordSpan[] = [
  { rootPc: 0, quality: 'maj', startBeat: 0 },
  { rootPc: 5, quality: 'maj', startBeat: 4 },
  { rootPc: 7, quality: 'dom7', startBeat: 8 },
  { rootPc: 0, quality: 'maj', startBeat: 12 },
];

const TOTAL_BEATS = 16;

/** The timeline under test: the same chords, in C major. */
const placed = () => Timeline.fromChords(SPANS, TOTAL_BEATS, 'C major');

/** One block chord as note events. */
function block(pitches: readonly number[], startBeat: number): NoteEvent[] {
  return pitches.map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
}

/** The same progression played as block chords, for the note path. */
const NOTES: readonly NoteEvent[] = [
  ...block([60, 64, 67], 0),
  ...block([65, 69, 72], 4),
  ...block([67, 71, 74, 77], 8),
  ...block([60, 64, 67], 12),
];

describe('construction', () => {
  it('infers from notes exactly what the inference function returns', () => {
    const analysis = chordTimelineFromNotes(NOTES);
    const timeline = Timeline.fromNotes(NOTES);
    expect(timeline.segments).toEqual(analysis.timeline.segments);
    expect(timeline.keys).toEqual(analysis.keys);
    expect(keyIdentity(timeline.key as Key)).toEqual(analysis.prevailingKey);
    expect(timeline.totalBeats).toBe(
      Math.max(
        ...analysis.timeline.segments.map((segment) => segment.endBeat),
        ...analysis.keys.map((region) => region.endBeat),
      ),
    );
  });

  it('carries the key of the progression as it is written', () => {
    // The one region the factory makes holds the key the progression stated,
    // spelled tonic and scale form and all: it is what the numerals over that
    // region are then read from, and an Ab minor read back as its pitch classes
    // would be numbered as the G# minor those read best as.
    const key = Key.parse('Ab minor');
    const progression = new Progression([Chord.parse('Abm'), Chord.parse('Ebm')], key);
    const timeline = Timeline.fromProgression(progression, 4);
    expect(timeline.keys).toHaveLength(1);
    expect(timeline.keys[0]?.key).toEqual(keyIdentity(key));
    expect(timeline.keys[0]?.key.tonic).toEqual(key.tonic.data);
  });
});

describe('plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const timeline = placed();
    expect(timeline.data).not.toBe(timeline.data);
    expect(timeline.data).toEqual(timeline.data);
    expect(timeline.segments).not.toBe(timeline.segments);
    expect(timeline.keys).not.toBe(timeline.keys);
  });
});

describe('analysis equivalence', () => {
  it('reads every chord in the key in force where the piece modulates', () => {
    const modulating = new Timeline({
      segments: [
        { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
        { startBeat: 4, endBeat: 8, chord: makeChord(2, 'dom7') },
        { startBeat: 8, endBeat: 12, chord: makeChord(7, 'maj') },
      ],
      totalBeats: 12,
      keys: [
        { startBeat: 0, endBeat: 6, key: resolveKey(majorKey(0)), confidence: 1 },
        {
          startBeat: 6,
          endBeat: 12,
          key: resolveKey(majorKey(7)),
          confidence: 1,
          modulation: 'dominant',
        },
      ],
    });
    expect(modulating.roman().map((entry) => entry.roman)).toEqual([
      chordToRoman(makeChord(0, 'maj'), majorKey(0)),
      chordToRoman(makeChord(2, 'dom7'), majorKey(0)),
      chordToRoman(makeChord(7, 'maj'), majorKey(7)),
    ]);
    expect(keyIdentity(modulating.key as Key)).toEqual(prevailingKeyOf(modulating.keys));
  });

  it('reports the prevailing key the key module reports', () => {
    const timeline = Timeline.fromNotes(NOTES);
    expect(keyIdentity(timeline.key as Key)).toEqual(prevailingKeyOf(timeline.keys));
  });
});
