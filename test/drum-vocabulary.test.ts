import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import { resolveContext } from '../src/generate/context/index.js';
import {
  FILL_ARCHETYPES,
  FILL_TYPES,
  type FillArchetype,
  isFillArchetype,
  selectFillType,
} from '../src/generate/drums/fills.js';
import { DRUM_NOTES } from '../src/generate/drums/hit.js';
import type { DrumsOptions, GrooveStyle, Section } from '../src/generate/drums/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { getKickPattern, KICK_FIGURES, KICK_STEPS } from '../src/generate/drums/kick.js';
import {
  DRUM_PATTERNS,
  isDrumPattern,
  placeDrumPattern,
} from '../src/generate/drums/vocabulary.js';
import { GENRES, type Vocabulary } from '../src/generate/vocabulary/index.js';

const STYLES: GrooveStyle[] = [
  'standard',
  'funk',
  'shuffle',
  'bossa',
  'trap',
  'halftime',
  'breakbeat',
  'house',
  'synthpop',
];
const SECTIONS: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];

/**
 * Digest of the whole style x section x nextSection x density matrix, fills
 * included. It pins the generated groove itself: a refactor that was meant to
 * move code rather than notes shows up here, and a change of the notes has to
 * be made deliberately by re-pinning it.
 *
 * It last moved when the ghost snares began following the voice the backbeat is
 * struck on and the ornament dial alone, in every section; when the broken
 * backbeat kick of the breakbeat figure became part of the figure rather than a
 * chorus slot; when a phrase end kept the onsets its style states outright; and
 * when a fill widened by one beat per step of section energy, so the pickup
 * beats every archetype is written with are played at a peak.
 */
function grooveDigest(): string {
  const hash = createHash('sha256');
  for (const style of STYLES) {
    for (const section of SECTIONS) {
      for (const nextSection of SECTIONS) {
        for (const density of [0.2, 0.55, 0.9]) {
          const opts: DrumsOptions = {
            bars: 4,
            ctx: { bpm: 128, complexity: { rhythmic: density }, seed: 11 },
            style,
            section,
            nextSection,
            fills: true,
          };
          for (const hit of generateDrums(opts)) {
            hash.update(
              `${style}|${section}|${nextSection}|${density}|${hit.pitch}|${hit.startBeat}|${hit.durationBeat}|${hit.velocity}|${hit.articulation ?? ''}\n`,
            );
          }
        }
      }
    }
  }
  return hash.digest('hex');
}

/** Digest of every fill selection across the transition contexts. */
function fillDigest(): string {
  const hash = createHash('sha256');
  const froms: Parameters<typeof selectFillType>[0][] = ['intro', 'a', 'b', 'chorus', 'bridge'];
  const tos: Parameters<typeof selectFillType>[1][] = ['chorus', 'a', 'outro', 'b'];
  const styles: Parameters<typeof selectFillType>[2][] = [
    'sparse',
    'standard',
    'rock',
    'fourOnFloor',
    'upbeat',
    'synth',
    'trap',
    'latin',
  ];
  const energies: Parameters<typeof selectFillType>[3][] = ['low', 'medium', 'high', 'peak'];
  for (const from of froms) {
    for (const to of tos) {
      for (const style of styles) {
        for (const energy of energies) {
          for (let seed = 0; seed < 32; seed += 1) {
            const fill = selectFillType(
              from,
              to,
              style,
              energy,
              resolveContext(seed).part('drums'),
              seed % 4,
            );
            hash.update(fill ?? '');
            hash.update('|');
          }
        }
      }
    }
  }
  return hash.digest('hex');
}

describe('one onset per voice and position', () => {
  it('writes no voice twice at one position at a doubled rate', () => {
    // A vocabulary of continuous sixteenths — the closed hi-hat of funk, the
    // shaker of samba — halves two of them onto every step, and a drum struck
    // twice at one instant is a pair of note-ons rather than a louder stroke.
    for (const genre of GENRES) {
      for (const rate of ['straight', 'half', 'double'] as const) {
        const hits = placeDrumPattern({ bars: 2, genre, rate });
        const seen = new Set<string>();
        for (const hit of hits) {
          const key = `${genre}/${rate} ${hit.pitch}@${hit.startBeat}`;
          expect(seen.has(key), key).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('keeps a doubled figure as dense as the dictionary wrote it', () => {
    // Merging the pairs must not empty the bar: the compressed figure still
    // states the genre.
    for (const genre of ['funk', 'samba'] as const) {
      const hits = placeDrumPattern({ bars: 1, genre, rate: 'double' });
      expect(hits.length, genre).toBeGreaterThan(16);
    }
  });
});

describe('moving the drum vocabulary into data', () => {
  it('pins every generated groove', () => {
    expect(grooveDigest()).toBe('467887cfc8083be17c10c42098db9e4964b97da61413ba7b6feb240fb466963d');
  });

  it('leaves every fill selection exactly as it was', () => {
    expect(fillDigest()).toBe('64a71488600be2a90ca0e16d209b44ece77a02fdec1cb4675a97bbf9bbb508fd');
  });

  it('holds all thirteen archetypes as data the generator only looks up', () => {
    expect(FILL_TYPES).toHaveLength(13);
    for (const id of FILL_TYPES) {
      const shape = FILL_ARCHETYPES[id];
      expect(shape.atBeat).toHaveLength(4);
      expect(shape.atBeat.flat().length).toBeGreaterThan(0);
    }
  });

  it('holds a kick figure for every internal style', () => {
    for (const figure of Object.values(KICK_FIGURES)) {
      expect(figure.length).toBeGreaterThan(0);
      for (const slot of figure) {
        expect(slot.step).toBeGreaterThanOrEqual(0);
        expect(slot.step).toBeLessThan(KICK_STEPS);
      }
    }
  });
});

describe('the sixteenth kick grid', () => {
  const draw = resolveContext(3).part('drums');

  it('is sixteen steps wide', () => {
    expect(getKickPattern('chorus', 'rock', 0, draw, 0.5)).toHaveLength(16);
  });

  it('puts the eighth-note patterns on the even steps', () => {
    const pattern = getKickPattern('a', 'standard', 0, draw, 0.5);
    expect(pattern[0]).toBe(true);
    expect(pattern[8]).toBe(true);
    // Nothing lands on an odd sixteenth: the inherited figures are eighth-note
    // figures, and moving the grid under them did not move them.
    expect(pattern.filter((on, step) => on && step % 2 === 1)).toEqual([]);
  });

  it('can express a kick a sixteenth grid was needed for', () => {
    const funk = DRUM_PATTERNS.find((entry) => entry.id === 'funkSixteenth');
    const odd = funk?.material.strokes.filter(
      (stroke) => stroke.voice === 'kick' && stroke.step % 2 === 1,
    );
    expect(odd?.length).toBeGreaterThan(0);
  });
});

describe('the drum pattern dictionary', () => {
  it('names a genre-characteristic pattern for each genre it covers', () => {
    const ids = DRUM_PATTERNS.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'motownBackbeat',
        'halfTimeShuffle',
        'bossaNova',
        'samba',
        'gospelPocket',
        'drumAndBassBreak',
      ]),
    );
  });

  it('records the ground every entry qualifies on', () => {
    for (const entry of DRUM_PATTERNS) {
      expect(['idiom', 'construction', 'traditional']).toContain(entry.provenance.basis);
      expect(entry.provenance.note.length).toBeGreaterThan(10);
      expect(GENRES).toContain(entry.genre);
      expect(entry.difficulty).toBeGreaterThanOrEqual(1);
      expect(entry.difficulty).toBeLessThanOrEqual(5);
    }
  });

  it('generates the same groove for the same seed', () => {
    const opts = { bars: 4, genre: 'motown' as const, ctx: { seed: 5, bpm: 120 } };
    expect(placeDrumPattern(opts)).toEqual(placeDrumPattern(opts));
  });

  it('emits valid hits in onset order', () => {
    const hits = placeDrumPattern({ bars: 2, genre: 'funk', ctx: { seed: 2, bpm: 100 } });
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i]?.startBeat).toBeGreaterThanOrEqual(hits[i - 1]?.startBeat ?? 0);
    }
    for (const hit of hits) {
      expect(hit.velocity).toBeGreaterThanOrEqual(1);
      expect(hit.velocity).toBeLessThanOrEqual(127);
      expect(hit.startBeat).toBeLessThan(8);
    }
  });

  it('lets genre choose the material and nothing else', () => {
    const bossa = placeDrumPattern({ bars: 1, genre: 'bossa', ctx: { seed: 1, bpm: 130 } });
    const samba = placeDrumPattern({ bars: 1, genre: 'samba', ctx: { seed: 1, bpm: 130 } });
    expect(bossa.some((h) => h.pitch === DRUM_NOTES.sideStick)).toBe(true);
    expect(samba.some((h) => h.pitch === DRUM_NOTES.shaker)).toBe(true);
    expect(bossa).not.toEqual(samba);
  });

  it('offers nothing outside the tempo band a pattern states', () => {
    // The drum'n'bass break states 160..180; at 90 nothing in that genre fits.
    expect(placeDrumPattern({ bars: 2, genre: 'dnb', ctx: { seed: 1, bpm: 90 } })).toEqual([]);
    expect(
      placeDrumPattern({ bars: 2, genre: 'dnb', ctx: { seed: 1, bpm: 174 } }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a figure the ceiling cannot carry rather than simplifying it', () => {
    const hard = placeDrumPattern({ bars: 2, genre: 'funk', ctx: { seed: 4, bpm: 110 } });
    const easy = placeDrumPattern({
      bars: 2,
      genre: 'funk',
      ctx: { seed: 4, bpm: 110, complexity: { difficulty: 1 } },
    });
    expect(hard.length).toBeGreaterThan(0);
    expect(easy).toEqual([]);
  });

  it('deforms with the complexity dials without changing the dictionary', () => {
    const written = DRUM_PATTERNS.find((e) => e.id === 'gospelPocket')?.material.strokes.length;
    const thinned = placeDrumPattern({
      bars: 1,
      genre: 'gospel',
      ctx: { seed: 3, bpm: 88, complexity: { rhythmic: 0 } },
    });
    const full = placeDrumPattern({
      bars: 1,
      genre: 'gospel',
      ctx: { seed: 3, bpm: 88, complexity: { rhythmic: 0.5 } },
    });
    expect(thinned.length).toBeLessThan(full.length);
    expect(DRUM_PATTERNS.find((e) => e.id === 'gospelPocket')?.material.strokes.length).toBe(
      written,
    );
  });

  it('keeps more ghosts as the ornament dial rises', () => {
    const at = (ornament: number) =>
      placeDrumPattern({
        bars: 1,
        genre: 'gospel',
        ctx: { seed: 9, bpm: 88, complexity: { ornament } },
      }).filter((hit) => hit.articulation === 'ghost').length;
    expect(at(0)).toBe(0);
    expect(at(1)).toBeGreaterThan(at(0));
  });

  it('plays the same figure at half and double rate on request', () => {
    const straight = placeDrumPattern({ bars: 1, genre: 'motown', ctx: { seed: 6, bpm: 120 } });
    const halved = placeDrumPattern({
      bars: 1,
      genre: 'motown',
      rate: 'half',
      ctx: { seed: 6, bpm: 120 },
    });
    expect(halved).not.toEqual(straight);
    expect(halved.length).toBeLessThanOrEqual(straight.length);
  });

  it('reaches the triplet feel an entry says is applied at render', () => {
    // The half-time shuffle is written on the straight sixteenth grid and is
    // only itself once the feel is applied, which its provenance says outright.
    // Without a way to ask for that from the surface that renders it, the entry
    // ships as something it says it is not.
    const straight = placeDrumPattern({ bars: 1, genre: 'blues', ctx: { seed: 2, bpm: 88 } });
    const shuffled = placeDrumPattern({
      bars: 1,
      genre: 'blues',
      feel: 'shuffle',
      ctx: { seed: 2, bpm: 88 },
    });
    expect(shuffled).not.toEqual(straight);
    const offBeats = shuffled.map((hit) => hit.startBeat % 1).filter((f) => f > 0.4 && f < 0.72);
    expect(offBeats.length).toBeGreaterThan(0);
    for (const frac of offBeats) {
      expect(frac).toBeCloseTo(2 / 3, 6);
    }
    // The two options are different questions: one changes the note values, the
    // other where they land.
    const halved = placeDrumPattern({
      bars: 1,
      genre: 'blues',
      rate: 'half',
      ctx: { seed: 2, bpm: 88 },
    });
    expect(halved).not.toEqual(shuffled);
  });

  it('answers the rhythmic dial in every genre it ships a figure for', () => {
    // Blocking anticipation on another voice's onset made the upper half of the
    // dial do nothing at all — byte for byte — in four of the built-in genres.
    expect(DRUM_PATTERNS.length).toBeGreaterThan(5);
    for (const entry of DRUM_PATTERNS) {
      // Inside the band the entry itself states, so every figure is reachable.
      const [low, high] = entry.tempoRange ?? [110, 110];
      const bpm = (low + high) / 2;
      const at = (rhythmic: number) =>
        JSON.stringify(
          placeDrumPattern({
            bars: 2,
            genre: entry.genre,
            ctx: { seed: 1, bpm, complexity: { rhythmic } },
          }),
        );
      expect(at(0.5), `${entry.id} plays nothing at ${bpm}`).not.toBe('[]');
      expect(at(1), `${entry.id} ignores the top of the dial`).not.toBe(at(0.5));
    }
  });
});

describe('a caller-supplied drum dictionary', () => {
  const clave: Vocabulary<unknown> = {
    id: 'callerClave',
    genre: 'reggae',
    difficulty: 1,
    articulations: [],
    material: {
      steps: 16,
      strokes: [
        { voice: 'sideStick', step: 0, velocity: 0.9 },
        { voice: 'sideStick', step: 6, velocity: 0.9 },
        { voice: 'kick', step: 8, velocity: 1 },
      ],
    },
    provenance: { basis: 'construction', note: 'written for this test from its own grid' },
  };

  it('recognises drum material by its shape', () => {
    expect(isDrumPattern(clave.material)).toBe(true);
    expect(isDrumPattern({ lengthSteps: 16, notes: [] })).toBe(false);
    expect(isFillArchetype(clave.material)).toBe(false);
  });

  it('reaches a genre the library ships nothing for', () => {
    const hits = placeDrumPattern({
      bars: 1,
      genre: 'reggae',
      ctx: { seed: 1, bpm: 80, vocabulary: [clave] },
    });
    expect(hits.map((h) => h.startBeat)).toEqual([0, 1.5, 2]);
    // Without the caller's dictionary the library has nothing to say here.
    expect(placeDrumPattern({ bars: 1, genre: 'reggae', ctx: { seed: 1, bpm: 80 } })).toEqual([]);
  });

  it('replaces a built-in when it reuses the id', () => {
    const replacement: Vocabulary<unknown> = { ...clave, id: 'bossaNova', genre: 'bossa' };
    const hits = placeDrumPattern({
      bars: 1,
      genre: 'bossa',
      ctx: { seed: 1, bpm: 130, vocabulary: [replacement] },
    });
    expect(hits).toHaveLength(3);
  });

  it('offers a caller fill to generateDrums without moving the built-in choices', () => {
    const fill: Vocabulary<unknown> = {
      id: 'callerFill',
      genre: 'rock',
      difficulty: 1,
      articulations: [],
      material: {
        atBeat: [
          [],
          [],
          [],
          [{ voice: DRUM_NOTES.lowTom, offset: 0, duration: 1, velocity: { base: 'accent' } }],
        ],
      } satisfies FillArchetype,
      provenance: { basis: 'construction', note: 'written for this test from its own grid' },
    };
    const base: DrumsOptions = {
      bars: 2,
      ctx: { bpm: 120, seed: 4 },
      style: 'standard',
      section: 'verse',
      fills: true,
    };
    const withCaller = generateDrums({ ...base, ctx: { seed: 4, bpm: 120, vocabulary: [fill] } });
    expect(withCaller.length).toBeGreaterThan(0);
    // The built-in output is untouched when the caller brings nothing.
    expect(generateDrums({ ...base, ctx: { seed: 4, bpm: 120 } })).toEqual(generateDrums(base));
  });

  it('gives a caller fill that reuses a built-in id the built-in weight, not both', () => {
    // Reusing an id is a replacement everywhere else in the vocabulary model:
    // the material is read through the caller's map wherever the table names
    // it, so offering it again as an extra candidate would hand that one fill a
    // weight no other entry has and let it dominate the phrase ends.
    const draw = resolveContext(5).part('drums');
    for (let bar = 0; bar < 16; bar += 1) {
      const plain = selectFillType('a', 'chorus', 'standard', 'high', draw, bar);
      const collided = selectFillType('a', 'chorus', 'standard', 'high', draw, bar, ['snareRoll']);
      expect(collided, `bar ${bar}`).toBe(plain);
    }
    // An id the library does not carry is an addition, and does change the odds.
    const added = new Set<string | undefined>();
    for (let bar = 0; bar < 16; bar += 1) {
      added.add(selectFillType('a', 'chorus', 'standard', 'high', draw, bar, ['callerFill']));
    }
    expect(added.has('callerFill')).toBe(true);
  });

  it('refuses a caller entry whose difficulty is off the scale', () => {
    expect(() =>
      placeDrumPattern({
        bars: 1,
        genre: 'reggae',
        ctx: { seed: 1, bpm: 80, vocabulary: [{ ...clave, difficulty: 40 }] },
      }),
    ).toThrow();
  });
});

describe('the built-in drum dictionaries are one object for the whole process', () => {
  it('holds every entry and every stroke frozen', () => {
    for (const entry of DRUM_PATTERNS) {
      expect(Object.isFrozen(entry), entry.id).toBe(true);
      expect(Object.isFrozen(entry.material), entry.id).toBe(true);
      expect(Object.isFrozen(entry.material.strokes), entry.id).toBe(true);
      for (const stroke of entry.material.strokes) {
        expect(Object.isFrozen(stroke), `${entry.id} step ${stroke.step}`).toBe(true);
      }
    }
    for (const [style, figure] of Object.entries(KICK_FIGURES)) {
      expect(Object.isFrozen(figure), style).toBe(true);
      for (const slot of figure) {
        expect(Object.isFrozen(slot), `${style} step ${slot.step}`).toBe(true);
      }
    }
    for (const [id, archetype] of Object.entries(FILL_ARCHETYPES)) {
      expect(Object.isFrozen(archetype), id).toBe(true);
      for (const beat of archetype.atBeat) {
        expect(Object.isFrozen(beat), id).toBe(true);
        for (const stroke of beat) {
          expect(Object.isFrozen(stroke), id).toBe(true);
          expect(Object.isFrozen(stroke.velocity), id).toBe(true);
        }
      }
    }
  });

  it('refuses a caller edit to an entry rather than keeping it for the process', () => {
    const first = DRUM_PATTERNS[0];
    if (!first) {
      throw new Error('the dictionary is empty');
    }
    const id = first.id;
    expect(() => {
      (first as { id: string }).id = 'hijacked';
    }).toThrow(TypeError);
    expect(() => {
      first.material.strokes.push({ voice: 'kick', step: 1, velocity: 1 });
    }).toThrow(TypeError);
    expect(DRUM_PATTERNS[0]?.id).toBe(id);
  });
});

describe('the meter a drum figure is written in', () => {
  /** A one-bar figure written in 3/4, twelve sixteenths to the bar. */
  const waltz: Vocabulary<unknown> = {
    id: 'callerWaltz',
    genre: 'rock',
    difficulty: 1,
    articulations: [],
    ts: { numerator: 3, denominator: 4 },
    material: {
      steps: 12,
      strokes: [
        { voice: 'kick', step: 0, velocity: 1 },
        { voice: 'snare', step: 4, velocity: 0.9 },
        { voice: 'snare', step: 8, velocity: 0.9 },
      ],
    },
    provenance: { basis: 'construction', note: 'written for this test from its own grid' },
  };

  it('refuses a meter no figure is written in rather than answering with silence', () => {
    // The built-in dictionary is written in 4/4 throughout, so a three-beat bar
    // has nothing to place. An empty track would read as "the dials rejected
    // every candidate", which is a different answer.
    expect(() => placeDrumPattern({ bars: 4, genre: 'bossa', ts: '3/4' })).toThrow(
      /no figure is written in/,
    );
    expect(() => placeDrumPattern({ bars: 4, genre: 'bossa', ts: '6/8' })).toThrow(
      InvalidInputError,
    );
  });

  it("places a figure supplied in another meter on that meter's bars", () => {
    const hits = placeDrumPattern({
      bars: 2,
      genre: 'rock',
      ts: '3/4',
      ctx: { seed: 1, bpm: 100, vocabulary: [waltz] },
    });
    // Three-beat bars: the second bar of the figure starts on beat 3, not 4.
    expect(hits.map((hit) => hit.startBeat)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('swings every bar of an odd meter the same way', () => {
    // A 7/8 bar is three and a half quarter notes, so every other bar begins
    // half a beat into one. Swinging the absolute position takes the offset
    // inside a quarter note, and that offset is not the offset inside the bar:
    // the downbeat of the odd bars was warped and their offbeats came out
    // straight, alternating bar by bar with no error to say so.
    const seven: Vocabulary<unknown> = {
      ...waltz,
      id: 'callerSeven',
      ts: { numerator: 7, denominator: 8 },
      material: {
        steps: 14,
        strokes: [
          { voice: 'kick', step: 0, velocity: 1 },
          { voice: 'snare', step: 2, velocity: 0.9 },
          { voice: 'snare', step: 6, velocity: 0.9 },
        ],
      },
    };
    const hits = placeDrumPattern({
      bars: 4,
      genre: 'rock',
      ts: '7/8',
      feel: 'shuffle',
      ctx: { seed: 1, bpm: 100, vocabulary: [seven] },
    });
    expect(hits.length).toBeGreaterThan(0);
    const barBeats = 3.5;
    // Where each bar's strokes sit inside their own bar. Every bar of a
    // repeated one-bar figure has to answer the same list, or the groove
    // alternates bar by bar with nothing to say so.
    const byBar = new Map<number, number[]>();
    for (const hit of hits) {
      const bar = Math.floor(hit.startBeat / barBeats + 1e-9);
      const within = Math.round((hit.startBeat - bar * barBeats) * 1e6) / 1e6;
      byBar.set(bar, [...(byBar.get(bar) ?? []), within]);
    }
    expect(byBar.size).toBe(4);
    const first = byBar.get(0) ?? [];
    // The bar line is never moved, whatever the swing.
    expect(first[0]).toBe(0);
    // And the swing did something, or the bars agree for the wrong reason.
    expect(first.some((within) => !Number.isInteger(within * 2))).toBe(true);
    for (const [bar, offsets] of byBar) {
      expect(offsets, `bar ${bar}`).toEqual(first);
    }
  });

  it('thins a figure against the bar it is written in', () => {
    // Below the neutral dial the figure is thinned by how much of the metre
    // each position carries. In 3/4 the beat-2 stroke is a plain main pulse and
    // goes; a 4/4 reading would rank it as the middle of the bar and keep it.
    const hits = placeDrumPattern({
      bars: 2,
      genre: 'rock',
      ts: '3/4',
      ctx: { seed: 1, bpm: 100, vocabulary: [waltz], complexity: { rhythmic: 0.15 } },
    });
    expect(hits.map((hit) => hit.startBeat)).toEqual([0, 3]);
  });

  it('writes the 4/4 dictionary exactly as it did', () => {
    // The meter a figure is ranked against is the one it is placed in, and the
    // built-in figures are placed in the meter they are written in.
    const hits = placeDrumPattern({ bars: 2, genre: 'bossa', ctx: { seed: 7, bpm: 130 } });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(placeDrumPattern({ bars: 2, genre: 'bossa', ctx: { seed: 7, bpm: 130 } }));
    for (const hit of hits) {
      expect(hit.startBeat).toBeLessThan(8);
    }
  });
});
