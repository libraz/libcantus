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
import { generateDrums } from '../src/generate/drums/index.js';

/** General MIDI percussion notes the drum engine is allowed to emit. */
const GM_PITCHES = new Set([36, 38, 37, 39, 42, 44, 46, 49, 51, 54, 50, 47, 45, 82]);

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

  it('places the single rest of a pattern one step short of full in the canonical rotation', () => {
    const pattern = (text: string): boolean[] => [...text].map((glyph) => glyph === 'x');
    expect(euclideanRhythm(3, 4)).toEqual(pattern('x.xx'));
    expect(euclideanRhythm(5, 6)).toEqual(pattern('x.xxxx'));
    expect(euclideanRhythm(7, 8)).toEqual(pattern('x.xxxxxx'));
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
