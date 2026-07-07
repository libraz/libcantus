import { describe, expect, it } from 'vitest';
import { euclideanRhythm, hasHit, patternToMask } from '../src/generate/drums/euclid.js';
import {
  type FillType,
  generateFill,
  getFillStartBeat,
  selectFillType,
} from '../src/generate/drums/fills.js';
import { HitList } from '../src/generate/drums/hit.js';
import type {
  DrumGenOptions,
  DrumRole,
  GrooveFeel,
  GrooveStyle,
  Section,
} from '../src/generate/drums/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { euclideanToKickPattern } from '../src/generate/drums/kick.js';
import { createRng } from '../src/generate/drums/rng.js';

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
          const opts: DrumGenOptions = {
            bars: 4,
            bpm: 128,
            style,
            section,
            density,
            seed: 11,
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
          bpm: 120,
          style,
          section,
          density: 0.8,
          role: 'fxOnly',
          seed: 7,
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
          const opts: DrumGenOptions = {
            bars: 2,
            bpm,
            style: 'funk',
            section: 'chorus',
            density: 0.8,
            feel,
            role,
            seed: 4,
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

  it('rotates onsets', () => {
    const base = euclideanRhythm(3, 8);
    const rotated = euclideanRhythm(3, 8, 2);
    expect(rotated).not.toEqual(base);
    expect(rotated.filter(Boolean)).toHaveLength(3);
  });

  it('maps a euclidean pattern to a kick pattern', () => {
    const mask = patternToMask(euclideanRhythm(4, 16));
    const kick = euclideanToKickPattern(mask);
    expect(kick.beat1).toBe(true);
    expect(hasHit(mask, 0)).toBe(true);
  });

  it('drives the kick from a euclidean option in generateDrums', () => {
    const opts: DrumGenOptions = {
      bars: 2,
      bpm: 120,
      style: 'standard',
      section: 'verse',
      density: 0.5,
      seed: 3,
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
        // Hits stay inside the fill bar (a flam grace note may sit a fraction
        // before the beat but never before the bar, and never past its end).
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

  it('sizes fills by energy', () => {
    expect(getFillStartBeat('low')).toBe(3);
    expect(getFillStartBeat('medium')).toBe(2);
    expect(getFillStartBeat('high')).toBe(0);
    expect(getFillStartBeat('peak')).toBe(0);
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
      const allowed = new Set(expected);
      // Draw many times so the assertion covers the whole branch, not one path.
      for (let seed = 0; seed < 64; seed += 1) {
        const rng = createRng(seed);
        const picked = selectFillType(from, to, style, energy, rng);
        expect(allowed.has(picked)).toBe(true);
      }
    }
  });

  it('reaches every fill archetype across transition contexts', () => {
    const seen = new Set<FillType>();
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
              const rng = createRng(seed * 7 + 1);
              seen.add(selectFillType(from, to, style, energy, rng));
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
