/**
 * The built WebAssembly package as its consumers meet it: a browser bundle under the settings the
 * README states, and a type check of its handles' `[Symbol.dispose]` with library checks on. Runs
 * with the wasm backend, after bindings/wasm/dist is built.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = path.join(REPO, 'bindings/wasm/dist');

describe.runIf(process.env.CANTUS_BOUNDARY_BACKEND === 'wasm')('the wasm package', () => {
  it('bundles for the browser with an es2022 target and nothing else', async () => {
    const result = await build({
      entryPoints: [path.join(REPO, 'examples/browser/main.js')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      alias: { '@libraz/libcantus-wasm': path.join(DIST, 'index.js') },
      write: false,
      outdir: path.join(tmpdir(), 'cantus-browser-check'),
      logLevel: 'silent',
    });
    expect(result.errors).toEqual([]);
  });

  it('declares [Symbol.dispose] on every handle, for a consumer checking library types', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cantus-dts-'));
    try {
      const file = path.join(dir, 'use.ts');
      writeFileSync(
        file,
        `import { createArrangementSession, createNoteEventIndex, createRng } from ${JSON.stringify(
          path.join(DIST, 'index.js'),
        )};
export function use(): number {
  using rng = createRng(1);
  createNoteEventIndex([])[Symbol.dispose]();
  createArrangementSession([])[Symbol.dispose]();
  return rng.next();
}
`,
      );
      const program = ts.createProgram([file], {
        target: ts.ScriptTarget.ES2022,
        lib: ['lib.es2022.d.ts'],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      });
      const messages = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(messages).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
