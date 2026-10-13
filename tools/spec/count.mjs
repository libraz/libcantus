#!/usr/bin/env node
/**
 * Check that splitting the suite lost or duplicated no test.
 *
 * Default: `vitest list --json` over `ts/test` (the package's own config) and
 * over `tests/spec` (CANTUS_IMPL=ts), summed, must equal BASELINE. Spec files
 * the split did not produce (absent from `tests/spec/manifest.json` and outside
 * `generated/`) were added afterwards; they are reported and left out of the sum.
 * `--compare <impl>`: run `tests/spec` under CANTUS_IMPL=ts and under
 * CANTUS_IMPL=<impl> with the JSON reporter; the passed counts must match and
 * neither run may skip, mark todo, or fail.
 *
 * Every count of zero is a failure.
 *
 * Usage: node tools/spec/count.mjs [--compare <impl>] [--max-workers <n>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Tests in the suite before the split (`vitest list --json`, 347 files). */
const BASELINE = 4723;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITEST = path.join(REPO, 'node_modules/.bin/vitest');
const SPEC = path.join(REPO, 'tests/spec');
const SPEC_CONFIG = path.join(SPEC, 'vitest.config.ts');

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

/** Tests `vitest list` collects for one config, as `{ file, name }` entries. */
function listed(label, cwd, config, env) {
  const out = execFileSync(VITEST, ['list', '--json', '-c', config], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tests = JSON.parse(out.slice(out.indexOf('[')));
  const files = new Set(tests.map((t) => t.file)).size;
  log(`${label}: ${files} files, ${tests.length} tests`);
  if (tests.length === 0) fail(`${label} collected no tests`);
  return tests;
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
      exit: result.status,
    };
    log(`IMPL=${impl}: ${JSON.stringify(totals)}`);
    if (totals.passed === 0) fail(`IMPL=${impl} passed no tests`);
    if (totals.failed > 0 || totals.skipped > 0 || totals.todo > 0) {
      fail(`IMPL=${impl} has failed, skipped or todo tests`);
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
  const pkg = listed('ts/test', path.join(REPO, 'ts'), 'vitest.config.ts', {}).length;
  const split = new Set(
    Object.keys(JSON.parse(readFileSync(path.join(SPEC, 'manifest.json'), 'utf8')).files),
  );
  const added = new Map();
  let spec = 0;
  for (const test of listed('tests/spec', REPO, SPEC_CONFIG, { CANTUS_IMPL: 'ts' })) {
    const rel = path.relative(SPEC, test.file).split(path.sep).join('/');
    if (split.has(rel) || rel.startsWith('generated/')) spec += 1;
    else added.set(rel, (added.get(rel) ?? 0) + 1);
  }
  for (const [rel, n] of [...added].sort())
    log(`tests/spec/${rel}: ${n} tests added after the split`);
  if (spec === 0) fail('tests/spec holds no split test');
  const total = pkg + spec;
  if (total !== BASELINE)
    fail(`ts/test + tests/spec = ${pkg} + ${spec} = ${total}, baseline ${BASELINE}`);
  log(`count: ${pkg} + ${spec} = ${total} = baseline`);
}
