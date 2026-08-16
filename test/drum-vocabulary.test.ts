import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
 * It last moved when a named feel stopped being halved on its way to the grid —
 * a shuffle is the triplet it is named for — and when the stroke a fill lands on
 * was lifted above the backbeats around it.
 */
function grooveDigest(): string {
  const hash = createHash('sha256');
  for (const style of STYLES) {
    for (const section of SECTIONS) {
      for (const nextSection of SECTIONS) {
        for (const density of [0.2, 0.55, 0.9]) {
          const opts: DrumsOptions = {
            bars: 4,
            bpm: 128,
            style,
            section,
            nextSection,
            density,
            seed: 11,
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
            hash.update(
              selectFillType(from, to, style, energy, resolveContext(seed).part('drums'), seed % 4),
            );
            hash.update('|');
          }
        }
      }
    }
  }
  return hash.digest('hex');
}

describe('moving the drum vocabulary into data', () => {
  it('pins every generated groove', () => {
    expect(grooveDigest()).toBe('a35ae5c8fa4e0bf60ab44a01a7750933f159b54f8505479875ce08fc1e4f5b06');
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
      bpm: 120,
      style: 'standard',
      section: 'verse',
      fills: true,
      seed: 4,
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
