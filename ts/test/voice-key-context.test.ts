import { describe, expect, it } from 'vitest';
import { analyzeVoice, type KeyContext, type VoiceNote } from '../src/analyze/voice/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';

const cMajor = majorKey(0);
const fMajor = majorKey(5);

const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };
const fMaj: Chord = { rootPc: 5, quality: 'maj', intervals: [0, 4, 7] };
const gMaj: Chord = { rootPc: 7, quality: 'maj', intervals: [0, 4, 7] };

/**
 * A voice with every figure the key can interact with: a prepared 4-3
 * suspension, a passing tone, and a leading tone resolving to the tonic.
 *
 * F over F major (preparation) — F over C major (suspension) — E (resolution) —
 * D (passing) — C — B over G major (leading tone) — C (tonic).
 */
const mixedVoice: VoiceNote[] = [
  { id: 1, pitch: 65, startBeat: 0, durationBeat: 1 },
  { id: 2, pitch: 65, startBeat: 1, durationBeat: 1 },
  { id: 3, pitch: 64, startBeat: 2, durationBeat: 1 },
  { id: 4, pitch: 62, startBeat: 3, durationBeat: 1 },
  { id: 5, pitch: 60, startBeat: 4, durationBeat: 1 },
  { id: 6, pitch: 71, startBeat: 5, durationBeat: 1 },
  { id: 7, pitch: 72, startBeat: 6, durationBeat: 1 },
];

const mixedChordAt = (beat: number): Chord => {
  if (beat < 1) {
    return fMaj;
  }
  if (beat < 5) {
    return cMaj;
  }
  return beat < 6 ? gMaj : cMaj;
};

/** A C in the bass, which is what makes the suspended F a dissonant fourth. */
const cBass = () => [{ pitch: 60 }];

describe('analyzeVoice key context', () => {
  it('reads a constant key and a callback returning it as the same key', () => {
    const fixed = analyzeVoice(mixedVoice, mixedChordAt, cMajor, cBass);
    const viaCallback = analyzeVoice(mixedVoice, mixedChordAt, () => cMajor, cBass);
    expect(viaCallback).toEqual(fixed);

    // The voice is only a meaningful compatibility case if it actually carries
    // the figures, so pin them down rather than trusting an equal pair of runs.
    expect(fixed[1]?.labels).toContainEqual({
      kind: 'suspension',
      type: 'sus4-3',
      resolveTo: 64,
    });
    expect(fixed[3]?.labels).toContainEqual({ kind: 'passing' });
    expect(fixed[5]?.labels).toContainEqual({ kind: 'leadingTone', resolveTo: 72 });
  });

  it('labels the same figure differently on each side of a modulation', () => {
    // Two identical B-to-C figures over an identical G-to-C harmony. B is the
    // leading tone of C major and a chromatic note in F major, so only the
    // second figure — the one whose tonic arrives after the modulation — is a
    // leading-tone resolution.
    const voice: VoiceNote[] = [
      { id: 1, pitch: 71, startBeat: 0, durationBeat: 1 },
      { id: 2, pitch: 72, startBeat: 1, durationBeat: 1 },
      { id: 3, pitch: 71, startBeat: 2, durationBeat: 1 },
      { id: 4, pitch: 72, startBeat: 3, durationBeat: 1 },
    ];
    const chordAt = (beat: number): Chord => (beat % 2 === 0 ? gMaj : cMaj);
    const key: KeyContext = (beat) => (beat < 2 ? fMajor : cMajor);

    const analyzed = analyzeVoice(voice, chordAt, key);

    expect(analyzed[0]?.labels.some((label) => label.kind === 'leadingTone')).toBe(false);
    expect(analyzed[2]?.labels).toContainEqual({ kind: 'leadingTone', resolveTo: 72 });
    // The harmonic reading is identical for both B's; the key alone differs.
    expect(analyzed[0]?.labels).toEqual([{ kind: 'chordTone', role: 'third' }]);
    expect(analyzed[2]?.labels).toEqual([
      { kind: 'chordTone', role: 'third' },
      { kind: 'leadingTone', resolveTo: 72 },
    ]);
  });

  it('reads the key at the beat the resolution lands on', () => {
    // The modulation starts on the arriving tonic at beat 2, so the B on beat 1
    // still sounds under F major. It is the leading tone of the key it arrives
    // in, not of the key it departs from.
    const voice: VoiceNote[] = [
      { id: 1, pitch: 71, startBeat: 1, durationBeat: 1 },
      { id: 2, pitch: 72, startBeat: 2, durationBeat: 1 },
    ];
    const analyzed = analyzeVoice(
      voice,
      (beat) => (beat < 2 ? gMaj : cMaj),
      (beat) => (beat < 2 ? fMajor : cMajor),
    );
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'leadingTone', resolveTo: 72 });
  });

  it('asks for the key only at beats inside the voice', () => {
    const asked: number[] = [];
    analyzeVoice(
      mixedVoice,
      mixedChordAt,
      (beat) => {
        asked.push(beat);
        return cMajor;
      },
      cBass,
    );

    const onsets = mixedVoice.map((note) => note.startBeat);
    const first = Math.min(...onsets);
    const last = Math.max(...mixedVoice.map((note) => note.startBeat + note.durationBeat));
    expect(asked.length).toBeGreaterThan(0);
    for (const beat of asked) {
      expect(beat).toBeGreaterThanOrEqual(first);
      expect(beat).toBeLessThanOrEqual(last);
      expect(onsets).toContain(beat);
    }
  });
});
