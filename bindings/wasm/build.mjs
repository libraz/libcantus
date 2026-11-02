#!/usr/bin/env node
/**
 * Assemble bindings/wasm/dist from the emscripten output, the facade and the pure TS types.
 *
 *   dist/cantus.{js,wasm}     the module (from the wasm build directory), its Node-only
 *                             `node:` imports hidden from bundlers
 *   dist/backend.js           src/backend.ts; imports ./cantus.js
 *   dist/index.js, dist/<layer>/index.js
 *                             the facade (bindings/js) with `#backend` bound to ./backend.js;
 *                             shared code is split into dist/chunk-*.js so every subpath sees
 *                             the same classes and the same module instance
 *   dist/**\/*.d.ts           ts/dist's declarations, so the types are pure TS's, with
 *                             `[Symbol.dispose]` on the handle types
 *
 * The result is checked by bundling examples/browser/main.js for the browser.
 *
 * Usage: node bindings/wasm/build.mjs [--wasm-dir build-wasm]
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserSafeModule, copyDeclarations, importsNodeBuiltin } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DIST = path.join(HERE, 'dist');
const FACADE = path.join(REPO, 'bindings/js/src');
const TYPES = path.join(REPO, 'ts/dist');
/** The facade entry per subpath: `.` and the five layers of the pure package. */
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'];
/** Top-level await needs es2022; bundlers consuming the package need the same target. */
const TARGET = 'es2022';

const argv = process.argv.slice(2);
const wasmDir = path.resolve(
  REPO,
  argv[0] === '--wasm-dir' && argv[1] !== undefined ? argv[1] : 'build-wasm',
);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

copyFileSync(path.join(wasmDir, 'cantus.wasm'), path.join(DIST, 'cantus.wasm'));
const cantusJs = browserSafeModule(readFileSync(path.join(wasmDir, 'cantus.js'), 'utf8'));
if (importsNodeBuiltin(cantusJs))
  throw new Error('cantus.js imports a node: builtin a bundler resolves');
writeFileSync(path.join(DIST, 'cantus.js'), cantusJs);

await build({
  entryPoints: [path.join(HERE, 'src/backend.ts')],
  outfile: path.join(DIST, 'backend.js'),
  bundle: true,
  format: 'esm',
  target: TARGET,
  external: ['./cantus.js'],
  logLevel: 'warning',
});

/** Resolve `#backend` to the sibling dist/backend.js instead of the facade's TS backend. */
const wasmBackend = {
  name: 'wasm-backend',
  setup(b) {
    b.onResolve({ filter: /^#backend$/ }, () => ({ path: './backend.js', external: true }));
  },
};

const facade = await build({
  entryPoints: [
    { in: path.join(FACADE, 'index.ts'), out: 'index' },
    ...LAYERS.map((name) => ({ in: path.join(FACADE, `${name}.ts`), out: `${name}/index` })),
  ],
  outdir: DIST,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: TARGET,
  chunkNames: 'chunk-[hash]',
  plugins: [wasmBackend],
  metafile: true,
  logLevel: 'warning',
});

// `./backend.js` is relative, so only files at the dist root may import it.
for (const [file, info] of Object.entries(facade.metafile.outputs)) {
  const importsBackend = info.imports.some((i) => i.path === './backend.js');
  if (importsBackend && path.dirname(path.resolve(file)) !== DIST) {
    throw new Error(`${file} imports ./backend.js but is not at the dist root`);
  }
}

const declarations = copyDeclarations(TYPES, DIST);
process.stdout.write(`wasm dist: ${declarations} declaration files from ts/dist\n`);

// The package as a browser bundler sees it, under the target the README asks for.
await build({
  entryPoints: [path.join(REPO, 'examples/browser/main.js')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: TARGET,
  alias: { '@libraz/libcantus-wasm': path.join(DIST, 'index.js') },
  write: false,
  outdir: path.join(DIST, 'browser-check'),
  logLevel: 'warning',
});
