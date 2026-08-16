import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filesUnder, ROOT, SRC, TESTS } from './support/source-files.js';

/** Where the generated documentation examples land. */
const GENERATED = path.join(TESTS, 'generated');

/** The hand-authored guides, in both languages. */
const GUIDES = [path.join(ROOT, 'docs/en'), path.join(ROOT, 'docs/ja')];

/**
 * The test files the repository carries, as absolute paths.
 *
 * What the check below is about is committed files: a probe written while
 * chasing a bug is the author's own business until it enters the repository, at
 * which point it becomes dead weight every run pays for. Outside a git checkout
 * the directory is read instead, which is the stricter reading rather than a
 * weaker one.
 */
function repositoryTestFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z', '--', 'test'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => path.join(ROOT, file));
  } catch {
    return filesUnder(TESTS, '.test.ts');
  }
}

/** Whether a module states an expectation rather than only running code. */
function statesAnExpectation(source: string): boolean {
  return /\bexpect(TypeOf)?\s*[(<.]/.test(source);
}

/**
 * The shipped sources, the guides, and the READMEs, as absolute paths.
 *
 * This module is left out of its own scan: it has to write the shapes down to
 * look for them, so it matches every rule it states. That is a property of the
 * scanner rather than an exemption granted to a file's contents.
 */
function publicArtifacts(): string[] {
  const self = fileURLToPath(import.meta.url);
  return [
    ...filesUnder(SRC, '.ts'),
    ...filesUnder(TESTS, '.test.ts').filter(
      (file) => file !== self && !file.startsWith(`${GENERATED}${path.sep}`),
    ),
    ...GUIDES.flatMap((dir) => filesUnder(dir, '.md')),
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'README_ja.md'),
  ];
}

/** Every `path:line` in `files` whose line matches, with the text that matched. */
function offences(files: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const hit = line.match(pattern);
        if (hit) {
          found.push(`${relative}:${index + 1}: ${hit[0]}`);
        }
      });
  }
  return found;
}

describe('what the public artifacts may say', () => {
  // Only rules that need no exemption list are kept here. A rule carrying
  // exceptions decays into a list nobody prunes, and the words that name a
  // process — "audit", "phase", "wave" — are ordinary English and ordinary music
  // theory besides ("four-bar groups in phase 3"), so those are left to review.
  const artifacts = publicArtifacts();

  it('cites no planning document', () => {
    // File and directory names that exist only outside the published package.
    expect(offences(artifacts, /backup\/|audit-20\d\d|design-music-theory/i)).toEqual([]);
  });

  it('carries no finding identifier', () => {
    // The shape findings are numbered in. Pitch names collide with it — `C-1` is
    // MIDI 0 — so `C` is not one of the letters, and a match wrapped in quotes or
    // backticks is a written pitch rather than a reference.
    expect(offences(artifacts, /(?<!['"`])\b(?:H|M|L|MT|P2|P4)-\d{1,3}\b(?!['"`])/)).toEqual([]);
  });

  it('states what the library does rather than what it did', () => {
    // Documentation describes the current state: the reader is told what is
    // true, not what changed. `no longer` is deliberately absent — "a version
    // this build no longer produces" is a statement about the present.
    const guides = artifacts.filter((file) => file.endsWith('.md'));
    const chronology =
      /\b(?:used to be|previously|formerly|has been fixed|in an earlier version)\b/i;
    expect(offences(guides, chronology)).toEqual([]);
    // In the sources only the one phrase that can only be chronology is checked:
    // `used to` alone is ordinary purpose ("the meter used to derive accents").
    expect(offences(filesUnder(SRC, '.ts'), /\bused to be\b/i)).toEqual([]);
  });
});

describe('the suite itself', () => {
  it('carries no test file that asserts nothing', () => {
    // The generated documentation examples are left out: a snippet the guide
    // prints without a stated result asserts by running at all, which is the
    // claim the guide makes for it.
    const silent = repositoryTestFiles()
      .filter((file) => !file.startsWith(`${GENERATED}${path.sep}`))
      .filter((file) => !statesAnExpectation(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
    expect(silent).toEqual([]);
  });
});
