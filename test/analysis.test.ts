import { describe, expect, it } from 'vitest';
import { analyzeVoice, type VoiceNote } from '../src/analysis/index.js';
import type { Chord } from '../src/chord/index.js';
import { MAJOR_MASK } from '../src/scale/index.js';
import type { KeyScale } from '../src/types.js';

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
    const analyzed = analyzeVoice(voice, chordAt, cMajor, noOtherVoices);
    const suspension = analyzed[1]?.labels.find((l) => l.kind === 'suspension');
    expect(suspension).toEqual({ kind: 'suspension', type: 'sus4-3', resolveTo: 64 });
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
