import { describe, expect, it } from 'vitest';
import { ConsonanceClass } from '../src/core/interval/index.js';
import { parseInterval, parseNote } from '../src/core/pitch/index.js';
import type { KeyScale } from '../src/core/types.js';
import {
  classifySpelledInterval,
  createsBattuta,
  createsHiddenParallelPerfect,
  createsParallelOctave,
  createsParallelPerfect,
  createsVerticalDissonance,
  createsVoiceCrossing,
  isAugmentedMelodicInterval,
  isForbiddenMelodicLeap,
  isLeadingToneResolution,
} from '../src/theory/counterpoint/index.js';
import { MAJOR_MASK } from '../src/theory/scale/index.js';

const cMajor: KeyScale = { rootPc: 0, modeMask12: MAJOR_MASK };

/** Spell a note name, for the predicates that read spelling. */
const note = (name: string) => parseNote(name);

describe('counterpoint predicates', () => {
  it('flags consecutive parallel fifths', () => {
    expect(createsParallelPerfect(67, 69, 60, 62)).toBe(true);
    expect(createsParallelPerfect(67, 67, 60, 62)).toBe(false);
  });

  it('flags consecutive parallel octaves', () => {
    expect(createsParallelOctave(72, 74, 60, 62)).toBe(true);
    expect(createsParallelOctave(69, 71, 60, 62)).toBe(false);
  });

  it('flags hidden perfect intervals by similar motion', () => {
    expect(createsHiddenParallelPerfect(64, 67, 60, 60)).toBe(false);
    expect(createsHiddenParallelPerfect(64, 67, 55, 60)).toBe(true);
  });

  it('detects voice crossing', () => {
    expect(createsVoiceCrossing(60, 64)).toBe(true);
    expect(createsVoiceCrossing(67, 60)).toBe(false);
  });

  it('detects vertical dissonance with the two-voice fourth rule', () => {
    expect(createsVerticalDissonance(66, 60, true)).toBe(true); // tritone
    expect(createsVerticalDissonance(65, 60, true)).toBe(true); // fourth, two-voice
    expect(createsVerticalDissonance(65, 60, false)).toBe(false); // fourth, allowed
    expect(() => createsVerticalDissonance(Number.NaN, 60, true)).toThrow(RangeError);
  });

  it('flags forbidden melodic leaps', () => {
    expect(isForbiddenMelodicLeap(60, 66)).toBe(true); // tritone
    expect(isForbiddenMelodicLeap(60, 71)).toBe(true); // major seventh
    expect(isForbiddenMelodicLeap(60, 67)).toBe(false); // fifth
  });

  it('recognizes a leading-tone resolution to the tonic', () => {
    expect(isLeadingToneResolution(71, 72, cMajor)).toBe(true); // B -> C
    expect(isLeadingToneResolution(71, 69, cMajor)).toBe(false); // B -> A
  });
});

describe('spelled input', () => {
  it('classifies an interval by its spelling, not its sound', () => {
    expect(classifySpelledInterval(parseInterval('d4'))).toBe(ConsonanceClass.Dissonance);
    expect(classifySpelledInterval(parseInterval('M3'))).toBe(ConsonanceClass.ImperfectConsonance);
    expect(classifySpelledInterval(parseInterval('A5'))).toBe(ConsonanceClass.Dissonance);
    expect(classifySpelledInterval(parseInterval('P5'))).toBe(ConsonanceClass.PerfectConsonance);
    expect(classifySpelledInterval(parseInterval('P4'))).toBe(ConsonanceClass.Dissonance);
    expect(classifySpelledInterval(parseInterval('P4'), false)).toBe(
      ConsonanceClass.ImperfectConsonance,
    );
    expect(classifySpelledInterval(parseInterval('P12'))).toBe(ConsonanceClass.PerfectConsonance);
  });

  it('hears a diminished fourth as the dissonance it is', () => {
    // Both spellings sound four semitones apart; only one is a consonance.
    expect(createsVerticalDissonance(note('Fb4'), note('C4'), true)).toBe(true);
    expect(createsVerticalDissonance(note('E4'), note('C4'), true)).toBe(false);
    expect(createsVerticalDissonance(64, 60, true)).toBe(false);
  });

  it('flags the augmented second a MIDI integer cannot show', () => {
    expect(isForbiddenMelodicLeap(note('Ab4'), note('B4'))).toBe(true);
    expect(isForbiddenMelodicLeap(note('A4'), note('C5'))).toBe(false);
    expect(isForbiddenMelodicLeap(68, 71)).toBe(false); // the same pitches, as a minor third
  });

  it('forbids diminished as well as augmented melodic intervals', () => {
    expect(isForbiddenMelodicLeap(note('B4'), note('F5'))).toBe(true); // diminished fifth
    expect(isForbiddenMelodicLeap(note('C5'), note('B3'))).toBe(true); // major seventh down
    expect(isForbiddenMelodicLeap(note('C4'), note('C5'))).toBe(false); // the octave is allowed
  });

  it('names an augmented melodic interval on its own', () => {
    expect(isAugmentedMelodicInterval(note('Ab4'), note('B4'))).toBe(true);
    expect(isAugmentedMelodicInterval(note('F4'), note('B4'))).toBe(true);
    expect(isAugmentedMelodicInterval(note('B4'), note('F5'))).toBe(false); // diminished, not augmented
    expect(isAugmentedMelodicInterval(note('C4'), note('C#4'))).toBe(false); // a chromatic inflection
  });

  it('reads the register rules off spelled notes as readily as off pitches', () => {
    expect(createsVoiceCrossing(note('C4'), note('E4'))).toBe(true);
    expect(createsParallelPerfect(note('G4'), note('A4'), note('C4'), note('D4'))).toBe(true);
    expect(createsHiddenParallelPerfect(note('E4'), note('G4'), note('G3'), note('C4'))).toBe(true);
    expect(isLeadingToneResolution(note('B4'), note('C5'), cMajor)).toBe(true);
  });

  it('flags an octave taken by a downward leap against a rising lower voice', () => {
    expect(createsBattuta(note('G5'), note('D5'), note('C4'), note('D4'))).toBe(true);
    expect(createsBattuta(note('E5'), note('D5'), note('C4'), note('D4'))).toBe(false); // by step
    expect(createsBattuta(72, 74, 60, 62)).toBe(false); // similar motion is not a battuta
  });
});
