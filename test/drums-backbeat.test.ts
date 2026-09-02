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
  // The groove states the backbeat of a latin style with the side-stick timbre
  // on the backbeat positions themselves. It is not a clave rhythm: the pattern
  // dictionary carries one for `bossaNova`, and this is the other path.
  it('states the backbeat of bossa on the side stick at every role and section', () => {
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

  it('leads the trap backbeat in with the ghosts, and does not ghost over it', () => {
    // A ghost is written on the 16ths of the beat before a backbeat, so where
    // the backbeat moved the ghosts move with it: trap's snare is on beat 3, so
    // the lead-in is beat 2. Fixed to beats 1 and 3, they anticipated a beat
    // trap has no snare on and landed again on the backbeat itself.
    const hits = generateDrums({
      ...base,
      style: 'trap',
      section: 'chorus',
      role: 'full',
      ctx: { seed: 5, bpm: 84, complexity: { ornament: 1 } },
    });
    const ghosts = hits.filter((hit) => hit.pitch === SNARE && !Number.isInteger(hit.startBeat));
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(Math.floor(ghost.startBeat) % 4, `${ghost.startBeat}`).toBe(1);
    }
  });

  it('leaves the claps of a 2-and-4 groove where they were', () => {
    const hits = generateDrums({ ...base, style: 'house', section: 'chorus', role: 'full' });
    const claps = positionsOf(hits, HANDCLAP);
    expect(claps.length).toBeGreaterThan(0);
    expect([...new Set(claps)].sort((a, b) => a - b)).toEqual([1, 3]);
  });
});

describe('a ghost decorates the backbeat it answers', () => {
  // A ghost is a soft stroke on the snare head leading into the backbeat, so it
  // belongs to a groove that states its backbeat there. With the fills off and
  // no chorus to lift into, every snare-drum onset in these parts is a ghost or
  // the backbeat itself.
  const ghostsOf = (hits: ReturnType<typeof generateDrums>) =>
    hits.filter((hit) => hit.pitch === SNARE && !Number.isInteger(hit.startBeat));

  it('writes no snare-head ghost where the backbeat is a side stick', () => {
    for (const role of ['ambient', 'minimal'] as const) {
      for (const style of ['standard', 'funk', 'synthpop', 'breakbeat'] as const) {
        for (const section of SECTIONS) {
          const hits = generateDrums({
            ...base,
            bars: 4,
            style,
            section,
            role,
            ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 1 }, seed: 1 },
          });
          const label = `${style}/${section}/${role}`;
          expect(
            hits.filter((hit) => hit.pitch === SNARE),
            label,
          ).toEqual([]);
        }
      }
    }
  });

  it('writes them where the backbeat is the snare drum itself', () => {
    for (const section of SECTIONS) {
      const hits = generateDrums({
        ...base,
        bars: 4,
        style: 'funk',
        section,
        role: 'full',
        ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 1 }, seed: 1 },
      });
      expect(ghostsOf(hits).length, section).toBeGreaterThan(0);
    }
  });

  it('writes none for a latin groove, which states its backbeat on the rim', () => {
    for (const section of SECTIONS) {
      const hits = generateDrums({
        ...base,
        bars: 4,
        style: 'bossa',
        section,
        role: 'full',
        ctx: { bpm: 120, complexity: { rhythmic: 0.9, ornament: 1 }, seed: 1 },
      });
      expect(
        hits.filter((hit) => hit.pitch === SNARE),
        section,
      ).toEqual([]);
    }
  });
});
