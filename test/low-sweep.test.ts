import { describe, expect, it } from 'vitest';
import { secondaryDominant } from '../src/analyze/functional/index.js';
import { BudgetExceededError, InvalidInputError } from '../src/core/errors/index.js';
import {
  formatTimeSignature,
  parseTimeSignature,
  type TimeSignature,
} from '../src/core/meter/index.js';
import { parseNote, spelledInterval } from '../src/core/pitch/index.js';
import { createRng } from '../src/core/random/index.js';
import { assertGenerationBudget, assertNoteEvent } from '../src/core/validation/index.js';
import { Chord, Key } from '../src/model/index.js';
import { majorKey } from '../src/theory/scale/index.js';

describe('meter round trips keep what they were given', () => {
  it('renders an additive grouping on request', () => {
    const aksak: TimeSignature = { numerator: 7, denominator: 8, grouping: [2, 2, 3] };
    expect(formatTimeSignature(aksak)).toBe('7/8');
    expect(formatTimeSignature(aksak, { grouping: true })).toBe('2+2+3/8');
  });

  it('rejects at parse time what every consumer would reject later', () => {
    expect(() => parseTimeSignature('0/4')).toThrow();
    expect(() => parseTimeSignature('4/0')).toThrow();
    expect(parseTimeSignature('7/8')).toEqual({ numerator: 7, denominator: 8 });
  });
});

describe('the random stream is not disturbed by a rejected call', () => {
  it('validates the probability before drawing', () => {
    const control = createRng(1);
    const first = [control.prob(0.5), control.prob(0.5)];

    const rng = createRng(1);
    expect(rng.prob(0.5)).toBe(first[0]);
    // A rejected call must not consume a draw, or catching the error would
    // silently shift every later value.
    expect(() => rng.prob(2)).toThrow(RangeError);
    expect(rng.prob(0.5)).toBe(first[1]);
  });

  it('rejects a seed the 32-bit state cannot hold', () => {
    expect(() => createRng(-1)).toThrow(RangeError);
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(2 ** 33)).toThrow(RangeError);
    expect(() => createRng(0xffffffff)).not.toThrow();
  });
});

describe('guards say which kind of failure happened', () => {
  it('calls a negative estimate a bad argument, not a budget overrun', () => {
    expect(() => assertGenerationBudget(-1, 'events')).toThrow(InvalidInputError);
    expect(() => assertGenerationBudget(11, 'events', 10)).toThrow(BudgetExceededError);
  });

  it('requires a note pitch to be a MIDI number', () => {
    expect(() => assertNoteEvent({ pitch: 60.5, startBeat: 0, durationBeat: 1 })).toThrow(
      RangeError,
    );
    expect(() => assertNoteEvent({ pitch: 128, startBeat: 0, durationBeat: 1 })).toThrow(
      RangeError,
    );
    expect(() => assertNoteEvent({ pitch: -1, startBeat: 0, durationBeat: 1 })).toThrow(RangeError);
  });
});

describe('spelled intervals refuse an undefined comparison', () => {
  it('rejects one note with an octave and one without', () => {
    expect(() => spelledInterval(parseNote('C4'), parseNote('G'))).toThrow(RangeError);
    expect(() => spelledInterval(parseNote('C'), parseNote('G4'))).toThrow(RangeError);
    expect(() => spelledInterval(parseNote('C'), parseNote('G'))).not.toThrow();
    expect(() => spelledInterval(parseNote('C4'), parseNote('G4'))).not.toThrow();
  });
});

describe('a scale degree outside the scale is an error', () => {
  it('does not wrap around to tonicize some other degree', () => {
    expect(() => secondaryDominant(7, majorKey(0))).toThrow(RangeError);
    expect(() => secondaryDominant(-1, majorKey(0))).toThrow(RangeError);
    expect(secondaryDominant(4, majorKey(0)).rootPc).toBe(2); // V/V in C is D7
  });
});

describe('a stale spelling hint is dropped, not trusted', () => {
  it('ignores a root spelling that no longer names the root', () => {
    // The hint says Bb while the root is C; the formatter must not print Bb.
    const chord = Chord.from({
      rootPc: 0,
      quality: 'maj',
      intervals: [0, 4, 7],
      rootSpelling: { letter: 6, alter: -1 },
    });
    expect(chord.symbol()).toBe('C');
    // With the hint gone there is no spelling of its own, so a key is needed.
    expect(() => chord.spell()).toThrow(/no key context/);
    expect(
      chord
        .withKey(Key.major('C'))
        .spell()
        .map((note) => note.name),
    ).toEqual(['C', 'E', 'G']);
  });
});
