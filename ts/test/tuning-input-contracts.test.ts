import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tsdocExamples } from './support/doc-examples.js';
import { PACKAGE_ROOT, SRC } from './support/source-files.js';

describe('a reference step is only required to be finite', () => {
  it('says so where the throws are documented', () => {
    const source = readFileSync(resolve(SRC, 'model/tuning.ts'), 'utf8');
    for (const member of ['static of(', 'static edo(']) {
      const doc = docAbove(source, member);
      expect(doc).toContain('reference step is not finite');
      expect(doc).not.toContain('reference step or frequency is not a finite positive number');
    }
  });
});

describe('the just ratio table is indexed by the classes it lists', () => {
  it('types an index outside 0..12 as an error', () => {
    const inRange = probe('const entry: readonly [number, number] = JUST_RATIOS[7];');
    const outOfRange = probe('const entry: readonly [number, number] = JUST_RATIOS[14];');
    expect(inRange).toEqual([]);
    expect(outOfRange.join(' ')).toMatch(/14/);
    expect(outOfRange.length).toBeGreaterThan(0);
  });

  it('resolves its own lookup without a suppression', () => {
    const source = readFileSync(resolve(SRC, 'core/tuning/index.ts'), 'utf8');
    expect(source).not.toMatch(/@ts-(expect-error|ignore|nocheck)/);
    expect(probe('justDeviationCents(7);', true)).toEqual([]);
  });
});

describe('the tuning documentation stands on its own', () => {
  it('imports the package rather than the source tree in every example', () => {
    const file = resolve(SRC, 'model/tuning.ts');
    const specifiers = tsdocExamples(readFileSync(file, 'utf8'))
      .filter((block) => block.lang === 'ts')
      .flatMap((block) => [...block.code.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]));
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier?.startsWith('.'))).toEqual([]);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^@libraz\/libcantus(\/|$)/);
    }
  });

  it('describes the two-argument ratio factory above it', () => {
    const doc = docAbove(
      readFileSync(resolve(SRC, 'core/tuning/index.ts'), 'utf8'),
      'function justRatio',
    );
    expect(doc).toContain('numerator');
    expect(doc).toContain('denominator');
    expect(doc).not.toContain('@category');
    expect(doc).not.toContain('indexed by semitone class');
  });
});

/**
 * The doc comment written directly above a declaration, with its asterisks and
 * line breaks folded away so a claim can be read as one sentence.
 *
 * @param source The source file text.
 * @param marker The opening text of the declaration the comment belongs to.
 * @returns The comment as a single line.
 */
function docAbove(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, marker).toBeGreaterThan(0);
  return source
    .slice(source.lastIndexOf('/**', at), at)
    .replace(/\s*\*+\s*/g, ' ')
    .trim();
}

/**
 * Semantic diagnostics of a snippet compiled against the real sources, so a
 * type that stops rejecting an index is a failing test rather than a comment.
 *
 * @param body Statements to compile after the import of the tuning module.
 * @param wholeProgram Whether to report the diagnostics of the tuning module
 *   itself instead of the snippet's.
 * @returns The diagnostic messages, empty when the snippet type-checks.
 */
function probe(body: string, wholeProgram = false): string[] {
  const config = ts.readConfigFile(resolve(PACKAGE_ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT);
  // `rootDir` is dropped because the snippet lives beside the sources rather
  // than under them, and nothing is emitted here anyway.
  const options: ts.CompilerOptions = { ...parsed.options, rootDir: undefined, noEmit: true };
  const file = resolve(PACKAGE_ROOT, 'test/tuning-index-probe.ts');
  const code = [
    "import { JUST_RATIOS, justDeviationCents } from '../src/core/tuning/index.js';",
    body,
    'void JUST_RATIOS;',
    'void justDeviationCents;',
  ].join('\n');
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (name === file ? code : readFile(name));
  host.fileExists = (name) => name === file || fileExists(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === file
      ? ts.createSourceFile(name, code, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([file], options, host);
  const subject = program.getSourceFile(wholeProgram ? resolve(SRC, 'core/tuning/index.ts') : file);
  expect(subject).toBeDefined();
  return program
    .getSemanticDiagnostics(subject)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}
