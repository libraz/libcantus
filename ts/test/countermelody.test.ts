import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/core/errors/index.js';
import type { KeyScale, NoteEvent } from '../src/core/types.js';
import type { CounterMelodyOptions } from '../src/generate/countermelody/index.js';
import { generateCounterMelody } from '../src/generate/countermelody/index.js';
import type { Chord } from '../src/theory/chord/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

/** One chord per 4/4 bar: C, Am, F, G, repeating. */
const progression: Chord[] = [
  makeChord(0, 'maj'),
  makeChord(9, 'min'),
  makeChord(5, 'maj'),
  makeChord(7, 'maj'),
];
const chordAt = (beat: number): Chord | null =>
  progression[Math.floor(beat / 4) % progression.length] ?? null;

/** Quarter-note melody starting at beat 0, chord tones on the strong beats. */
const melody: NoteEvent[] = [72, 71, 67, 64, 69, 67, 64, 60].map((pitch, i) => ({
  pitch,
  startBeat: i,
  durationBeat: 1,
  velocity: 100,
}));

function generate(over: Partial<CounterMelodyOptions> = {}): NoteEvent[] {
  return generateCounterMelody({ melody, chordAt, key: cMajor, ...over });
}

describe('ranking weight overrides', () => {
  it('rejects a weight written as an explicit undefined', () => {
    expect(() => generate({ weights: { chordTone: undefined as unknown as number } })).toThrow(
      InvalidInputError,
    );
  });
});
