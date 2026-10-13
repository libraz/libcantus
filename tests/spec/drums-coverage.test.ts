import {
  DRUM_NOTES,
  type DrumRole,
  type DrumsOptions,
  type GrooveFeel,
  type GrooveStyle,
  generateDrums,
  type Section,
} from '@libraz/libcantus/generate';
import { describe, expect, it } from 'vitest';

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
