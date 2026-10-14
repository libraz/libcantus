#!/usr/bin/env node
/**
 * Check that the C++ codec writes the fields the TS declarations promise.
 *
 * Every `CANTUS_JSON_FIELDS(Type, ...)` in `src/ops` is compared with the properties of the type
 * of the same name that `ts/src/index.ts` exports: a field the TS type lacks, or a property the
 * codec never writes, fails. Then the recorded corpus (`tests/corpus/out`, when present) is
 * read: for every op whose declared result is such a type or an array of it, each key a recorded
 * TS result carries must be one of the codec's fields, so a key TS sets at runtime without
 * declaring it is caught even where no recorded call reaches the C++ side.
 *
 * Codec types without an exported TS type of the same name are wire-only records and are listed.
 *
 * Usage: node tools/conformance/check_shapes.mjs [--corpus <dir>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OPS_DIR = path.join(REPO, 'src/ops');
const ENTRY = path.join(REPO, 'ts/src/index.ts');
const MANIFEST = path.join(REPO, 'api/manifest.json');

function parseArgs(argv) {
  const args = { corpus: path.join(REPO, 'tests/corpus/out/ops') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--corpus') args.corpus = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

/** Type name → field names, from every codec declaration. */
function codecFields() {
  const fields = new Map();
  const pattern = /^CANTUS_JSON_FIELDS\(\s*([A-Za-z_:]+)\s*,([^)]*)\)/gm;
  for (const name of readdirSync(OPS_DIR).filter((n) => /\.(h|cpp)$/.test(n))) {
    const text = readFileSync(path.join(OPS_DIR, name), 'utf8');
    for (const [, type, list] of text.matchAll(pattern)) {
      const names = list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const short = type.split('::').pop();
      if (fields.has(short)) throw new Error(`${short} is declared by two codec lines`);
      fields.set(short, { fields: new Set(names), file: `src/ops/${name}` });
    }
  }
  return fields;
}

/** The exported TS types of the package root, with the checker. */
function tsTypes() {
  const program = ts.createProgram([ENTRY], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(ENTRY));
  const types = new Map();
  for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.name;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))) continue;
    types.set(name, checker.getDeclaredTypeOfSymbol(symbol));
  }
  return { checker, program, types, moduleSymbol };
}

/** Properties of a type; of a union, those of any member (a codec writes each variant's). */
function propertyNames(checker, type) {
  const parts = type.isUnion() ? type.types : [type];
  return new Set(parts.flatMap((part) => checker.getPropertiesOfType(part).map((p) => p.name)));
}

/** Codec type names an op's declared result is, directly or as array elements. */
function resultTypes(ts_, codec) {
  const { checker, moduleSymbol } = ts_;
  const results = new Map();
  for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.name;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!(symbol.flags & ts.SymbolFlags.Function)) continue;
    const type = checker.getTypeOfSymbol(symbol);
    const names = new Set();
    for (const signature of type.getCallSignatures()) {
      let ret = checker.getReturnTypeOfSignature(signature);
      if (checker.isArrayType(ret)) ret = checker.getTypeArguments(ret)[0];
      for (const part of ret.isUnion() ? ret.types : [ret]) {
        const alias = part.aliasSymbol?.name ?? part.getSymbol()?.name;
        if (alias && codec.has(alias)) names.add(alias);
      }
    }
    if (names.size === 1) results.set(name, [...names][0]);
  }
  return results;
}

/** Keys of every object a result carries at its top level (or as its array elements). */
function* resultObjects(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* resultObjects(item);
  } else if (value && typeof value === 'object' && !Object.keys(value).some((k) => k[0] === '$')) {
    yield value;
  }
}

/** The JSON text of every object inside a value. */
function collectObjects(value, out) {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value)) out.add(JSON.stringify(value));
    for (const item of Object.values(value)) collectObjects(item, out);
  }
}

function checkCorpus(dir, results, codec, problems) {
  if (!existsSync(dir)) {
    log(`corpus: ${path.relative(REPO, dir)} absent; record it with yarn corpus to check results`);
    return;
  }
  let calls = 0;
  let ops = 0;
  for (const [op, type] of [...results].sort()) {
    const file = path.join(dir, `${encodeURIComponent(op)}.jsonl`);
    if (!existsSync(file)) continue;
    ops += 1;
    const unknown = new Set();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const record = JSON.parse(line);
      if (!('result' in record)) continue;
      calls += 1;
      // An argument returned as it came keeps whatever keys the caller gave it.
      const given = new Set();
      collectObjects(record.args, given);
      for (const object of resultObjects(record.result)) {
        if (given.has(JSON.stringify(object))) continue;
        for (const key of Object.keys(object)) {
          if (!codec.get(type).fields.has(key)) unknown.add(key);
        }
      }
    }
    for (const key of unknown) problems.push(`${op}: TS result carries ${type}.${key}`);
  }
  log(`corpus: ${calls} results of ${ops} ops checked against their codec fields`);
  if (calls === 0) problems.push('corpus: no recorded result to check');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const codec = codecFields();
  if (codec.size === 0) throw new Error('no CANTUS_JSON_FIELDS declaration found');
  const program = tsTypes();
  const problems = [];
  const wireOnly = [];
  let compared = 0;
  for (const [type, { fields, file }] of [...codec].sort()) {
    const declared = program.types.get(type);
    if (!declared) {
      wireOnly.push(type);
      continue;
    }
    compared += 1;
    const props = propertyNames(program.checker, declared);
    for (const f of fields) if (!props.has(f)) problems.push(`${file}: ${type}.${f} is not in TS`);
    for (const p of props)
      if (!fields.has(p)) problems.push(`${file}: ${type}.${p} is not written`);
  }
  log(`codec: ${compared} types match their TS declarations`);
  if (wireOnly.length > 0) log(`codec: wire-only records: ${wireOnly.join(', ')}`);
  if (compared === 0) problems.push('codec: no type compared');

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const opNames = new Set(manifest.ops.map((op) => op.name));
  const results = new Map([...resultTypes(program, codec)].filter(([name]) => opNames.has(name)));
  checkCorpus(args.corpus, results, codec, problems);

  for (const problem of problems) console.error(`check_shapes: ${problem}`);
  if (problems.length > 0) process.exit(1);
  log('check_shapes: every codec type matches TS');
}

main();
