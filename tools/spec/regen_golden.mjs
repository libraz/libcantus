#!/usr/bin/env node
/**
 * Regenerate the generation goldens from the pure TS implementation. Never from C++.
 *
 * This records an intended change of generated output, so it is run on purpose after
 * `ALGORITHM_VERSION` moves (or a recorded output is found wrong), and its diff is reviewed:
 *
 *   tests/spec/generation-golden.test.ts  in the `GOLDEN` block of the current `ALGORITHM_VERSION`
 *                                         (added when new), each generator whose output moved;
 *                                         older blocks are kept
 *   tests/spec/golden/determinism.json    rewritten by its own test under UPDATE_GOLDEN=1
 *
 * The first file's outputs are produced by loading the test module through Vite's module runner,
 * against `ts/src`, with a stand-in for `vitest` that runs the recording test's body and keeps
 * what it would have compared.
 *
 * Usage: node tools/spec/regen_golden.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'];
const GENERATION = path.join(REPO, 'tests/spec/generation-golden.test.ts');
const DETERMINISM = 'tests/spec/derived-determinism.test.ts';
const BIN = path.join(REPO, 'node_modules/.bin');
const RECORDING = /reproduces its recorded output at version (\d+)$/;
const STUB_ID = '\0cantus-vitest-stub';

/**
 * A `vitest` that registers tests instead of running them, and keeps each `expect(value)` with
 * the value its `toEqual` was given.
 */
const STUB = `
export const registered = [];
export const expected = [];
const chain = () => new Proxy(() => chain(), { get: () => chain() });
const it = (name, fn) => registered.push({ name, fn, table: null });
it.each = (table) => (name, fn) => registered.push({ name, fn, table });
const describe = (_name, fn) => fn();
describe.each = (table) => (_name, fn) => table.forEach((row) => fn(row));
const expect = (value) => {
  const entry = { value, recorded: undefined };
  expected.push(entry);
  return new Proxy({ toEqual: (recorded) => { entry.recorded = recorded; } }, {
    get: (target, key) => target[key] ?? chain(),
  });
};
const noop = () => {};
export { it, it as test, describe, expect, noop as beforeEach, noop as afterEach,
  noop as beforeAll, noop as afterAll };
export const vi = chain();
`;

function fail(message) {
  console.error(`regen_golden: ${message}`);
  process.exit(1);
}

/** The algorithm version a recording test's title names, or NaN. */
function recordedVersion(title) {
  const match = title.match(RECORDING);
  return match ? Number(match[1]) : Number.NaN;
}

/** What every generator returns at the current algorithm version, and what is recorded. */
async function generationOutputs() {
  const { createServer, createServerModuleRunner } = await import('vite');
  const server = await createServer({
    root: REPO,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    // Bare imports are otherwise handed to Node unresolved, past the stand-in below.
    ssr: { noExternal: ['vitest'] },
    resolve: {
      alias: [
        { find: /^@libraz\/libcantus$/, replacement: path.join(REPO, 'ts/src/index.ts') },
        ...LAYERS.map((name) => ({
          find: new RegExp(`^@libraz/libcantus/${name}$`),
          replacement: path.join(REPO, `ts/src/${name}/index.ts`),
        })),
      ],
    },
    plugins: [
      {
        name: 'cantus-vitest-stub',
        enforce: 'pre',
        resolveId: (id) => (id === 'vitest' ? STUB_ID : null),
        load: (id) => (id === STUB_ID ? STUB : null),
      },
    ],
  });
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  try {
    const { ALGORITHM_VERSION } = await runner.import(path.join(REPO, 'ts/src/index.ts'));
    await runner.import(GENERATION);
    const stub = await runner.import(STUB_ID);
    const recording = stub.registered.find(
      (t) => t.table && recordedVersion(t.name) === ALGORITHM_VERSION,
    );
    if (!recording) fail(`no recording test for version ${ALGORITHM_VERSION} in ${GENERATION}`);
    const outputs = {};
    for (const row of recording.table) {
      stub.expected.length = 0;
      recording.fn(row);
      outputs[row.name] = stub.expected[0];
    }
    if (Object.keys(outputs).length === 0) fail('the recording test has no case');
    return { version: ALGORITHM_VERSION, outputs };
  } finally {
    await runner.close();
    await server.close();
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A JS literal for a value, keeping what JSON cannot (-0, NaN, ±Infinity, undefined). */
function literal(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '-0';
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return String(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  const fields = Object.entries(value).map(
    ([key, v]) => `${IDENT.test(key) ? key : JSON.stringify(key)}: ${literal(v)}`,
  );
  // A line break after the brace keeps the object expanded through the formatter.
  return fields.length === 0 ? '{}' : `{\n${fields.join(',\n')},\n}`;
}

/** The `GOLDEN` object literal of the test file. */
function goldenTable(sf) {
  let table = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'GOLDEN' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      table = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!table) fail(`no GOLDEN object literal in ${GENERATION}`);
  return table;
}

const propertyNamed = (object, name, sf) =>
  object.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === name);

/**
 * Write one version's block: a generator whose output moved gets its new literal, a new one is
 * appended, one no longer run is dropped, and the text of the others is left as it is.
 */
function writeGenerationBlock(version, outputs) {
  const text = readFileSync(GENERATION, 'utf8');
  const sf = ts.createSourceFile(GENERATION, text, ts.ScriptTarget.Latest, true);
  const table = goldenTable(sf);
  const block = propertyNamed(table, String(version), sf);
  const edits = [];
  const changed = [];
  if (!block) {
    const fields = Object.entries(outputs).map(([name, { value }]) => `${name}: ${literal(value)}`);
    const end = table.getEnd() - 1;
    edits.push([end, end, `  ${version}: {\n${fields.join(',\n')},\n},\n`]);
    changed.push(...Object.keys(outputs));
  } else {
    if (!ts.isObjectLiteralExpression(block.initializer)) fail(`GOLDEN[${version}] is no literal`);
    const object = block.initializer;
    for (const [name, { value, recorded }] of Object.entries(outputs)) {
      if (isDeepStrictEqual(value, recorded)) continue;
      changed.push(name);
      const property = propertyNamed(object, name, sf);
      if (property) {
        edits.push([
          property.initializer.getStart(sf),
          property.initializer.getEnd(),
          literal(value),
        ]);
      } else {
        const end = object.getEnd() - 1;
        edits.push([end, end, `${name}: ${literal(value)},\n`]);
      }
    }
    for (const property of object.properties) {
      const name = property.name?.getText(sf);
      if (name && !(name in outputs)) {
        changed.push(`-${name}`);
        const end = text[property.getEnd()] === ',' ? property.getEnd() + 1 : property.getEnd();
        edits.push([property.getFullStart(), end, '']);
      }
    }
  }
  if (edits.length === 0) return changed;
  let next = text;
  for (const [start, end, insert] of edits.sort((x, y) => y[0] - x[0])) {
    next = next.slice(0, start) + insert + next.slice(end);
  }
  writeFileSync(GENERATION, next);
  execFileSync(path.join(BIN, 'biome'), ['format', '--write', GENERATION], {
    cwd: REPO,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return changed;
}

const { version, outputs } = await generationOutputs();
const changed = writeGenerationBlock(version, outputs);
process.stdout.write(
  `regen_golden: ${path.relative(REPO, GENERATION)} version ${version}: ` +
    `${changed.length === 0 ? 'unchanged' : `wrote ${changed.join(', ')}`} ` +
    `(${Object.keys(outputs).length} generators)\n`,
);
execFileSync(
  path.join(BIN, 'vitest'),
  ['run', '-c', 'tests/spec/vitest.config.ts', '--maxWorkers=1', DETERMINISM],
  {
    cwd: REPO,
    env: { ...process.env, CANTUS_IMPL: 'ts', UPDATE_GOLDEN: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
process.stdout.write('regen_golden: rewrote tests/spec/golden/determinism.json\n');
