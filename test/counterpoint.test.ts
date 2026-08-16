import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

  it('degrades to false on MIDI integers rather than refusing them', () => {
    // Every augmented interval sounds like a plain one, so a bare pitch pair
    // carries nothing this rule can read; a host sweeping the whole predicate
    // set over numbers still gets an answer.
    expect(isAugmentedMelodicInterval(68, 71)).toBe(false); // Ab4 -> B4 as integers
    expect(isAugmentedMelodicInterval(65, 71)).toBe(false); // F4 -> B4 as integers
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'src/theory/counterpoint/index.ts');
const GUIDES = ['en', 'ja'].map((lang) => ({
  lang,
  file: path.join(ROOT, 'docs', lang, 'counterpoint-and-part-writing.md'),
}));

/**
 * The exported predicates declaring a MIDI-integer overload beside the spelled
 * one — read from the source rather than listed, so a predicate that gains or
 * loses its numeric form moves this set on its own.
 */
function dualFormPredicates(): string[] {
  const source = ts.createSourceFile(
    MODULE,
    readFileSync(MODULE, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const forms = new Map<string, Set<string>>();
  for (const statement of source.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.body !== undefined ||
      statement.name === undefined ||
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    const first = statement.parameters[0]?.type;
    const form =
      first?.kind === ts.SyntaxKind.NumberKeyword
        ? 'number'
        : first !== undefined && ts.isTypeReferenceNode(first) && first.getText() === 'Note'
          ? 'note'
          : null;
    if (form === null) {
      continue;
    }
    const seen = forms.get(statement.name.text) ?? new Set<string>();
    seen.add(form);
    forms.set(statement.name.text, seen);
  }
  return [...forms]
    .filter(([, seen]) => seen.has('number') && seen.has('note'))
    .map(([name]) => name)
    .sort();
}

/** Markdown prose with the fenced blocks removed. */
function prose(file: string): string {
  return readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```/gm, '');
}

describe('the dual-form predicate set the guide names', () => {
  it.each(GUIDES)('$lang lists exactly the predicates that take MIDI numbers', ({ file }) => {
    // The guide's claim is a set equality, so it is checked as one: a predicate
    // that only reads spelling must not be advertised as taking integers, and
    // one that takes both must not be left out of the sweep a host writes.
    const paragraph = prose(file)
      .split(/\n\s*\n/)
      .filter((block) => block.includes('isAugmentedMelodicInterval'));
    expect(paragraph).toHaveLength(1);
    const named = [...(paragraph[0] as string).matchAll(/`([A-Za-z_$][\w$]*)`/g)]
      .map((match) => match[1] as string)
      .sort();
    expect(named).toEqual(dualFormPredicates());
  });
});
