import { describe, expect, it } from 'vitest';
import type { TimeSignature } from '../src/core/meter/index.js';
import { generateBassLine } from '../src/generate/bass/index.js';
import type { LickMaterial } from '../src/generate/bass/licks.js';
import { BASS_LICKS, isLickMaterial, placeLicks } from '../src/generate/bass/licks.js';
import { GENRES, selectVocabulary, type Vocabulary } from '../src/generate/vocabulary/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
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
    const opts = { genre: 'motown' as const, ctx: { seed: 5, bpm: 112 } };
    expect(placeLicks(TIMELINE, KEY, opts)).toEqual(placeLicks(TIMELINE, KEY, opts));
  });

  it('places notes inside the timeline, in onset order, without overlapping', () => {
    const notes = placeLicks(TIMELINE, KEY, { genre: 'soul', ctx: { seed: 3, bpm: 96 } });
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
      { genre: 'country', ctx: { seed: 1, bpm: 100, complexity: { rhythmic: 1 } } },
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
      const notes = placeLicks([FIRST_SPAN], KEY, {
        genre,
        ctx: { seed: 3, bpm, complexity: { rhythmic: 1 } },
      });
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
                {
                  genre: lick.genre,
                  ctx: { seed: 2, bpm, complexity: { rhythmic: 1 } },
                  difficulty: 5,
                  octave,
                },
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

  it('sounds the slash bass at the onset the figure begins on', () => {
    // The written bass is what sounds under the chord, and the figure's own
    // root note shares that onset with it. Whichever of the two survives, the
    // onset is the bass: C/E in the default register is E2, the same note the
    // styled generator writes there.
    const slash = [{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj', 4) }];
    const notes = placeLicks(slash, KEY, {
      genre: 'motown',
      ctx: { seed: 0, bpm: 112, complexity: { rhythmic: 1 } },
    });
    expect(notes[0]?.startBeat).toBe(0);
    expect(notes[0]?.pitch).toBe(40);
    expect(notes[0]?.pitch).toBe(
      generateBassLine({ segments: slash, key: KEY, style: 'root' })[0]?.pitch,
    );
    // The figure above that onset is still measured from the chord's own root,
    // so its octave degree answers C rather than the whole figure being
    // transposed onto the bass, which would sound it a third too high.
    const octave = notes.find((note) => Math.abs(note.startBeat - 1) < 1e-9);
    expect(octave?.pitch).toBe(48);
  });

  it('sounds a flattened degree below the plain one, whatever the chord supplies', () => {
    // An alteration displaces the diatonic degree; it does not stack on top of
    // a degree the chord already flattened. A flat seventh is ten semitones
    // above the root over a dominant or minor chord as much as over a major
    // one — otherwise the boogie's sixth-to-flat-seventh motion comes out as a
    // repeated sixth.
    const SIXTEENTH = 0.25;
    const flattened = BASS_LICKS.filter((lick) =>
      lick.material.notes.some((note) => note.degree === 7 && note.alter === -1),
    );
    expect(flattened.length).toBeGreaterThan(0);

    for (const lick of flattened) {
      const [slowest, fastest] = lick.tempoRange ?? [100, 100];
      const bpm = Math.round((slowest + fastest) / 2);
      const rootStep = Math.min(
        ...lick.material.notes.filter((note) => note.degree === 1).map((note) => note.step),
      );
      const flatStep = (
        lick.material.notes.find((note) => note.degree === 7 && note.alter === -1) ?? { step: 0 }
      ).step;
      for (const quality of lick.fitsOver ?? ['maj7', 'dom7', 'min7', 'min']) {
        const notes = placeLicks(
          [{ startBeat: 0, endBeat: 4, chord: makeChord(0, quality) }],
          KEY,
          {
            genre: lick.genre,
            difficulty: 5,
            ctx: { seed: 0, bpm, complexity: { rhythmic: 1 } },
          },
        );
        const at = (step: number) =>
          notes.find((note) => Math.abs(note.startBeat - step * SIXTEENTH) < 1e-9);
        const where = `${lick.id} over ${quality}`;
        const root = at(rootStep);
        const flat = at(flatStep);
        expect(root, where).toBeDefined();
        expect(flat, where).toBeDefined();
        expect((flat?.pitch ?? 0) - (root?.pitch ?? 0), where).toBe(10);
      }
    }
  });

  it('walks the boogie figure through its flat seventh over a dominant chord', () => {
    const notes = placeLicks([{ startBeat: 0, endBeat: 4, chord: makeChord(0, 'dom7') }], KEY, {
      genre: 'blues',
      ctx: { seed: 0, bpm: 120, complexity: { rhythmic: 1 } },
    });
    const sounded = [0, 2, 4, 6, 8, 10, 12].map(
      (step) => notes.find((note) => Math.abs(note.startBeat - step * 0.25) < 1e-9)?.pitch,
    );
    // C G A Bb A G C, in the default register.
    expect(sounded).toEqual([36, 43, 45, 46, 45, 43, 36]);
  });

  it('takes the boogie sixth from the chord it is played over, not from the key', () => {
    // The boogie figure names its own sixth, so over a dominant seventh it is
    // the major sixth that chord's mode carries wherever the chord sits in the
    // key: F# over A7, C# over E7. The key's own sixth from those roots is a
    // semitone lower and belongs to a different chord.
    const cases = [
      { rootPc: 9, sixthPc: 6, keySixthPc: 5 },
      { rootPc: 4, sixthPc: 1, keySixthPc: 0 },
    ] as const;
    for (const { rootPc, sixthPc, keySixthPc } of cases) {
      const notes = placeLicks(
        [{ startBeat: 0, endBeat: 4, chord: makeChord(rootPc, 'dom7') }],
        KEY,
        { genre: 'blues', ctx: { seed: 0, bpm: 120, complexity: { rhythmic: 1 } } },
      );
      // The boogie states its sixth on the third sixteenth pair of the bar.
      const sixth = notes.find((note) => Math.abs(note.startBeat - 1) < 1e-9);
      const where = `dom7 on ${rootPc}`;
      expect(sixth?.pitch, where).toBeDefined();
      expect(((sixth?.pitch ?? 0) % 12) + 0, where).toBe(sixthPc);
      expect(
        notes.some((note) => note.pitch % 12 === keySixthPc),
        where,
      ).toBe(false);
    }
  });

  it('leaves a suspended chord suspended instead of sounding the third it replaced', () => {
    // A suspension does not omit its third, it puts the fourth in that place.
    // Restoring the third from the key is what the chord exists to prevent, so
    // a figure written on the third sounds the tone the chord suspended into.
    const cases = [
      { rootPc: 0, thirdPc: 4, suspendedPc: 5 },
      { rootPc: 7, thirdPc: 11, suspendedPc: 0 },
    ] as const;
    for (const genre of ['jazz', 'gospel', 'reggae'] as const) {
      for (const { rootPc, thirdPc, suspendedPc } of cases) {
        const notes = placeLicks(
          [{ startBeat: 0, endBeat: 4, chord: makeChord(rootPc, 'sus4') }],
          KEY,
          { genre, ctx: { seed: 1, bpm: 100, complexity: { rhythmic: 1 } } },
        );
        const pcs = new Set(notes.map((note) => note.pitch % 12));
        const where = `${genre} over sus4 on ${rootPc}`;
        expect(pcs.has(thirdPc), where).toBe(false);
        expect(pcs.has(suspendedPc), where).toBe(true);
      }
    }
  });

  it('walks into every chord change by step, even where the figure fills that beat', () => {
    // The figure's own fixed degrees hold the beat before the change whatever
    // the next chord is, so the beat sounding is not the same thing as the line
    // leading into the change: what is written there has to be a step from the
    // note the next chord starts on.
    const changes = [
      { startBeat: 0, endBeat: 4, chord: makeChord(2, 'min7') },
      { startBeat: 4, endBeat: 8, chord: makeChord(7, 'dom7') },
      { startBeat: 8, endBeat: 12, chord: makeChord(0, 'maj7') },
    ];
    const notes = placeLicks(changes, KEY, {
      genre: 'jazz',
      ctx: { seed: 1, bpm: 140, complexity: { rhythmic: 1 } },
    });
    const at = (beat: number) => notes.find((note) => Math.abs(note.startBeat - beat) < 1e-9);
    for (const change of [4, 8]) {
      const approach = at(change - 1);
      const landing = at(change);
      expect(approach, `beat ${change - 1}`).toBeDefined();
      expect(landing, `beat ${change}`).toBeDefined();
      const step = Math.abs((approach?.pitch ?? 0) - (landing?.pitch ?? 0));
      expect(step, `into beat ${change}`).toBeGreaterThanOrEqual(1);
      expect(step, `into beat ${change}`).toBeLessThanOrEqual(2);
    }
  });

  it('rejects a ceiling off the scale whether or not the context also names one', () => {
    // Whether the context names the same dial is not something this caller can
    // see, so a value outside the scale is refused either way rather than
    // silently dropped when the context happens to win.
    expect(() => placeLicks(TIMELINE, KEY, { genre: 'motown', difficulty: 99 })).toThrow();
    expect(() =>
      placeLicks(TIMELINE, KEY, {
        genre: 'motown',
        difficulty: 99,
        ctx: { complexity: { difficulty: 3 } },
      }),
    ).toThrow();
  });

  it('rejects overlapping chord segments exactly as the styled generator does', () => {
    // Both surfaces read the same placement, so the same placement is either
    // playable on both or refused by both.
    const overlapping = [
      { startBeat: 0, endBeat: 4, chord: makeChord(0, 'maj7') },
      { startBeat: 2, endBeat: 6, chord: makeChord(5, 'maj7') },
    ];
    expect(() => placeLicks(overlapping, KEY, { genre: 'motown' })).toThrow(/must not overlap/);
    expect(() => generateBassLine({ segments: overlapping, key: KEY })).toThrow(/must not overlap/);
  });

  it('honours the chord qualities a figure states it fits over', () => {
    // The walk-down states major-family chords only, so a bar of m7b5 cannot
    // take it; the line still sounds, on its root.
    const notes = placeLicks([{ startBeat: 0, endBeat: 4, chord: makeChord(2, 'm7b5') }], KEY, {
      genre: 'motown',
      ctx: { seed: 2, bpm: 112, complexity: { rhythmic: 1 } },
    });
    expect(notes).toHaveLength(1);
    expect(notes.map((note) => note.pitch % 12)).toEqual([2]);
  });

  it('falls back to the root when the genre has nothing for this tempo', () => {
    const notes = placeLicks(TIMELINE, KEY, {
      genre: 'motown',
      ctx: { seed: 2, bpm: 240, complexity: { rhythmic: 1 } },
    });
    expect(notes).toHaveLength(TIMELINE.length);
    expect(notes.map((note) => note.pitch % 12)).toEqual([0, 9, 5, 7]);
  });

  it('rejects a figure above the ceiling rather than simplifying it', () => {
    const free = placeLicks(TIMELINE, KEY, {
      genre: 'funk',
      ctx: { seed: 8, bpm: 112, complexity: { rhythmic: 1 } },
    });
    const capped = placeLicks(TIMELINE, KEY, {
      genre: 'funk',
      ctx: { seed: 8, bpm: 112, complexity: { rhythmic: 1 } },
      difficulty: 1,
    });
    expect(free.length).toBeGreaterThan(capped.length);
    // What survives the ceiling is the plain root of each chord, not a
    // half-remembered version of the figure.
    expect(capped).toHaveLength(TIMELINE.length);
  });

  it('plays fewer figures as the density falls', () => {
    const sparse = placeLicks(TIMELINE, KEY, {
      genre: 'blues',
      ctx: { seed: 4, bpm: 120, complexity: { rhythmic: 0 } },
    });
    const busy = placeLicks(TIMELINE, KEY, {
      genre: 'blues',
      ctx: { seed: 4, bpm: 120, complexity: { rhythmic: 1 } },
    });
    expect(sparse).toHaveLength(TIMELINE.length);
    expect(busy.length).toBeGreaterThan(sparse.length);
  });

  it('plays every bar of a chord that lasts longer than a figure', () => {
    // A ballad or a modal vamp holds one chord for four bars. The figure is a
    // bar long, so the rest of the segment was one held note before: the line
    // stopped and the note it stopped on was written as a twelve-beat ornament.
    const vamp = [{ startBeat: 0, endBeat: 16, chord: makeChord(0, 'maj7') }];
    for (const genre of ['motown', 'soul', 'jazz', 'country'] as const) {
      const notes = placeLicks(vamp, KEY, {
        genre,
        ctx: { seed: 3, bpm: 100, complexity: { rhythmic: 1 } },
      });
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
      const omitted = placeLicks(TIMELINE, KEY, { genre, ctx: { seed: 4, bpm: 100 } });
      const explicit = placeLicks(TIMELINE, KEY, {
        genre,
        ctx: { seed: 4, bpm: 100, complexity: { rhythmic: 0.6 } },
      });
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
    const notes = placeLicks(TIMELINE, KEY, {
      genre: 'jazz',
      ctx: { seed: 1, bpm: 140, complexity: { rhythmic: 0 } },
    });
    // With no figures taken every segment is a root, so the connecting tones are
    // the only other notes that can appear.
    expect(notes.length).toBeGreaterThanOrEqual(TIMELINE.length);
  });

  it('keeps the line inside the requested register', () => {
    for (const octave of [1, 2, 3]) {
      const notes = placeLicks(TIMELINE, KEY, {
        genre: 'gospel',
        ctx: { seed: 6, bpm: 84 },
        octave,
      });
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
    const notes = placeLicks(TIMELINE, KEY, {
      genre: 'funk',
      ctx: { seed: 8, bpm: 100, complexity: { rhythmic: 1 } },
    });
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
    const line = generateBassLine({
      segments: TIMELINE,
      key: KEY,
      style: 'walking',
      ctx: { seed: 1 },
    });
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
      ctx: { seed: 1, bpm: 90, vocabulary: [ownLick], complexity: { rhythmic: 1 } },
    });
    expect(notes.length).toBeGreaterThan(TIMELINE.length);
    // Without the caller's dictionary the genre has nothing, so every segment
    // falls back to its root.
    const bare = placeLicks(TIMELINE, KEY, {
      genre: 'hiphop',
      ctx: { seed: 1, bpm: 90, complexity: { rhythmic: 1 } },
    });
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
      ctx: { seed: 1, bpm: 120, vocabulary: [replacement], complexity: { rhythmic: 1 } },
    });
    // Root and fifth: the caller's figure, not the four-note built-in it took
    // the name of. At a full dial the fifth is also anticipated, which is the
    // same note a sixteenth earlier rather than a note the built-in supplied.
    expect(notes.map((note) => note.pitch % 12)).toEqual([0, 7, 7]);
    // Everything above the figure's own notes is the dial adding to it, so a
    // quieter setting is a subset of this one rather than a different figure.
    const quieter = placeLicks([FIRST_SPAN], KEY, {
      genre: 'country',
      ctx: { seed: 1, bpm: 120, vocabulary: [replacement], complexity: { rhythmic: 0.8 } },
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

describe('the meter a lick is shaped against', () => {
  // A compound bar and a four-four bar accent different sixteenths, so a figure
  // shaped against the wrong one pushes into a beat the piece does not feel. In
  // 6/8 the second pulse is beat 1.5, and an anticipation belongs a sixteenth
  // before it; a four-four reading of the same span accents beat 2 instead.
  const sixEight: TimeSignature = { numerator: 6, denominator: 8, grouping: [3, 3] };
  const fourFour: TimeSignature = { numerator: 4, denominator: 4 };

  const runningEighths = (ts: TimeSignature): Vocabulary<unknown> => ({
    id: 'countryAlternating',
    genre: 'country',
    difficulty: 1,
    articulations: [],
    ts,
    material: {
      lengthSteps: 12,
      notes: [0, 2, 4, 6, 8, 10].map((step, index) => ({
        degree: index % 2 === 0 ? 1 : 5,
        step,
        velocity: step === 0 ? 1 : 0.8,
      })),
    },
    provenance: { basis: 'construction', note: 'written for this test from its own grid' },
  });

  const spans = [{ startBeat: 0, endBeat: 3, chord: makeChord(0, 'maj') }];

  const shape = (ts: TimeSignature) =>
    placeLicks(spans, KEY, {
      genre: 'country',
      ts,
      ctx: {
        seed: 5,
        bpm: 100,
        vocabulary: [runningEighths(ts)],
        complexity: { rhythmic: 0.7 },
      },
    }).map((note) => note.startBeat);

  it('pushes into a pulse of its own bar rather than a beat of another', () => {
    expect(shape(sixEight)).toContain(1.25);
    expect(shape(sixEight)).not.toContain(1.75);
  });

  it('writes a four-four figure exactly as it did', () => {
    const inFour = placeLicks(TIMELINE, KEY, { genre: 'country', ctx: { seed: 7, bpm: 120 } });
    const named = placeLicks(TIMELINE, KEY, {
      genre: 'country',
      ts: fourFour,
      ctx: { seed: 7, bpm: 120 },
    });
    expect(named).toEqual(inFour);
  });
});

describe('a figure asks the chord for a degree the chord states', () => {
  // "Which degree is this interval" was answered three ways in this module, and
  // the loosest of them folded six, seven and eight onto the fifth. A chord's
  // own flat thirteenth sits eight semitones above the root, so a figure asking
  // for the thirteenth matched nothing, fell through to the key, and played a
  // tone the chord had already contradicted.

  const SIXTEENTH = 0.25;

  /** A one-bar figure asking for a single degree, as a caller's own vocabulary. */
  function figureOn(degree: number, alter = 0): Vocabulary<LickMaterial> {
    return {
      id: `degree${degree}`,
      genre: 'jazz',
      difficulty: 1,
      articulations: [],
      ts: { numerator: 4, denominator: 4 },
      material: { lengthSteps: 16, notes: [{ degree, step: 0, velocity: 1, alter }] },
      provenance: { basis: 'idiom', note: 'a single degree, to read what the chord answers' },
    };
  }

  /** The pitch class the figure sounded over `chord`. */
  function sounded(figure: Vocabulary<LickMaterial>, chord: ReturnType<typeof makeChord>): number {
    const notes = placeLicks([{ startBeat: 0, endBeat: 4, chord }], KEY, {
      genre: 'jazz',
      difficulty: 5,
      ctx: { seed: 0, bpm: 120, complexity: { rhythmic: 1 }, vocabulary: [figure] },
    });
    const first = notes.find((note) => Math.abs(note.startBeat) < SIXTEENTH);
    return (((first?.pitch ?? Number.NaN) % 12) + 12) % 12;
  }

  it('plays the flat thirteenth a chord states rather than the key’s own sixth', () => {
    // C7b13 sounds A flat. The key is C major, whose sixth degree is A, so the
    // two answers differ by a semitone and the wrong one is audible.
    const chord = makeChord(0, '7b13');
    expect(chordPitchClasses(chord)).toContain(8);
    expect(sounded(figureOn(13), chord)).toBe(8);
  });

  it('plays the diminished fifth of a chord that has one', () => {
    // The same reading the other way: a flattened fifth with no perfect fifth
    // beside it is the chord's fifth, and asking for degree five must find it.
    expect(sounded(figureOn(5), makeChord(0, 'dim'))).toBe(6);
  });

  it('does not read a sharp eleventh as the chord’s fifth', () => {
    // Six semitones alongside a perfect fifth is a sharp eleventh, so degree
    // five is the perfect fifth the chord actually states.
    expect(sounded(figureOn(5), makeChord(0, 'maj7#11'))).toBe(7);
  });
});
