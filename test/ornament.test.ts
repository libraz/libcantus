import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import type { NoteEvent } from '../src/core/types.js';
import { type BassSegment, generateBassLine } from '../src/generate/bass/index.js';
import { DRUM_NOTES, generateDrums } from '../src/generate/drums/index.js';
import { ORNAMENT_STYLES, ornament } from '../src/generate/ornament/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);

/** Two bars of eighth notes: strong and weak positions, both plentiful. */
function eighths(): NoteEvent[] {
  return Array.from({ length: 16 }, (_, index) => ({
    pitch: 48 + (index % 5),
    startBeat: index * 0.5,
    durationBeat: 0.5,
    velocity: 90,
  }));
}

describe('ornament decorates material it is given', () => {
  it('returns the same onsets it was handed', () => {
    const source = eighths();
    for (const style of ORNAMENT_STYLES) {
      const decorated = ornament(source, { style, amount: 1, seed: 1 });
      expect(decorated).toHaveLength(source.length);
      expect(decorated.map((note) => note.startBeat)).toEqual(source.map((note) => note.startBeat));
      expect(decorated.map((note) => note.pitch)).toEqual(source.map((note) => note.pitch));
      expect(decorated.map((note) => note.durationBeat)).toEqual(
        source.map((note) => note.durationBeat),
      );
    }
  });

  it('carries the ornament as an attribute rather than extra notes', () => {
    const flammed = ornament(eighths(), { style: 'flam', amount: 1, seed: 2 });
    expect(flammed.some((note) => note.articulation === 'flam')).toBe(true);
    for (const note of flammed) {
      expect(note.articulation === undefined || note.articulation === 'flam').toBe(true);
    }
  });

  it('does not touch the source array', () => {
    const source = eighths();
    const before = JSON.stringify(source);
    ornament(source, { style: 'ghost', amount: 1, seed: 3 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('is deterministic for a seed and independent of call order', () => {
    const once = ornament(eighths(), { style: 'ghost', amount: 0.6, seed: 4 });
    const twice = ornament(eighths(), { style: 'ghost', amount: 0.6, seed: 4 });
    expect(twice).toEqual(once);
    // Ornamenting the second half alone decorates it exactly as ornamenting the
    // whole passage did: the choice is addressed by each note's own position.
    const tail = eighths().slice(8);
    const tailAlone = ornament(tail, { style: 'ghost', amount: 0.6, seed: 4 });
    expect(tailAlone.map((note) => note.articulation)).toEqual(
      once.slice(8).map((note) => note.articulation),
    );
  });
});

describe('ornament styles pick the positions they belong on', () => {
  it('ghosts weak positions and accents strong ones', () => {
    const ghosted = ornament(eighths(), { style: 'ghost', amount: 1, seed: 5 });
    for (const note of ghosted) {
      if (note.articulation === 'ghost') {
        expect(note.startBeat % 2).not.toBe(0);
      }
    }
    const accented = ornament(eighths(), { style: 'accent', amount: 1, seed: 5 });
    for (const note of accented) {
      if (note.articulation === 'accent') {
        expect(note.startBeat % 2).toBe(0);
      }
    }
  });

  it('softens a ghost and lifts an accent', () => {
    const source = eighths();
    const ghosted = ornament(source, { style: 'ghost', amount: 1, seed: 6 });
    const accented = ornament(source, { style: 'accent', amount: 1, seed: 6 });
    ghosted.forEach((note, index) => {
      if (note.articulation === 'ghost') {
        expect(note.velocity ?? 0).toBeLessThan(source[index]?.velocity ?? 0);
      }
    });
    accented.forEach((note, index) => {
      if (note.articulation === 'accent') {
        expect(note.velocity ?? 0).toBeGreaterThan(source[index]?.velocity ?? 0);
      }
    });
  });

  it('slides only where the line actually moves', () => {
    const line: NoteEvent[] = [
      { pitch: 40, startBeat: 0, durationBeat: 1, velocity: 90 },
      { pitch: 40, startBeat: 1, durationBeat: 1, velocity: 90 },
      { pitch: 52, startBeat: 2, durationBeat: 1, velocity: 90 },
    ];
    const slid = ornament(line, { style: 'slide', amount: 1, seed: 7 });
    expect(slid[0]?.articulation).toBeUndefined();
    expect(slid[1]?.articulation).toBeUndefined();
    expect(slid[2]?.articulation).toBe('slide');
  });

  it('reads strong positions from the meter it is given', () => {
    const ts = parseTimeSignature('3/4');
    const waltz: NoteEvent[] = Array.from({ length: 6 }, (_, index) => ({
      pitch: 60,
      startBeat: index,
      durationBeat: 1,
      velocity: 80,
    }));
    const accented = ornament(waltz, { style: 'accent', amount: 1, seed: 8, ts });
    for (const note of accented) {
      if (note.articulation === 'accent') {
        expect(note.startBeat % 3).toBe(0);
      }
    }
  });
});

describe('ornament leaves existing decisions alone', () => {
  it('keeps an ornament a generator already wrote', () => {
    const hits = generateDrums({
      bars: 2,
      bpm: 120,
      style: 'breakbeat',
      section: 'verse',
      nextSection: 'chorus',
      density: 0.7,
      fills: true,
      seed: 17,
    });
    const already = hits.filter((hit) => hit.articulation !== undefined);
    const decorated = ornament(hits, { style: 'ghost', amount: 1, seed: 1 });
    for (const hit of already) {
      const same = decorated.find(
        (note) => note.startBeat === hit.startBeat && note.pitch === hit.pitch,
      );
      expect(same?.articulation).toBe(hit.articulation);
    }
  });

  it('layers with a second pass instead of overwriting it', () => {
    const first = ornament(eighths(), { style: 'ghost', amount: 0.5, seed: 9 });
    const second = ornament(first, { style: 'accent', amount: 1, seed: 9 });
    const ghosts = (notes: NoteEvent[]) => notes.filter((n) => n.articulation === 'ghost').length;
    expect(ghosts(second)).toBe(ghosts(first));
    expect(second.some((note) => note.articulation === 'accent')).toBe(true);
  });
});

describe('a difficulty ceiling reaches the ornament layer', () => {
  it('leaves a passage too fast for the ceiling plain', () => {
    const sixteenths: NoteEvent[] = Array.from({ length: 16 }, (_, index) => ({
      pitch: 38,
      startBeat: index * 0.25,
      durationBeat: 0.25,
      velocity: 90,
    }));
    const unhurried = ornament(sixteenths, {
      style: 'ghost',
      ctx: { seed: 2, bpm: 60, complexity: { ornament: 1, difficulty: 3 } },
    });
    const hurried = ornament(sixteenths, {
      style: 'ghost',
      ctx: { seed: 2, bpm: 200, complexity: { ornament: 1, difficulty: 1 } },
    });
    expect(unhurried.some((note) => note.articulation === 'ghost')).toBe(true);
    expect(hurried.every((note) => note.articulation === undefined)).toBe(true);
  });

  it('takes its amount from the context when the caller names none', () => {
    const viaContext = ornament(eighths(), {
      style: 'ghost',
      ctx: { seed: 4, complexity: { ornament: 0.75 } },
    });
    expect(viaContext).toEqual(ornament(eighths(), { style: 'ghost', amount: 0.75, seed: 4 }));
  });
});

describe('ornament works on any material', () => {
  it('decorates a generated bass line', () => {
    const segments: BassSegment[] = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj') },
      { startBeat: 4, endBeat: 8, chord: makeChord(7, 'maj') },
    ];
    const line = generateBassLine({ segments, key: cMajor, style: 'pop', ctx: 3 });
    const decorated = ornament(line, { style: 'ghost', amount: 1, seed: 3 });
    expect(decorated.map((note) => note.startBeat)).toEqual(line.map((note) => note.startBeat));
  });

  it('decorates drum hits, which are note events too', () => {
    const hits = generateDrums({
      bars: 1,
      bpm: 100,
      style: 'standard',
      section: 'verse',
      density: 0.5,
      seed: 1,
    });
    const kicks = hits.filter((hit) => hit.pitch === DRUM_NOTES.kick);
    const decorated = ornament(kicks, { style: 'flam', amount: 1, seed: 1 });
    expect(decorated).toHaveLength(kicks.length);
    // The kick falls on the downbeats, which is where a flam belongs.
    expect(decorated.some((hit) => hit.articulation === 'flam')).toBe(true);
  });

  it('rejects an amount outside the dial', () => {
    expect(() => ornament(eighths(), { amount: 1.5 })).toThrow(RangeError);
    expect(() => ornament(eighths(), { style: 'nope' as never })).toThrow();
  });
});
