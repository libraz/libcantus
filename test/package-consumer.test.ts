import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'libcantus-consumer-'));

afterAll(() => rmSync(temp, { recursive: true, force: true }));

function run(command: string, args: string[], cwd = ROOT): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

const importLines = [
  "import * as root from '@libraz/libcantus';",
  "import * as core from '@libraz/libcantus/core';",
  "import * as theory from '@libraz/libcantus/theory';",
  "import * as analyze from '@libraz/libcantus/analyze';",
  "import * as generate from '@libraz/libcantus/generate';",
  "import * as model from '@libraz/libcantus/model';",
  "import type { ChordSpan as RootChordSpan, PitchSpelling as RootPitchSpelling } from '@libraz/libcantus';",
  "import type { ChordSpan as TheoryChordSpan, PitchSpelling as TheoryPitchSpelling } from '@libraz/libcantus/theory';",
];

const requireLines = [
  "import root = require('@libraz/libcantus');",
  "import core = require('@libraz/libcantus/core');",
  "import theory = require('@libraz/libcantus/theory');",
  "import analyze = require('@libraz/libcantus/analyze');",
  "import generate = require('@libraz/libcantus/generate');",
  "import model = require('@libraz/libcantus/model');",
  "import type { ChordSpan as RootChordSpan, PitchSpelling as RootPitchSpelling } from '@libraz/libcantus';",
  "import type { ChordSpan as TheoryChordSpan, PitchSpelling as TheoryPitchSpelling } from '@libraz/libcantus/theory';",
];

const runtimeCheck = `
const modules = [root, core, theory, analyze, generate, model];
if (modules.some((value) => Object.keys(value).length === 0)) {
  throw new Error('an exported package layer was empty');
}
if (root.majorKey(0).rootPc !== 0 || model.Key.major('Eb').chord(0).symbol() !== 'Eb') {
  throw new Error('package runtime returned an unexpected result');
}
`;

const typeParityCheck = `
const rootSpelling: RootPitchSpelling = { letter: 0, alter: 0 };
const theorySpelling: TheoryPitchSpelling = rootSpelling;
const rootSpan: RootChordSpan = { rootPc: 0, quality: 'maj', startBeat: 0 };
const theorySpan: TheoryChordSpan = rootSpan;
void theorySpelling;
void theorySpan;
`;

describe('packed package consumer matrix', () => {
  it('typechecks and executes root/subpaths through ESM and CJS NodeNext conditions', () => {
    run('yarn', ['build']);
    // Read the tarball contents with `tar` rather than parsing `npm pack --json`.
    // When the suite runs under `yarn`, npm inherits Yarn's user-agent env and
    // executes the `prepare` lifecycle script despite `--ignore-scripts`, so the
    // build tool's stdout leaks into the `--json` payload and breaks JSON.parse.
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', temp]);
    const tarballName = readdirSync(temp).find((file) => file.endsWith('.tgz'));
    expect(tarballName, 'npm pack produced a tarball').toBeDefined();
    const tarball = path.join(temp, tarballName ?? 'missing.tgz');
    const packedPaths = new Set(
      run('tar', ['-tzf', tarball])
        .split('\n')
        .filter(Boolean)
        .filter((entry) => !entry.endsWith('/'))
        .map((entry) => entry.replace(/^package\//, '')),
    );

    for (const layer of ['', 'core/', 'theory/', 'analyze/', 'generate/', 'model/']) {
      const entry = `dist/${layer}index`;
      for (const extension of ['.js', '.js.map', '.cjs', '.cjs.map', '.d.ts', '.d.cts']) {
        expect(packedPaths.has(`${entry}${extension}`), `${entry}${extension}`).toBe(true);
      }
    }
    expect(
      [...packedPaths].filter(
        (file) =>
          !file.startsWith('dist/') &&
          !file.startsWith('src/') &&
          !['package.json', 'README.md', 'LICENSE', 'tsconfig.json'].includes(file),
      ),
    ).toEqual([]);

    const consumer = path.join(temp, 'consumer');
    mkdirSync(consumer, { recursive: true });
    write(
      path.join(consumer, 'package.json'),
      JSON.stringify({ private: true, name: 'libcantus-packed-consumer' }),
    );
    run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
      consumer,
    );

    const compilerOptions = {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    };
    const esm = path.join(consumer, 'esm');
    const cjs = path.join(consumer, 'cjs');
    write(path.join(esm, 'package.json'), JSON.stringify({ type: 'module' }));
    write(path.join(cjs, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    write(
      path.join(esm, 'consumer.ts'),
      `${importLines.join('\n')}\n${typeParityCheck}\n${runtimeCheck}`,
    );
    write(
      path.join(cjs, 'consumer.cts'),
      `${requireLines.join('\n')}\n${typeParityCheck}\n${runtimeCheck}`,
    );
    write(
      path.join(esm, 'tsconfig.json'),
      JSON.stringify({ compilerOptions, files: ['consumer.ts'] }),
    );
    write(
      path.join(cjs, 'tsconfig.json'),
      JSON.stringify({ compilerOptions, files: ['consumer.cts'] }),
    );

    const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    run(process.execPath, [tsc, '-p', path.join(esm, 'tsconfig.json')], consumer);
    run(process.execPath, [tsc, '-p', path.join(cjs, 'tsconfig.json')], consumer);

    write(
      path.join(esm, 'runtime.mjs'),
      `${importLines.filter((line) => !line.startsWith('import type')).join('\n')}\n${runtimeCheck}`,
    );
    write(
      path.join(cjs, 'runtime.cjs'),
      `${requireLines
        .filter((line) => !line.startsWith('import type'))
        .map((line) =>
          line.replace(/^import (\w+) = require\(/, 'const $1 = require(').replace(/;$/, ';'),
        )
        .join('\n')}\n${runtimeCheck}`,
    );
    run(process.execPath, [path.join(esm, 'runtime.mjs')], consumer);
    run(process.execPath, [path.join(cjs, 'runtime.cjs')], consumer);

    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const snippets = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
    expect(snippets.length).toBeGreaterThan(0);
    const docs = path.join(consumer, 'readme');
    const fixture = `
const melodyAndChordNotes = [
  { pitch: 60, startBeat: 0, durationBeat: 4 },
  { pitch: 64, startBeat: 0, durationBeat: 4 },
  { pitch: 67, startBeat: 0, durationBeat: 4 },
];
const melodyNotes = [{ pitch: 72, startBeat: 0, durationBeat: 4 }];
const chordNotes = melodyAndChordNotes;
`;
    const docsFiles = snippets.map((snippet, index) => {
      const filename = `example-${index}.mts`;
      write(path.join(docs, filename), `${fixture}\n${snippet}`);
      return filename;
    });
    write(path.join(docs, 'package.json'), JSON.stringify({ type: 'module' }));
    write(
      path.join(docs, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          noEmit: false,
          outDir: 'compiled',
          sourceMap: false,
        },
        files: docsFiles,
      }),
    );
    run(process.execPath, [tsc, '-p', path.join(docs, 'tsconfig.json')], consumer);
    for (let index = 0; index < docsFiles.length; index += 1) {
      run(process.execPath, [path.join(docs, 'compiled', `example-${index}.mjs`)], consumer);
    }

    // The declarations in the tarball, not source aliases, were the files
    // resolved above. Keep a direct sanity check for the CJS declaration
    // target because it is the condition that regressed in v0.9.2.
    const installedPackage = JSON.parse(
      readFileSync(
        path.join(consumer, 'node_modules', '@libraz', 'libcantus', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, { require: { types: string } }> };
    expect(installedPackage.exports['.']?.require.types).toBe('./dist/index.d.cts');
  }, 30_000);
});
