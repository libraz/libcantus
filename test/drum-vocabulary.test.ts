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
 * included. Pinned before the vocabulary was moved out of the generators'
 * control flow, so the move can be shown to have changed nothing.
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
  it('leaves every generated groove exactly as it was', () => {
    expect(grooveDigest()).toBe('ecc01e2324a7197efb053f3d528bd362d481e297e1b6922b54c364f3d13b0524');
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
      feel: 'half',
      ctx: { seed: 6, bpm: 120 },
    });
    expect(halved).not.toEqual(straight);
    expect(halved.length).toBeLessThanOrEqual(straight.length);
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
