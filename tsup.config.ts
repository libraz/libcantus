import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/theory/index.ts',
    'src/analyze/index.ts',
    'src/generate/index.ts',
    'src/model/index.ts',
  ],
  format: ['esm', 'cjs'],
  // Share chunks in the CommonJS build too. Without it every entry inlines its
  // own copy of the model classes, so a consumer importing from both the root
  // and the /model subpath ends up with two unrelated constructors.
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
