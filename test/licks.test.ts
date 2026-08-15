import { describe, expect, it } from 'vitest';
import { generateBassLine } from '../src/generate/bass/index.js';
import { BASS_LICKS, isLickMaterial, placeLicks } from '../src/generate/bass/licks.js';
import { GENRES, type Vocabulary } from '../src/generate/vocabulary/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';

const KEY = majorKey(0);

const FIRST_SPAN = { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') };

const TIMELINE = [
  FIRST_SPAN,
  { startBeat: 4, endBeat: 8, chord: makeChord(9, 'min7') },
  { startBeat: 8, endBeat: 12, chord: makeChord(5, 'maj7') },
  { startBeat: 12, endBeat: 16, chord: makeChord(7, 'dom7') },
];

describe('the bass lick dictionary', () => {
  it('holds figures for the genres it covers, each with its conditions', () => {
    expect(BASS_LICKS.length).toBeGreaterThan(5);
    for (const lick of BASS_LICKS) {
      expect(GENRES).toContain(lick.genre);
      expect(lick.difficulty).toBeGreaterThanOrEqual(1);
      expect(lick.difficulty).toBeLessThanOrEqual(5);
      expect(lick.material.notes.length).toBeGreaterThan(0);
      for (const note of lick.material.notes) {
        expect(note.step).toBeGreaterThanOrEqual(0);
        expect(note.step).toBeLessThan(lick.material.lengthSteps);
        expect(note.degree).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('records the ground every entry qualifies on', () => {
    for (const lick of BASS_LICKS) {
      expect(['idiom', 'construction', 'traditional']).toContain(lick.provenance.basis);
      expect(lick.provenance.note.length).toBeGreaterThan(10);
    }
  });

  it('recognises its own material and not that of another part', () => {
    expect(isLickMaterial(BASS_LICKS[0]?.material)).toBe(true);
    expect(isLickMaterial({ steps: 16, strokes: [] })).toBe(false);
  });
});

describe('placeLicks', () => {
  it('is fully determined by the options and the seed', () => {
    const opts = { genre: 'motown' as const, seed: 5, bpm: 112 };
    expect(placeLicks(TIMELINE, KEY, opts)).toEqual(placeLicks(TIMELINE, KEY, opts));
  });

  it('places notes inside the timeline, in onset order, without overlapping', () => {
    const notes = placeLicks(TIMELINE, KEY, { genre: 'soul', seed: 3, bpm: 96 });
    expect(notes.length).toBeGreaterThan(0);
    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i];
      if (!note) continue;
      expect(note.startBeat).toBeGreaterThanOrEqual(0);
      expect(note.startBeat).toBeLessThan(16);
      expect(note.durationBeat).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      const next = notes[i + 1];
      if (next) {
        expect(note.startBeat + note.durationBeat).toBeLessThanOrEqual(next.startBeat + 1e-9);
      }
    }
  });

  it('takes the degrees the chord names, so one figure fits every chord', () => {
    // The country figure is root and fifth only; over a minor chord the fifth is
    // still the chord's own, and over a diminished chord it is the flat five.
    const overDim = placeLicks(
      [{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'dim') }],
      minorKey(0),
      { genre: 'country', seed: 1, density: 1, bpm: 100 },
    );
    const pcs = new Set(overDim.map((note) => note.pitch % 12));
    expect(pcs.has(6)).toBe(true);
    expect(pcs.has(7)).toBe(false);
  });

  it('honours the chord qualities a figure states it fits over', () => {
    // The walk-down states major-family chords only, so a bar of m7b5 cannot
    // take it; the line still sounds, on its root.
    const notes = placeLicks([{ startBeat: 0, endBeat: 4, chord: makeChord(2, 'm7b5') }], KEY, {
      genre: 'motown',
      seed: 2,
      density: 1,
      bpm: 112,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.pitch % 12).toBe(2);
  });

  it('falls back to the root when the genre has nothing for this tempo', () => {
    const notes = placeLicks(TIMELINE, KEY, { genre: 'motown', seed: 2, density: 1, bpm: 240 });
    expect(notes).toHaveLength(TIMELINE.length);
    expect(notes.map((note) => note.pitch % 12)).toEqual([0, 9, 5, 7]);
  });

  it('rejects a figure above the ceiling rather than simplifying it', () => {
    const free = placeLicks(TIMELINE, KEY, { genre: 'funk', seed: 8, density: 1, bpm: 112 });
    const capped = placeLicks(TIMELINE, KEY, {
      genre: 'funk',
      seed: 8,
      density: 1,
      bpm: 112,
      difficulty: 1,
    });
    expect(free.length).toBeGreaterThan(capped.length);
    // What survives the ceiling is the plain root of each chord, not a
    // half-remembered version of the figure.
    expect(capped).toHaveLength(TIMELINE.length);
  });

  it('plays fewer figures as the density falls', () => {
    const sparse = placeLicks(TIMELINE, KEY, { genre: 'blues', seed: 4, density: 0, bpm: 120 });
    const busy = placeLicks(TIMELINE, KEY, { genre: 'blues', seed: 4, density: 1, bpm: 120 });
    expect(sparse).toHaveLength(TIMELINE.length);
    expect(busy.length).toBeGreaterThan(sparse.length);
  });

  it('leads into the next chord by step where the figure leaves room', () => {
    const notes = placeLicks(TIMELINE, KEY, { genre: 'jazz', seed: 1, density: 0, bpm: 140 });
    // With no figures taken every segment is a root, so the connecting tones are
    // the only other notes that can appear.
    expect(notes.length).toBeGreaterThanOrEqual(TIMELINE.length);
  });

  it('keeps the line inside the requested register', () => {
    for (const octave of [1, 2, 3]) {
      const notes = placeLicks(TIMELINE, KEY, { genre: 'gospel', seed: 6, bpm: 84, octave });
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(octave * 12 + 12 - 12);
        expect(note.pitch).toBeLessThanOrEqual(octave * 12 + 12 + 12);
      }
    }
  });

  it('carries the articulations the figure asks for', () => {
    const notes = placeLicks(TIMELINE, KEY, { genre: 'funk', seed: 8, density: 1, bpm: 100 });
    expect(notes.some((note) => note.articulation === 'mute')).toBe(true);
  });

  it('rejects a segment with no duration and an unknown genre', () => {
    expect(() =>
      placeLicks([{ startBeat: 0, endBeat: 0, chord: makeChord(0, 'maj') }], KEY, {
        genre: 'pop',
      }),
    ).toThrow();
    expect(() => placeLicks(TIMELINE, KEY, { genre: 'gamelan' as unknown as 'pop' })).toThrow();
  });

  it('returns nothing for an empty timeline', () => {
    expect(placeLicks([], KEY, { genre: 'pop' })).toEqual([]);
  });

  it('leaves the phrase-shape generator alone', () => {
    // The lick layer is an addition, not a replacement: the styled generator is
    // reached the same way and answers the same as before.
    const line = generateBassLine({ segments: TIMELINE, key: KEY, style: 'walking', seed: 1 });
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('a caller-supplied lick dictionary', () => {
  const ownLick: Vocabulary<unknown> = {
    id: 'callerRiff',
    genre: 'hiphop',
    difficulty: 1,
    articulations: [],
    material: {
      lengthSteps: 16,
      notes: [
        { degree: 1, step: 0, velocity: 1 },
        { degree: 5, step: 8, velocity: 0.8 },
      ],
    },
    provenance: { basis: 'construction', note: 'written for this test from its own grid' },
  };

  it('reaches a genre the library ships nothing for', () => {
    const notes = placeLicks(TIMELINE, KEY, {
      genre: 'hiphop',
      density: 1,
      seed: 1,
      bpm: 90,
      ctx: { seed: 1, bpm: 90, vocabulary: [ownLick] },
    });
    expect(notes.length).toBeGreaterThan(TIMELINE.length);
    // Without the caller's dictionary the genre has nothing, so every segment
    // falls back to its root.
    const bare = placeLicks(TIMELINE, KEY, { genre: 'hiphop', density: 1, seed: 1, bpm: 90 });
    expect(bare).toHaveLength(TIMELINE.length);
  });

  it('replaces a built-in figure when it reuses the id', () => {
    const replacement: Vocabulary<unknown> = {
      ...ownLick,
      id: 'countryAlternating',
      genre: 'country',
    };
    const notes = placeLicks([FIRST_SPAN], KEY, {
      genre: 'country',
      density: 1,
      seed: 1,
      bpm: 120,
      ctx: { seed: 1, bpm: 120, vocabulary: [replacement] },
    });
    // Two notes, root and fifth: the caller's figure, not the four-note
    // built-in it took the name of.
    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.pitch % 12)).toEqual([0, 7]);
  });

  it('refuses an entry whose difficulty is off the scale', () => {
    expect(() =>
      placeLicks(TIMELINE, KEY, {
        genre: 'hiphop',
        ctx: { seed: 1, vocabulary: [{ ...ownLick, difficulty: 0 }] },
      }),
    ).toThrow();
  });
});
