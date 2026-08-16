import { describe, expect, it } from 'vitest';
import type { SuspensionFigure, TheoryLabel } from '../src/analyze/voice/index.js';
import { analyzeVoice } from '../src/analyze/voice/index.js';
import type { NoteEvent } from '../src/core/types.js';
import type { MelodyToneRole } from '../src/generate/harmonize/nct.js';
import { classifyMelodyTones } from '../src/generate/harmonize/nct.js';
import type { Chord } from '../src/theory/chord/index.js';
import { chordQualities, intervalAboveRoot, makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';

const cMajor = majorKey(0);

/** Lay pitches out as a line of quarter notes, one per beat. */
function line(pitches: number[]): NoteEvent[] {
  return pitches.map((pitch, index) => ({ pitch, startBeat: index, durationBeat: 1 }));
}

/**
 * The interval classes above the bass each figure names.
 *
 * A figure is written from the interval the suspended note forms with the bass,
 * so `4-3` is a fourth above it and `7-6` a seventh; the compound `9-8` is the
 * ninth, which reduces to the same interval class as a second.
 */
const FIGURE_INTERVALS: Record<SuspensionFigure, number[]> = {
  'sus2-3': [1, 2],
  'sus4-3': [5, 6],
  'sus6-5': [8, 9],
  'sus7-6': [10, 11],
  'sus9-8': [2],
};

/** The extension each interval class above the root forms, when it forms one. */
const TENSION_DEGREES: Record<number, 9 | 11 | 13> = {
  1: 9,
  2: 9,
  3: 9,
  5: 11,
  6: 11,
  8: 13,
  9: 13,
};

describe('suspension figures', () => {
  /**
   * A suspension over a sounding bass: the note is prepared by the same pitch
   * under a chord that owns it, then resolves by `delta` semitones.
   */
  function suspension(
    notePitch: number,
    delta: number,
    bassPitch: number,
    chord: Chord,
  ): SuspensionFigure | null {
    const preparation = makeChord(((notePitch % 12) + 12) % 12, 'maj');
    const analyzed = analyzeVoice(
      line([notePitch, notePitch, notePitch + delta]),
      (beat) => (beat < 1 ? preparation : chord),
      cMajor,
      () => [{ pitch: bassPitch }],
    );
    const label = analyzed[1]?.labels.find((entry) => entry.kind === 'suspension');
    return label?.kind === 'suspension' ? label.type : null;
  }

  it('names a second above the bass resolving up as the 2-3', () => {
    // C2 in the bass, D4 held over the arriving C major and rising to E4.
    expect(suspension(62, 2, 36, makeChord(0, 'maj'))).toBe('sus2-3');
  });

  it('leaves a retardation rising to the octave unfigured', () => {
    // C2 in the bass with B4 above it — a major seventh — resolving up by a
    // semitone to C5. That is the 7-8 retardation, not the 2-3 the figure
    // would claim, and the note forms no second with the bass at all.
    expect(suspension(71, 1, 36, makeChord(0, 'maj'))).toBeNull();
  });

  it('keeps every reported figure on an interval the note actually forms', () => {
    const failures: string[] = [];
    let figured = 0;
    for (let ic = 0; ic < 12; ic += 1) {
      for (const delta of [-2, -1, 1, 2]) {
        const bassPitch = 36;
        const notePitch = bassPitch + 36 + ic;
        const figure = suspension(notePitch, delta, bassPitch, makeChord(0, 'maj'));
        if (figure === null) {
          continue;
        }
        figured += 1;
        if (!FIGURE_INTERVALS[figure].includes(ic)) {
          failures.push(`ic ${ic} resolving by ${delta} reported as ${figure}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(figured).toBeGreaterThan(0);
  });
});

describe('the leaning figure carries one name across the layers', () => {
  // B - E - D over G major: the E leans in by leap on the stronger beat and
  // gives way by step in the other direction, which is the appoggiatura both
  // layers are looking at.
  const leaning = [
    { pitch: 71, startBeat: 1, durationBeat: 1 },
    { pitch: 76, startBeat: 2, durationBeat: 1 },
    { pitch: 74, startBeat: 3, durationBeat: 1 },
  ];

  it('names it the same string in the analysis and in the harmonizer', () => {
    // These two assignments only typecheck while both layers spell the figure
    // the same way, which is what keeps one legend covering both readings.
    const figure = 'appoggiatura';
    const noteLevel: TheoryLabel['kind'] = figure;
    const harmonizer: MelodyToneRole = figure;
    expect(noteLevel).toBe(harmonizer);

    expect(classifyMelodyTones(leaning, { numerator: 4, denominator: 4 })[1]?.role).toBe(figure);
    const labels = analyzeVoice(leaning, () => makeChord(7, 'maj'), cMajor)[1]?.labels ?? [];
    expect(labels).toContainEqual({ kind: figure, resolveTo: 74 });
  });

  it('keeps the escape tone, the mirror of the figure, apart from it', () => {
    // A - B - E over G major: stepping out of the harmony and leaving by leap
    // is the other figure, and naming both the same way would lose the
    // distinction the two layers agree on.
    const escaping = [
      { pitch: 71, startBeat: 1, durationBeat: 1 },
      { pitch: 69, startBeat: 2, durationBeat: 1 },
      { pitch: 74, startBeat: 3, durationBeat: 1 },
    ];
    const kinds = (analyzeVoice(escaping, () => makeChord(7, 'maj'), cMajor)[1]?.labels ?? []).map(
      (label) => label.kind,
    );
    expect(kinds).toContain('escape');
    expect(kinds).not.toContain('appoggiatura');
  });
});

describe('tension degrees', () => {
  it('reports the sharp ninth of an altered dominant as a ninth', () => {
    // C7#9 sounds its #9 as D#4 (63); reading it as a thirteenth named the most
    // idiomatic altered tension after an interval it does not form.
    const chord = parseChordSymbol('C7#9');
    const analyzed = analyzeVoice(line([63]), () => chord, cMajor);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('reports the flat ninth of the mirror chord as a ninth, as before', () => {
    const analyzed = analyzeVoice(line([61]), () => parseChordSymbol('C7b9'), cMajor);
    expect(analyzed[0]?.labels).toContainEqual({ kind: 'tension', degree: 9 });
  });

  it('names the extension every tension label reports, over the whole vocabulary', () => {
    // Every chord on every root against every pitch class: a tension label may
    // only name the extension its interval above the root forms, and no note
    // sounding against a chord may come back unclassified.
    const failures: string[] = [];
    let tensions = 0;
    for (const quality of chordQualities()) {
      for (let rootPc = 0; rootPc < 12; rootPc += 1) {
        const chord = makeChord(rootPc, quality);
        for (let pc = 0; pc < 12; pc += 1) {
          const analyzed = analyzeVoice(line([60 + pc]), () => chord, cMajor);
          const labels = analyzed[0]?.labels ?? [];
          const where = `${quality}@${rootPc}/${pc}`;
          if (labels.length === 0) {
            failures.push(`${where}: no label at all`);
          }
          const ic = intervalAboveRoot(60 + pc, chord);
          for (const label of labels) {
            if (label.kind !== 'tension') {
              continue;
            }
            tensions += 1;
            if (label.degree !== TENSION_DEGREES[ic]) {
              failures.push(`${where}: interval class ${ic} reported as ${label.degree}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(tensions).toBeGreaterThan(0);
  });
});
