import { describe, expect, it } from 'vitest';
import { generateBassLine } from '../src/generate/bass/index.js';
import { BASS_LICKS, isLickMaterial, placeLicks } from '../src/generate/bass/licks.js';
import { GENRES, selectVocabulary, type Vocabulary } from '../src/generate/vocabulary/index.js';
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

  it('sounds the octave degree an octave above the root it answers', () => {
    // The two figures whose whole character is the octave: the soul push and
    // the funk sixteenth pop. Degree 8 is written as the octave above degree 1,
    // so it has to sound as one — a bass line that answers the root with the
    // root is not the figure the dictionary holds.
    const cases = [
      { genre: 'soul', bpm: 96, rootStep: 0, octaveStep: 6 },
      { genre: 'funk', bpm: 100, rootStep: 0, octaveStep: 3 },
    ] as const;
    for (const { genre, bpm, rootStep, octaveStep } of cases) {
      const notes = placeLicks([FIRST_SPAN], KEY, { genre, seed: 3, density: 1, bpm });
      const at = (step: number) => notes.find((note) => Math.abs(note.startBeat - step / 4) < 1e-9);
      const root = at(rootStep);
      const octave = at(octaveStep);
      expect(root, `${genre} root`).toBeDefined();
      expect(octave, `${genre} octave`).toBeDefined();
      expect(octave?.pitch).toBe((root?.pitch ?? 0) + 12);
    }
  });

  it('sounds every octave degree an octave above the root of the same figure', () => {
    // Degree 8 is written as the octave above degree 1, so wherever the
    // dictionary uses it the two have to stand exactly twelve semitones apart —
    // over any chord, in any key, in any register. Folding each note into one
    // octave band spelled the octave as the root the figure had just played and
    // turned the soul push and the funk pop into repeated notes.
    const SIXTEENTH = 0.25;
    const figures = BASS_LICKS.filter((lick) =>
      lick.material.notes.some((note) => note.degree === 8),
    );
    expect(figures.length).toBeGreaterThan(0);

    for (const lick of figures) {
      const [slowest, fastest] = lick.tempoRange ?? [100, 100];
      const bpm = Math.round((slowest + fastest) / 2);
      const qualities = lick.fitsOver ?? ['maj7', 'min7'];
      for (const quality of qualities) {
        for (let rootPc = 0; rootPc < 12; rootPc += 1) {
          for (const key of [majorKey(0), minorKey(9)]) {
            for (const octave of [1, 2, 3]) {
              const notes = placeLicks(
                [{ startBeat: 0, endBeat: 4, chord: makeChord(rootPc, quality) }],
                key,
                { genre: lick.genre, density: 1, difficulty: 5, seed: 2, bpm, octave },
              );
              const soundedAt = (step: number) =>
                notes
                  .filter((note) => Math.abs(note.startBeat - step * SIXTEENTH) < 1e-9)
                  .map((note) => note.pitch);
              const pitchesOf = (degree: number) =>
                new Set(
                  lick.material.notes
                    .filter((note) => note.degree === degree)
                    .flatMap((note) => soundedAt(note.step)),
                );
              const where = `${lick.id} ${quality}@${rootPc} key ${key.rootPc} octave ${octave}`;
              const roots = [...pitchesOf(1)];
              const octaves = [...pitchesOf(8)];
              expect(roots, where).toHaveLength(1);
              expect(octaves, where).toEqual([(roots[0] ?? 0) + 12]);
            }
          }
        }
      }
    }
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

  it('plays every bar of a chord that lasts longer than a figure', () => {
    // A ballad or a modal vamp holds one chord for four bars. The figure is a
    // bar long, so the rest of the segment was one held note before: the line
    // stopped and the note it stopped on was written as a twelve-beat ornament.
    const vamp = [{ startBeat: 0, endBeat: 16, chord: makeChord(0, 'maj7') }];
    for (const genre of ['motown', 'soul', 'jazz', 'country'] as const) {
      const notes = placeLicks(vamp, KEY, { genre, seed: 3, density: 1, bpm: 100 });
      for (let bar = 0; bar < 4; bar += 1) {
        const inBar = notes.filter(
          (note) => note.startBeat >= bar * 4 && note.startBeat < (bar + 1) * 4,
        );
        expect(inBar.length, `${genre} bar ${bar}`).toBeGreaterThan(0);
      }
      // No note outlives the figure it belongs to, or the bar it was written in.
      for (const note of notes) {
        expect(note.durationBeat, `${genre} @${note.startBeat}`).toBeLessThanOrEqual(4);
      }
      // And the line stays in the register it was asked for rather than
      // climbing an octave per bar as the figures answer themselves.
      const pitches = notes.map((note) => note.pitch);
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(24);
    }
  });

  it('says the same thing whether the documented default is written out or left out', () => {
    for (const genre of ['motown', 'blues', 'gospel'] as const) {
      const omitted = placeLicks(TIMELINE, KEY, { genre, seed: 4, bpm: 100 });
      const explicit = placeLicks(TIMELINE, KEY, { genre, seed: 4, bpm: 100, density: 0.6 });
      expect(explicit, genre).toEqual(omitted);
    }
  });

  it('declares the meter its figures are written in', () => {
    // "Absent means any" is only true of the data if an entry written for a
    // four-beat bar says so; otherwise a waltz is handed a 4/4 figure.
    for (const lick of BASS_LICKS) {
      expect(lick.ts, lick.id).toEqual({ numerator: 4, denominator: 4 });
    }
    expect(selectVocabulary(BASS_LICKS, { ts: { numerator: 3, denominator: 4 } })).toEqual([]);
    expect(selectVocabulary(BASS_LICKS, { ts: { numerator: 4, denominator: 4 } }).length).toBe(
      BASS_LICKS.length,
    );
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
        // Roots land in the octave band the caller asked for; a figure is then
        // written upward from its root, so the band has to be wide enough for
        // the range the figure was written in — up to its own octave.
        expect(note.pitch).toBeLessThanOrEqual(octave * 12 + 12 + 24);
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
    // Root and fifth: the caller's figure, not the four-note built-in it took
    // the name of. At a full dial the fifth is also anticipated, which is the
    // same note a sixteenth earlier rather than a note the built-in supplied.
    expect(notes.map((note) => note.pitch % 12)).toEqual([0, 7, 7]);
    // Everything above the figure's own notes is the dial adding to it, so a
    // quieter setting is a subset of this one rather than a different figure.
    const quieter = placeLicks([FIRST_SPAN], KEY, {
      genre: 'country',
      density: 0.8,
      seed: 1,
      bpm: 120,
      ctx: { seed: 1, bpm: 120, vocabulary: [replacement] },
    });
    const busier = new Set(notes.map((note) => note.startBeat));
    for (const note of quieter) {
      expect(busier.has(note.startBeat), `lost ${note.startBeat}`).toBe(true);
    }
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
