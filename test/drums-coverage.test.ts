import { describe, expect, it } from 'vitest';
import { euclideanRhythm, hasHit, patternToMask } from '../src/drums/euclid.js';
import {
  type FillType,
  generateFill,
  getFillStartBeat,
  selectFillType,
} from '../src/drums/fills.js';
import { HitList } from '../src/drums/hit.js';
import type {
  DrumGenOptions,
  DrumRole,
  GrooveFeel,
  GrooveStyle,
  Section,
} from '../src/drums/index.js';
import { generateDrums } from '../src/drums/index.js';
import { euclideanToKickPattern } from '../src/drums/kick.js';
import { createRng } from '../src/drums/rng.js';

const STYLES: GrooveStyle[] = [
  'standard',
  'funk',
  'shuffle',
  'bossa',
  'trap',
  'halftime',
  'breakbeat',
];
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

  it('renders every fill archetype at every beat', () => {
    for (const fill of ALL_FILLS) {
      const track = new HitList();
      for (let beat = 0; beat < 4; beat += 1) {
        generateFill(track, 12 + beat, beat, fill, 100);
      }
    }
    // A tom-based fill emits tom voices in its later beats.
    const track = new HitList();
    generateFill(track, 14, 2, 'tomDescend', 100);
    generateFill(track, 15, 3, 'tomDescend', 100);
    expect(track.hits.some((h) => h.pitch === 45 || h.pitch === 47 || h.pitch === 50)).toBe(true);
  });

  it('sizes fills by energy', () => {
    expect(getFillStartBeat('low')).toBe(3);
    expect(getFillStartBeat('medium')).toBe(2);
    expect(getFillStartBeat('high')).toBe(0);
    expect(getFillStartBeat('peak')).toBe(0);
  });

  it('selects fill types across transition contexts', () => {
    const rng = createRng(9);
    const contexts: [
      Parameters<typeof selectFillType>[0],
      Parameters<typeof selectFillType>[1],
      Parameters<typeof selectFillType>[2],
      Parameters<typeof selectFillType>[3],
    ][] = [
      ['a', 'chorus', 'sparse', 'medium'],
      ['a', 'chorus', 'fourOnFloor', 'low'],
      ['b', 'chorus', 'standard', 'peak'],
      ['a', 'chorus', 'fourOnFloor', 'high'],
      ['a', 'chorus', 'standard', 'high'],
      ['intro', 'a', 'standard', 'medium'],
      ['a', 'a', 'rock', 'medium'],
      ['a', 'a', 'standard', 'medium'],
    ];
    for (const [from, to, style, energy] of contexts) {
      expect(typeof selectFillType(from, to, style, energy, rng)).toBe('string');
    }
  });
});
