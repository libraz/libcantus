import { describe, expect, it } from 'vitest';
import {
  type DrumsOptions,
  type GrooveStyle,
  generateDrums,
  type Section,
} from '../src/generate/drums/index.js';

const OPEN_HAT = 46;

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

const base: DrumsOptions = {
  bars: 4,
  ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 1 },
  style: 'standard',
  section: 'verse',
};

/** The sound of an onset: which instrument, at which position. */
const onsetKeys = (hits: ReturnType<typeof generateDrums>) =>
  new Set(hits.map((hit) => `${hit.pitch}@${hit.startBeat}`));

describe('four-on-the-floor open hi-hats', () => {
  it('answers the kick off the beat instead of on it', () => {
    let offbeats = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const hits = generateDrums({
        ...base,
        style: 'house',
        section: 'chorus',
        ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed },
      });
      for (const hit of hits.filter((hit) => hit.pitch === OPEN_HAT)) {
        // A four-on-the-floor kick occupies every downbeat, so no open hat may
        // land on one.
        expect(Number.isInteger(hit.startBeat), `seed ${seed}`).toBe(false);
        if (Math.abs((hit.startBeat % 1) - 0.5) < 1e-9) {
          offbeats += 1;
        }
      }
    }
    expect(offbeats).toBeGreaterThan(0);
  });

  it('opens on the "and" of the backbeats', () => {
    const positions = new Set<number>();
    for (let seed = 0; seed < 12; seed += 1) {
      const hits = generateDrums({
        ...base,
        style: 'house',
        section: 'chorus',
        ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed },
      });
      for (const hit of hits.filter((hit) => hit.pitch === OPEN_HAT)) {
        positions.add(hit.startBeat % 4);
      }
    }
    expect(positions.has(1.5) || positions.has(3.5)).toBe(true);
    for (const position of positions) {
      expect([1.5, 3.5, 3.75]).toContain(position);
    }
  });
});

describe('the rhythmic dial only adds onsets', () => {
  const steps = 21;

  it('keeps every sounding onset as the dial is raised, across styles and sections', () => {
    for (const style of STYLES) {
      for (const section of SECTIONS) {
        for (const seed of [0, 1, 7]) {
          let previous: Set<string> | undefined;
          let previousDial = 0;
          for (let step = 0; step < steps; step += 1) {
            const rhythmic = step / (steps - 1);
            const current = onsetKeys(
              generateDrums({
                ...base,
                style,
                section,
                ctx: { bpm: 120, complexity: { rhythmic }, seed },
              }),
            );
            if (previous) {
              const lost = [...previous].filter((key) => !current.has(key));
              expect(
                lost,
                `${style}/${section}/seed ${seed}: ${previousDial} -> ${rhythmic}`,
              ).toEqual([]);
            }
            previous = current;
            previousDial = rhythmic;
          }
        }
      }
    }
  });

  it('never trades an open hi-hat for a closed one as the dial is raised', () => {
    for (const section of ['prechorus', 'chorus'] as Section[]) {
      for (const seed of [0, 1, 2, 3]) {
        let previous: number[] = [];
        for (let step = 0; step < steps; step += 1) {
          const rhythmic = step / (steps - 1);
          const hits = generateDrums({
            ...base,
            section,
            ctx: { bpm: 120, complexity: { rhythmic }, seed },
          });
          const open = hits.filter((hit) => hit.pitch === OPEN_HAT).map((hit) => hit.startBeat);
          for (const beat of previous) {
            expect(open, `${section}/seed ${seed}/dial ${rhythmic}`).toContain(beat);
          }
          previous = open;
        }
      }
    }
  });
});
