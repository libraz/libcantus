import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/types.js';
import {
  type BassLineOptions,
  type BassSegment,
  type BassStyle,
  generateBassLine,
} from '../src/generate/bass/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** A four-bar I-IV-V-I placement in C major, one bar (4 beats) per chord. */
function progression(): BassSegment[] {
  return [
    { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
    { startBeat: 4, endBeat: 8, chord: makeChord(5, 'maj') },
    { startBeat: 8, endBeat: 12, chord: makeChord(7, 'maj') },
    { startBeat: 12, endBeat: 16, chord: makeChord(0, 'maj') },
  ];
}

const ALL_STYLES: BassStyle[] = ['root', 'rootFifth', 'pop', 'walking', 'arpeggio'];

/** Circular distance between two pitch classes, in [0, 6]. */
function pcDistance(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/** The segment covering a note's onset, if any. */
function segmentAt(segments: BassSegment[], startBeat: number): BassSegment | undefined {
  return segments.find((s) => startBeat >= s.startBeat - 1e-9 && startBeat < s.endBeat - 1e-9);
}

describe('generateBassLine', () => {
  it('places every note in the bass register', () => {
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments: progression(), key: cMajor, style, seed: 3 });
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(24);
        expect(note.pitch).toBeLessThanOrEqual(55);
      }
    }
  });

  it('sounds only chord tones, except walking approach beats', () => {
    const segments = progression();
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments, key: cMajor, style, seed: 7 });
      for (const note of notes) {
        const seg = segmentAt(segments, note.startBeat);
        expect(seg).toBeDefined();
        if (!seg) {
          continue;
        }
        const pc = ((note.pitch % 12) + 12) % 12;
        const lastStart = segments[segments.length - 1]?.startBeat ?? Number.NEGATIVE_INFINITY;
        const hasNext = note.startBeat < lastStart;
        const isApproach =
          style === 'walking' && hasNext && Math.abs(note.startBeat - (seg.endBeat - 1)) < 1e-6;
        if (isApproach) {
          // A walking approach note leads by step into the next chord, so it
          // sits within two semitones of that chord's bass (diatonic or
          // chromatic neighbor) rather than merely being some scale tone.
          const nextSeg = segments.find((s) => s.startBeat >= seg.endBeat - 1e-9);
          const nextRoot = (((nextSeg?.chord.bassPc ?? nextSeg?.chord.rootPc ?? 0) % 12) + 12) % 12;
          expect(pcDistance(nextRoot, pc)).toBeLessThanOrEqual(2);
        } else {
          expect(chordPitchClasses(seg.chord)).toContain(pc);
        }
      }
    }
  });

  it('uses the slash bass pitch class for root style', () => {
    const segments: BassSegment[] = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj', 4) }, // C/E
    ];
    const notes = generateBassLine({ segments, key: cMajor, style: 'root' });
    expect(notes).toHaveLength(1);
    expect((((notes[0]?.pitch ?? Number.NaN) % 12) + 12) % 12).toBe(4);
  });

  it('yields exactly one note per segment for root style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'root' });
    expect(notes).toHaveLength(segments.length);
  });

  it('yields one note per beat for walking style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'walking' });
    // Four bars of 4/4 = 16 quarter-note beats.
    expect(notes).toHaveLength(16);
  });

  it('leads by step into each chord change in walking style', () => {
    const segments = progression();
    const notes = generateBassLine({ segments, key: cMajor, style: 'walking', seed: 5 });
    const byStart = new Map<number, NoteEvent>();
    for (const note of notes) {
      byStart.set(Math.round(note.startBeat * 2) / 2, note);
    }
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const next = segments[i + 1];
      if (!seg || !next) {
        continue;
      }
      const approach = byStart.get(seg.endBeat - 1);
      const downbeat = byStart.get(next.startBeat);
      expect(approach).toBeDefined();
      expect(downbeat).toBeDefined();
      if (approach && downbeat) {
        expect(Math.abs(approach.pitch - downbeat.pitch)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('sorts onsets and never overlaps notes', () => {
    for (const style of ALL_STYLES) {
      const notes = generateBassLine({ segments: progression(), key: cMajor, style, seed: 11 });
      for (let i = 1; i < notes.length; i += 1) {
        const prev = notes[i - 1];
        const cur = notes[i];
        if (!prev || !cur) {
          continue;
        }
        expect(cur.startBeat).toBeGreaterThan(prev.startBeat);
        expect(prev.startBeat + prev.durationBeat).toBeLessThanOrEqual(cur.startBeat + 1e-9);
      }
    }
  });

  it('is deterministic for identical options and seed', () => {
    const opts: BassLineOptions = {
      segments: progression(),
      key: cMajor,
      style: 'pop',
      seed: 42,
    };
    expect(generateBassLine(opts)).toEqual(generateBassLine(opts));
  });

  it('produces different lines for different seeds in stochastic styles', () => {
    const base = { segments: progression(), key: cMajor, style: 'walking' as BassStyle };
    const a = generateBassLine({ ...base, seed: 1 });
    const b = generateBassLine({ ...base, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('sounds the real altered fifth for dim/aug/m7b5 chords in rootFifth style', () => {
    // rootFifth emits the root on the downbeat and the fifth on the midpoint;
    // dim => 6, aug => 8, m7b5 => 6 semitones above the root.
    const cases: [Parameters<typeof makeChord>[1], number][] = [
      ['dim', 6],
      ['aug', 8],
      ['m7b5', 6],
    ];
    for (const [quality, expectedFifth] of cases) {
      const segments: BassSegment[] = [{ startBeat: 0, endBeat: 4, chord: makeChord(0, quality) }];
      const notes = generateBassLine({ segments, key: cMajor, style: 'rootFifth' });
      expect(notes).toHaveLength(2);
      const rootPc = (((notes[0]?.pitch ?? Number.NaN) % 12) + 12) % 12;
      const fifthPc = (((notes[1]?.pitch ?? Number.NaN) % 12) + 12) % 12;
      expect(rootPc).toBe(0);
      // The fifth is the actual altered fifth, never a repeated root.
      expect(fifthPc).toBe(expectedFifth);
      expect(fifthPc).not.toBe(rootPc);
    }
  });

  it('keeps pop pickups within the declared register band', () => {
    // Default octave 2 => band [36, 48]. Sweep many seeds so weak-beat pickups
    // (including the octave-drop pickup) actually fire; none may leave the band.
    const octave = 2;
    const low = octave * 12 + 12;
    const high = low + 12;
    for (let seed = 0; seed < 40; seed += 1) {
      const notes = generateBassLine({
        segments: progression(),
        key: cMajor,
        style: 'pop',
        octave,
        seed,
      });
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(low);
        expect(note.pitch).toBeLessThanOrEqual(high);
      }
    }
  });

  it('is deep-equal deterministic across every style for a fixed seed', () => {
    for (const style of ALL_STYLES) {
      const opts: BassLineOptions = { segments: progression(), key: cMajor, style, seed: 99 };
      expect(generateBassLine(opts)).toEqual(generateBassLine(opts));
    }
  });

  it('returns an empty line for no segments', () => {
    expect(generateBassLine({ segments: [], key: cMajor })).toEqual([]);
  });
});
