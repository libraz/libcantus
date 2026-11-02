import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';
import { copyDeclarations } from '../wasm/patch.mjs';

/**
 * The node package's dist/: the facade (bindings/js) bundled with `#backend` bound to the addon
 * backend, ESM and CJS, one entry per pure TS subpath plus backend.js. Declarations are the pure
 * package's own (ts/dist), with each handle type given the `[Symbol.dispose]` the runtime adds.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const facade = (file: string) => path.join(here, '../js/src', file);
const pureDist = path.join(here, '../../ts/dist');

export default defineConfig({
  entry: {
    index: facade('index.ts'),
    'core/index': facade('core.ts'),
    'theory/index': facade('theory.ts'),
    'analyze/index': facade('analyze.ts'),
    'generate/index': facade('generate.ts'),
    'model/index': facade('model.ts'),
    backend: path.join(here, 'src/backend.ts'),
  },
  format: ['esm', 'cjs'],
  // One shared chunk for the runtime and the backend, so every subpath (and backend.js) uses the
  // same addon binding and the same generated classes.
  splitting: true,
  // backend.ts resolves the addon from import.meta.url, which the CJS build needs shimmed.
  shims: true,
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  esbuildPlugins: [
    {
      name: 'cantus-node-backend',
      setup(build) {
        build.onResolve({ filter: /^#backend$/ }, () => ({
          path: path.join(here, 'src/backend.ts'),
        }));
      },
    },
  ],
  onSuccess: async () => {
    statSync(path.join(pureDist, 'index.d.ts'));
    copyDeclarations(pureDist, path.join(here, 'dist'), ['.d.ts', '.d.cts']);
  },
});
