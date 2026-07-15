import { describe, expect, it } from 'vitest';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { createsParallelOctave, createsParallelPerfect } from '../src/theory/counterpoint/index.js';
import {
  nextVoicing,
  SATB_RANGES,
  voiceChord,
  voiceChordStyled,
  voiceLeadingCost,
  voiceProgression,
} from '../src/theory/voicing/index.js';

/** Reduce a MIDI pitch to a pitch class. */
function pc(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

describe('voiceChord', () => {
  it('voices a triad within the SATB ranges with all chord tones present', () => {
    const chord = makeChord(0, 'maj');
    const voicing = voiceChord(chord);
    expect(voicing).toHaveLength(4);
    for (let i = 0; i < voicing.length; i += 1) {
      const pitch = voicing[i] ?? Number.NaN;
      const range = SATB_RANGES[i] ?? { min: 0, max: 0 };
      expect(pitch).toBeGreaterThanOrEqual(range.min);
      expect(pitch).toBeLessThanOrEqual(range.max);
    }
    const sounding = new Set(voicing.map(pc));
    for (const tone of chordPitchClasses(chord)) {
      expect(sounding.has(tone)).toBe(true);
    }
  });

  it('returns pitches in ascending order (index 0 = lowest)', () => {
    const voicing = voiceChord(makeChord(7, 'dom7'));
    for (let i = 1; i < voicing.length; i += 1) {
      expect(voicing[i] ?? 0).toBeGreaterThanOrEqual(voicing[i - 1] ?? 0);
    }
  });

  it('puts the root in the bass by default', () => {
    const voicing = voiceChord(makeChord(2, 'min'));
    expect(pc(voicing[0] ?? Number.NaN)).toBe(2);
  });

  it('puts bassPc in the bass for slash chords', () => {
    const voicing = voiceChord(makeChord(0, 'maj', 4)); // C/E
    expect(pc(voicing[0] ?? Number.NaN)).toBe(4);
  });

  it('supports other voice counts', () => {
    const voicing = voiceChord(makeChord(0, 'maj'), { voices: 3 });
    expect(voicing).toHaveLength(3);
    expect(pc(voicing[0] ?? Number.NaN)).toBe(0);
  });

  it('respects explicit ranges', () => {
    const ranges = [
      { min: 48, max: 59 },
      { min: 60, max: 71 },
      { min: 66, max: 77 },
    ];
    const voicing = voiceChord(makeChord(5, 'maj'), { ranges });
    expect(voicing).toHaveLength(3);
    for (let i = 0; i < voicing.length; i += 1) {
      const pitch = voicing[i] ?? Number.NaN;
      const range = ranges[i] ?? { min: 0, max: 0 };
      expect(pitch).toBeGreaterThanOrEqual(range.min);
      expect(pitch).toBeLessThanOrEqual(range.max);
    }
  });
});

describe('voiceLeadingCost', () => {
  it('sums absolute semitone motion across voices', () => {
    expect(voiceLeadingCost([60, 64, 67], [62, 65, 67])).toBe(3);
    expect(voiceLeadingCost([60], [60])).toBe(0);
  });

  it('returns Infinity for voicings of different lengths', () => {
    expect(voiceLeadingCost([60, 64], [60, 64, 67])).toBe(Number.POSITIVE_INFINITY);
  });

  it('charges more for a hidden perfect on the outer voices than a clean move of equal motion', () => {
    // Both candidates move the two voices a combined 8 semitones.
    // Clean: bass +4, soprano +4 landing on a major third (imperfect) — no penalty.
    const clean = voiceLeadingCost([60, 63], [64, 67]);
    // Hidden: bass +2, soprano +6 reaching a perfect fifth by similar motion
    // with the soprano leaping — a direct fifth, discouraged.
    const hidden = voiceLeadingCost([60, 63], [62, 69]);
    expect(clean).toBe(8);
    expect(hidden).toBeGreaterThan(clean);
    expect(hidden).toBe(14); // 8 motion + 6 hidden-perfect penalty
  });

  it('does not penalize a direct fifth reached with the top voice moving by step', () => {
    // Bass Bb3 and soprano F4 reach a perfect fifth, but the soprano moves only
    // a semitone (F#4->F4): the traditional step exception keeps it a plain cost.
    expect(voiceLeadingCost([60, 66], [58, 65])).toBe(3);
  });

  it('leaves inner-voice hidden perfects to the pure motion cost', () => {
    // A hidden fifth between two inner voices (not the bass/soprano pair) is not
    // charged the outer-voice penalty; only the summed motion is counted.
    expect(voiceLeadingCost([60, 60, 63, 84], [60, 62, 69, 84])).toBe(8);
  });
});

describe('voiceChord register balance', () => {
  it('does not bias candidates to the low register for a wide 5-voice range', () => {
    // Five voices each spanning six octaves with generous spacing: the search
    // hits MAX_CANDIDATES, and a naive low-to-high enumeration would exhaust the
    // budget on low-bass candidates, pinning the bass near its floor. Centre-out
    // enumeration keeps the bass near the register centre instead.
    const wide = Array.from({ length: 5 }, () => ({ min: 24, max: 96 }));
    const voicing = voiceChord(makeChord(0, 'maj7'), { ranges: wide, maxSpacing: 48 });
    expect(voicing).toHaveLength(5);
    const center = (24 + 96) / 2; // 60
    const bass = voicing[0] ?? 0;
    // The bass sits near the register centre, not pinned toward the 24 floor.
    expect(Math.abs(bass - center)).toBeLessThanOrEqual(12);
  });
});

describe('voiceProgression', () => {
  const progression = [
    makeChord(0, 'maj'), // C
    makeChord(5, 'maj'), // F
    makeChord(7, 'maj'), // G
    makeChord(0, 'maj'), // C
  ];

  it('voices each chord with smooth voice leading', () => {
    const voicings = voiceProgression(progression);
    expect(voicings).toHaveLength(4);
    let total = 0;
    for (let i = 1; i < voicings.length; i += 1) {
      const cost = voiceLeadingCost(voicings[i - 1] ?? [], voicings[i] ?? []);
      expect(cost).toBeLessThanOrEqual(12);
      total += cost;
    }
    expect(total).toBeLessThanOrEqual(30);
  });

  it('keeps every voicing inside its voice range and ascending', () => {
    const voicings = voiceProgression(progression);
    for (const voicing of voicings) {
      for (let i = 0; i < voicing.length; i += 1) {
        const pitch = voicing[i] ?? Number.NaN;
        const range = SATB_RANGES[i] ?? { min: 0, max: 0 };
        expect(pitch).toBeGreaterThanOrEqual(range.min);
        expect(pitch).toBeLessThanOrEqual(range.max);
        if (i > 0) {
          expect(pitch).toBeGreaterThanOrEqual(voicing[i - 1] ?? 0);
        }
      }
    }
  });

  it('avoids parallel perfects and octaves between consecutive voicings', () => {
    const voicings = voiceProgression(progression);
    for (let step = 1; step < voicings.length; step += 1) {
      const prev = voicings[step - 1] ?? [];
      const cur = voicings[step] ?? [];
      for (let lower = 0; lower < cur.length; lower += 1) {
        for (let upper = lower + 1; upper < cur.length; upper += 1) {
          const prevLower = prev[lower] ?? 0;
          const prevUpper = prev[upper] ?? 0;
          const curLower = cur[lower] ?? 0;
          const curUpper = cur[upper] ?? 0;
          expect(createsParallelPerfect(prevUpper, curUpper, prevLower, curLower)).toBe(false);
          expect(createsParallelOctave(prevUpper, curUpper, prevLower, curLower)).toBe(false);
        }
      }
    }
  });

  it('places each chord tone in every voicing', () => {
    const voicings = voiceProgression(progression);
    for (let i = 0; i < progression.length; i += 1) {
      const chord = progression[i];
      const voicing = voicings[i] ?? [];
      const sounding = new Set(voicing.map(pc));
      for (const tone of chordPitchClasses(chord ?? makeChord(0, 'maj'))) {
        expect(sounding.has(tone)).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    expect(voiceProgression(progression)).toEqual(voiceProgression(progression));
  });

  it('follows bassPc across a progression', () => {
    const slash = [makeChord(0, 'maj'), makeChord(5, 'maj', 9)]; // C, F/A
    const voicings = voiceProgression(slash);
    expect(pc(voicings[1]?.[0] ?? Number.NaN)).toBe(9);
  });

  it('throws when no pitch of the required class fits the given range', () => {
    // A one-semitone range on C#, which is not a tone of a C major triad.
    expect(() =>
      voiceChord(makeChord(0, 'maj'), { voices: 1, ranges: [{ min: 1, max: 1 }] }),
    ).toThrow(/no voicing/);
  });
});

describe('voiceChordStyled', () => {
  it('drops the second voice from the top an octave below the close voicing', () => {
    const chord = makeChord(0, 'maj7');
    const close = voiceChordStyled(chord, { style: 'close' });
    const drop2 = voiceChordStyled(chord, { style: 'drop2' });
    const secondFromTop = close[close.length - 2] ?? Number.NaN;
    expect(drop2).toContain(secondFromTop - 12);
    // The two voicings sound the same pitch classes.
    expect(new Set(drop2.map(pc))).toEqual(new Set(close.map(pc)));
  });

  it('drops the third voice from the top for drop3', () => {
    const chord = makeChord(0, 'maj7');
    const close = voiceChordStyled(chord, { style: 'close' });
    const drop3 = voiceChordStyled(chord, { style: 'drop3' });
    const thirdFromTop = close[close.length - 3] ?? Number.NaN;
    expect(drop3).toContain(thirdFromTop - 12);
  });

  it('keeps root, third and seventh but omits the fifth in a maj7 shell', () => {
    const chord = makeChord(0, 'maj7');
    const shell = new Set(voiceChordStyled(chord, { style: 'shell' }).map(pc));
    expect(shell.has(0)).toBe(true); // root
    expect(shell.has(4)).toBe(true); // major third
    expect(shell.has(11)).toBe(true); // major seventh
    expect(shell.has(7)).toBe(false); // fifth omitted
  });

  it('keeps root, third and seventh but omits the fifth in a dom7 shell', () => {
    const chord = makeChord(7, 'dom7'); // G7
    const shell = new Set(voiceChordStyled(chord, { style: 'shell' }).map(pc));
    expect(shell.has(7)).toBe(true); // root
    expect(shell.has(11)).toBe(true); // major third
    expect(shell.has(5)).toBe(true); // minor seventh
    expect(shell.has(2)).toBe(false); // fifth omitted
  });

  it('pins chord-tone and non-chord slash basses below every styled voicing', () => {
    for (const bassPc of [4, 2]) {
      const chord = makeChord(0, 'maj7', bassPc);
      for (const style of ['close', 'drop2', 'drop3', 'shell', 'rootless'] as const) {
        const voicing = voiceChordStyled(chord, { style });
        expect(voicing.length, `${style} Cmaj7/${bassPc}`).toBeGreaterThan(0);
        expect(pc(voicing[0] ?? Number.NaN), `${style} Cmaj7/${bassPc}`).toBe(bassPc);
      }
    }
  });

  it('omits the root in a rootless voicing', () => {
    const rootless = new Set(voiceChordStyled(makeChord(0, 'dom7'), { style: 'rootless' }).map(pc));
    expect(rootless.has(0)).toBe(false);
    expect(rootless.has(4)).toBe(true);
    expect(rootless.has(10)).toBe(true);
  });

  it('places the requested pitch class on top', () => {
    const voicing = voiceChordStyled(makeChord(0, 'maj7'), { topNote: 4 });
    expect(pc(voicing[voicing.length - 1] ?? Number.NaN)).toBe(4);
  });

  it('is ascending and contains every chord tone for a close voicing', () => {
    const chord = makeChord(2, 'dom7');
    const voicing = voiceChordStyled(chord);
    for (let i = 1; i < voicing.length; i += 1) {
      expect(voicing[i] ?? 0).toBeGreaterThanOrEqual(voicing[i - 1] ?? 0);
    }
    const sounding = new Set(voicing.map(pc));
    for (const tone of chordPitchClasses(chord)) {
      expect(sounding.has(tone)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const chord = makeChord(5, 'maj7');
    expect(voiceChordStyled(chord, { style: 'drop2' })).toEqual(
      voiceChordStyled(chord, { style: 'drop2' }),
    );
  });
});

describe('nextVoicing', () => {
  const current = voiceChord(makeChord(0, 'maj')); // C major, SATB

  it('returns a same-length ascending voicing with low voice-leading cost', () => {
    const next = nextVoicing(current, makeChord(7, 'maj')); // to G major
    expect(next).toHaveLength(current.length);
    for (let i = 1; i < next.length; i += 1) {
      expect(next[i] ?? 0).toBeGreaterThanOrEqual(next[i - 1] ?? 0);
    }
    expect(voiceLeadingCost(current, next)).toBeLessThanOrEqual(12);
  });

  it('avoids parallel perfects and octaves against the current voicing', () => {
    const next = nextVoicing(current, makeChord(7, 'maj'));
    for (let lower = 0; lower < next.length; lower += 1) {
      for (let upper = lower + 1; upper < next.length; upper += 1) {
        const prevLower = current[lower] ?? 0;
        const prevUpper = current[upper] ?? 0;
        const curLower = next[lower] ?? 0;
        const curUpper = next[upper] ?? 0;
        expect(createsParallelPerfect(prevUpper, curUpper, prevLower, curLower)).toBe(false);
        expect(createsParallelOctave(prevUpper, curUpper, prevLower, curLower)).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    const chord = makeChord(5, 'maj');
    expect(nextVoicing(current, chord)).toEqual(nextVoicing(current, chord));
  });

  it('throws when no voicing fits the given ranges', () => {
    expect(() =>
      nextVoicing(current, makeChord(0, 'maj'), { voices: 1, ranges: [{ min: 1, max: 1 }] }),
    ).toThrow(/no voicing/);
  });

  it('never returns MIDI outside [0, 127] for extreme-low input', () => {
    const voicing = nextVoicing([1, 3, 5], makeChord(0, 'maj'));
    expect(voicing).toHaveLength(3);
    for (const pitch of voicing) {
      expect(pitch).toBeGreaterThanOrEqual(0);
      expect(pitch).toBeLessThanOrEqual(127);
    }
  });

  it('never returns MIDI outside [0, 127] for extreme-high input', () => {
    const voicing = nextVoicing([124, 126, 127], makeChord(0, 'maj'));
    expect(voicing).toHaveLength(3);
    for (const pitch of voicing) {
      expect(pitch).toBeGreaterThanOrEqual(0);
      expect(pitch).toBeLessThanOrEqual(127);
    }
  });
});
