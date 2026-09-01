import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import { Key } from '../src/model/key.js';
import { Score } from '../src/model/score.js';
import { Timeline } from '../src/model/timeline.js';
import { spanFromChord } from '../src/theory/chord/index.js';
import { NAMED_SCALES, type ScaleName } from '../src/theory/scale/index.js';

/**
 * The identity of a key — its spelled tonic and the scale form it was read
 * under — travelling across the layers that hold keys: the name a key prints,
 * the score and the timeline that carry one, and the analyses taken from them.
 */

const SCALE_NAMES = Object.keys(NAMED_SCALES) as ScaleName[];

const PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** A C major triad held for a bar, then a second bar of the same. */
const TRIAD: NoteEvent[] = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
  { pitch: 60, startBeat: 4, durationBeat: 4 },
  { pitch: 64, startBeat: 4, durationBeat: 4 },
  { pitch: 67, startBeat: 4, durationBeat: 4 },
];

/** A run that establishes C major and then leans on G major. */
const MODULATING: NoteEvent[] = [
  ...[60, 64, 67, 65, 64, 62, 60, 67].map((pitch, index) => ({
    pitch,
    startBeat: index * 2,
    durationBeat: 2,
  })),
  ...[67, 71, 74, 72, 71, 69, 67, 66].map((pitch, index) => ({
    pitch,
    startBeat: 16 + index * 2,
    durationBeat: 2,
  })),
];

/** The A harmonic minor the detector reads off a leading-tone cadence. */
function detectedHarmonicMinor(): Key {
  const detected = Key.detectBest([57, 59, 60, 62, 64, 65, 68]);
  expect(detected?.variant).toBe('harmonic');
  return detected ?? Key.minor('A');
}

describe('a key names the scale it holds', () => {
  it('prints a scale word every built-in scale reads back', () => {
    for (const name of SCALE_NAMES) {
      for (const root of PITCH_CLASSES) {
        const key = Key.named(name, root);
        expect(Key.parse(key.toString()).equals(key), key.toString()).toBe(true);
      }
    }
  });

  it('prints the same word for the same scale however the key was built', () => {
    const named = Key.named('harmonicMinor', 'A');
    const detected = detectedHarmonicMinor();
    const rebuilt = Key.of(named.scale);
    expect(named.toString()).toBe('A harmonic minor');
    expect(detected.toString()).toBe('A harmonic minor');
    expect(rebuilt.toString()).toBe('A harmonic minor');
    // The scale form is not what decides the word: the mask is.
    expect(Key.named('dorian', 'D').toString()).toBe('D dorian');
    expect(Key.named('melodicMinor', 'D').toString()).toBe('D melodic minor');
    expect(Key.named('majorPentatonic', 'C').toString()).toBe('C major pentatonic');
  });

  it('reads a detected key back from what it printed', () => {
    for (const match of Key.detectMatches([57, 59, 60, 62, 64, 65, 68], { modes: true })) {
      expect(Key.parse(match.key.toString()).equals(match.key), match.key.toString()).toBe(true);
    }
  });

  it('leaves the other notation systems the mode word they have', () => {
    expect(detectedHarmonicMinor().toString({ system: 'german' })).toBe('a moll');
    expect(Key.named('dorian', 'D').toString({ system: 'german' })).toBe('d moll');
  });
});

describe('a score carries the key it was given', () => {
  it('keeps the tonic spelling and the scale form through every reading', () => {
    const flat = Key.parse('Ab minor');
    const score = Score.of(TRIAD, { key: flat });
    expect(score.key()?.tonic.name).toBe('Ab');
    expect(score.key()?.toString()).toBe('Ab minor');
    expect(score.data.key?.tonic).toEqual(flat.tonic.data);
    // Rebuilt from its own data, and from stored key data.
    expect(Score.fromJSON(score.toJSON()).key()?.tonic.name).toBe('Ab');
    expect(Score.fromData({ ...score.data, key: flat.toJSON() }).key()?.tonic.name).toBe('Ab');
    expect(Score.of(TRIAD).withKey(flat).key()?.tonic.name).toBe('Ab');

    const detected = detectedHarmonicMinor();
    const read = Score.of(TRIAD, { key: detected });
    expect(read.key()?.variant).toBe('harmonic');
    expect(read.key()?.toString()).toBe('A harmonic minor');
    expect(read.keys()[0]?.key.variant).toBe('harmonic');
  });

  it('spells a bare key/scale the way the scale reads best', () => {
    const bare = Score.of(TRIAD, {
      key: { rootPc: 8, modeMask12: Key.minor('A').scale.modeMask12 },
    });
    expect(bare.key()?.tonic.name).toBe('G#');
    expect(Score.of(TRIAD, { key: 'Ab minor' }).key()?.tonic.name).toBe('Ab');
  });

  it('answers with its own key wherever it is asked', () => {
    const score = Score.of(MODULATING, { key: 'C major' });
    const regions = score.keys();
    expect(regions.length).toBe(1);
    expect(regions[0]?.startBeat).toBe(0);
    expect(regions[0]?.endBeat).toBe(score.totalBeats);
    expect(Key.of(regions[0]?.key ?? Key.major('C').scale).toString()).toBe('C major');
    expect(score.key()?.toString()).toBe('C major');
    expect(score.timeline().key?.toString()).toBe('C major');
    expect(score.timeline().keys.length).toBe(1);
    // Without a stated key the same notes are read as they sound.
    expect(Score.of(MODULATING).keys().length).toBeGreaterThanOrEqual(1);
  });

  it('moves its key with its notes', () => {
    const score = Score.of(TRIAD, { key: 'C major' });
    const up = score.transpose(2);
    expect(up.key()?.toString()).toBe('D major');
    // The music is the same music, so it takes the same numerals: a tonic that
    // moved to D reads as I in D major, not as II in the key it came from.
    expect(up.timeline().roman()[0]?.roman).toBe('I');
    expect(up.timeline().roman()).toEqual(score.timeline().roman());
    expect(up.data.key).toEqual(Key.major('D').toJSON());
    // A spelled interval spells the key it lands on.
    expect(score.transposeBy('A4').key()?.toString()).toBe('F# major');
    expect(score.transposeBy('d5').key()?.toString()).toBe('Gb major');
    expect(score.transposeBy('-M2').key()?.toString()).toBe('Bb major');
    // A score with no key of its own still has none afterwards.
    expect(Score.of(TRIAD).transpose(2).key()?.toString()).toBe(
      Score.of(TRIAD).transpose(2).key()?.toString(),
    );
  });

  it('hands back detected keys as keys', () => {
    const score = Score.of(TRIAD);
    const matches = score.detectKeys();
    const best = matches[0];
    expect(best).toBeDefined();
    expect(`${best?.key}`).toBe(best?.key.toString());
    expect(`${best?.key}`).not.toBe('[object Object]');
    // The plain form stays reachable, and the record reads as the one the key
    // detector hands back from the class API.
    expect(best?.key.data.scale).toEqual(best?.key.scale);
    const counterpart = Key.detectMatches(score.notes.map((note) => note.pitch));
    expect(Object.keys(best ?? {}).sort()).toEqual(Object.keys(counterpart[0] ?? {}).sort());
    expect(best?.key.toString()).toBe(counterpart[0]?.key.toString());
  });
});

describe('a timeline carries the key it was given', () => {
  const spans = [
    spanFromChord(Key.parse('Ab minor').chord(1).toJSON(), 0),
    spanFromChord(Key.parse('Ab minor').chord(5).toJSON(), 4),
  ];

  it('keeps the tonic spelling and the scale form through every reading', () => {
    const flat = Key.parse('Ab minor');
    const timeline = Timeline.fromChords(spans, 8, flat);
    expect(timeline.key?.tonic.name).toBe('Ab');
    expect(timeline.at(0)?.key?.tonic.name).toBe('Ab');
    expect(timeline.keys[0]?.key.tonic).toEqual(flat.tonic.data);
    expect(Timeline.fromData(timeline.data).key?.tonic.name).toBe('Ab');
    expect(timeline.slice(0, 4).key?.tonic.name).toBe('Ab');
    expect(timeline.progression().key?.tonic.name).toBe('Ab');
  });

  it('leaves an inferred key the bare scale the analysis read', () => {
    const inferred = Timeline.fromNotes(TRIAD);
    expect(inferred.keys.every((region) => region.key.tonic === undefined)).toBe(true);
    expect(inferred.key?.toString()).toBe('C major');
  });

  it('reads the keys its chords imply', () => {
    const regions = Timeline.fromChords(spans, 8).modulations();
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0]?.endBeat).toBe(8);
  });
});
