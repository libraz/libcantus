#!/usr/bin/env node
/**
 * Member-level parity between the pure TS package, the API manifest, the C++ op registry and
 * the generated TS facade.
 *
 * Each set is printed with its count; a name missing from any side is listed and fails:
 *   exports   the runtime exports of every subpath: pure TS, manifest, facade
 *   members   `Class.static` and `Class#member` of every exported class: pure TS, manifest ops,
 *             facade; the model classes and the hybrid and handle members: manifest, facade
 *             meta; and which of those members are ops
 *   consts    `$const:<name>` for every exported value that is not a function or class
 *   ops       the manifest ops and `cantus list` (minus the `$` builtins)
 *   functions every exported function has an op, except the facade-local ones
 *
 * Modules load from source through Vite's module runner, so no package build is needed; the
 * registry comes from the CLI of an existing build tree.
 *
 * Usage: node tools/parity/check.mjs [--cli <path to cantus>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(REPO, 'api/manifest.json');
const ANNOTATIONS = path.join(REPO, 'api/annotations.json');
/** Own properties every class constructor or prototype has, which are not API members. */
const STATIC_BUILTINS = new Set(['length', 'name', 'prototype']);
const PROTO_BUILTINS = new Set(['constructor']);

function parseArgs(argv) {
  const args = { cli: path.join(REPO, 'build/tools/cli/cantus') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cli') args.cli = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

let problems = 0;

/** Compare named sets that must be equal; a set of zero names is a difference too. */
function compare(label, sets) {
  const entries = Object.entries(sets);
  const union = new Set(entries.flatMap(([, set]) => [...set]));
  let ok = union.size > 0;
  for (const [name, set] of entries) {
    const missing = [...union].filter((x) => !set.has(x)).sort();
    if (missing.length > 0) {
      ok = false;
      log(`parity: ${label}: missing from ${name}: ${missing.join(', ')}`);
    }
  }
  if (union.size === 0) log(`parity: ${label}: no names`);
  if (!ok) problems += 1;
  log(`${label}: ${union.size} ${ok ? 'agree' : 'DIFFER'} (${entries.map(([n]) => n).join(', ')})`);
}

async function createLoader() {
  const { createServer, createServerModuleRunner } = await import('vite');
  const server = await createServer({
    root: REPO,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  return {
    load: (file) => runner.import(path.join(REPO, file)),
    async close() {
      await runner.close();
      await server.close();
    },
  };
}

/** The module of one subpath in the pure package and in the facade. */
function entryFiles(subpath) {
  return subpath === '.'
    ? { pure: 'ts/src/index.ts', facade: 'bindings/js/src/index.ts' }
    : { pure: `ts/src/${subpath}/index.ts`, facade: `bindings/js/src/${subpath}.ts` };
}

/** `X.static` and `X#member` names of a class, by string key. */
function classMembers(name, cls) {
  const names = new Set();
  for (const key of Object.getOwnPropertyNames(cls)) {
    if (!STATIC_BUILTINS.has(key)) names.add(`${name}.${key}`);
  }
  for (const key of Object.getOwnPropertyNames(cls.prototype ?? {})) {
    if (!PROTO_BUILTINS.has(key)) names.add(`${name}#${key}`);
  }
  return names;
}

function registry(cli) {
  if (!existsSync(cli)) {
    console.error(`parity: ${cli} does not exist; run make build`);
    process.exit(1);
  }
  return JSON.parse(execFileSync(cli, ['list'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const annotations = JSON.parse(readFileSync(ANNOTATIONS, 'utf8'));
  const loader = await createLoader();
  try {
    const pure = {};
    const facade = {};
    for (const subpath of manifest.subpaths) {
      const files = entryFiles(subpath);
      pure[subpath] = await loader.load(files.pure);
      facade[subpath] = await loader.load(files.facade);
      const listed = manifest.exports.filter((e) => e.subpaths.includes(subpath)).map((e) => e.id);
      compare(`exports '${subpath}'`, {
        'pure TS': new Set(Object.keys(pure[subpath])),
        manifest: new Set(listed),
        facade: new Set(Object.keys(facade[subpath])),
      });
    }

    const root = pure['.'];
    const froot = facade['.'];
    const ops = new Set(manifest.ops.map((op) => op.name));
    const classes = manifest.exports.filter((e) => e.kind === 'class' || e.kind === 'error');
    const pureMembers = new Set();
    const facadeMembers = new Set();
    for (const { id } of classes) {
      for (const m of classMembers(id, root[id])) pureMembers.add(m);
      for (const m of classMembers(id, froot[id])) facadeMembers.add(m);
    }
    const classIds = new Set(classes.map((e) => e.id));
    // `X.constructor` is the `new X(...)` op of a public constructor, which only the declarations
    // tell apart from a private one; the registry comparison below covers it.
    compare('class members', {
      'pure TS': pureMembers,
      'manifest ops': new Set(
        manifest.ops
          .filter((op) => op.member && classIds.has(op.export) && op.member !== 'constructor')
          .map((op) => op.name),
      ),
      facade: facadeMembers,
    });

    const { CLASSES, TYPES } = await loader.load('bindings/js/src/generated/meta.ts');
    compare('model classes', {
      manifest: new Set(classes.filter((e) => e.kind === 'class').map((e) => e.id)),
      'facade meta': new Set(CLASSES),
    });
    const typeIds = new Set(manifest.types.map((t) => t.id));
    compare('hybrid and handle members', {
      manifest: new Set(manifest.types.flatMap((t) => t.members.map((m) => `${t.id}#${m.name}`))),
      'facade meta': new Set(
        Object.entries(TYPES).flatMap(([id, meta]) =>
          [...meta.methods, ...meta.properties].map((m) => `${id}#${m}`),
        ),
      ),
    });
    // Methods of either kind are ops; of the properties only a handle's are (a hybrid's are its
    // payload, read without a call).
    compare('hybrid and handle member ops', {
      manifest: new Set(
        manifest.types.flatMap((t) =>
          t.members
            .filter((m) => m.kind === 'method' || t.kind === 'handle')
            .map((m) => `${t.id}#${m.name}`),
        ),
      ),
      'manifest ops': new Set(
        manifest.ops.filter((op) => typeIds.has(op.export)).map((op) => op.name),
      ),
    });

    const values = manifest.exports.filter((e) => e.kind === 'const' || e.kind === 'enum');
    compare('consts', {
      'pure TS': new Set(
        Object.entries(root)
          .filter(([, v]) => typeof v !== 'function')
          .map(([k]) => `$const:${k}`),
      ),
      manifest: new Set(values.map((e) => `$const:${e.id}`)),
      'manifest ops': new Set([...ops].filter((name) => name.startsWith('$const:'))),
    });

    const local = new Set((annotations.facade_local ?? []).map((e) => e.id));
    compare('functions', {
      'pure TS': new Set(
        Object.entries(root)
          .filter(([k, v]) => typeof v === 'function' && !classIds.has(k) && !local.has(k))
          .map(([k]) => k),
      ),
      'manifest ops': new Set(
        manifest.ops.filter((op) => !op.member && !op.name.startsWith('$')).map((op) => op.name),
      ),
    });

    const list = registry(args.cli);
    const builtin = (name) => name.startsWith('$') && !name.startsWith('$const:');
    compare('ops', {
      'manifest ops': ops,
      'cantus list': new Set(list.map((op) => op.name).filter((name) => !builtin(name))),
    });
  } finally {
    await loader.close();
  }
  if (problems > 0) {
    console.error(`parity: ${problems} sets differ`);
    process.exit(1);
  }
  log('parity: every set agrees');
}

await main();
