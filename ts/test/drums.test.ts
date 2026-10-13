import { describe, expect, it } from 'vitest';
import { FILL_ARCHETYPES, generateFill } from '../src/generate/drums/fills.js';
import { HitList } from '../src/generate/drums/hit.js';
import { type DrumsOptions, generateDrums } from '../src/generate/drums/index.js';
import { quantizeSwing } from '../src/generate/drums/swing.js';

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;
const SHAKER = 82;

const base: DrumsOptions = {
  bars: 1,
  ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 1 },
  style: 'standard',
  section: 'verse',
};

describe('generateDrums richness', () => {
  it('puts Euclidean kicks, shakers, and pre-chorus snare lifts on the shared shuffle grid', () => {
    // A shuffle asked for by name is the triplet itself, whatever the style's
    // own character, so every off-beat eighth lands on the triplet position.
    const swungAnd = quantizeSwing(0.5, 1, 'sixteenth');
    const hiHatPitches = new Set([CLOSED_HAT, OPEN_HAT]);
    const hasHiHatAt = (hits: ReturnType<typeof generateDrums>, tick: number) =>
      hits.some((hit) => hiHatPitches.has(hit.pitch) && hit.startBeat === tick);

    const euclidean = generateDrums({
      ...base,
      section: 'chorus',
      feel: 'shuffle',
      euclideanKick: { pulses: 3, steps: 8 },
    });
    const offBeatKicks = euclidean.filter((hit) => hit.pitch === KICK && hit.startBeat % 1 !== 0);
    expect(offBeatKicks.length).toBeGreaterThan(0);
    for (const kick of offBeatKicks) {
      // Compared as a quantity rather than bit for bit: the delay is added to
      // the position itself now, so the last bit follows the bar it lands in.
      expect(kick.startBeat % 1).toBeCloseTo(swungAnd, 12);
      expect(hasHiHatAt(euclidean, kick.startBeat)).toBe(true);
    }

    const preChorus = generateDrums({
      ...base,
      bars: 3,
      ctx: { bpm: 170, complexity: { rhythmic: 0.5 }, seed: 1 },
      section: 'prechorus',
      feel: 'shuffle',
      nextSection: 'chorus',
    });
    for (const barStart of [0, 4, 8]) {
      const tick = barStart + swungAnd;
      expect(preChorus.some((hit) => hit.pitch === SHAKER && hit.startBeat === tick)).toBe(true);
      expect(hasHiHatAt(preChorus, tick)).toBe(true);
    }
    for (const barStart of [4, 8]) {
      const tick = barStart + swungAnd;
      expect(preChorus.some((hit) => hit.pitch === SNARE && hit.startBeat === tick)).toBe(true);
      expect(hasHiHatAt(preChorus, tick)).toBe(true);
    }
  });
});

describe('a fill is a lift, not a dip', () => {
  it('crescendos across the whole roll rather than restarting each beat', () => {
    // The roll is written as a single seven-stroke gesture, so its velocities
    // never fall back partway through — which is what a crescendo means and
    // what the helper that builds it is called.
    const track = new HitList();
    for (const beat of [2, 3]) {
      generateFill(track, beat, beat, FILL_ARCHETYPES.snareRoll, 80);
    }
    const strokes = track.hits
      .filter((hit) => hit.pitch === SNARE)
      .sort((a, b) => a.startBeat - b.startBeat);
    expect(strokes.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < strokes.length; i += 1) {
      expect(
        strokes[i]?.velocity ?? 0,
        `stroke ${i} falls back to ${strokes[i]?.velocity}`,
      ).toBeGreaterThanOrEqual(strokes[i - 1]?.velocity ?? 0);
    }
    // And the stroke it lands on is the loudest of them.
    expect(strokes[strokes.length - 1]?.velocity).toBe(
      Math.max(...strokes.map((hit) => hit.velocity)),
    );
  });
});

describe('quantizeSwing sixteenth grid', () => {
  it('delays the "e" off-beat 16th under full swing', () => {
    expect(quantizeSwing(0.25, 1, 'sixteenth')).toBeGreaterThan(0.25);
  });

  it('delays the "a" off-beat 16th under full swing', () => {
    expect(quantizeSwing(0.75, 1, 'sixteenth')).toBeGreaterThan(0.75);
  });

  it('places the shuffle "a" 16th near 0.8125 without over-swinging', () => {
    // At three quarters of the full triplet displacement the "a" 16th (0.75
    // beat) lands near 0.8125, not a doubly-swung 0.9375 crowding the next
    // downbeat.
    const swing = 0.75;
    expect(quantizeSwing(0.75, swing, 'sixteenth')).toBeCloseTo(0.8125, 10);
    // It is symmetric with the "e" 16th and never crosses the next downbeat.
    expect(quantizeSwing(0.25, swing, 'sixteenth')).toBeCloseTo(0.3125, 10);
    expect(quantizeSwing(0.75, 1, 'sixteenth')).toBeLessThan(1);
  });

  it('never moves an onset earlier than it was written', () => {
    // Swing is a warp of the beat, so a position between two grid slots is
    // delayed against itself. Snapping it to the nearest slot instead moved a
    // Euclidean kick on a five-step bar backwards, which is the one thing a
    // timing transform must never do.
    for (const resolution of ['eighth', 'sixteenth'] as const) {
      for (const swing of [0, 0.25, 0.375, 0.75, 1]) {
        for (let tick = 0; tick <= 4; tick += 1 / 32) {
          const swung = quantizeSwing(tick, swing, resolution);
          expect(swung, `${resolution} @${tick} swing ${swing}`).toBeGreaterThanOrEqual(
            tick - 1e-12,
          );
          // And never past the position of the next grid slot's own arrival.
          expect(swung).toBeLessThan(tick + 0.25);
        }
      }
    }
  });
});

describe('HitList crash proximity', () => {
  const CRASH = 49;

  it('sees a crash on either side of the beat it is asked about', () => {
    // The guard keeps an open hi-hat off a beat a crash already covers, and a
    // crash written a 32nd earlier covers the beat just as much as one written a
    // 32nd later.
    for (const offset of [-0.125, -0.0625, 0, 0.0625, 0.125]) {
      const track = new HitList();
      track.add(CRASH, 2 + offset, 0.5, 100);
      expect(track.hasCrashNear(2), `crash at ${offset} from the beat`).toBe(true);
    }
  });

  it('ignores a crash a 16th or more away, equally in both directions', () => {
    for (const offset of [-1, -0.5, -0.25, 0.25, 0.5, 1]) {
      const track = new HitList();
      track.add(CRASH, 2 + offset, 0.5, 100);
      expect(track.hasCrashNear(2), `crash at ${offset} from the beat`).toBe(false);
    }
  });

  it('answers for the crash voice alone', () => {
    const track = new HitList();
    track.add(SNARE, 1.9375, 0.25, 90);
    expect(track.hasCrashNear(2)).toBe(false);
  });
});
