/**
 * Rewrites applied to what bindings/wasm/dist ships, shared by build.mjs and the package test.
 *
 * - The emscripten module loads `node:module` under Node only, through a dynamic import a
 *   bundler would still try to resolve for the browser; the specifier is made opaque to bundlers.
 * - The pure package's declarations describe its handles without `[Symbol.dispose]`, which the
 *   facade's handles have; each handle type of the manifest gets the member.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Copy every declaration file under `from` whose name ends with one of `suffixes` into `to`,
 * keeping the layout, with each handle type of the manifest made disposable.
 * @param {string} from
 * @param {string} to
 * @param {readonly string[]} [suffixes]
 * @returns {number} How many files were copied.
 * @throws {Error} When nothing was copied, or a handle type is declared in none of the files.
 */
export function copyDeclarations(from, to, suffixes = ['.d.ts']) {
  const handles = handleTypes();
  const disposable = new Set();
  const copy = (source, target) => {
    let count = 0;
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const file = path.join(source, entry.name);
      if (entry.isDirectory()) {
        count += copy(file, path.join(target, entry.name));
      } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        mkdirSync(target, { recursive: true });
        const { text, added } = declareDispose(readFileSync(file, 'utf8'), handles);
        for (const name of added) disposable.add(name);
        writeFileSync(path.join(target, entry.name), text);
        count += 1;
      }
    }
    return count;
  };
  const count = copy(from, to);
  if (count === 0) {
    throw new Error(
      `${path.relative(REPO, from)} has no declarations; build the pure package first`,
    );
  }
  const undeclared = handles.filter((name) => !disposable.has(name));
  if (undeclared.length > 0) {
    throw new Error(
      `no \`type X = {\` declaration to make disposable for ${undeclared.join(', ')}`,
    );
  }
  return count;
}
