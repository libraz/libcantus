import { describe, expect, it } from 'vitest';
import { resolveContext } from '../src/generate/context/index.js';
import { euclideanRhythm } from '../src/generate/drums/euclid.js';
import {
  type FillArchetype,
  type FillType,
  generateFill,
  getFillStartBeat,
  selectFillType,
} from '../src/generate/drums/fills.js';
import { DRUM_NOTES, HitList } from '../src/generate/drums/hit.js';
import type {
  DrumRole,
  DrumsOptions,
  GrooveFeel,
  GrooveStyle,
  Section,
} from '../src/generate/drums/index.js';
import { generateDrums } from '../src/generate/drums/index.js';

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

/** General MIDI percussion notes the drum engine is allowed to emit. */
const GM_PITCHES = new Set([36, 38, 37, 39, 42, 44, 46, 49, 51, 54, 50, 47, 45, 82]);
const SECTIONS: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
const FEELS: GrooveFeel[] = ['straight', 'swing', 'shuffle'];
const ROLES: DrumRole[] = ['full', 'ambient', 'minimal', 'fxOnly'];

describe('generateDrums coverage matrix', () => {
  it('produces valid hits across every style and section', () => {
    for (const style of STYLES) {
      for (const section of SECTIONS) {
        for (const density of [0.2, 0.55, 0.9]) {
          const opts: DrumsOptions = {
            bars: 4,
            ctx: { bpm: 128, complexity: { rhythmic: density }, seed: 11 },
            style,
            section,
            fills: true,
          };
          const hits = generateDrums(opts);
          for (const h of hits) {
            expect(h.pitch).toBeGreaterThanOrEqual(35);
            expect(h.pitch).toBeLessThanOrEqual(82);
            expect(h.velocity).toBeGreaterThanOrEqual(1);
            expect(h.velocity).toBeLessThanOrEqual(127);
            expect(h.startBeat).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('suppresses kick and snare voices under fxOnly', () => {
    const KICK = 36;
    const SNARE = 38;
    for (const style of STYLES) {
      for (const section of SECTIONS) {
        const hits = generateDrums({
          bars: 4,
          ctx: { bpm: 120, complexity: { rhythmic: 0.8 }, seed: 7 },
          style,
          section,
          role: 'fxOnly',
          fills: true,
        });
        expect(hits.some((h) => h.pitch === KICK)).toBe(false);
        expect(hits.some((h) => h.pitch === SNARE)).toBe(false);
      }
    }
  });

  it('covers every feel, role, and tempo band', () => {
    for (const feel of FEELS) {
      for (const role of ROLES) {
        for (const bpm of [88, 120, 165]) {
          const opts: DrumsOptions = {
            bars: 2,
            ctx: { bpm: bpm, complexity: { rhythmic: 0.8 }, seed: 4 },
            style: 'funk',
            section: 'chorus',
            feel,
            role,
          };
          expect(generateDrums(opts)).toEqual(generateDrums(opts));
        }
      }
    }
  });
});

describe('euclid', () => {
  it('distributes pulses evenly', () => {
    expect(euclideanRhythm(3, 8)).toEqual([true, false, false, true, false, false, true, false]);
    expect(euclideanRhythm(4, 16).filter(Boolean)).toHaveLength(4);
    expect(euclideanRhythm(0, 4)).toEqual([false, false, false, false]);
    expect(euclideanRhythm(4, 4)).toEqual([true, true, true, true]);
  });

  it('names the pattern of the standard euclidean rhythms', () => {
    // E(5,8), the Cuban cinquillo, and E(5,16), a common trap kick.
    expect(euclideanRhythm(5, 8)).toEqual([true, false, true, true, false, true, true, false]);
    expect(euclideanRhythm(2, 5)).toEqual([true, false, true, false, false]);
    expect(euclideanRhythm(7, 16).filter(Boolean)).toHaveLength(7);
  });

  it('rotates onsets forward by the given number of steps', () => {
    // A rotation moves each onset later by `rotation` steps, wrapping around;
    // asserting only that the array changed would pass for either direction.
    const base = euclideanRhythm(3, 8);
    const rotated = euclideanRhythm(3, 8, 2);
    expect(rotated.filter(Boolean)).toHaveLength(3);
    for (let step = 0; step < base.length; step += 1) {
      expect(rotated[(step + 2) % base.length], `step ${step}`).toBe(base[step]);
    }
    expect(euclideanRhythm(3, 8, 8)).toEqual(base);
    expect(euclideanRhythm(3, 8, -2)).toEqual(euclideanRhythm(3, 8, 6));
  });

  it('drives the kick from a euclidean option in generateDrums', () => {
    const opts: DrumsOptions = {
      bars: 2,
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 3 },
      style: 'standard',
      section: 'verse',
    };
    // A default standard verse kicks only on beats 1 and 3.
    const defaultKicks = generateDrums(opts)
      .filter((h) => h.pitch === 36)
      .map((h) => h.startBeat % 4);
    expect(new Set(defaultKicks)).toEqual(new Set([0, 2]));

    // pulses=4 over 16 steps spreads onsets to all four downbeats.
    const euclid = generateDrums({ ...opts, euclideanKick: { pulses: 4, steps: 16 } });
    const euclidKicks = euclid.filter((h) => h.pitch === 36).map((h) => h.startBeat % 4);
    expect(new Set(euclidKicks)).toEqual(new Set([0, 1, 2, 3]));

    // Determinism holds with the euclidean option applied.
    expect(
      generateDrums({ ...opts, euclideanKick: { pulses: 5, steps: 16, rotation: 1 } }),
    ).toEqual(generateDrums({ ...opts, euclideanKick: { pulses: 5, steps: 16, rotation: 1 } }));
  });

  it('scales Euclidean steps across the whole bar', () => {
    const hits = generateDrums({
      bars: 1,
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 } },
      style: 'standard',
      section: 'verse',
      euclideanKick: { pulses: 4, steps: 8 },
    });
    expect(hits.filter((hit) => hit.pitch === 36).map((hit) => hit.startBeat)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('preserves pulse count, bar span, and determinism for every supported step count', () => {
    for (let steps = 1; steps <= 16; steps += 1) {
      const options: DrumsOptions = {
        bars: 1,
        ctx: { bpm: 120, complexity: { rhythmic: 0.5 } },
        style: 'standard',
        section: 'verse',
        euclideanKick: { pulses: steps, steps },
      };
      const kicks = generateDrums(options).filter((hit) => hit.pitch === 36);
      expect(kicks).toHaveLength(steps);
      expect(kicks[0]?.startBeat).toBe(0);
      expect(kicks.at(-1)?.startBeat).toBeCloseTo((4 * (steps - 1)) / steps);
      expect(generateDrums(options)).toEqual(generateDrums(options));
    }
  });
});

describe('fills', () => {
  const ALL_FILLS: FillType[] = [
    'snareRoll',
    'tomDescend',
    'tomAscend',
    'snareTomCombo',
    'simpleCrash',
    'linearFill',
    'ghostToAccent',
    'bdSnareAlternate',
    'hiHatChoke',
    'tomShuffle',
    'breakdownFill',
    'flamsAndDrags',
    'halfTimeFill',
  ];

  it('renders every fill archetype into valid, non-empty hits', () => {
    const barStart = 12;
    for (const fill of ALL_FILLS) {
      const track = new HitList();
      for (let beat = 0; beat < 4; beat += 1) {
        generateFill(track, barStart + beat, beat, fill, 100);
      }
      // Every archetype must produce sound across the four beats of the bar.
      expect(track.hits.length).toBeGreaterThan(0);
      for (const h of track.hits) {
        // GM percussion pitch in range.
        expect(GM_PITCHES.has(h.pitch)).toBe(true);
        expect(h.pitch).toBeGreaterThanOrEqual(35);
        expect(h.pitch).toBeLessThanOrEqual(82);
        // Velocity within the valid MIDI range.
        expect(h.velocity).toBeGreaterThanOrEqual(1);
        expect(h.velocity).toBeLessThanOrEqual(127);
        // Hits stay inside the fill bar. Ornaments are carried as articulations
        // rather than as grace notes written early, so no onset sits before the
        // beat it belongs to, let alone before the bar or past its end.
        expect(h.startBeat).toBeGreaterThanOrEqual(barStart);
        expect(h.startBeat).toBeLessThan(barStart + 4);
      }
    }
  });

  it('emits a phrase-end fill at beat 3 for every low-energy archetype', () => {
    // At low energy the fill spans only beat 3; none of the archetypes reachable
    // there may leave that beat silent (#21).
    const lowEnergyFills: FillType[] = ['simpleCrash', 'breakdownFill', 'halfTimeFill'];
    for (const fill of lowEnergyFills) {
      const track = new HitList();
      generateFill(track, 15, 3, fill, 100);
      expect(track.hits.length).toBeGreaterThan(0);
      for (const h of track.hits) {
        expect(h.startBeat).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('sizes fills by energy, one beat per step', () => {
    expect(getFillStartBeat('low')).toBe(3);
    expect(getFillStartBeat('medium')).toBe(2);
    expect(getFillStartBeat('high')).toBe(1);
    expect(getFillStartBeat('peak')).toBe(0);
  });

  it('plays the pickup beats every archetype is written with', () => {
    // The pickup beats are material like any other: an archetype that writes
    // kick and snare on beat 1 and snare and tom on beat 2 has to be heard
    // playing them at the energies whose fills start that early.
    for (const fill of ALL_FILLS) {
      for (const beat of [0, 1]) {
        const track = new HitList();
        generateFill(track, beat, beat, fill, 100);
        expect(track.hits.length, `${fill} at beat ${beat}`).toBeGreaterThan(0);
      }
    }
    const peak = generateDrums({
      bars: 2,
      style: 'standard',
      section: 'chorus',
      fills: true,
      ctx: { seed: 5, bpm: 120 },
    });
    const pickup = peak.filter((hit) => hit.startBeat >= 4 && hit.startBeat < 5);
    expect(pickup.map((hit) => hit.pitch)).toContain(DRUM_NOTES.kick);
    expect(pickup.map((hit) => hit.pitch)).toContain(DRUM_NOTES.snare);
  });

  it('selects fills from the expected set for each transition context', () => {
    type Ctx = [
      Parameters<typeof selectFillType>[0],
      Parameters<typeof selectFillType>[1],
      Parameters<typeof selectFillType>[2],
      Parameters<typeof selectFillType>[3],
      FillType[],
    ];
    const contexts: Ctx[] = [
      // sparse style: only the two sparse archetypes, whatever the transition.
      ['a', 'chorus', 'sparse', 'medium', ['simpleCrash', 'breakdownFill']],
      // low target energy is handled before the transition-specific blocks.
      ['a', 'chorus', 'fourOnFloor', 'low', ['simpleCrash', 'breakdownFill', 'halfTimeFill']],
      // into-chorus, non-high style.
      [
        'b',
        'chorus',
        'standard',
        'peak',
        ['snareTomCombo', 'tomDescend', 'ghostToAccent', 'hiHatChoke', 'linearFill', 'snareRoll'],
      ],
      // into-chorus, high-energy style.
      [
        'a',
        'chorus',
        'fourOnFloor',
        'high',
        [
          'tomDescend',
          'snareRoll',
          'linearFill',
          'bdSnareAlternate',
          'flamsAndDrags',
          'tomShuffle',
          'ghostToAccent',
        ],
      ],
      [
        'a',
        'chorus',
        'standard',
        'high',
        ['snareTomCombo', 'tomDescend', 'ghostToAccent', 'hiHatChoke', 'linearFill', 'snareRoll'],
      ],
      // out-of-intro, non-chorus target.
      [
        'intro',
        'a',
        'standard',
        'medium',
        ['snareRoll', 'simpleCrash', 'ghostToAccent', 'breakdownFill', 'halfTimeFill'],
      ],
      // generic high-energy style.
      [
        'a',
        'a',
        'rock',
        'medium',
        [
          'tomDescend',
          'snareRoll',
          'tomAscend',
          'snareTomCombo',
          'linearFill',
          'bdSnareAlternate',
          'flamsAndDrags',
          'tomShuffle',
        ],
      ],
      // generic default style.
      [
        'a',
        'a',
        'standard',
        'medium',
        [
          'snareRoll',
          'snareTomCombo',
          'ghostToAccent',
          'hiHatChoke',
          'halfTimeFill',
          'breakdownFill',
        ],
      ],
    ];
    for (const [from, to, style, energy, expected] of contexts) {
      // Draw many times so the assertion covers the whole branch, not one path.
      for (let seed = 0; seed < 64; seed += 1) {
        const picked = selectFillType(
          from,
          to,
          style,
          energy,
          resolveContext(seed).part('drums'),
          0,
        );
        expect(expected).toContain(picked);
      }
    }
  });

  it('reaches every fill archetype across transition contexts', () => {
    // The selector answers a plain id, so the ids seen are collected as text
    // and every archetype is looked for among them.
    const seen = new Set<string>();
    const froms: Parameters<typeof selectFillType>[0][] = ['intro', 'a', 'b'];
    const tos: Parameters<typeof selectFillType>[1][] = ['chorus', 'a', 'outro'];
    const styles: Parameters<typeof selectFillType>[2][] = [
      'sparse',
      'standard',
      'rock',
      'fourOnFloor',
    ];
    const energies: Parameters<typeof selectFillType>[3][] = ['low', 'medium', 'high', 'peak'];
    for (const from of froms) {
      for (const to of tos) {
        for (const style of styles) {
          for (const energy of energies) {
            for (let seed = 0; seed < 32; seed += 1) {
              const picked = selectFillType(
                from,
                to,
                style,
                energy,
                resolveContext(seed * 7 + 1).part('drums'),
                0,
              );
              expect(picked, 'every transition context offers a fill').toBeDefined();
              seen.add(picked ?? '');
            }
          }
        }
      }
    }
    for (const fill of ALL_FILLS) {
      expect(seen.has(fill)).toBe(true);
    }
  });
});

describe('the ornament dial is the ghost density in every section', () => {
  /** Snare-drum onsets off the beat: the ghosts, with no fill or lift to add any. */
  const ghostCount = (section: Section, ornament: number) =>
    generateDrums({
      bars: 4,
      style: 'funk',
      section,
      role: 'full',
      ctx: { bpm: 120, complexity: { rhythmic: 0.5, ornament }, seed: 0 },
    }).filter((hit) => hit.pitch === DRUM_NOTES.snare && !Number.isInteger(hit.startBeat)).length;

  it('answers the dial in the sections a verse and an intro are written in', () => {
    // The ghosts are what makes the groove this genre rather than a plain pop
    // beat, and the dial is the caller's only lever on them: a section may scale
    // the density, but none of them may leave the lever doing nothing.
    for (const section of SECTIONS) {
      const quiet = ghostCount(section, 0);
      const middle = ghostCount(section, 0.5);
      const busy = ghostCount(section, 1);
      expect(middle, section).toBeGreaterThanOrEqual(quiet);
      expect(busy, section).toBeGreaterThanOrEqual(middle);
      expect(busy, section).toBeGreaterThan(quiet);
    }
  });
});

describe('two style names are two grooves', () => {
  const skeleton = (style: GrooveStyle, section: Section, seed: number, rhythmic: number) =>
    generateDrums({
      bars: 2,
      style,
      section,
      ctx: { bpm: 120, complexity: { rhythmic }, seed },
    })
      .filter((hit) => hit.pitch === DRUM_NOTES.kick || hit.pitch === DRUM_NOTES.snare)
      .map((hit) => `${hit.pitch}@${hit.startBeat}`)
      .join(' ');

  it('separates a breakbeat from a plain pop beat in every section', () => {
    // The difference has to be in the figure rather than in a slot the dial may
    // fill in a chorus: a caller who chose the style for a verse would otherwise
    // receive the plain beat with nothing to tell them so.
    for (const section of SECTIONS) {
      for (const seed of [0, 1, 5]) {
        for (const rhythmic of [0.2, 0.5, 0.9]) {
          const label = `${section}/${seed}/${rhythmic}`;
          expect(skeleton('breakbeat', section, seed, rhythmic), label).not.toBe(
            skeleton('standard', section, seed, rhythmic),
          );
        }
      }
    }
  });

  it('keeps a dance kick and a latin kick through the phrase end', () => {
    // The outro plays two half notes under whatever the style states outright,
    // so a four-on-the-floor and a clave-leaning figure are still themselves
    // where the piece ends.
    for (const style of ['house', 'bossa'] as GrooveStyle[]) {
      expect(skeleton(style, 'outro', 0, 0.5), style).not.toBe(
        skeleton('standard', 'outro', 0, 0.5),
      );
    }
  });
});

describe('an archetype shorter than the bar', () => {
  // `boundToBar` answers for the beats an archetype does not write itself,
  // which is what a caller's two-beat figure runs into: held, its last beat
  // sounds again on the beats after it; bound, it stops where it was written.
  const twoBeats: FillArchetype = {
    atBeat: [
      [{ voice: DRUM_NOTES.snare, offset: 0, duration: 0.5, velocity: { base: 'fill' } }],
      [{ voice: DRUM_NOTES.lowTom, offset: 0, duration: 0.5, velocity: { base: 'accent' } }],
    ],
  };

  it('holds its last beat over the rest of the bar', () => {
    const track = new HitList();
    for (let beat = 0; beat < 4; beat += 1) {
      generateFill(track, beat, beat, twoBeats, 100);
    }
    expect(track.hits.map((hit) => hit.pitch)).toEqual([
      DRUM_NOTES.snare,
      DRUM_NOTES.lowTom,
      DRUM_NOTES.lowTom,
      DRUM_NOTES.lowTom,
    ]);
  });

  it('stops where it was written when it is bound to the bar', () => {
    const track = new HitList();
    for (let beat = 0; beat < 4; beat += 1) {
      generateFill(track, beat, beat, { ...twoBeats, boundToBar: true }, 100);
    }
    expect(track.hits.map((hit) => hit.pitch)).toEqual([DRUM_NOTES.snare, DRUM_NOTES.lowTom]);
  });
});
