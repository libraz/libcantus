import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './support/source-files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'src/theory/counterpoint/index.ts');
const GUIDES = ['en', 'ja'].map((lang) => ({
  lang,
  file: path.join(REPO_ROOT, 'docs', lang, 'counterpoint-and-part-writing.md'),
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
