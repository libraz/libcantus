import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chordTimelineFromNotes } from '../src/analyze/timeline/index.js';
import { beatToBarPosition, metricWeight, parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { assertNoteEvent, assertNoteEvents } from '../src/core/validation/index.js';
import { humanize } from '../src/generate/groove/index.js';

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
    expect(humanize(WITH_PICKUP, { ctx: { seed: 3 }, timing: 0.02 })[0]?.startBeat).toBeLessThan(0);
  });
});
