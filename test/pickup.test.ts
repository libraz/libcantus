import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeArrangement } from '../src/analyze/arrange/index.js';
import { keyTimelineFromNotes } from '../src/analyze/keys/index.js';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import {
  barIndexAt,
  barStartBeat,
  beatToBarPosition,
  formatBarPosition,
  isStrongBeat,
  metricWeight,
  parseTimeSignature,
} from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { assertNoteEvent, assertNoteEvents } from '../src/core/validation/index.js';
import { humanize } from '../src/generate/groove/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const COMMON = parseTimeSignature('4/4');

/**
 * A melody with a one-beat upbeat: the pickup sounds at beat -1, so the first
 * downbeat is beat 0 exactly as the score has it.
 */
const WITH_PICKUP: NoteEvent[] = [
  { pitch: 67, startBeat: -1, durationBeat: 1 },
  { pitch: 72, startBeat: 0, durationBeat: 1 },
  { pitch: 71, startBeat: 1, durationBeat: 1 },
  { pitch: 69, startBeat: 2, durationBeat: 1 },
  { pitch: 67, startBeat: 3, durationBeat: 1 },
  { pitch: 65, startBeat: 4, durationBeat: 2 },
  { pitch: 64, startBeat: 6, durationBeat: 2 },
];

/** The same melody under the old workaround: everything shifted a beat later. */
const SHIFTED: NoteEvent[] = WITH_PICKUP.map((note) => ({
  ...note,
  startBeat: note.startBeat + 1,
}));

/** The `startBeat` doc comment as an IDE hover shows it. */
function startBeatDoc(): string {
  const source = readFileSync(
    fileURLToPath(new URL('../src/core/types.ts', import.meta.url)),
    'utf8',
  );
  return source.match(/\/\*\*([\s\S]*?)\*\/\s*startBeat: number;/)?.[1] ?? '';
}

describe('one sign convention for startBeat', () => {
  it('states the negative-beat convention where a reader hovers the field', () => {
    // The type doc is what an editor shows, so a reader who follows it writes
    // the pickup the analyzers read. Telling them to shift the piece instead
    // moves every strong beat with it.
    const doc = startBeatDoc();
    expect(doc).toMatch(/pickup/);
    expect(doc).toMatch(/unbounded below/);
    expect(doc).toMatch(/negative onset/);
    expect(doc).not.toMatch(/never negative|non-negative/);
  });

  it('is enforced the same way by every entry that reads an onset', () => {
    const upbeat: NoteEvent = { pitch: 67, startBeat: -1, durationBeat: 1 };
    // The validator accepts it by default and narrows on request, which is what
    // the type doc points the reader at.
    expect(assertNoteEvent(upbeat)).toBe(upbeat);
    expect(() => assertNoteEvent(upbeat, 'note', { minStartBeat: -1 })).not.toThrow();
    expect(() => assertNoteEvent(upbeat, 'note', { minStartBeat: 0 })).toThrow(RangeError);
    expect(assertNoteEvents(WITH_PICKUP)).toEqual(WITH_PICKUP);
    // The meter, the analyzers and the generators all read that same onset as
    // an upbeat rather than as a downbeat.
    expect(metricWeight(upbeat.startBeat, COMMON)).toBe(1);
    expect(beatToBarPosition(upbeat.startBeat, COMMON).bar).toBe(-1);
    expect(chordTimelineFromNotes(WITH_PICKUP).timeline.segments[0]?.startBeat).toBe(-1);
    expect(humanize(WITH_PICKUP, { seed: 3, timing: 0.02 })[0]?.startBeat).toBeLessThan(0);
  });
});

describe('a pickup is written before the downbeat', () => {
  it('gives the note after the upbeat the weight of a downbeat', () => {
    const downbeat = WITH_PICKUP[1];
    const upbeat = WITH_PICKUP[0];
    expect(metricWeight(downbeat?.startBeat ?? 0, COMMON)).toBe(3);
    expect(isStrongBeat(downbeat?.startBeat ?? 0, COMMON)).toBe(true);
    // The upbeat is the last beat of the bar before it, so it weighs as one.
    expect(metricWeight(upbeat?.startBeat ?? 0, COMMON)).toBe(1);
    expect(isStrongBeat(upbeat?.startBeat ?? 0, COMMON)).toBe(false);
  });

  it('misplaces every strong beat when the piece is shifted by hand instead', () => {
    // Shifting turns the upbeat into the downbeat and the downbeat into a weak
    // beat — the whole strong/weak pattern of the score moves with it.
    expect(metricWeight(SHIFTED[0]?.startBeat ?? 0, COMMON)).toBe(3);
    expect(metricWeight(SHIFTED[1]?.startBeat ?? 0, COMMON)).toBe(1);
    const asWritten = WITH_PICKUP.map((note) => metricWeight(note.startBeat, COMMON));
    const shifted = SHIFTED.map((note) => metricWeight(note.startBeat, COMMON));
    expect(shifted).not.toEqual(asWritten);
    expect(asWritten).toEqual([1, 3, 1, 2, 1, 3, 2]);
    expect(shifted).toEqual([3, 1, 2, 1, 3, 1, 1]);
  });

  it('numbers the pickup as the bar before the first', () => {
    expect(barIndexAt(-1, COMMON)).toBe(-1);
    expect(barStartBeat(-1, COMMON)).toBe(-4);
    expect(beatToBarPosition(-1, COMMON)).toEqual({ bar: -1, beat: 3 });
    // A score numbers the pickup bar 0 and the first full bar 1.
    expect(formatBarPosition(-1, COMMON)).toBe('0.4');
    expect(formatBarPosition(0, COMMON)).toBe('1.1');
  });

  it('holds however long the pickup is', () => {
    // Three quarters of upbeat still leave the downbeat at beat 0.
    expect(metricWeight(-3, COMMON)).toBe(1);
    expect(metricWeight(-2, COMMON)).toBe(2);
    expect(metricWeight(0, COMMON)).toBe(3);
  });
});

describe('the analysis entry points read a pickup', () => {
  /** A G triad upbeat into two bars of C and G. */
  function pickupPiece(): NoteEvent[] {
    const chord = (root: number, startBeat: number, durationBeat: number): NoteEvent[] =>
      [root, root + 4, root + 7].map((pitch) => ({ pitch, startBeat, durationBeat }));
    return [...chord(67, -1, 1), ...chord(60, 0, 4), ...chord(67, 4, 4), ...chord(60, 8, 4)];
  }

  it('analyses the upbeat instead of dropping or absorbing it', () => {
    const { timeline } = chordTimelineFromNotes(pickupPiece(), { pickupBeats: 1 });
    expect(timeline.segments.map((segment) => segment.startBeat)).toEqual([-1, 0, 4, 8]);
    expect(timeline.at(-1)?.rootPc).toBe(7);
    expect(timeline.at(0)?.rootPc).toBe(0);
  });

  it('finds the bar lines the score has, not the ones the shift would', () => {
    const asWritten = chordTimelineFromNotes(pickupPiece(), { pickupBeats: 1 });
    const shifted = chordTimelineFromNotes(
      pickupPiece().map((note) => ({ ...note, startBeat: note.startBeat + 1 })),
    );
    // Every boundary of the shifted reading sits a beat off its own bar line.
    expect(asWritten.timeline.segments.every((s) => metricWeight(s.startBeat, COMMON) === 3)).toBe(
      false,
    );
    expect(
      asWritten.timeline.segments
        .filter((s) => s.startBeat >= 0)
        .every((s) => isStrongBeat(s.startBeat, COMMON)),
    ).toBe(true);
    expect(shifted.timeline.segments.some((s) => !isStrongBeat(s.startBeat, COMMON))).toBe(true);
  });

  it('starts the key regions where the piece does, key given or inferred', () => {
    const notes = pickupPiece();
    const inferred = chordTimelineFromNotes(notes, { pickupBeats: 1 });
    const given = chordTimelineFromNotes(notes, { pickupBeats: 1, key: majorKey(0) });
    // A given key answers the question for the whole span, upbeat included, so
    // its one region cannot begin after the first segment does. The searched
    // path reads longer slots than the chord grid, but the piece has one first
    // beat, so both paths name it — otherwise the same input reports its key as
    // starting at two different beats depending on how the key was arrived at.
    expect(given.keys).toHaveLength(1);
    expect(given.keys[0]?.startBeat).toBe(given.timeline.segments[0]?.startBeat);
    expect(given.keys[0]?.startBeat).toBe(-1);
    expect(inferred.keys[0]?.startBeat).toBe(inferred.timeline.segments[0]?.startBeat);
    expect(inferred.keys[0]?.startBeat).toBe(given.keys[0]?.startBeat);
  });

  it('reports no chord and no key before the first note sounds', () => {
    // Half a beat of upbeat: shorter than a chord slot and far shorter than a
    // key slot, so both grids reach back past it. Nothing sounds in the stretch
    // they reach into, and a stretch with no notes is not a segment.
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -0.5, durationBeat: 0.5 },
      ...[60, 64, 67].map((pitch) => ({ pitch, startBeat: 0, durationBeat: 4 })),
      ...[67, 71, 74].map((pitch) => ({ pitch, startBeat: 4, durationBeat: 4 })),
    ];
    const { timeline, keys } = chordTimelineFromNotes(notes);
    expect(timeline.segments[0]?.startBeat).toBe(-0.5);
    expect(timeline.at(-0.5)).not.toBeNull();
    expect(timeline.at(-0.75)).toBeNull();
    expect(timeline.at(-1)).toBeNull();
    expect(keys[0]?.startBeat).toBe(-0.5);
    // The key path on its own reads the same first beat as the chord path.
    expect(keyTimelineFromNotes(notes)[0]?.startBeat).toBe(-0.5);
  });

  it('reads a note a hair before the downbeat as the downbeat, not as an upbeat', () => {
    // An export or a performance puts the first note a millibeat early. Reading
    // that as a pickup hands the analysis a whole slot of silence in front of
    // the music — a bar that sounds nowhere in the input.
    const jittered: NoteEvent[] = [
      ...[60, 64, 67].map((pitch) => ({ pitch, startBeat: -0.007, durationBeat: 4 })),
      ...[67, 71, 74].map((pitch) => ({ pitch, startBeat: 4, durationBeat: 4 })),
      ...[60, 64, 67].map((pitch) => ({ pitch, startBeat: 8, durationBeat: 4 })),
    ];
    const { timeline, keys } = chordTimelineFromNotes(jittered);
    expect(timeline.segments[0]?.startBeat).toBe(0);
    expect(timeline.at(-1)).toBeNull();
    expect(timeline.at(-0.5)).toBeNull();
    expect(keys[0]?.startBeat).toBe(0);
    expect(keys.every((region) => region.startBeat >= 0)).toBe(true);

    // The jitter is the only difference from a quantized take, and it changes
    // nothing about where the analysis says the music is.
    const quantized = jittered.map((note) => ({
      ...note,
      startBeat: note.startBeat < 0 ? 0 : note.startBeat,
    }));
    const exact = chordTimelineFromNotes(quantized);
    expect(timeline.segments.map((s) => [s.startBeat, s.endBeat])).toEqual(
      exact.timeline.segments.map((s) => [s.startBeat, s.endBeat]),
    );
    // A declared pickup does not change the reading either: the jitter is not
    // an upbeat whether or not the caller has one.
    const declared = chordTimelineFromNotes(jittered, { pickupBeats: 1 });
    expect(declared.timeline.segments[0]?.startBeat).toBe(0);
    expect(declared.keys[0]?.startBeat).toBe(0);
  });

  it('rejects a note starting before the declared pickup', () => {
    const early = [...pickupPiece(), { pitch: 60, startBeat: -2, durationBeat: 1 }];
    expect(() => chordTimelineFromNotes(early, { pickupBeats: 1 })).toThrow(RangeError);
    expect(() => chordTimelineFromNotes(early, { pickupBeats: 2 })).not.toThrow();
    // A nonsensical onset is rejected whether a pickup is declared or not.
    expect(() =>
      chordTimelineFromNotes([{ pitch: 60, startBeat: Number.NEGATIVE_INFINITY, durationBeat: 1 }]),
    ).toThrow(RangeError);
  });

  it('carries the upbeat through the arrangement analysis', () => {
    const notes = pickupPiece();
    const analysis = analyzeArrangement([{ role: 'harmony', notes }], { pickupBeats: 1 });
    expect(analysis.tracks[0]?.notes.length).toBe(notes.length);
    expect(analysis.timeline.at(-1)?.rootPc).toBe(7);
    expect(() => analyzeArrangement([{ role: 'harmony', notes }], { pickupBeats: 0 })).toThrow(
      RangeError,
    );
  });
});
