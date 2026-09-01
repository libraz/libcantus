import { describe, expect, it } from 'vitest';
import {
  type DrumRole,
  type DrumsOptions,
  generateDrums,
  type Section,
} from '../src/generate/drums/index.js';

const SNARE = 38;
const SIDESTICK = 37;
const HANDCLAP = 39;

const SECTIONS: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
const ROLES: DrumRole[] = ['full', 'ambient', 'minimal'];

const base: DrumsOptions = {
  bars: 2,
  ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 1 },
  style: 'standard',
  section: 'verse',
};

/** Onsets of one pitch, in bar-relative beats. */
const positionsOf = (hits: ReturnType<typeof generateDrums>, pitch: number) =>
  hits.filter((hit) => hit.pitch === pitch).map((hit) => hit.startBeat % 4);

describe('the backbeat voice follows the role and the style together', () => {
  it('writes a rim-click clave for bossa at every role and section', () => {
    for (const role of ROLES) {
      for (const section of SECTIONS) {
        const hits = generateDrums({ ...base, style: 'bossa', section, role });
        const label = `${role}/${section}`;
        expect(
          hits.filter((hit) => hit.pitch === SNARE),
          label,
        ).toEqual([]);
        const backbeat = positionsOf(hits, SIDESTICK);
        // The intro's first bar stays open, so the side-sticks of the second
        // bar carry the clave there.
        expect(backbeat.length, label).toBeGreaterThan(0);
        expect(
          [...new Set(backbeat)].sort((a, b) => a - b),
          label,
        ).toEqual([1, 3]);
      }
    }
  });

  it('keeps bossa on the same backbeat voice as the role is stepped down', () => {
    const peakOf = (role: DrumRole) => {
      const hits = generateDrums({ ...base, style: 'bossa', section: 'chorus', role });
      const backbeat = hits.filter((hit) => hit.pitch === SIDESTICK);
      expect(backbeat.length, role).toBeGreaterThan(0);
      expect(hits.some((hit) => hit.pitch === SNARE)).toBe(false);
      return backbeat.reduce((loudest, hit) => Math.max(loudest, hit.velocity), 0);
    };
    // Only the weight moves with the role; the voice does not.
    expect(peakOf('full')).toBeGreaterThan(peakOf('ambient'));
    expect(peakOf('ambient')).toBeGreaterThan(peakOf('minimal'));
  });

  it('leaves fxOnly without a backbeat voice at all', () => {
    const hits = generateDrums({ ...base, style: 'bossa', section: 'chorus', role: 'fxOnly' });
    expect(hits.some((hit) => hit.pitch === SNARE || hit.pitch === SIDESTICK)).toBe(false);
  });

  it('gives the bridge the same backbeat snare as every other section', () => {
    const countSnares = (section: Section) =>
      generateDrums({ ...base, bars: 4, section, role: 'full' }).filter(
        (hit) => hit.pitch === SNARE && Number.isInteger(hit.startBeat),
      ).length;
    expect(countSnares('bridge')).toBe(countSnares('verse'));
    expect(countSnares('bridge')).toBe(8);
  });

  it('writes the bridge cross-stick once per backbeat, not once per hi-hat stroke', () => {
    const bars = 4;
    const hits = generateDrums({ ...base, bars, section: 'bridge', role: 'ambient' });
    const clicks = hits.filter((hit) => hit.pitch === SIDESTICK);
    expect(clicks.length).toBe(2 * bars);
    expect([...new Set(clicks.map((hit) => hit.startBeat % 4))].sort((a, b) => a - b)).toEqual([
      1, 3,
    ]);
  });

  it('gives halftime a full snare outside the chorus as well', () => {
    for (const section of ['verse', 'prechorus', 'bridge', 'outro'] as Section[]) {
      const hits = generateDrums({ ...base, style: 'halftime', section, role: 'full' });
      const snares = hits.filter((hit) => hit.pitch === SNARE);
      expect(positionsOf(hits, SNARE), section).toEqual([2, 2]);
      expect(
        hits.some((hit) => hit.pitch === SIDESTICK),
        section,
      ).toBe(false);
      // The backbeat arrives above the beat it lands on, not below it.
      const beatVelocity = hits
        .filter((hit) => hit.startBeat === 2 && hit.pitch !== SNARE)
        .reduce((loudest, hit) => Math.max(loudest, hit.velocity), 0);
      expect(snares[0]?.velocity, section).toBeGreaterThan(beatVelocity);
    }
  });

  it('gives every role but fxOnly a backbeat stroke in every style and section', () => {
    const styles: DrumsOptions['style'][] = [
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
    for (const style of styles) {
      for (const section of SECTIONS) {
        for (const role of ROLES) {
          const hits = generateDrums({ ...base, style, section, role });
          const backbeat = hits.filter(
            (hit) => hit.pitch === SNARE || hit.pitch === SIDESTICK,
          ).length;
          expect(backbeat, `${style}/${section}/${role}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('voices that reinforce the backbeat follow where it moved', () => {
  it('puts trap hand-claps on beat 3 with the snare', () => {
    const hits = generateDrums({ ...base, style: 'trap', section: 'chorus', role: 'full' });
    const claps = positionsOf(hits, HANDCLAP);
    expect(claps.length).toBeGreaterThan(0);
    expect([...new Set(claps)]).toEqual([2]);
    // Ghost notes sit between the beats; the backbeat itself is the stroke the
    // claps have to agree with.
    const backbeat = hits.filter((hit) => hit.pitch === SNARE && Number.isInteger(hit.startBeat));
    expect([...new Set(backbeat.map((hit) => hit.startBeat % 4))]).toEqual([2]);
  });

  it('leaves the claps of a 2-and-4 groove where they were', () => {
    const hits = generateDrums({ ...base, style: 'house', section: 'chorus', role: 'full' });
    const claps = positionsOf(hits, HANDCLAP);
    expect(claps.length).toBeGreaterThan(0);
    expect([...new Set(claps)].sort((a, b) => a - b)).toEqual([1, 3]);
  });
});
