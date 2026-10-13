import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import generateDocExamples from './support/generate-doc-examples.js';

/**
 * The shared spec suite, run against the implementation `CANTUS_IMPL` names.
 *
 * Every spec file imports the library as `@libraz/libcantus[/<layer>]`; the
 * alias below is the only place that decides which implementation answers.
 */
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'] as const;

const repo = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

/** Entry points per implementation: the package root, then one per layer subpath. */
const IMPLS: Record<string, { root: string; layer: (name: string) => string }> = {
  ts: { root: repo('ts/src/index.ts'), layer: (name) => repo(`ts/src/${name}/index.ts`) },
  'facade-ts': {
    root: repo('bindings/js/src/index.ts'),
    layer: (name) => repo(`bindings/js/src/${name}.ts`),
  },
  wasm: {
    root: repo('bindings/wasm/dist/index.js'),
    layer: (name) => repo(`bindings/wasm/dist/${name}/index.js`),
  },
  node: {
    root: repo('bindings/node/dist/index.js'),
    layer: (name) => repo(`bindings/node/dist/${name}/index.js`),
  },
};

const implName = process.env.CANTUS_IMPL ?? 'ts';
const impl = IMPLS[implName];
if (!impl) {
  throw new Error(`CANTUS_IMPL=${implName} is not one of ${Object.keys(IMPLS).join(', ')}`);
}

// Before collection, so a newly written guide is picked up on the first run and
// `vitest run tests/spec/generated/<page>` can filter by file name.
generateDocExamples();

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@libraz\/libcantus$/, replacement: impl.root },
      ...LAYERS.map((name) => ({
        find: new RegExp(`^@libraz/libcantus/${name}$`),
        replacement: impl.layer(name),
      })),
    ],
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    // Several suites sweep a space exhaustively and take seconds of real work;
    // the budget is for catching a hang, not for timing the sweeps.
    testTimeout: 120_000,
  },
});
