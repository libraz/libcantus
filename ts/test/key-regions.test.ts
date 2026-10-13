import { describe, expect, it } from 'vitest';
import type { KeyRegion } from '../src/analyze/keys/index.js';
import {
  attachPivots,
  detectModulations,
  keyTimelineFromNotes,
} from '../src/analyze/keys/index.js';
import { analyzeTimeline, chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { formatNote } from '../src/core/pitch/index.js';
import type { NoteEvent } from '../src/core/types.js';
import type { ChordQuality, ChordSegment } from '../src/theory/chord/index.js';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import type { ResolvedKey } from '../src/theory/scale/index.js';
import { MAJOR_MASK, majorKey, NATURAL_MINOR_MASK, resolveKey } from '../src/theory/scale/index.js';

/** One bar of 4/4: a bass note under an upper voicing, all sounding together. */
function bar(startBeat: number, bass: number, upper: number[]): NoteEvent[] {
  return [bass, ...upper].map((pitch) => ({ pitch, startBeat, durationBeat: 4 }));
}

/**
 * Four bars of C major: I IV V7 I. The B and the F of the G7 are the tritone
 * that names C, and no pitch outside the C major collection sounds.
 */
function cPhrase(at: number): NoteEvent[] {
  return [
    ...bar(at + 0, 36, [60, 64, 67]), // C   C E G
    ...bar(at + 4, 41, [65, 69, 72]), // F   F A C
    ...bar(at + 8, 43, [67, 71, 74, 77]), // G7  G B D F
    ...bar(at + 12, 36, [60, 64, 67]), // C   C E G
  ];
}

/**
 * The same four bars a fifth higher: I IV V7 I in G major. F# is the only tone
 * outside C major, and it is exactly the tone that separates the two keys.
 */
function gPhrase(at: number): NoteEvent[] {
  return [
    ...bar(at + 0, 43, [67, 71, 74]), // G   G B D
    ...bar(at + 4, 48, [72, 76, 79]), // C   C E G
    ...bar(at + 8, 50, [74, 78, 81, 84]), // D7  D F# A C
    ...bar(at + 12, 43, [67, 71, 74]), // G   G B D
  ];
}

/** One bar-long chord segment in 4/4. */
function seg(startBeat: number, rootPc: number, quality: ChordQuality): ChordSegment {
  return { startBeat, endBeat: startBeat + 4, chord: makeChord(rootPc, quality) };
}

/** C: I IV V7 I, then G: I IV V7 I — the same music as the note fixtures. */
const C_TO_G_CHORDS: readonly ChordSegment[] = [
  seg(0, 0, 'maj'), // C
  seg(4, 5, 'maj'), // F
  seg(8, 7, 'dom7'), // G7
  seg(12, 0, 'maj'), // C
  seg(16, 7, 'maj'), // G
  seg(20, 0, 'maj'), // C
  seg(24, 2, 'dom7'), // D7
  seg(28, 7, 'maj'), // G
];

/**
 * Name a key the way it is read aloud, e.g. `'A minor'`.
 *
 * The tonic is the one the key carries, not one derived back from its pitch
 * classes: a region states its own spelling, and reading it any other way here
 * would let a region report an Ab while this test called it a G#.
 */
function keyName(key: ResolvedKey | null): string {
  if (key === null) {
    return 'none';
  }
  const mode =
    key.scale.modeMask12 === NATURAL_MINOR_MASK
      ? 'minor'
      : key.scale.modeMask12 === MAJOR_MASK
        ? 'major'
        : `mask ${key.scale.modeMask12}`;
  return `${formatNote(key.tonic)} ${mode}`;
}

/** Every region's key, in time order. */
function keyNames(regions: readonly KeyRegion[]): string[] {
  return regions.map((region) => keyName(region.key));
}

describe('detectModulations names the pivot from the triad the chord is heard as', () => {
  it('attaches a pivot to exactly the chords sounding the candidate triad', () => {
    // The boundary is fixed and every quality in the vocabulary is tried over
    // the same root, so the rule is read off the whole vocabulary rather than
    // from a handful of examples: the pivot is attached when the chord sounds
    // the candidate's own third and fifth, and never otherwise.
    for (const quality of chordQualities()) {
      const chord = makeChord(0, quality);
      const regions = attachPivots(
        [
          { startBeat: 0, endBeat: 24, key: resolveKey(majorKey(0)), confidence: 1 },
          { startBeat: 24, endBeat: 32, key: resolveKey(majorKey(7)), confidence: 1 },
        ],
        [{ startBeat: 20, endBeat: 24, chord }],
      );
      // C major is I of C and IV of G; the candidate is its triad, so the chord
      // matches exactly when it sounds a major third and a perfect fifth.
      const soundsTheTriad = chord.intervals.includes(4) && chord.intervals.includes(7);
      expect(regions[1]?.pivot !== undefined, quality).toBe(soundsTheTriad);
    }
  });
});

describe('the timeline entry points take the note arrays the library hands out', () => {
  it('accepts a readonly array without a copy or a cast', () => {
    // `ArrangementTrack.notes` and `TrackEdit.notes` are readonly, and none of
    // these entry points modifies what it is given, so a caller must be able to
    // pass one straight on. This is a compile-time claim as much as a runtime
    // one: the assignment below is what would fail.
    const notes: readonly NoteEvent[] = Object.freeze(cPhrase(0));
    expect(keyTimelineFromNotes(notes)).toHaveLength(1);
    expect(chordTimelineFromNotes(notes).timeline.segments.length).toBeGreaterThan(0);
    expect(analyzeTimeline(notes).result.timeline.segments.length).toBeGreaterThan(0);
  });
});

describe('a region owns the key it reports', () => {
  /** Every field of a region except the key object's identity. */
  function readingOf(regions: readonly KeyRegion[]): unknown[] {
    return regions.map((region) => ({
      startBeat: region.startBeat,
      endBeat: region.endBeat,
      key: keyName(region.key),
      confidence: region.confidence,
      modulation: region.modulation,
      pivot:
        region.pivot === undefined
          ? undefined
          : `${region.pivot.romanFrom}=${region.pivot.romanTo}`,
    }));
  }

  it('gives the note path a key per region that no later call shares', () => {
    // The candidate table is built once for the process and the search's
    // distances are precomputed from it, so a region handed the table's own key
    // would let a caller writing to it rewrite what every later search reports.
    const notes = [...cPhrase(0), ...gPhrase(16)];
    const regions = keyTimelineFromNotes(notes);
    expect(regions).toHaveLength(2);
    expect(regions[0]?.key).not.toBe(regions[1]?.key);
    const reading = readingOf(regions);
    for (const region of regions) {
      region.key.scale.rootPc = 11;
      region.key.scale.modeMask12 = NATURAL_MINOR_MASK;
    }
    // Neither the other regions of the same run nor a second call moved.
    expect(readingOf(keyTimelineFromNotes(notes))).toEqual(reading);
  });

  it('gives the chord path the same', () => {
    const regions = detectModulations(C_TO_G_CHORDS);
    expect(regions).toHaveLength(2);
    expect(regions[0]?.key).not.toBe(regions[1]?.key);
    const reading = readingOf(regions);
    for (const region of regions) {
      region.key.scale.rootPc = 11;
      region.key.scale.modeMask12 = NATURAL_MINOR_MASK;
    }
    expect(readingOf(detectModulations(C_TO_G_CHORDS))).toEqual(reading);
  });

  it('keeps the keys a timeline analysis ran against out of the candidate table', () => {
    const notes = [...cPhrase(0), ...gPhrase(16)];
    const first = analyzeTimeline(notes).result;
    const chords = first.timeline.segments.map((segment) => segment.chord.rootPc);
    for (const region of first.keys) {
      region.key.scale.rootPc = 11;
      region.key.scale.modeMask12 = NATURAL_MINOR_MASK;
    }
    const second = analyzeTimeline(notes).result;
    expect(keyNames(second.keys)).toEqual(['C major', 'G major']);
    expect(second.timeline.segments.map((segment) => segment.chord.rootPc)).toEqual(chords);
  });
});
