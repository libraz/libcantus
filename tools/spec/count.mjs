#!/usr/bin/env node
/**
 * Check that splitting the suite lost or duplicated no test.
 *
 * Default: every unit (one `it` / `test`, or one `.each` / loop statement, as
 * `split.mjs` counts them) of each file `tests/spec/manifest.json` records is
 * read from the split base and looked up, by its describe path and title, in
 * the file's two halves today: `ts/test/<file>` for the units the manifest lists
 * as `tsOnly`, `tests/spec/<file>` for the rest. A unit missing from its half
 * or present in the other fails; units and files added since the split are
 * reported and pass. The base must hold the unit counts the manifest records.
 * A unit a behaviour change removed is listed with its reason in
 * `tests/spec/retired.json`; it must be at the base and absent today.
 * `--compare <impl>`: run `tests/spec` under CANTUS_IMPL=ts and under
 * CANTUS_IMPL=<impl> with the JSON reporter; the passed counts must match and
 * neither run may skip, mark todo, or fail.
 *
 * Every count of zero is a failure.
 *
 * Usage: node tools/spec/count.mjs [--compare <impl>] [--max-workers <n>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITEST = path.join(REPO, 'node_modules/.bin/vitest');
const SPEC = path.join(REPO, 'tests/spec');
const SPEC_CONFIG = path.join(SPEC, 'vitest.config.ts');
const TS_TEST = path.join(REPO, 'ts/test');
const MANIFEST = path.join(SPEC, 'manifest.json');
const RETIRED = path.join(SPEC, 'retired.json');

function parseArgs(argv) {
  const args = { compare: null, maxWorkers: '2' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--compare') args.compare = argv[++i];
    else if (argv[i] === '--max-workers') args.maxWorkers = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.compare === undefined) throw new Error('--compare needs an implementation name');
  return args;
}

/** One line of the summary on stdout. */
function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  console.error(`count: ${message}`);
  process.exit(1);
}

const TEST_ROOTS = new Set(['it', 'test']);
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

/** The identifier a call chain such as `it.each(table)(...)` starts from. */
function calleeRoot(expr) {
  let current = expr;
  for (;;) {
    if (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    } else if (ts.isTaggedTemplateExpression(current)) current = current.tag;
    else break;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/** The first `it` / `test` / `describe` call inside a node. */
function firstTestCall(node) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const root = calleeRoot(n.expression) ?? '';
      if (TEST_ROOTS.has(root) || root === 'describe') {
        found = n;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function titleOf(call, sf) {
  const first = call.arguments[0];
  if (!first) return '';
  return ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)
    ? first.text
    : first.getText(sf);
}

/** The callback block of a plain `describe(...)` (not `.each` / `.for`), or null. */
function describeBody(statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    return null;
  }
  const call = statement.expression;
  if (calleeRoot(call.expression) !== 'describe') return null;
  for (let e = call.expression; ts.isPropertyAccessExpression(e) || ts.isCallExpression(e); ) {
    if (ts.isPropertyAccessExpression(e) && (e.name.text === 'each' || e.name.text === 'for')) {
      return null;
    }
    e = e.expression;
  }
  const fn = call.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  return fn && ts.isBlock(fn.body) ? fn.body : null;
}

function isSkipped(statement) {
  if (
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isImportDeclaration(statement)
  ) {
    return true;
  }
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    HOOKS.has(statement.expression.expression.text)
  );
}

/** The units of one test file, as `{ key, line }`; the key is the describe path and title. */
function unitsOf(text, name) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const units = [];
  const scope = (statements, prefix) => {
    for (const statement of statements) {
      const body = describeBody(statement);
      if (body) {
        scope(body.statements, [...prefix, titleOf(statement.expression, sf)]);
        continue;
      }
      if (isSkipped(statement)) continue;
      const call = firstTestCall(statement);
      if (!call) continue;
      const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1;
      units.push({ key: [...prefix, titleOf(call, sf)].join(' > '), line });
    }
  };
  scope(sf.statements, []);
  return units;
}

/** Each file's text at a git ref, from one `git cat-file --batch`. */
function readAt(ref, names) {
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: REPO,
    input: names.map((name) => `${ref}:${name}\n`).join(''),
    maxBuffer: 1 << 30,
  });
  const texts = new Map();
  let offset = 0;
  for (const name of names) {
    const headerEnd = out.indexOf(10, offset);
    const header = out.subarray(offset, headerEnd).toString('utf8');
    if (header.endsWith(' missing')) fail(`${name} is missing at ${ref}`);
    const size = Number(header.split(' ')[2]);
    texts.set(name, out.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8'));
    offset = headerEnd + 1 + size + 1;
  }
  return texts;
}

/** How many times each key occurs in a list of units. */
function tally(units) {
  const counts = new Map();
  for (const { key } of units) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** Units of the file in one half today, or none when the half has no such file. */
function unitsNow(dir, file) {
  const full = path.join(dir, file);
  return existsSync(full) ? unitsOf(readFileSync(full, 'utf8'), full) : [];
}

/** Test files directly under a directory (the suite is flat). */
function testFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith('.test.ts'));
}

/** Compare one recorded file's units at the base with its two halves today. */
function checkFile(file, entry, baseText, retired, problems) {
  const before = unitsOf(baseText, file);
  if (before.length !== entry.units) {
    problems.push(
      `${file}: ${before.length} units at the base, the manifest records ${entry.units}`,
    );
    return 0;
  }
  const tsLines = new Set(entry.tsOnly.map((u) => u.line));
  const expected = {
    ts: tally(before.filter((u) => tsLines.has(u.line))),
    spec: tally(before.filter((u) => !tsLines.has(u.line))),
  };
  const actual = { ts: tally(unitsNow(TS_TEST, file)), spec: tally(unitsNow(SPEC, file)) };
  for (const { unit } of retired) {
    const side = ['ts', 'spec'].find((s) => expected[s].has(unit));
    if (side === undefined) {
      problems.push(`${file}: retired but not at the base: ${unit}`);
    } else if (actual.ts.has(unit) || actual.spec.has(unit)) {
      problems.push(`${file}: retired but still present: ${unit}`);
    } else {
      const left = (expected[side].get(unit) ?? 0) - 1;
      if (left > 0) expected[side].set(unit, left);
      else expected[side].delete(unit);
    }
  }
  if (retired.length > 0) log(`${file}: ${retired.length} units retired since the split`);
  let added = 0;
  for (const [side, other] of [
    ['ts', 'spec'],
    ['spec', 'ts'],
  ]) {
    for (const [key, want] of expected[side]) {
      const have = actual[side].get(key) ?? 0;
      if (have < want) problems.push(`${file}: lost from ${side}: ${key}`);
      else added += have - want;
      if (!expected[other].has(key) && actual[other].has(key)) {
        problems.push(`${file}: in both ts and spec: ${key}`);
      }
    }
    for (const [key, have] of actual[side]) {
      if (!expected.ts.has(key) && !expected.spec.has(key)) added += have;
    }
  }
  if (added > 0) log(`${file}: ${added} units added since the split`);
  return before.length;
}

/** Check every file the manifest records, and report the files added since the split. */
function checkSplit() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const files = Object.keys(manifest.files).sort();
  if (files.length === 0) fail('the manifest records no file');
  const base = readAt(
    manifest.base,
    files.map((file) => `ts/test/${file}`),
  );
  const retired = JSON.parse(readFileSync(RETIRED, 'utf8'));
  const problems = [];
  let units = 0;
  for (const file of files) {
    const entries = retired[file] ?? [];
    units += checkFile(file, manifest.files[file], base.get(`ts/test/${file}`), entries, problems);
  }
  const recorded = new Set(files);
  for (const file of Object.keys(retired)) {
    if (!recorded.has(file))
      problems.push(`${file}: retired units of a file the manifest does not record`);
  }
  for (const [label, dir] of [
    ['ts/test', TS_TEST],
    ['tests/spec', SPEC],
  ]) {
    for (const file of testFiles(dir)
      .filter((f) => !recorded.has(f))
      .sort()) {
      log(`${label}/${file}: ${unitsNow(dir, file).length} units, a file added since the split`);
    }
  }
  for (const problem of problems) console.error(`count: ${problem}`);
  if (problems.length > 0) fail(`${problems.length} problems in the split`);
  if (units === 0) fail('the split base holds no unit');
  log(
    `count: ${units} units of ${files.length} files at ${manifest.base.slice(0, 12)} all present once`,
  );
}

/** Status totals of one `vitest run` of the spec suite under an implementation. */
function run(impl, maxWorkers) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cantus-count-'));
  const report = path.join(dir, 'report.json');
  try {
    const result = spawnSync(
      VITEST,
      [
        'run',
        '-c',
        SPEC_CONFIG,
        '--reporter=json',
        `--outputFile=${report}`,
        `--maxWorkers=${maxWorkers}`,
      ],
      {
        cwd: REPO,
        env: { ...process.env, CANTUS_IMPL: impl },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    const data = JSON.parse(readFileSync(report, 'utf8'));
    const totals = {
      passed: data.numPassedTests,
      failed: data.numFailedTests,
      skipped: data.numPendingTests,
      todo: data.numTodoTests,
      failedSuites: data.numFailedTestSuites,
      exit: result.status,
    };
    log(`IMPL=${impl}: ${JSON.stringify(totals)}`);
    if (totals.passed === 0) fail(`IMPL=${impl} passed no tests`);
    if (totals.failed > 0 || totals.skipped > 0 || totals.todo > 0) {
      fail(`IMPL=${impl} has failed, skipped or todo tests`);
    }
    if (totals.failedSuites > 0 || totals.exit !== 0) {
      fail(
        `IMPL=${impl} has ${totals.failedSuites} spec files that failed to load or exit ${totals.exit}`,
      );
    }
    return totals;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.compare) {
  const reference = run('ts', args.maxWorkers);
  const other = run(args.compare, args.maxWorkers);
  if (other.passed !== reference.passed) {
    fail(`IMPL=${args.compare} passed ${other.passed}, IMPL=ts passed ${reference.passed}`);
  }
  log(`count: IMPL=${args.compare} matches IMPL=ts at ${reference.passed} passed`);
} else {
  checkSplit();
}
