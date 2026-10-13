import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { spellLine } from '../src/analyze/spelling/index.js';
import { InvalidInputError } from '../src/core/errors/index.js';
import { parseNote } from '../src/core/pitch/index.js';
import { makeChord } from '../src/theory/chord/index.js';
import { majorKey } from '../src/theory/scale/index.js';
import {
  assertTonicOf,
  spellChord,
  spellPitch,
  spellPitchClass,
  spellPitchClasses,
  spellScale,
} from '../src/theory/spelling/index.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The two files whose exports take a spelled tonic alongside a key. */
const SPELLING_SOURCES = [
  path.join(SRC, 'theory/spelling/index.ts'),
  path.join(SRC, 'analyze/spelling/index.ts'),
];

/**
 * Every exported declaration in a file that receives a spelled tonic: a
 * function taking one as a parameter, or an options type carrying one.
 *
 * Read from the source rather than listed, so an entry point added beside the
 * others has to be checked here before it can ship.
 */
function tonicTakingExports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!exported(statement)) {
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.parameters.some((parameter) => parameter.name.getText() === 'tonic')
    ) {
      found.push(statement.name.text);
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      ts.isTypeLiteralNode(statement.type) &&
      statement.type.members.some((member) => member.name?.getText() === 'tonic')
    ) {
      found.push(statement.name.text);
    }
  }
  return found.sort();
}

const cMajor = majorKey(0);
const spellsC = parseNote('C');
const spellsD = parseNote('D');
const line = [{ pitch: 60, startBeat: 0, durationBeat: 1 }];

/**
 * One entry per spelling entry point: the same call written twice, once with a
 * tonic that spells the key's root and once with one that does not.
 *
 * The name is the exported declaration the call goes through, so the scan above
 * can check that nothing is missing from the table.
 */
const ENTRY_POINTS: { name: string; matching: () => unknown; mismatched: () => unknown }[] = [
  {
    name: 'assertTonicOf',
    matching: () => assertTonicOf(spellsC, cMajor, 'test'),
    mismatched: () => assertTonicOf(spellsD, cMajor, 'test'),
  },
  {
    name: 'spellPitchClass',
    matching: () => spellPitchClass(4, spellsC, cMajor),
    mismatched: () => spellPitchClass(4, spellsD, cMajor),
  },
  {
    name: 'spellPitchClasses',
    matching: () => spellPitchClasses([0, 4, 7], spellsC, cMajor),
    mismatched: () => spellPitchClasses([0, 4, 7], spellsD, cMajor),
  },
  {
    name: 'spellScale',
    matching: () => spellScale(spellsC, cMajor),
    mismatched: () => spellScale(spellsD, cMajor),
  },
  {
    name: 'spellChord',
    matching: () => spellChord(makeChord(7, 'dom7'), spellsC, cMajor),
    mismatched: () => spellChord(makeChord(7, 'dom7'), spellsD, cMajor),
  },
  {
    name: 'spellPitch',
    matching: () => spellPitch(64, spellsC, cMajor),
    mismatched: () => spellPitch(64, spellsD, cMajor),
  },
  {
    // The tonic reaches `spellLine` through its options rather than as a
    // parameter, which is why the scan looks at options types too.
    name: 'SpellLineOptions',
    matching: () => spellLine(line, null, cMajor, { tonic: spellsC }),
    mismatched: () => spellLine(line, null, cMajor, { tonic: spellsD }),
  },
];

describe('the tonic a spelling function is given', () => {
  it('is checked by every export that takes one', () => {
    // A tonic that sounds a pitch class other than the key's root anchors the
    // letters on the wrong degree, so the scale it spells names a letter twice
    // and reaches accidentals no reading of the key supports. One entry point
    // rejected the pair and its five siblings spelled it anyway.
    const scanned = SPELLING_SOURCES.flatMap(tonicTakingExports).sort();
    expect(scanned).toEqual(ENTRY_POINTS.map((entry) => entry.name).sort());
  });

  it.each(ENTRY_POINTS)('$name rejects a tonic that is not the key root', ({ mismatched }) => {
    expect(mismatched).toThrow(InvalidInputError);
  });

  it.each(ENTRY_POINTS)('$name spells a matching pair as before', ({ matching }) => {
    expect(matching).not.toThrow();
  });

  it('answers the way the class API answers', () => {
    // `new Key(scale, tonic)` has always refused the pair; the functional API
    // silently accepted it, so the two surfaces disagreed about the same input.
    expect(() => spellScale(parseNote('B'), majorKey(6))).toThrow(InvalidInputError);
    expect(() => spellScale(parseNote('Gb'), majorKey(6))).not.toThrow();
  });
});
