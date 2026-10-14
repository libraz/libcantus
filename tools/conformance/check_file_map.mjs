#!/usr/bin/env node
/**
 * Check the one-to-one file correspondence between `ts/src` and the C++ core.
 *
 * `ts/src/<layer>/<module>/<name>.ts` is `src/<layer>/<module>/<snake_name>.{h,cpp}`; a module's
 * `index.ts` is `<module>.cpp`, or its public header `include/cantus/<layer>/<module>.h` when it
 * only re-exports; the flat model layer and the layer roots follow the same rule one level up.
 * A TS file is also mapped when it declares types only (its public header carries them), when a
 * `tables.json` generates its values, or when `api/annotations.json` `file_map_exceptions` lists
 * it. In the other direction every C++ file under `src/<layer>` must be the counterpart of a TS
 * file, an exception's `cpp`, or a module's own `<module>.{h,cpp}`.
 *
 * Usage: node tools/conformance/check_file_map.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LAYERS = ['core', 'theory', 'analyze', 'generate', 'model'];

const rel = (file) => path.relative(REPO, file).split(path.sep).join('/');
const exists = (file) => existsSync(path.join(REPO, file));
const snake = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function statementsOf(file) {
  const text = readFileSync(path.join(REPO, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false).statements;
}

const isTypeStatement = (s) =>
  ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isImportDeclaration(s);

/** Declares types and nothing that exists at runtime. */
const typeOnly = (file) =>
  statementsOf(file).every(
    (s) => isTypeStatement(s) || (ts.isExportDeclaration(s) && s.isTypeOnly),
  );

/** Re-exports other modules and declares nothing of its own but types. */
const reexportOnly = (file) =>
  statementsOf(file).every((s) => isTypeStatement(s) || ts.isExportDeclaration(s));

/** Modules (relative to ts/src) whose tables or limits some tables.json generates. */
function tableModules() {
  const modules = new Set();
  for (const file of walk(path.join(REPO, 'src')).filter((f) => f.endsWith('tables.json'))) {
    const spec = JSON.parse(readFileSync(file, 'utf8'));
    for (const entry of [...(spec.tables ?? []), ...(spec.limits ?? [])]) modules.add(entry.module);
  }
  return modules;
}

/** The C++ files a TS file may correspond to: implementation first, then public header. */
function counterparts(tsRel) {
  const parts = tsRel.split('/');
  const name = path.basename(tsRel, '.ts');
  const dir = parts.slice(0, -1).join('/');
  const cdir = parts.slice(0, -1).map(snake).join('/');
  if (name !== 'index') {
    const stem = snake(name);
    const header =
      parts.length === 2 ? `include/cantus/${parts[0]}/${stem}.h` : `include/cantus/${cdir}.h`;
    return { impl: [`src/${cdir}/${stem}.cpp`, `src/${cdir}/${stem}.h`], header, dir };
  }
  if (parts.length === 2) return { impl: [], header: `include/cantus/${parts[0]}.h`, dir };
  const mod = snake(parts[parts.length - 2]);
  return {
    impl: [`src/${cdir}/${mod}.cpp`, `src/${cdir}/${mod}.h`],
    header: `include/cantus/${cdir}.h`,
    dir,
  };
}

function main() {
  const annotations = JSON.parse(readFileSync(path.join(REPO, 'api/annotations.json'), 'utf8'));
  const exceptions = annotations.file_map_exceptions ?? [];
  const excepted = new Set(exceptions.map((e) => e.ts.split('#')[0]));
  const exceptionCpp = new Set(exceptions.map((e) => e.cpp).filter(Boolean));
  const tables = tableModules();
  const problems = [];
  const claimed = new Set();
  let mapped = 0;

  const tsFiles = walk(path.join(REPO, 'ts/src'))
    .map(rel)
    .filter((f) => f.endsWith('.ts') && f !== 'ts/src/index.ts')
    .sort();
  for (const file of tsFiles) {
    const tsRel = file.slice('ts/src/'.length);
    const { impl, header } = counterparts(tsRel);
    const found = impl.filter(exists);
    for (const f of found) claimed.add(f);
    if (found.length > 0) mapped += 1;
    else if (path.basename(tsRel) === 'index.ts' && reexportOnly(file) && exists(header)) {
      mapped += 1;
    } else if (typeOnly(file) && exists(header)) mapped += 1;
    else if (tables.has(tsRel) || excepted.has(file)) mapped += 1;
    else problems.push(`${file}: no ${impl.join(' / ') || header}`);
  }

  let cppCount = 0;
  for (const layer of LAYERS) {
    for (const full of walk(path.join(REPO, 'src', layer)).sort()) {
      const file = rel(full);
      if (!/\.(h|cpp)$/.test(file) || /\.gen\./.test(file)) continue;
      cppCount += 1;
      const stem = path.basename(file).replace(/\.(h|cpp)$/, '');
      const ownModule = path.basename(path.dirname(file)) === stem;
      if (claimed.has(file) || exceptionCpp.has(file) || ownModule) continue;
      problems.push(`${file}: no ts/src counterpart`);
    }
  }
  for (const e of exceptions) {
    if (!exists(e.ts.split('#')[0])) problems.push(`file_map_exceptions: ${e.ts} does not exist`);
    if (e.cpp && !exists(e.cpp)) problems.push(`file_map_exceptions: ${e.cpp} does not exist`);
  }

  for (const problem of problems) console.error(`check_file_map: ${problem}`);
  if (tsFiles.length === 0 || cppCount === 0) {
    console.error('check_file_map: no files to compare');
    process.exit(1);
  }
  if (problems.length > 0) process.exit(1);
  process.stdout.write(
    `check_file_map: ${mapped} TS files and ${cppCount} C++ files correspond (${exceptions.length} exceptions)\n`,
  );
}

main();
