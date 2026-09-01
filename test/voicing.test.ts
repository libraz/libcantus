import { describe, expect, it } from 'vitest';
import { BudgetExceededError } from '../src/core/errors/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordPitchClasses, makeChord } from '../src/theory/chord/index.js';
import { createsParallelOctave, createsParallelPerfect } from '../src/theory/counterpoint/index.js';
import { checkPartWriting, spellVoicing } from '../src/theory/partwriting/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { isFunctioningLeadingTone } from '../src/theory/tendency/index.js';
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
  it('lets callers raise the candidate cap for a large voicing search', () => {
    const compact = voiceChord(makeChord(0, '13'), { voices: 6, maxCandidates: 10_000 });
    expect(compact).toEqual([48, 52, 57, 62, 67, 70]);
  });

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

  it('measures motion alone, charging nothing extra for a hidden perfect', () => {
    // Both moves carry the two voices a combined 8 semitones.
    // Clean: bass +4, soprano +4 landing on a major third (imperfect).
    const clean = voiceLeadingCost([60, 63], [64, 67]);
    // Hidden: bass +2, soprano +6 reaching a perfect fifth by similar motion
    // with the soprano leaping — a direct fifth, which the part-writing checker
    // reports and the search weighs, but which is not a distance.
    const hidden = voiceLeadingCost([60, 63], [62, 69]);
    expect(clean).toBe(8);
    expect(hidden).toBe(8);
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
  it('keeps adjacent voices distinct in every realized chord', () => {
    const voicings = voiceProgression([makeChord(7, 'dom7'), makeChord(0, 'maj')], {
      key: majorKey(0),
    });
    for (const voicing of voicings) {
      for (let index = 1; index < voicing.length; index += 1) {
        expect(voicing[index]).toBeGreaterThan(voicing[index - 1] ?? Number.POSITIVE_INFINITY);
      }
    }
  });

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

  it('voices a lone chord exactly as voiceChord does', () => {
    // Nothing follows, so there is nothing to weigh the chord against beyond
    // its own structure and register: the two entry points must agree.
    for (const chord of progression) {
      expect(voiceProgression([chord])).toEqual([voiceChord(chord)]);
    }
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
  it('can thin a larger current voicing to the requested voice count', () => {
    const next = nextVoicing([60, 64, 67, 72], makeChord(7, 'maj'), { voices: 3 });
    expect(next).toHaveLength(3);
    expect(next.every((pitch, index) => index === 0 || pitch >= (next[index - 1] ?? pitch))).toBe(
      true,
    );
  });

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

  it('uses the same tendency-tone score as progression voicing', () => {
    const chords = [makeChord(7, 'dom7'), makeChord(0, 'maj')];
    const opts = {
      key: majorKey(0),
      ranges: SATB_RANGES.map((range) => ({ ...range })),
      previousChord: chords[0],
    };
    const [previous, expected] = voiceProgression(chords, opts);
    expect(nextVoicing(previous ?? [], chords[1] ?? makeChord(0, 'maj'), opts)).toEqual(expected);
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

  it('fails fast when a voice admits no chord tone at all', () => {
    // Wide ranges below a top voice pinned to a non-chord tone: without an
    // up-front feasibility check the search expands the whole cartesian product
    // of the lower voices before discovering there is no leaf.
    const ranges = [
      ...Array.from({ length: 11 }, () => ({ min: 0, max: 127 })),
      { min: 1, max: 1 }, // C#, no tone of a C major triad
    ];
    expect(() => voiceChord(makeChord(0, 'maj'), { ranges })).toThrow(/no voicing/);
  });

  it('validates its inputs the way its sibling entry points do', () => {
    const chord = makeChord(0, 'maj');
    expect(() => nextVoicing([], chord)).toThrow(/at least one pitch/);
    expect(() => nextVoicing([60, Number.NaN], chord)).toThrow(/current\[1\]/);
    expect(() => nextVoicing(current, chord, { maxSpacing: Number.NaN })).toThrow(/maxSpacing/);
    expect(() => nextVoicing(current, chord, { maxSpacing: -1 })).toThrow(/non-negative/);
  });

  it('applies the voice-count budget to ranges read off the current voicing', () => {
    // The interactive entry point: the voice count arrives inside `current`
    // rather than in the options, and the search it asks for is the same size.
    const chord = makeChord(0, 'maj');
    const wide = Array.from({ length: 129 }, (_, index) => 40 + (index % 40));
    const started = Date.now();
    expect(() => nextVoicing(wide, chord)).toThrow(BudgetExceededError);
    expect(Date.now() - started).toBeLessThan(1000);
    // The same count written out as explicit ranges has always been rejected.
    const ranges = wide.map((pitch) => ({ min: pitch - 12, max: pitch + 12 }));
    expect(() => voiceChord(chord, { ranges })).toThrow(BudgetExceededError);
  });
});

describe('tendency-tone resolution', () => {
  /** Every voice's motion between two voicings, by voice index. */
  function motions(prev: number[], cur: number[]): number[] {
    return cur.map((pitch, index) => pitch - (prev[index] ?? 0));
  }

  it('resolves the chordal seventh downward by step', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const key = majorKey(tonic);
      const dominant = makeChord((tonic + 7) % 12, 'dom7');
      const tonicChord = makeChord(tonic, 'maj');
      const [prev, cur] = voiceProgression([dominant, tonicChord], { key });
      const seventhPc = ((tonic + 5) % 12) + 0; // the fourth degree, G7's F in C
      const voice = (prev ?? []).findIndex((pitch) => pc(pitch) === seventhPc);
      expect(voice, `no seventh voiced on ${tonic}`).toBeGreaterThanOrEqual(0);
      const motion = motions(prev ?? [], cur ?? [])[voice] ?? 0;
      expect(motion, `seventh motion in key ${tonic}`).toBeGreaterThanOrEqual(-2);
      expect(motion, `seventh motion in key ${tonic}`).toBeLessThanOrEqual(-1);
    }
  });

  it('resolves the seventh of ii-V-I and of an applied dominant', () => {
    const key = majorKey(0);
    const progressions: Chord[][] = [
      [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')],
      [makeChord(2, 'dom7'), makeChord(7, 'maj')], // V7/V - V
      [makeChord(7, 'dom7'), makeChord(9, 'min')], // deceptive
    ];
    for (const chords of progressions) {
      const voicings = voiceProgression(chords, { key });
      for (let step = 1; step < chords.length; step += 1) {
        const chord = chords[step - 1];
        const prev = voicings[step - 1] ?? [];
        const cur = voicings[step] ?? [];
        const seventh = (chord?.intervals ?? []).find((interval) => interval % 12 === 10);
        if (seventh === undefined) {
          continue;
        }
        const seventhPc = pc((chord?.rootPc ?? 0) + seventh);
        const nextPcs = new Set(chordPitchClasses(chords[step] ?? makeChord(0, 'maj')));
        if (nextPcs.has(seventhPc)) {
          continue; // held as a common tone
        }
        for (let voice = 0; voice < prev.length; voice += 1) {
          if (pc(prev[voice] ?? 0) !== seventhPc) {
            continue;
          }
          const motion = (cur[voice] ?? 0) - (prev[voice] ?? 0);
          expect(motion, `seventh at voice ${voice}`).toBeGreaterThanOrEqual(-2);
          expect(motion, `seventh at voice ${voice}`).toBeLessThanOrEqual(-1);
        }
      }
    }
  });

  it('does not double the leading tone when the key is known', () => {
    for (let tonic = 0; tonic < 12; tonic += 1) {
      const key = majorKey(tonic);
      const leadingTone = (tonic + 11) % 12;
      for (const chord of [makeChord(leadingTone, 'dim'), makeChord((tonic + 7) % 12, 'dom7')]) {
        const voicing = voiceChord(chord, { key });
        const doubled = voicing.filter((pitch) => pc(pitch) === leadingTone).length;
        expect(doubled, `${chord.quality} in key ${tonic}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('raises the leading tone to the tonic', () => {
    const key = majorKey(0);
    const [prev, cur] = voiceProgression([makeChord(7, 'dom7'), makeChord(0, 'maj')], { key });
    const voice = (prev ?? []).findIndex((pitch) => pc(pitch) === 11);
    expect(voice).toBeGreaterThanOrEqual(0);
    expect(motions(prev ?? [], cur ?? [])[voice]).toBe(1);
  });

  it('leaves the fifth of an altered chord freely doubled', () => {
    // A diminished triad has no perfect fifth: exempting only root + 7 would
    // leave the root as the sole freely doubled tone.
    const voicing = voiceChord(makeChord(11, 'dim'), { key: majorKey(0) });
    expect(new Set(voicing.map(pc)).size).toBeLessThanOrEqual(3);
    expect(voicing.filter((pitch) => pc(pitch) === 11)).toHaveLength(1);
  });
});

describe('voiceProgression exact output', () => {
  // Every rule the search applies is a weight, and every weight is compared
  // against another, so a change in how candidates are held or in what order
  // they are visited moves the winner without breaking any single rule. These
  // pin the pitches themselves across a spread of voice counts, keys, and
  // candidate caps, so such a move is caught rather than merely permitted.
  const cases: {
    name: string;
    chords: Chord[];
    opts?: Parameters<typeof voiceProgression>[1];
    expected: number[][];
  }[] = [
    {
      name: 'a four-bar turnaround with no key',
      chords: [makeChord(0, 'maj'), makeChord(9, 'min'), makeChord(5, 'maj'), makeChord(7, 'maj')],
      expected: [
        [48, 60, 64, 67],
        [45, 60, 64, 69],
        [41, 60, 65, 69],
        [43, 59, 62, 67],
      ],
    },
    {
      name: 'a ii-V-I in a known key',
      chords: [makeChord(2, 'min7'), makeChord(7, 'dom7'), makeChord(0, 'maj7')],
      opts: { key: majorKey(0) },
      expected: [
        [50, 60, 65, 69],
        [55, 59, 62, 65],
        [48, 55, 59, 64],
      ],
    },
    {
      name: 'three voices over a slash chord',
      chords: [
        makeChord(0, 'maj'),
        makeChord(7, 'maj', 11),
        makeChord(9, 'min'),
        makeChord(5, 'maj'),
        makeChord(7, 'dom7'),
        makeChord(0, 'maj'),
      ],
      opts: { voices: 3, key: majorKey(0) },
      expected: [
        [48, 64, 67],
        [47, 62, 67],
        [45, 64, 72],
        [53, 69, 72],
        [55, 65, 71],
        [48, 64, 72],
      ],
    },
    {
      name: 'five voices with wide spacing',
      chords: [makeChord(0, 'maj9'), makeChord(9, '7b9'), makeChord(2, 'min9'), makeChord(7, '13')],
      opts: { voices: 5, maxSpacing: 14 },
      expected: [
        [48, 55, 62, 64, 71],
        [45, 55, 61, 64, 70],
        [50, 53, 60, 64, 69],
        [43, 53, 59, 64, 69],
      ],
    },
    {
      name: 'a search stopped early by the candidate cap',
      chords: [
        makeChord(10, 'maj'),
        makeChord(3, 'maj'),
        makeChord(5, 'dom7'),
        makeChord(10, 'maj'),
      ],
      opts: { maxCandidates: 300, key: majorKey(10) },
      expected: [
        [46, 62, 65, 70],
        [51, 63, 67, 70],
        [53, 60, 63, 69],
        [46, 58, 62, 70],
      ],
    },
  ];

  for (const { name, chords, opts, expected } of cases) {
    it(`voices ${name} to fixed pitches`, () => {
      expect(voiceProgression(chords, opts)).toEqual(expected);
      // The first chord goes through voiceChord, so it is pinned there too.
      expect(voiceChord(chords[0] ?? makeChord(0, 'maj'), opts)).toEqual(expected[0]);
    });
  }
});

describe('the leading tone the voicer and the checker share', () => {
  const KEY = majorKey(0);
  const TONIC = makeChord(0, 'maj');
  /** C3 G3 C4 E4: it holds the tonic, drops the leading tone, and resolves nothing. */
  const TONIC_VOICING = [48, 55, 60, 64];

  // Each voicing sounds the key's leading tone in one voice, and every voice
  // moves somewhere other than a semitone up. Where the chord is one the leading
  // tone functions in, that voice is an outer one: an inner voice is allowed the
  // frustrated resolution, which would make the two rows disagree for a reason
  // this case is not about.
  const cases: { name: string; chord: Chord; voicing: number[] }[] = [
    { name: 'V', chord: makeChord(7, 'maj'), voicing: [43, 62, 67, 71] },
    { name: 'V7', chord: makeChord(7, 'dom7'), voicing: [43, 62, 65, 71] },
    { name: 'viio6', chord: makeChord(11, 'dim'), voicing: [50, 62, 65, 71] },
    { name: 'viim7b5', chord: makeChord(11, 'm7b5'), voicing: [50, 62, 65, 71] },
    { name: 'iii', chord: makeChord(4, 'min'), voicing: [52, 59, 64, 67] },
    { name: 'Imaj7', chord: makeChord(0, 'maj7'), voicing: [48, 55, 64, 71] },
    {
      name: 'a minor triad on the seventh degree',
      chord: makeChord(11, 'min'),
      voicing: [50, 62, 66, 71],
    },
  ];

  for (const { name, chord, voicing } of cases) {
    it(`treats ${name} the same way in the search and in the check`, () => {
      const functioning = isFunctioningLeadingTone(chord, KEY);
      const chords = [chord, TONIC];
      const spelled = [voicing, TONIC_VOICING].map((pitches, index) =>
        spellVoicing(pitches, chords[index] ?? TONIC, KEY),
      );
      const unresolved = checkPartWriting(spelled, chords, KEY).some(
        (violation) => violation.kind === 'unresolvedLeadingTone',
      );
      expect(unresolved, `checker on ${name}`).toBe(functioning);
      // The key only ever reaches the search through the same predicate, so a
      // chord the checker leaves alone must voice identically with and without
      // one.
      if (!functioning) {
        expect(voiceProgression(chords, { key: KEY }), `search on ${name}`).toEqual(
          voiceProgression(chords),
        );
      }
    });
  }

  it('does not report its own output as faulty', () => {
    // Imaj7 sounds the key's leading tone as its own seventh. An ungated rule
    // asks that voice to rise while the seventh rule asks it to fall, and the
    // library then fails the voicing it just wrote.
    const chords = [makeChord(0, 'maj7'), makeChord(5, 'maj')];
    const voiced = voiceProgression(chords, { key: KEY });
    expect(voiced).toEqual(voiceProgression(chords));
    const spelled = voiced.map((pitches, index) =>
      spellVoicing(pitches, chords[index] ?? TONIC, KEY),
    );
    expect(checkPartWriting(spelled, chords, KEY)).toEqual([]);
  });

  it('charges the seventh of Imaj7 once, as a seventh', () => {
    const chords = [makeChord(0, 'maj7'), makeChord(5, 'maj')];
    const spelled = [
      [48, 55, 64, 71],
      [53, 57, 60, 72],
    ].map((pitches, index) => spellVoicing(pitches, chords[index] ?? TONIC, KEY));
    expect(checkPartWriting(spelled, chords, KEY).map((violation) => violation.kind)).toEqual([
      'unresolvedSeventh',
    ]);
  });

  it('still resolves the dominant family', () => {
    for (const chord of [makeChord(7, 'dom7'), makeChord(11, 'dim')]) {
      const [prev, cur] = voiceProgression([chord, TONIC], { key: KEY });
      const voice = (prev ?? []).findIndex((pitch) => pc(pitch) === 11);
      expect(voice).toBeGreaterThanOrEqual(0);
      expect((cur ?? [])[voice] ?? 0).toBe(((prev ?? [])[voice] ?? 0) + 1);
    }
  });
});
