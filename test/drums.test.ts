import { describe, expect, it } from 'vitest';
import { parseTimeSignature } from '../src/core/meter/index.js';
import { FILL_ARCHETYPES, generateFill } from '../src/generate/drums/fills.js';
import { HitList } from '../src/generate/drums/hit.js';
import {
  type DrumsOptions,
  type GrooveStyle,
  generateDrums,
  type Section,
} from '../src/generate/drums/index.js';
import { quantizeSwing } from '../src/generate/drums/swing.js';

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;
const TAMBOURINE = 54;
const HANDCLAP = 39;
const SIDESTICK = 37;
const SHAKER = 82;

const isTom = (pitch: number) => pitch === 45 || pitch === 47 || pitch === 50;
const isOffGrid16 = (beat: number) => {
  const frac = beat - Math.floor(beat);
  return Math.abs(frac - 0.25) < 1e-6 || Math.abs(frac - 0.75) < 1e-6;
};

const base: DrumsOptions = {
  bars: 1,
  ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 1 },
  style: 'standard',
  section: 'verse',
};

describe('generateDrums basic groove', () => {
  it.each(['6/8', '12/8', '5/4', '7/8'])('refuses to write a groove in %s', (text) => {
    // Every shape this generator writes is written against a four-beat bar, so
    // another meter came back with 4/4 accents inside a bar of the wrong length
    // and nothing to tell the caller that had happened. A meter it cannot place
    // is refused where it is asked for.
    const ts = parseTimeSignature(text);
    expect(() =>
      generateDrums({ ...base, bars: 3, ts, section: 'chorus', style: 'house' }),
    ).toThrow(/4\/4/);
  });

  it('keeps every hit inside each bar of the meter it does write', () => {
    const bars = 3;
    const hits = generateDrums({ ...base, bars, section: 'chorus', style: 'house' });
    for (const hit of hits) {
      const bar = Math.floor(hit.startBeat / 4);
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThan(bars);
      expect(hit.startBeat).toBeLessThan((bar + 1) * 4);
    }
  });

  it('places a standard 1-and-3 kick and a backbeat snare', () => {
    const hits = generateDrums(base);
    const kicks = hits.filter((h) => h.pitch === KICK);
    // Standard pop groove: kick on beats 1 and 3 (0-based 0 and 2). The verse
    // section adds no kick syncopation, so exactly two downbeat kicks land.
    expect(kicks.map((h) => h.startBeat).sort((a, b) => a - b)).toEqual([0, 2]);

    const snares = hits.filter((h) => h.pitch === SNARE);
    expect(snares.map((h) => h.startBeat).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('adds hits monotonically with density', () => {
    const sparse = generateDrums({
      ...base,
      ctx: { bpm: 120, complexity: { rhythmic: 0.3 }, seed: 1 },
    });
    const dense = generateDrums({
      ...base,
      ctx: { bpm: 120, complexity: { rhythmic: 0.8 }, seed: 1 },
    });
    expect(dense.length).toBeGreaterThanOrEqual(sparse.length);
  });

  it('suppresses 16th-note hats at high BPM', () => {
    const countHats = (opts: DrumsOptions) =>
      generateDrums(opts).filter((h) => h.pitch === CLOSED_HAT).length;
    const slow = countHats({ ...base, ctx: { bpm: 110, complexity: { rhythmic: 0.8 }, seed: 1 } });
    const fast = countHats({ ...base, ctx: { bpm: 180, complexity: { rhythmic: 0.8 }, seed: 1 } });
    expect(fast).toBeLessThanOrEqual(slow);
  });

  it('replaces only the last bar when fills are enabled', () => {
    const opts: DrumsOptions = {
      ...base,
      bars: 4,
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 0 },
    };
    const noFill = generateDrums(opts);
    const withFill = generateDrums({ ...opts, fills: true });

    const beforeLast = (hits: typeof noFill) => hits.filter((h) => h.startBeat < 12);
    expect(beforeLast(withFill)).toEqual(beforeLast(noFill));

    const lastBar = (hits: typeof noFill) => hits.filter((h) => h.startBeat >= 12);
    expect(lastBar(withFill)).not.toEqual(lastBar(noFill));
  });
});

describe('generateDrums richness', () => {
  it('emits ghost snares and open hi-hats in a dense chorus', () => {
    const render = (seed: number) =>
      generateDrums({
        bars: 2,
        ctx: { bpm: 120, complexity: { rhythmic: 0.7 }, seed: seed },
        style: 'standard',
        section: 'chorus',
      });
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    const hasGhost = seeds.some((s) =>
      render(s).some((h) => h.pitch === SNARE && isOffGrid16(h.startBeat)),
    );
    const hasOpenHat = seeds.some((s) => render(s).some((h) => h.pitch === OPEN_HAT));
    expect(hasGhost).toBe(true);
    expect(hasOpenHat).toBe(true);
  });

  it('allows 16th-grid hats at moderate BPM but not at high BPM', () => {
    const opts = (bpm: number, seed: number): DrumsOptions => ({
      bars: 1,
      ctx: { bpm: bpm, complexity: { rhythmic: 0.6 }, seed: seed },
      style: 'standard',
      section: 'chorus',
    });
    const isHat = (p: number) => p === CLOSED_HAT || p === OPEN_HAT;
    const offGridHats = (bpm: number, seed: number) =>
      generateDrums(opts(bpm, seed)).filter((h) => isHat(h.pitch) && isOffGrid16(h.startBeat))
        .length;
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    // Which seeds reach the 16th grid is the seed's business; that the grid is
    // reachable at a moderate tempo and unreachable at a high one is not.
    expect(seeds.some((seed) => offGridHats(120, seed) > 0)).toBe(true);
    for (const seed of seeds) {
      expect(offGridHats(180, seed), `seed ${seed}`).toBe(0);
    }
  });

  it('delays off-beat hi-hats under a swing feel', () => {
    const common: DrumsOptions = {
      bars: 1,
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: 3 },
      style: 'standard',
      section: 'verse',
    };
    const offBeat = (feel: 'straight' | 'swing') =>
      generateDrums({ ...common, feel }).find(
        (h) => h.pitch === CLOSED_HAT && h.startBeat > 0.4 && h.startBeat < 0.9,
      )?.startBeat ?? 0;
    expect(offBeat('swing')).toBeGreaterThan(offBeat('straight'));
  });

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

  it('adds auxiliary percussion only in energetic sections', () => {
    const chorus = generateDrums({
      bars: 1,
      ctx: { bpm: 128, complexity: { rhythmic: 0.8 }, seed: 5 },
      style: 'funk',
      section: 'chorus',
    });
    const intro = generateDrums({
      bars: 1,
      ctx: { bpm: 128, complexity: { rhythmic: 0.2 }, seed: 5 },
      style: 'funk',
      section: 'intro',
    });
    const auxCount = (hits: typeof chorus) =>
      hits.filter((h) => h.pitch === TAMBOURINE || h.pitch === HANDCLAP).length;
    expect(auxCount(chorus)).toBeGreaterThan(0);
    expect(auxCount(intro)).toBe(0);
  });

  it('keeps only FX/auxiliary voices in fxOnly and never returns an accidental empty bar', () => {
    const main = new Set([KICK, SNARE, CLOSED_HAT, OPEN_HAT]);
    for (const section of ['intro', 'verse', 'chorus', 'outro'] as const) {
      const hits = generateDrums({
        ...base,
        section,
        role: 'fxOnly',
        ctx: { complexity: { rhythmic: 0.8 } },
      });
      expect(hits.length, section).toBeGreaterThan(0);
      expect(
        hits.some((hit) => main.has(hit.pitch)),
        section,
      ).toBe(false);
    }
  });

  it('produces a recognizable fill in the last bar', () => {
    const opts = (seed: number, fills: boolean): DrumsOptions => ({
      bars: 4,
      ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: seed },
      style: 'standard',
      section: 'verse',
      fills,
    });
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    // Every fill changes the last bar, regardless of archetype.
    for (const s of seeds) {
      const noFill = generateDrums(opts(s, false)).filter((h) => h.startBeat >= 12);
      const withFill = generateDrums(opts(s, true)).filter((h) => h.startBeat >= 12);
      expect(withFill).not.toEqual(noFill);
    }
    // Some fill archetypes (e.g. snare rolls) use neither toms nor crash, and
    // only one of the eight a verse can draw does, so the sweep is wide enough
    // to reach it rather than expecting a particular seed to.
    const wideSweep = Array.from({ length: 30 }, (_, index) => index);
    const introducesTomOrCrash = wideSweep.some((s) =>
      generateDrums(opts(s, true))
        .filter((h) => h.startBeat >= 12)
        .some((h) => isTom(h.pitch) || h.pitch === 49),
    );
    expect(introducesTomOrCrash).toBe(true);
  });

  it('is deterministic for identical options and seed', () => {
    const opts: DrumsOptions = {
      bars: 4,
      ctx: { bpm: 124, complexity: { rhythmic: 0.75 }, seed: 99 },
      style: 'funk',
      section: 'chorus',
      fills: true,
    };
    expect(generateDrums(opts)).toEqual(generateDrums(opts));
  });

  it('is deterministic across the full style/section/feel/role matrix', () => {
    const styles: GrooveStyle[] = [
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
    const sections: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
    for (const style of styles) {
      for (const section of sections) {
        const opts: DrumsOptions = {
          bars: 3,
          ctx: { bpm: 132, complexity: { rhythmic: 0.7 }, seed: 123 },
          style,
          section,
          fills: true,
          nextSection: 'chorus',
        };
        // Two independent runs of the same options must be byte-for-byte equal.
        expect(generateDrums(opts)).toEqual(generateDrums(opts));
      }
    }
  });
});

describe('generateDrums phrase-end fills', () => {
  it('never emits a silent last-bar fill at low energy', () => {
    // At intro/outro energy the fill spans only beat 3; no seed may leave the
    // phrase end silent (#21). intro/outro carry no auxiliary percussion, so a
    // hit in the beat-3 window can only come from the fill itself.
    const sections: Section[] = ['intro', 'outro'];
    const styles: GrooveStyle[] = ['standard', 'halftime', 'breakbeat', 'house', 'synthpop'];
    const bars = 2;
    const lastBarStart = (bars - 1) * 4;
    for (const section of sections) {
      for (const style of styles) {
        for (let seed = 0; seed < 40; seed += 1) {
          const hits = generateDrums({
            bars,
            ctx: { bpm: 120, complexity: { rhythmic: 0.5 }, seed: seed },
            style,
            section,
            fills: true,
          });
          const fillWindow = hits.filter((h) => h.startBeat >= lastBarStart + 3);
          expect(fillWindow.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('a fill is a lift, not a dip', () => {
  it('lands on a stroke louder than the backbeats around it', () => {
    for (const style of ['standard', 'funk', 'breakbeat', 'halftime'] as const) {
      for (const section of ['verse', 'chorus', 'bridge'] as const) {
        const hits = generateDrums({
          bars: 4,
          ctx: { bpm: 120, complexity: { rhythmic: 0.6 }, seed: 2 },
          style,
          section,
          nextSection: 'chorus',
          fills: true,
        });
        const backbeats = hits.filter(
          (hit) =>
            hit.startBeat < 12 &&
            (hit.pitch === SNARE || hit.pitch === SIDESTICK) &&
            Number.isInteger(hit.startBeat) &&
            hit.startBeat % 2 === 1,
        );
        if (backbeats.length === 0) {
          continue;
        }
        const loudestBackbeat = Math.max(...backbeats.map((hit) => hit.velocity));
        const fillBar = hits.filter((hit) => hit.startBeat >= 12);
        expect(fillBar.length, `${style}/${section}`).toBeGreaterThan(0);
        expect(
          Math.max(...fillBar.map((hit) => hit.velocity)),
          `${style}/${section}: the fill never rises to the backbeat`,
        ).toBeGreaterThanOrEqual(loudestBackbeat);
      }
    }
  });

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

  it('keeps a Euclidean kick evenly spread under every feel', () => {
    // Five steps to the bar puts onsets between the sixteenths. The spacing is
    // what the option sells, so it survives the feel rather than collapsing
    // onto the swung eighth.
    const spacings = (feel: DrumsOptions['feel']) => {
      const kicks = generateDrums({
        ...base,
        section: 'chorus',
        feel,
        euclideanKick: { pulses: 3, steps: 5 },
      })
        .filter((hit) => hit.pitch === KICK)
        .map((hit) => hit.startBeat)
        .sort((a, b) => a - b);
      return kicks.slice(1).map((beat, index) => beat - (kicks[index] ?? 0));
    };
    for (const feel of ['straight', 'swing', 'shuffle'] as const) {
      const gaps = spacings(feel);
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) {
        expect(gap, `feel ${feel}`).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('the groove feel is taken at its word', () => {
  const offBeats = (over: Partial<DrumsOptions>) =>
    generateDrums({ ...base, section: 'chorus', ...over })
      .filter((hit) => hit.pitch === CLOSED_HAT || hit.pitch === OPEN_HAT)
      // The "and" of each beat: the position a feel is read off. The "a" 16th
      // has a swing of its own and lands later still.
      .map((hit) => hit.startBeat % 1)
      .filter((frac) => frac > 0.4 && frac < 0.72);

  it('puts a shuffle off-beat on the triplet', () => {
    const swung = offBeats({ feel: 'shuffle' });
    expect(swung.length).toBeGreaterThan(0);
    for (const frac of swung) {
      expect(frac).toBeCloseTo(2 / 3, 6);
    }
  });

  it('separates swing from shuffle measurably', () => {
    const straight = offBeats({ feel: 'straight' });
    const swing = offBeats({ feel: 'swing' });
    const shuffle = offBeats({ feel: 'shuffle' });
    expect(straight[0]).toBeCloseTo(0.5, 6);
    expect(swing[0]).toBeGreaterThan(straight[0] ?? 0);
    expect(shuffle[0]).toBeGreaterThan(swing[0] ?? 0);
  });

  it('honours a named feel in the styles whose own character is straight', () => {
    // Trap sits on a straight grid by nature, which is the right default and
    // the wrong answer to a caller who asked for a shuffle in so many words.
    for (const style of ['trap', 'house', 'synthpop'] as const) {
      const straight = offBeats({ style, feel: 'straight' });
      const shuffled = offBeats({ style, feel: 'shuffle' });
      expect(shuffled.length, style).toBeGreaterThan(0);
      expect(shuffled, style).not.toEqual(straight);
      for (const frac of shuffled) {
        expect(frac, style).toBeCloseTo(2 / 3, 6);
      }
    }
  });
});

describe('generateDrums onset ordering', () => {
  it('returns every hit in non-decreasing onset order', () => {
    // Foot hi-hats and percussion are appended after the beat loop, so an
    // unsorted list steps backwards mid-bar and a MIDI writer emits a negative
    // delta time.
    for (const style of ['standard', 'funk', 'shuffle', 'trap', 'house'] as const) {
      const hits = generateDrums({
        bars: 4,
        ctx: { bpm: 120, complexity: { rhythmic: 0.8 }, seed: 5 },
        style,
        section: 'chorus',
        fills: true,
      });
      expect(hits.length).toBeGreaterThan(0);
      for (let i = 1; i < hits.length; i += 1) {
        const previous = hits[i - 1];
        const current = hits[i];
        if (!previous || !current) {
          throw new Error('expected two adjacent hits');
        }
        expect(current.startBeat).toBeGreaterThanOrEqual(previous.startBeat);
        if (current.startBeat === previous.startBeat) {
          expect(current.pitch).toBeGreaterThanOrEqual(previous.pitch);
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

describe('generateDrums option validation', () => {
  it('rejects a name that is not one of the documented values', () => {
    // A name from a config file or a JavaScript caller used to be read against
    // a table with no entry for it, producing NaN velocities or a TypeError.
    expect(() => generateDrums({ ...base, section: 'verse2' as Section })).toThrow(/drum section/);
    expect(() => generateDrums({ ...base, style: 'bogus' as GrooveStyle })).toThrow(/drum style/);
    expect(() => generateDrums({ ...base, feel: 'swung' as DrumsOptions['feel'] })).toThrow(
      /drum feel/,
    );
    expect(() => generateDrums({ ...base, role: 'quiet' as DrumsOptions['role'] })).toThrow(
      /drum role/,
    );
    expect(() => generateDrums({ ...base, nextSection: 'coda' as Section })).toThrow(
      /drum nextSection/,
    );
  });

  it('emits an integer velocity in [1, 127] for every hit', () => {
    const sections: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
    const styles: GrooveStyle[] = ['standard', 'funk', 'shuffle', 'bossa', 'trap', 'halftime'];
    for (const section of sections) {
      for (const style of styles) {
        for (const role of ['full', 'ambient', 'minimal', 'fxOnly'] as const) {
          for (const hit of generateDrums({
            ...base,
            bars: 2,
            section,
            style,
            role,
            fills: true,
          })) {
            expect(Number.isInteger(hit.velocity), `${style}/${section}/${role}`).toBe(true);
            expect(hit.velocity).toBeGreaterThanOrEqual(1);
            expect(hit.velocity).toBeLessThanOrEqual(127);
          }
        }
      }
    }
  });
});

describe('generateDrums shuffle alignment', () => {
  it('puts the kick and the hi-hat "and" on the same tick', () => {
    // The kick's "and" was fully swung while the hi-hat's was left straight, so
    // the two voices separated by tens of milliseconds at the same notated
    // position — audible as a flam rather than as groove.
    const HATS = new Set([CLOSED_HAT, OPEN_HAT, 44, 51]); // closed, open, pedal, ride
    const isAnd = (beat: number) => {
      const frac = beat - Math.floor(beat);
      return frac >= 0.4 && frac <= 0.7;
    };
    for (const density of [0.3, 0.6, 0.9]) {
      for (const style of ['shuffle', 'standard', 'funk'] as const) {
        const hits = generateDrums({
          ...base,
          bars: 2,
          style,
          section: 'chorus',
          ctx: { complexity: { rhythmic: density } },
        });
        for (let beat = 0; beat < 8; beat += 1) {
          const inBeat = hits.filter((h) => h.startBeat >= beat && h.startBeat < beat + 1);
          const kickAnd = inBeat.find((h) => h.pitch === KICK && isAnd(h.startBeat));
          const hatAnd = inBeat.find((h) => HATS.has(h.pitch) && isAnd(h.startBeat));
          if (kickAnd === undefined || hatAnd === undefined) {
            continue;
          }
          expect(hatAnd.startBeat, `${style} density ${density} beat ${beat}`).toBeCloseTo(
            kickAnd.startBeat,
            9,
          );
        }
      }
    }
  });
});

describe('generateDrums role ordering', () => {
  it('keeps ambient on ride and minimal on pedal hi-hat articulations', () => {
    const ambient = generateDrums({
      ...base,
      bars: 4,
      section: 'chorus',
      role: 'ambient',
      ctx: { seed: 1 },
    });
    const minimal = generateDrums({
      ...base,
      bars: 4,
      section: 'chorus',
      role: 'minimal',
      ctx: { seed: 1 },
    });
    expect(ambient.some((hit) => hit.pitch === 51)).toBe(true);
    expect(ambient.some((hit) => hit.pitch === OPEN_HAT)).toBe(false);
    expect(minimal.some((hit) => hit.pitch === 44)).toBe(true);
    expect(minimal.some((hit) => hit.pitch === CLOSED_HAT || hit.pitch === OPEN_HAT)).toBe(false);
  });

  it('never lets a sparser role play louder than a busier one', () => {
    const sections: Section[] = ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro'];
    const styles: GrooveStyle[] = ['standard', 'halftime', 'trap', 'house'];
    for (const section of sections) {
      for (const style of styles) {
        const peak = (role: DrumsOptions['role']) => {
          const hits = generateDrums({ ...base, bars: 2, section, style, role });
          return hits.reduce((loudest, hit) => Math.max(loudest, hit.velocity), 0);
        };
        const full = peak('full');
        const ambient = peak('ambient');
        const minimal = peak('minimal');
        expect(ambient, `${style}/${section}`).toBeLessThanOrEqual(full);
        expect(minimal, `${style}/${section}`).toBeLessThanOrEqual(ambient);
      }
    }
  });

  it('gives minimal a backbeat in every style', () => {
    const styles: GrooveStyle[] = ['standard', 'halftime', 'trap', 'house', 'bossa'];
    for (const style of styles) {
      const hits = generateDrums({ ...base, bars: 2, style, section: 'chorus', role: 'minimal' });
      const backbeat = hits.filter((h) => h.pitch === SNARE || h.pitch === SIDESTICK);
      expect(backbeat.length, style).toBeGreaterThan(0);
    }
  });
});

describe('generateDrums prechorus fills', () => {
  it('leaves the opening two beats to the groove so fill archetypes can differ', () => {
    const signatures = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      const hits = generateDrums({
        ...base,
        bars: 1,
        section: 'chorus',
        style: 'house',
        fills: true,
        ctx: { seed: seed },
      });
      signatures.add(
        hits
          .filter((hit) => hit.startBeat >= 2)
          .map((hit) => `${hit.startBeat}:${hit.pitch}`)
          .join(','),
      );
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it('honours nextSection rather than assuming a chorus follows', () => {
    const opts: DrumsOptions = {
      ...base,
      bars: 4,
      section: 'prechorus',
      fills: true,
    };
    const intoVerse = generateDrums({ ...opts, nextSection: 'verse' });
    const intoChorus = generateDrums({ ...opts, nextSection: 'chorus' });
    const withoutFills = generateDrums({ ...opts, nextSection: 'verse', fills: false });
    // Leading into a verse the fill is what marks the phrase end, so the last
    // bar has to differ from the plain groove.
    const lastBar = (hits: ReturnType<typeof generateDrums>) =>
      JSON.stringify(hits.filter((h) => h.startBeat >= 12));
    expect(lastBar(intoVerse)).not.toBe(lastBar(withoutFills));
    // Leading into a chorus the two-bar lift takes over instead.
    expect(lastBar(intoChorus)).not.toBe(lastBar(intoVerse));
  });
});
