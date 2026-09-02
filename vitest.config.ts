import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import generateDocExamples from './test/support/generate-doc-examples.js';

const layer = (name: string) => fileURLToPath(new URL(`./src/${name}/index.ts`, import.meta.url));

// Before collection, so a newly written guide is picked up on the first run and
// `vitest run test/generated/<page>` can filter by file name.
generateDocExamples();

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@libraz\/libcantus$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      { find: /^@libraz\/libcantus\/core$/, replacement: layer('core') },
      { find: /^@libraz\/libcantus\/theory$/, replacement: layer('theory') },
      { find: /^@libraz\/libcantus\/analyze$/, replacement: layer('analyze') },
      { find: /^@libraz\/libcantus\/generate$/, replacement: layer('generate') },
      { find: /^@libraz\/libcantus\/model$/, replacement: layer('model') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Several suites sweep a space exhaustively — every scale on every root,
    // every symbol through all twelve semitones, an arrangement of tens of
    // thousands of notes — and take seconds of real work rather than
    // milliseconds. The default budget makes those fail whenever the machine is
    // busy, which reports a scheduling delay as a broken library. The budget
    // here is for catching a hang; the sweeps that guard against a complexity
    // regression are orders of magnitude slower than this when they regress.
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
