import { describe, expect, it } from 'vitest';
import { hypermeter } from '../src/analyze/form/hypermeter.js';
import { sectionsFromNotes } from '../src/analyze/form/section.js';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';

const COMMON = parseTimeSignature('4/4');

/** One bar of melody, transposed to `at` and to the given pitches. */
function bar(at: number, pitches: readonly number[]): NoteEvent[] {
  return pitches.map((pitch, index) => ({
    pitch,
    startBeat: at + index,
    durationBeat: 1,
  }));
}

describe('hypermeter over a pickup', () => {
  it('reads the group from the full bars when the span is too short to decide', () => {
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      { pitch: 72, startBeat: 0, durationBeat: 4 },
      { pitch: 65, startBeat: 4, durationBeat: 4 },
    ];
    const reading = hypermeter(notes, COMMON);
    expect(reading.downbeats).toEqual([0]);
    expect(reading.groupBars).toBe(2);
  });

  it('never reports a beat before the first downbeat', () => {
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -2, durationBeat: 2 },
      { pitch: 72, startBeat: 0, durationBeat: 4 },
      { pitch: 65, startBeat: 4, durationBeat: 4 },
      { pitch: 64, startBeat: 8, durationBeat: 4 },
    ];
    for (const downbeat of hypermeter(notes, COMMON).downbeats) {
      expect(downbeat).toBeGreaterThanOrEqual(0);
    }
  });

  it('has no hypermetric downbeat when only the pickup sounds', () => {
    const notes: NoteEvent[] = [{ pitch: 67, startBeat: -1, durationBeat: 1 }];
    const reading = hypermeter(notes, COMMON);
    expect(reading.downbeats).toEqual([]);
  });
});

describe('section length over a pickup', () => {
  it('counts the units of the folded grid rather than the raw start beat', () => {
    const phrase = [60, 62, 64, 65];
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      ...bar(0, phrase),
      ...bar(4, phrase),
      ...bar(8, phrase),
      ...bar(12, phrase),
      ...bar(16, phrase),
      ...bar(20, phrase),
      ...bar(24, phrase),
      ...bar(28, phrase),
    ];
    const sections = sectionsFromNotes(notes, { ts: COMMON, unitBars: 4 });
    expect(sections).toHaveLength(1);
    const [section] = sections;
    expect(section?.startBeat).toBe(-1);
    expect(section?.bars).toBe(8);
    expect(section?.bars).toBe(2 * 4);
  });

  it('keeps every section a whole number of units long', () => {
    const phrase = [60, 62, 64, 65];
    const other = [72, 71, 69, 67];
    const notes: NoteEvent[] = [
      { pitch: 67, startBeat: -1, durationBeat: 1 },
      ...bar(0, phrase),
      ...bar(4, phrase),
      ...bar(8, other),
      ...bar(12, other),
    ];
    const sections = sectionsFromNotes(notes, { ts: COMMON, unitBars: 2 });
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.bars % 2).toBe(0);
    }
  });
});
