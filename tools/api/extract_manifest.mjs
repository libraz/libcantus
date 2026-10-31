#!/usr/bin/env node
/**
 * Extract the API ledger `api/manifest.json` from the pure TS package.
 *
 * Reads `ts/src/index.ts` and the five layer subpaths with the TypeScript
 * Compiler API and records every runtime export: its kind, declaring module,
 * subpaths, parameters, and for classes the static / method / getter members
 * and the getter `[Symbol.iterator]` walks. The hybrid and handle types named
 * in `api/annotations.json` are recorded too, since their members are ops.
 * The op list at the end is what every surface must answer.
 *
 * Usage: node tools/api/extract_manifest.mjs [--check]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(REPO, 'ts');
const OUT = path.join(REPO, 'api/manifest.json');
const ANNOTATIONS = path.join(REPO, 'api/annotations.json');

/** Subpath name ('.' is the package root) to entry file. */
const SUBPATHS = [
  ['.', 'src/index.ts'],
  ['core', 'src/core/index.ts'],
  ['theory', 'src/theory/index.ts'],
  ['analyze', 'src/analyze/index.ts'],
  ['generate', 'src/generate/index.ts'],
  ['model', 'src/model/index.ts'],
];

function fail(message) {
  console.error(`extract_manifest: ${message}`);
  process.exit(1);
}

function rel(file) {
  return path.relative(REPO, file).split(path.sep).join('/');
}

function createProgram() {
  const configPath = path.join(PKG, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) fail(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PKG);
  const roots = SUBPATHS.map(([, file]) => path.join(PKG, file));
  return ts.createProgram(roots, { ...parsed.options, noEmit: true });
}

function readAnnotations() {
  if (!existsSync(ANNOTATIONS)) fail('api/annotations.json is missing');
  return JSON.parse(readFileSync(ANNOTATIONS, 'utf8'));
}

function hasModifier(node, kind) {
  return (ts.getCombinedModifierFlags(node) & kind) !== 0;
}

/** The field names of a plain object shape (through unions and intersections), or undefined. */
function objectFields(checker, type) {
  const fields = new Set();
  const parts = type.isUnion() ? type.types : [type];
  for (const part of parts) {
    if (!(part.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) continue;
    if (checker.isArrayType(part) || checker.isTupleType(part)) continue;
    if (part.getCallSignatures().length > 0) continue;
    const symbol = part.getSymbol();
    if (symbol && symbol.flags & ts.SymbolFlags.Class) continue;
    for (const prop of part.getProperties()) fields.add(prop.getName());
  }
  return fields.size > 0 ? [...fields] : undefined;
}

/** Parameter names that carry a call's options. */
const OPTION_PARAMS = new Set(['opts', 'options']);

/**
 * The option bag of a parameter: the field names when it is an optional `opts` / `options`
 * parameter whose resolved type is an object shape, else undefined. Python binds such a bag
 * to keyword-only arguments; every other parameter stays positional.
 */
function optionBag(checker, p, name, optional) {
  if (!optional || p.dotDotDotToken || !OPTION_PARAMS.has(name)) return undefined;
  return objectFields(checker, checker.getNonNullableType(checker.getTypeAtLocation(p)));
}

function paramName(decl, index) {
  return ts.isIdentifier(decl.name) ? decl.name.text : `arg${index}`;
}

/** Parameters of a signature-bearing declaration, merging overloads. */
function paramsOf(checker, decls) {
  const sigDecls = decls.filter((d) => d.parameters);
  if (sigDecls.length === 0) return { params: [], length: 0 };
  // The implementation signature when present, else the widest overload.
  const impl = sigDecls.find((d) => d.body) ?? sigDecls[sigDecls.length - 1];
  const widest = sigDecls.reduce((a, b) => (b.parameters.length > a.parameters.length ? b : a));
  const shape = impl.parameters.length >= widest.parameters.length ? impl : widest;
  const minRequired = Math.min(
    ...sigDecls.map(
      (d) =>
        d.parameters.filter((p) => !p.questionToken && !p.initializer && !p.dotDotDotToken).length,
    ),
  );
  const params = shape.parameters.map((p, i) => {
    const entry = {
      name: paramName(p, i),
      optional: Boolean(p.questionToken || p.initializer) || i >= minRequired,
      rest: Boolean(p.dotDotDotToken),
    };
    const bag = optionBag(checker, p, entry.name, entry.optional);
    if (bag) entry.bag = bag;
    return entry;
  });
  // Function.prototype.length of the runtime function: parameters before the first default or rest.
  let length = 0;
  for (const p of impl.parameters) {
    if (p.initializer || p.dotDotDotToken) break;
    length += 1;
  }
  return { params, length };
}

/** Parameters of a function-typed property or variable. */
function paramsOfType(checker, type) {
  const sigs = type.getCallSignatures();
  if (sigs.length === 0) return { params: [], length: 0 };
  const decls = sigs.map((s) => s.getDeclaration()).filter(Boolean);
  return paramsOf(checker, decls);
}

function memberName(member) {
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isPrivateIdentifier(name)) return undefined;
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText()}]`;
  return undefined;
}

/** The getter `[Symbol.iterator]` walks: the one typed `readonly T[]` for the iterator's T. */
function iterableGetter(checker, cls, iteratorMethod, getters) {
  const sig = checker.getSignatureFromDeclaration(iteratorMethod);
  const ret = checker.getReturnTypeOfSignature(sig);
  const element = checker.getTypeArguments(ret)[0];
  if (!element) fail(`${cls}: cannot read the element type of [Symbol.iterator]`);
  const matches = getters.filter(({ decl }) => {
    const type = checker.getTypeAtLocation(decl);
    if (!checker.isArrayType(type)) return false;
    const [arg] = checker.getTypeArguments(type);
    return arg !== undefined && checker.typeToString(arg) === checker.typeToString(element);
  });
  if (matches.length !== 1) {
    fail(`${cls}: [Symbol.iterator] matches ${matches.length} getters typed as its element array`);
  }
  return matches[0].name;
}

function classEntry(checker, decl) {
  const members = [];
  let ctor;
  let iterator;
  const getters = [];
  for (const m of decl.members) {
    if (ts.isConstructorDeclaration(m)) {
      if (m.body || !ctor) ctor = m;
      continue;
    }
    if (hasModifier(m, ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
    const name = memberName(m);
    if (name === undefined) continue;
    const isStatic = hasModifier(m, ts.ModifierFlags.Static);
    if (name === '[Symbol.iterator]') {
      iterator = m;
      continue;
    }
    if (name.startsWith('[')) fail(`${decl.name.text}: unsupported computed member ${name}`);
    if (ts.isMethodDeclaration(m)) {
      if (members.some((e) => e.name === name && e.static === isStatic)) continue;
      const overloads = decl.members.filter(
        (o) =>
          ts.isMethodDeclaration(o) &&
          memberName(o) === name &&
          hasModifier(o, ts.ModifierFlags.Static) === isStatic,
      );
      members.push({ name, static: isStatic, kind: 'method', ...paramsOf(checker, overloads) });
    } else if (ts.isGetAccessorDeclaration(m)) {
      members.push({ name, static: isStatic, kind: 'getter' });
      if (!isStatic) getters.push({ name, decl: m });
    } else if (ts.isPropertyDeclaration(m)) {
      members.push({ name, static: isStatic, kind: 'property' });
    } else if (ts.isSetAccessorDeclaration(m)) {
      fail(`${decl.name.text}.${name}: setters are not supported`);
    }
  }
  const hidden =
    ctor !== undefined && hasModifier(ctor, ts.ModifierFlags.Private | ts.ModifierFlags.Protected);
  const entry = {
    constructor: {
      ...(ctor ? paramsOf(checker, [ctor]) : { params: [], length: 0 }),
      ...(hidden ? { private: true } : {}),
    },
    members,
  };
  if (iterator) entry.iterable = iterableGetter(checker, decl.name.text, iterator, getters);
  return entry;
}

function extendsError(decl) {
  for (const clause of decl.heritageClauses ?? []) {
    for (const t of clause.types) {
      if (/^(Range|Type)?Error$/.test(t.expression.getText())) return true;
    }
  }
  return false;
}

/** One runtime export as a manifest entry, or undefined when it is type-only. */
function exportEntry(checker, symbol) {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (!(target.flags & ts.SymbolFlags.Value)) return undefined;
  const decls = target.getDeclarations() ?? [];
  const decl = decls.find((d) => !ts.isTypeAliasDeclaration(d) && !ts.isInterfaceDeclaration(d));
  if (!decl) return undefined;
  const id = symbol.getName();
  const module = rel(decl.getSourceFile().fileName);
  if (ts.isFunctionDeclaration(decl)) {
    const fns = decls.filter(ts.isFunctionDeclaration);
    return { id, kind: 'function', module, ...paramsOf(checker, fns) };
  }
  if (ts.isClassDeclaration(decl)) {
    if (extendsError(decl)) return { id, kind: 'error', module };
    return { id, kind: 'class', module, ...classEntry(checker, decl) };
  }
  if (ts.isEnumDeclaration(decl)) return { id, kind: 'enum', module };
  if (ts.isVariableDeclaration(decl)) {
    const type = checker.getTypeOfSymbolAtLocation(target, decl);
    const init = decl.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      return { id, kind: 'function', module, ...paramsOf(checker, [init]) };
    }
    if (type.getCallSignatures().length > 0 && type.getProperties().length === 0) {
      return { id, kind: 'function', module, ...paramsOfType(checker, type) };
    }
    return { id, kind: 'const', module };
  }
  fail(`${id}: unsupported declaration kind ${ts.SyntaxKind[decl.kind]}`);
}

/** The members of an exported object type (a hybrid or handle). */
function typeEntry(checker, program, name, classification) {
  for (const [, file] of SUBPATHS) {
    const sf = program.getSourceFile(path.join(PKG, file));
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
    if (!symbol) continue;
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decl = target
      .getDeclarations()
      ?.find((d) => ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d));
    if (!decl) break;
    const type = checker.getDeclaredTypeOfSymbol(target);
    const members = type.getProperties().map((prop) => {
      const propDecl = prop.valueDeclaration ?? prop.getDeclarations()?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(prop, propDecl);
      if (propType.getCallSignatures().length > 0) {
        return { name: prop.getName(), kind: 'method', ...paramsOfType(checker, propType) };
      }
      return { name: prop.getName(), kind: 'property' };
    });
    return { id: name, kind: classification, module: rel(decl.getSourceFile().fileName), members };
  }
  fail(`${classification} type ${name} is not exported`);
}

function opsOf(entries, types, local) {
  const ops = [];
  const add = (name, entry, member) =>
    ops.push({ name, export: entry.id, module: entry.module, ...(member ? { member } : {}) });
  for (const e of entries) {
    if (local.has(e.id)) continue;
    if (e.kind === 'function') add(e.id, e);
    else if (e.kind === 'const' || e.kind === 'enum') add(`$const:${e.id}`, e);
    else if (e.kind === 'class') {
      if (!e.constructor.private) add(`${e.id}.constructor`, e, 'constructor');
      for (const m of e.members) add(`${e.id}${m.static ? '.' : '#'}${m.name}`, e, m.name);
    }
  }
  // A hybrid's data members travel in its payload; only its methods and a handle's members are ops.
  for (const t of types) {
    for (const m of t.members) {
      if (t.kind === 'handle' || m.kind === 'method') add(`${t.id}#${m.name}`, t, m.name);
    }
  }
  ops.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return ops;
}

function build() {
  const annotations = readAnnotations();
  const program = createProgram();
  const checker = program.getTypeChecker();
  const byId = new Map();
  for (const [subpath, file] of SUBPATHS) {
    const sf = program.getSourceFile(path.join(PKG, file));
    if (!sf) fail(`cannot read ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const entry = exportEntry(checker, symbol);
      if (!entry) continue;
      const known = byId.get(entry.id);
      if (known) {
        if (known.module !== entry.module) fail(`${entry.id} resolves to two declarations`);
        known.subpaths.push(subpath);
      } else {
        byId.set(entry.id, { ...entry, subpaths: [subpath] });
      }
    }
  }
  const order = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const exports = [...byId.values()].sort(order).map(({ subpaths, ...rest }) => {
    const { id, kind, module, ...detail } = rest;
    return { id, kind, module, subpaths, ...detail };
  });
  const local = new Set((annotations.facade_local ?? []).map((e) => e.id));
  for (const id of local) if (!byId.has(id)) fail(`facade_local names unknown export ${id}`);
  const types = [];
  for (const kind of ['hybrid', 'handle']) {
    for (const name of Object.keys(annotations.classification?.[kind] ?? {})) {
      types.push(typeEntry(checker, program, name, kind));
    }
  }
  types.sort(order);
  const counts = {};
  for (const e of exports) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const ops = opsOf(exports, types, local);
  return {
    source: 'ts/src/index.ts',
    subpaths: SUBPATHS.map(([s]) => s),
    counts: { ...counts, types: types.length, ops: ops.length },
    exports,
    types,
    ops,
  };
}

/** The manifest's JSON as the repo's biome configuration formats it. */
function formatJson(value) {
  return execFileSync(
    path.join(REPO, 'node_modules/.bin/biome'),
    ['format', `--stdin-file-path=${OUT}`],
    {
      cwd: REPO,
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  );
}

function main() {
  const check = process.argv.includes('--check');
  for (const arg of process.argv.slice(2)) if (arg !== '--check') fail(`unknown argument ${arg}`);
  const manifest = build();
  const text = formatJson(manifest);
  if (manifest.exports.length === 0 || manifest.ops.length === 0) fail('no exports found');
  const summary = Object.entries(manifest.counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== text)
      fail('api/manifest.json is stale; run node tools/api/extract_manifest.mjs');
    process.stdout.write(`extract_manifest: up to date (${summary})\n`);
    return;
  }
  writeFileSync(OUT, text);
  process.stdout.write(`extract_manifest: wrote api/manifest.json (${summary})\n`);
}

main();
