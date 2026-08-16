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
