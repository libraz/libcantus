import { describe, expect, it } from 'vitest';
import {
  classifyInterval,
  isConsonantInterval,
  isPerfectInterval,
} from '../src/core/interval/index.js';
import {
  isCompound,
  metricWeight,
  pulsesPerBar,
  type TimeSignature,
  tuplet,
} from '../src/core/meter/index.js';
import {
  formatNote,
  midiToNote,
  noteToMidi,
  noteToPitchClass,
  parseNote,
  pitchClassOf,
} from '../src/core/pitch/index.js';
import { createRng } from '../src/core/random/index.js';
import {
  edo,
  frequencyOf,
  JUST_RATIOS,
  nearestStep,
  ratioToCents,
  TWELVE_TET,
} from '../src/core/tuning/index.js';
import type { NoteEvent } from '../src/core/types.js';
import {
  assertFiniteNumber,
  assertGenerationBudget,
  assertNoteEvent,
  assertNoteEvents,
  assertPositiveInt,
  assertRange,
  assertTimeSignature,
} from '../src/core/validation/index.js';
import { generateDrums } from '../src/generate/drums/index.js';
import { harmonizeMelody } from '../src/generate/harmonize/index.js';
import { generateMotif } from '../src/generate/motif/index.js';
import { generateProgression } from '../src/generate/progression/index.js';
import { generateRhythm } from '../src/generate/rhythm/index.js';
import { Note } from '../src/model/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey, NAMED_SCALES, scaleByName } from '../src/theory/scale/index.js';
import { parseChordSymbol } from '../src/theory/symbol/index.js';
import { SATB_RANGES } from '../src/theory/voicing/index.js';

describe('shared numeric input contracts', () => {
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects non-finite value %s', (value) => {
    expect(() => assertFiniteNumber(value, 'value')).toThrow(RangeError);
  });

  it('checks integer, range, and generation budget boundaries', () => {
    expect(assertPositiveInt(1, 'count')).toBe(1);
    expect(() => assertPositiveInt(1.5, 'count')).toThrow(RangeError);
    expect(assertRange(1, 0, 1, 'ratio')).toBe(1);
    expect(() => assertRange(-1, 0, 1, 'ratio')).toThrow(RangeError);
    expect(assertGenerationBudget(10, 'events', 10)).toBe(10);
    expect(() => assertGenerationBudget(11, 'events', 10)).toThrow(RangeError);
  });

  it('validates meter grouping before downbeat and off-pulse early returns', () => {
    const invalid = { numerator: 7, denominator: 8, grouping: [2, 2] };
    expect(() => metricWeight(0, invalid)).toThrow(RangeError);
    expect(() => metricWeight(0.25, invalid)).toThrow(RangeError);
    expect(() => tuplet(1, 1_000_001)).toThrow(RangeError);
  });

  it('rejects invalid tuning and random ranges consistently', () => {
    expect(() => edo(0)).toThrow(RangeError);
    expect(() => frequencyOf(Number.NaN)).toThrow(RangeError);
    expect(() => nearestStep(0)).toThrow(RangeError);
    expect(() => ratioToCents(3, 0)).toThrow(RangeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createRng(1).range(4, 3)).toThrow(RangeError);
    expect(() => createRng(1).range(1.5, 3)).toThrow(RangeError);
    expect(() => createRng(1).float(2, 1)).toThrow(RangeError);
  });

  it.each([
    () => generateRhythm({ numerator: 4, denominator: 4 }, { bars: Number.POSITIVE_INFINITY }),
    () => generateRhythm({ numerator: 4, denominator: 4 }, { subdivision: 1_000_001 }),
    () => generateProgression({ key: majorKey(0), style: 'dance', bars: 1.5 }),
    () => generateMotif({ key: majorKey(0), bars: Number.NaN }),
    () =>
      generateDrums({
        bars: 1,
        bpm: 120,
        style: 'standard',
        section: 'verse',
        density: Number.NaN,
        fills: false,
      }),
    () =>
      harmonizeMelody({
        melody: [{ pitch: 60, startBeat: 0, durationBeat: 1 }],
        key: majorKey(0),
        harmonicRhythm: Number.POSITIVE_INFINITY,
        reharmonize: 'diatonic',
        placement: { transposeSearch: false, octaveSearch: false },
      }),
  ])('rejects unsafe generator input before looping or allocating', (generate) => {
    expect(generate).toThrow(RangeError);
  });
});

describe('core guards reject what would otherwise flow on as garbage', () => {
  it('rejects a non-finite MIDI number instead of naming it CNaN', () => {
    expect(() => midiToNote(Number.NaN)).toThrow(RangeError);
    expect(() => midiToNote(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => Note.fromMidi(Number.NaN)).toThrow(RangeError);
    expect(() => pitchClassOf(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a note whose fields are not finite integers', () => {
    expect(() => formatNote({ letter: 0, alter: Number.NaN })).toThrow(RangeError);
    expect(() => noteToMidi({ letter: 0, alter: 0, octave: Number.NaN })).toThrow(RangeError);
    expect(() => noteToPitchClass({ letter: Number.NaN, alter: 0 })).toThrow(RangeError);
  });

  it('rejects an alteration wide enough to blow up glyph rendering', () => {
    expect(() => formatNote({ letter: 0, alter: 1e6 })).toThrow(RangeError);
    expect(() => parseNote(`C${'#'.repeat(40)}`)).toThrow(RangeError);
  });

  it('rejects a non-finite interval instead of silently calling it a dissonance', () => {
    expect(() => classifyInterval(Number.NaN)).toThrow(RangeError);
    expect(() => isConsonantInterval(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => isPerfectInterval(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a hole or an undefined element in a note-event array', () => {
    const sparse: NoteEvent[] = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];
    sparse[2] = { pitch: 62, startBeat: 2, durationBeat: 1 };
    expect(() => assertNoteEvents(sparse)).toThrow(RangeError);
    expect(() => assertNoteEvents([undefined as unknown as NoteEvent])).toThrow(RangeError);
  });

  it('names a zero-length note as such instead of quoting a denormal bound', () => {
    expect(() => assertNoteEvent({ pitch: 60, startBeat: 0, durationBeat: 0 })).toThrow(
      /durationBeat must be positive/,
    );
  });
});

describe('lookup tables cannot be reached through the prototype chain', () => {
  it('rejects an inherited property name as a scale', () => {
    for (const name of [
      'bogus',
      'toString',
      'constructor',
      '__proto__',
      'valueOf',
      'hasOwnProperty',
    ]) {
      expect(() => scaleByName(name, 0), name).toThrow();
    }
  });

  it('rejects an inherited property name as a chord quality', () => {
    for (const suffix of ['bogus', 'toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(() => parseChordSymbol(`C${suffix}`), suffix).toThrow();
    }
    expect(() => makeChord(0, 'toString' as never)).toThrow();
  });

  it('leaves the public constant tables frozen', () => {
    expect(Object.isFrozen(TWELVE_TET)).toBe(true);
    expect(Object.isFrozen(NAMED_SCALES)).toBe(true);
    expect(Object.isFrozen(JUST_RATIOS)).toBe(true);
    expect(Object.isFrozen(SATB_RANGES)).toBe(true);
    expect(SATB_RANGES.every((range) => Object.isFrozen(range))).toBe(true);
  });
});

describe('additive metres stay expressible', () => {
  it('accepts a grouping in denominator units for a compound numerator', () => {
    const aksak: TimeSignature = { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] };
    expect(() => assertTimeSignature(aksak)).not.toThrow();
    expect(pulsesPerBar(aksak)).toBe(9);
    expect(isCompound(aksak)).toBe(false);
    // Group heads land on the 1st, 3rd, 5th and 7th quavers.
    expect(metricWeight(0, aksak)).toBe(3);
    expect(metricWeight(1, aksak)).toBe(2);
    expect(metricWeight(0.5, aksak)).toBe(1);
  });

  it('still accepts a grouping of the compound pulses', () => {
    const nine: TimeSignature = { numerator: 9, denominator: 8, grouping: [1, 1, 1] };
    expect(pulsesPerBar(nine)).toBe(3);
    expect(isCompound(nine)).toBe(true);
  });

  it('keeps pulse counts exact for a denominator that does not divide evenly', () => {
    const odd: TimeSignature = { numerator: 7, denominator: 12 };
    expect(pulsesPerBar(odd)).toBe(7);
    expect(() => metricWeight(0, odd)).not.toThrow();
  });
});
