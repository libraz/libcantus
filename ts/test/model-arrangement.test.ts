import { describe, expect, it } from 'vitest';
import type {
  ArrangementAnalysis,
  ArrangementOptions,
  ArrangementTrack,
} from '../src/analyze/arrange/index.js';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { type MeterMap, parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { Arrangement } from '../src/model/arrangement.js';
import { Key } from '../src/model/key.js';
import { NoteSafety } from '../src/theory/safety/index.js';

/**
 * `Arrangement` is a skin over the arrangement-analysis functions and the
 * session that holds one open across edits, so most of what is checked here is
 * equivalence: the class answer must be the answer the underlying function
 * gives for the same tracks and the same settings, and an updated arrangement
 * must answer exactly as one built from the edited tracks outright. The rest is
 * the contract every model class holds — plain data out, plain data back in,
 * nothing shared with the caller, and no method that mutates.
 */

/** A melody over two bars, with a chromatic note that clashes with the harmony. */
const MELODY: NoteEvent[] = [
  { pitch: 72, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 74, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 73, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 76, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 79, startBeat: 6, durationBeat: 2, velocity: 92 },
];

/** A bass line spelling out the harmony under the melody. */
const BASS: NoteEvent[] = [
  { pitch: 48, startBeat: 0, durationBeat: 4 },
  { pitch: 43, startBeat: 4, durationBeat: 4 },
];

/** A drum part, whose pitches name instruments rather than harmony. */
const DRUMS: NoteEvent[] = [
  { pitch: 36, startBeat: 0, durationBeat: 0.5 },
  { pitch: 38, startBeat: 2, durationBeat: 0.5 },
  { pitch: 36, startBeat: 4, durationBeat: 0.5 },
  { pitch: 38, startBeat: 6, durationBeat: 0.5 },
];

/** The melody after an edit that moves the clashing note onto a chord tone. */
const EDITED_MELODY: NoteEvent[] = [
  { pitch: 72, startBeat: 0, durationBeat: 1, velocity: 90 },
  { pitch: 74, startBeat: 1, durationBeat: 1, velocity: 80 },
  { pitch: 76, startBeat: 2, durationBeat: 2, velocity: 85 },
  { pitch: 76, startBeat: 4, durationBeat: 2, velocity: 88 },
  { pitch: 79, startBeat: 6, durationBeat: 2, velocity: 92 },
];

/** The tracks every check reads, the last of them deliberately unnamed. */
const TRACKS: readonly ArrangementTrack[] = [
  { name: 'melody', role: 'melody', notes: MELODY },
  { name: 'bass', role: 'bass', notes: BASS },
  { role: 'drums', notes: DRUMS },
];

/** A meter map that changes signature partway, so the meter is carried, not assumed. */
const METERS: MeterMap = [
  { startBeat: 0, ts: parseTimeSignature('4/4') },
  { startBeat: 4, ts: parseTimeSignature('3/4') },
];

/**
 * Settings filling every option the class stores, so the round trip and the
 * poison checks reach each of them. Written as the plain options the analysis
 * takes, so the same value drives the class and the function it is compared
 * against.
 */
const OPTIONS: ArrangementOptions = {
  key: Key.major('C').scale,
  meters: METERS,
  harmonyTracks: [0, 1],
  minSeverity: NoteSafety.Warning,
  harmonicRhythm: 2,
  profile: 'pop',
  budget: 500_000,
};

/** The tracks as a fresh mutable array, which the analysis functions take. */
function tracks(edited?: readonly NoteEvent[]): ArrangementTrack[] {
  return TRACKS.map((track, index) =>
    edited !== undefined && index === 0 ? { ...track, notes: edited } : { ...track },
  );
}

/**
 * The analysis as plain data.
 *
 * The chord timeline carries a lookup function, which is not data and not
 * comparable; its segments are, and they are what the lookup reads.
 */
function plain(analysis: ArrangementAnalysis) {
  const { timeline, ...rest } = analysis;
  return { ...rest, segments: timeline.segments };
}

describe('Arrangement plain data', () => {
  it('hands out a fresh copy on every read', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.data).not.toBe(arrangement.data);
    expect(arrangement.data).toEqual(arrangement.data);
    expect(arrangement.data.tracks[0]).not.toBe(arrangement.data.tracks[0]);
    expect(arrangement.tracks).not.toBe(arrangement.tracks);
  });
});

describe('Arrangement answers as the functions do', () => {
  it('reports the conflicts the analysis found', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    expect(arrangement.conflicts).toEqual(analyzeArrangement(tracks(), OPTIONS).conflicts);
    expect(arrangement.conflicts.length).toBeGreaterThan(0);
    expect(arrangement.conflicts).not.toBe(arrangement.conflicts);
  });
});

describe('Arrangement updates', () => {
  it('leaves the arrangement it was asked of unchanged', () => {
    const arrangement = Arrangement.of(TRACKS, OPTIONS);
    const before = arrangement.data;
    const analysisBefore = plain(arrangement.analysis);
    const updated = arrangement.update([{ trackIndex: 0, notes: EDITED_MELODY }]);
    expect(arrangement.data).toEqual(before);
    expect(plain(arrangement.analysis)).toEqual(analysisBefore);
    expect(plain(arrangement.analysis)).toEqual(plain(analyzeArrangement(tracks(), OPTIONS)));
    expect(updated).not.toBe(arrangement);
    expect(updated.tracks[0]?.notes).toEqual(EDITED_MELODY);
    expect(arrangement.tracks[0]?.notes).toEqual(MELODY);
  });
});
