/**
 * Rewrites applied to what bindings/wasm/dist ships, shared by build.mjs and the package test.
 *
 * - The emscripten module loads `node:module` under Node only, through a dynamic import a
 *   bundler would still try to resolve for the browser; the specifier is made opaque to bundlers.
 * - The pure package's declarations describe its handles without `[Symbol.dispose]`, which the
 *   facade's handles have; each handle type of the manifest gets the member.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A dynamic import of a `node:` builtin, with the quote it uses. */
const NODE_IMPORT = /\bimport\((["'])(node:[\w/]+)\1\)/g;

/** The emscripten module with every `import("node:…")` left for Node alone to resolve. */
export function browserSafeModule(text) {
  return text.replace(
    NODE_IMPORT,
    (_, quote, id) =>
      `import(/* webpackIgnore: true */ /* @vite-ignore */ [${quote}${id}${quote}][0])`,
  );
}

/** Whether `text` still holds an import of a `node:` builtin that a bundler resolves. */
export function importsNodeBuiltin(text) {
  return new RegExp(NODE_IMPORT.source).test(text) || /\bfrom\s*["']node:/.test(text);
}

/** The handle types of the API manifest. */
export function handleTypes() {
  const manifest = JSON.parse(readFileSync(path.join(REPO, 'api/manifest.json'), 'utf8'));
  return manifest.types.filter((t) => t.kind === 'handle').map((t) => t.id);
}

const DISPOSE_MEMBER =
  '    /** Release the handle now; later calls on it fail with `RELEASED_HANDLE`. */\n' +
  '    [Symbol.dispose](): void;\n';
const DISPOSABLE_LIB = '/// <reference lib="esnext.disposable" />\n';

/**
 * A declaration file with `[Symbol.dispose]` added to each of `handles` it declares (as
 * `type Name = {`), and the names it added it to.
 */
export function declareDispose(text, handles) {
  const added = [];
  let out = text;
  for (const name of handles) {
    const head = new RegExp(`^type ${name} = \\{\\n`, 'm');
    if (!head.test(out)) continue;
    out = out.replace(head, (match) => `${match}${DISPOSE_MEMBER}`);
    added.push(name);
  }
  return { text: added.length > 0 ? `${DISPOSABLE_LIB}${out}` : out, added };
}
