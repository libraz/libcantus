import { describe, expect, it } from 'vitest';
import { analyzeVoice, type VoiceNote } from '../src/analyze/voice/index.js';
import type { KeyScale } from '../src/core/types.js';
import type { Chord } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };
const cMaj: Chord = { rootPc: 0, quality: 'maj', intervals: [0, 4, 7] };
const fMaj: Chord = { rootPc: 5, quality: 'maj', intervals: [0, 4, 7] };

const noOtherVoices = () => [];

describe('analyzeVoice', () => {
  it('labels a prepared, resolving suspension as sus4-3', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 65, startBeat: 0, durationBeat: 1 }, // F over F major (preparation)
      { id: 2, pitch: 65, startBeat: 1, durationBeat: 1 }, // F over C major (suspension)
      { id: 3, pitch: 64, startBeat: 2, durationBeat: 1 }, // E (resolution)
    ];
    const chordAt = (beat: number): Chord => (beat < 1 ? fMaj : cMaj);
    // A C in the bass makes the suspended F a dissonant fourth, which is what
    // qualifies it as a genuine suspension.
    const cBass = () => [{ pitch: 60 }];
    const analyzed = analyzeVoice(voice, chordAt, cMajor, cBass);
    const suspension = analyzed[1]?.labels.find((l) => l.kind === 'suspension');
    expect(suspension).toEqual({ kind: 'suspension', type: 'sus4-3', resolveTo: 64 });
  });

  it('classifies the suspension subtype from the sounding bass, not the root', () => {
    // A 7-6 suspension: E is held over D minor in first inversion (F in the
    // bass) and resolves down to D. Above the bass F the held E is a seventh
    // (sus7-6); measured from the root D it would misread as a ninth (sus9-8).
    const dmOverF = makeChord(2, 'min', 5);
    const voice: VoiceNote[] = [
      { id: 1, pitch: 64, startBeat: 0, durationBeat: 1 }, // E over C major (preparation)
      { id: 2, pitch: 64, startBeat: 1, durationBeat: 1 }, // E over Dm/F (suspension)
      { id: 3, pitch: 62, startBeat: 2, durationBeat: 1 }, // D (resolution)
    ];
    const chordAt = (beat: number): Chord => (beat < 1 ? cMaj : dmOverF);
    const bass = (beat: number) => (beat < 1 ? [{ pitch: 48 }] : [{ pitch: 53 }]);
    const analyzed = analyzeVoice(voice, chordAt, cMajor, bass);
    const suspension = analyzed[1]?.labels.find((l) => l.kind === 'suspension');
    expect(suspension).toEqual({ kind: 'suspension', type: 'sus7-6', resolveTo: 62 });
  });

  it('gives simultaneous cluster notes no melodic labels', () => {
    // A C-D-E cluster struck together: under naive onset-sorted adjacency the
    // D would read as a passing tone between C and E, but nothing moves — it
    // is a sounding ninth against the chord.
    const voice: VoiceNote[] = [
      { id: 1, pitch: 60, startBeat: 0, durationBeat: 4 },
      { id: 2, pitch: 62, startBeat: 0, durationBeat: 4 },
      { id: 3, pitch: 64, startBeat: 0, durationBeat: 4 },
    ];
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    const dLabels = analyzed[1]?.labels ?? [];
    expect(dLabels.some((l) => l.kind === 'passing')).toBe(false);
    expect(dLabels.some((l) => l.kind === 'suspension')).toBe(false);
    expect(dLabels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('does not label a suspension when no other voice is dissonant against it', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 65, startBeat: 0, durationBeat: 1 }, // F over F major (preparation)
      { id: 2, pitch: 65, startBeat: 1, durationBeat: 1 }, // F over C major
      { id: 3, pitch: 64, startBeat: 2, durationBeat: 1 }, // E (resolution)
    ];
    const chordAt = (beat: number): Chord => (beat < 1 ? fMaj : cMaj);
    const analyzed = analyzeVoice(voice, chordAt, cMajor, noOtherVoices);
    const suspension = analyzed[1]?.labels.find((l) => l.kind === 'suspension');
    expect(suspension).toBeUndefined();
  });

  it('labels the flat ninth of a 7b9 chord as a ninth tension', () => {
    const c7b9 = makeChord(0, '7b9');
    const voice: VoiceNote[] = [{ id: 1, pitch: 61, startBeat: 0, durationBeat: 1 }]; // Db over C
    const analyzed = analyzeVoice(voice, () => c7b9, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('labels a stepwise connector between chord tones as passing', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 60, startBeat: 0, durationBeat: 1 }, // C
      { id: 2, pitch: 62, startBeat: 1, durationBeat: 1 }, // D (weak beat)
      { id: 3, pitch: 64, startBeat: 2, durationBeat: 1 }, // E
    ];
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[1]?.labels).toContainEqual({ kind: 'passing' });
  });

  it('labels chord tones with their role', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 60, startBeat: 0, durationBeat: 1 },
      { id: 2, pitch: 64, startBeat: 1, durationBeat: 1 },
    ];
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'chordTone', role: 'root' });
    expect(analyzed[1]?.labels).toContainEqual({ kind: 'chordTone', role: 'third' });
  });

  it('labels a returning stepwise motion as a neighbor', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 60, startBeat: 0, durationBeat: 1 },
      { id: 2, pitch: 62, startBeat: 1, durationBeat: 1 },
      { id: 3, pitch: 60, startBeat: 2, durationBeat: 1 },
    ];
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[1]?.labels).toContainEqual({ kind: 'neighbor' });
  });

  it('labels an early chord tone as an anticipation', () => {
    const gMaj: Chord = { rootPc: 7, quality: 'maj', intervals: [0, 4, 7] };
    const voice: VoiceNote[] = [
      { id: 1, pitch: 60, startBeat: 0, durationBeat: 1 }, // C over G (non-chord)
      { id: 2, pitch: 60, startBeat: 1, durationBeat: 1 }, // C over C (chord tone)
    ];
    const analyzed = analyzeVoice(voice, (b) => (b < 1 ? gMaj : cMaj), cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'anticipation' });
  });

  it('labels a step-then-leap-away figure as an escape tone', () => {
    const voice: VoiceNote[] = [
      { id: 1, pitch: 64, startBeat: 0, durationBeat: 1 }, // E
      { id: 2, pitch: 65, startBeat: 1, durationBeat: 1 }, // F (step up, NCT)
      { id: 3, pitch: 60, startBeat: 2, durationBeat: 1 }, // C (leap down)
    ];
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[1]?.labels).toContainEqual({ kind: 'escape' });
  });

  it('labels a chord ninth as a tension', () => {
    const cAdd9: Chord = { rootPc: 0, quality: 'add9', intervals: [0, 4, 7, 14] };
    const voice: VoiceNote[] = [{ id: 1, pitch: 62, startBeat: 0, durationBeat: 1 }]; // D
    const analyzed = analyzeVoice(voice, () => cAdd9, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('labels an isolated fourth as an avoid note', () => {
    const voice: VoiceNote[] = [{ id: 1, pitch: 65, startBeat: 0, durationBeat: 1 }]; // F over C
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'avoid' });
  });

  it('adds a leading-tone label alongside the chord role', () => {
    const gMaj: Chord = { rootPc: 7, quality: 'maj', intervals: [0, 4, 7] };
    const voice: VoiceNote[] = [
      { id: 1, pitch: 71, startBeat: 0, durationBeat: 1 }, // B, third of G
      { id: 2, pitch: 72, startBeat: 1, durationBeat: 1 }, // C, tonic
    ];
    const analyzed = analyzeVoice(voice, (b) => (b < 1 ? gMaj : cMaj), cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'leadingTone', resolveTo: 72 });
  });

  it('flags an unresolved dissonance with a resolution target', () => {
    const voice: VoiceNote[] = [{ id: 1, pitch: 68, startBeat: 0, durationBeat: 1 }]; // Ab over C
    const analyzed = analyzeVoice(voice, () => cMaj, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'needsResolution', resolveTo: 67 });
  });

  it('returns no labels without a chord', () => {
    const voice: VoiceNote[] = [{ id: 1, pitch: 61, startBeat: 0, durationBeat: 1 }];
    const analyzed = analyzeVoice(voice, () => null, cMajor, noOtherVoices);
    expect(analyzed[0]?.labels).toEqual([]);
  });
});
