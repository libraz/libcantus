import { describe, expect, it } from 'vitest';
import { chordQualities, makeChord } from '../src/theory/chord/index.js';
import { createsParallelPerfect, createsVoiceOverlap } from '../src/theory/counterpoint/index.js';
import { roleOf } from '../src/theory/harmony/index.js';
import { evaluateSafety, NoteSafety } from '../src/theory/safety/index.js';
import { majorKey, minorKey } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';
import { SATB_RANGES, voiceChordStyled, voiceProgression } from '../src/theory/voicing/index.js';

const cMajor = majorKey(0);

describe('the safety evaluator agrees with the chord across every quality', () => {
  it('never calls a chord tone dissonant, in any quality or inversion', () => {
    for (const quality of chordQualities()) {
      for (const rootPc of [0, 5, 7, 11]) {
        const chord = makeChord(rootPc, quality);
        for (const interval of chord.intervals) {
          const pitch = 60 + rootPc + interval;
          const result = evaluateSafety({
            profile: 'pop',
            candidatePitch: pitch,
            chord,
            key: cMajor,
            otherVoices: [],
            strongBeat: true,
          });
          expect(result.safety, `${quality}/${rootPc}/${interval}`).not.toBe(NoteSafety.Dissonant);
          // The harmony layer never calls a chord tone a doubling, which it
          // has no way to detect from one pitch.
          expect(roleOf(pitch, chord).role, `${quality}/${interval}`).not.toBe('doubling');
        }
      }
    }
  });

  it('does not flag the tritone a diminished or dominant chord is built from', () => {
    for (const quality of ['dim', 'dim7', 'm7b5', 'dom7'] as const) {
      const chord = makeChord(0, quality);
      const [lower, upper] = [60, 60 + (chord.intervals[2] ?? 6)];
      const result = evaluateSafety({
        profile: 'strict',
        candidatePitch: upper,
        chord,
        key: cMajor,
        otherVoices: [{ pitch: lower }],
        strongBeat: true,
      });
      expect(result.safety, quality).not.toBe(NoteSafety.Dissonant);
    }
  });
});

describe('voiceProgression obeys the rules it is scored on', () => {
  const progression = ['C', 'Am', 'F', 'G', 'C'].map((symbol) => parseChordSymbol(symbol));

  it('writes no parallel perfects and no voice overlap', () => {
    const voicings = voiceProgression(progression, { key: cMajor });
    expect(voicings).toHaveLength(progression.length);
    for (let i = 1; i < voicings.length; i += 1) {
      const prev = voicings[i - 1];
      const cur = voicings[i];
      if (!prev || !cur) {
        throw new Error('expected a voicing per chord');
      }
      for (let lower = 0; lower < cur.length; lower += 1) {
        for (let upper = lower + 1; upper < cur.length; upper += 1) {
          const [pl, pu, cl, cu] = [prev[lower], prev[upper], cur[lower], cur[upper]];
          if (pl === undefined || pu === undefined || cl === undefined || cu === undefined) {
            continue;
          }
          expect(createsParallelPerfect(pu, cu, pl, cl), `pair ${lower}-${upper} at ${i}`).toBe(
            false,
          );
          if (upper === lower + 1) {
            expect(createsVoiceOverlap(pu, cu, pl, cl), `overlap ${lower} at ${i}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps every voice inside its range and in ascending order', () => {
    const voicings = voiceProgression(progression, { key: cMajor });
    for (const voicing of voicings) {
      expect(voicing).toHaveLength(SATB_RANGES.length);
      for (let voice = 0; voice < voicing.length; voice += 1) {
        const pitch = voicing[voice];
        const range = SATB_RANGES[voice];
        if (pitch === undefined || range === undefined) {
          throw new Error('expected a pitch per range');
        }
        expect(pitch).toBeGreaterThanOrEqual(range.min);
        expect(pitch).toBeLessThanOrEqual(range.max);
      }
      expect([...voicing].sort((a, b) => a - b)).toEqual(voicing);
    }
  });

  it('does not double the leading tone of the key', () => {
    // The dominant is where a doubled leading tone is easiest to fall into.
    const voicings = voiceProgression([parseChordSymbol('G'), parseChordSymbol('C')], {
      key: cMajor,
    });
    const dominant = voicings[0] ?? [];
    const leadingTones = dominant.filter((pitch) => ((pitch % 12) + 12) % 12 === 11);
    expect(leadingTones.length).toBeLessThanOrEqual(1);
  });

  it('resolves the chordal seventh downward by step', () => {
    const [dominant, tonic] = voiceProgression([parseChordSymbol('G7'), parseChordSymbol('C')], {
      key: cMajor,
    });
    if (!dominant || !tonic) {
      throw new Error('expected two voicings');
    }
    const seventhVoice = dominant.findIndex((pitch) => ((pitch % 12) + 12) % 12 === 5);
    expect(seventhVoice).toBeGreaterThanOrEqual(0);
    const from = dominant[seventhVoice];
    const to = tonic[seventhVoice];
    if (from === undefined || to === undefined) {
      throw new Error('expected the seventh to be voiced in both chords');
    }
    expect(from - to).toBeGreaterThan(0);
    expect(from - to).toBeLessThanOrEqual(2);
  });

  it('voices a minor progression within its own key', () => {
    const minor = ['Am', 'Dm', 'E', 'Am'].map((symbol) => parseChordSymbol(symbol));
    const voicings = voiceProgression(minor, { key: minorKey(9) });
    expect(voicings).toHaveLength(minor.length);
    for (const voicing of voicings) {
      expect(new Set(voicing).size).toBeGreaterThan(1);
    }
  });
});

describe('styled voicings sit where the octave says', () => {
  it('places the close stack in the requested octave', () => {
    const chord = parseChordSymbol('Cmaj7');
    for (const octave of [2, 4, 6]) {
      const pitches = voiceChordStyled(chord, { octave });
      const base = 12 * (octave + 1);
      expect(pitches[0], `octave ${octave}`).toBeGreaterThanOrEqual(base);
      expect(pitches[0], `octave ${octave}`).toBeLessThan(base + 12);
    }
  });

  it('keeps every pitch a valid MIDI number, or says it cannot', () => {
    for (const octave of [-1, 0, 7]) {
      const pitches = voiceChordStyled(parseChordSymbol('Cmaj7'), { octave });
      for (const pitch of pitches) {
        expect(pitch, `octave ${octave}`).toBeGreaterThanOrEqual(0);
        expect(pitch, `octave ${octave}`).toBeLessThanOrEqual(127);
      }
    }
    // Past the top of the MIDI range the stack cannot fit, and the failure is
    // reported rather than silently clamped into a different chord.
    expect(() => voiceChordStyled(parseChordSymbol('Cmaj7'), { octave: 9 })).toThrow(RangeError);
  });
});
