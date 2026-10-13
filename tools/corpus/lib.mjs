/**
 * Shared pieces of the corpus tools: paths, the unit table, the corpus stamp,
 * and the op registry as the C ABI replayer reports it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(REPO, 'tests/corpus/out');
export const RAW = path.join(OUT, 'raw');
export const OPS_DIR = path.join(OUT, 'ops');
export const SPEC_OPS = path.join(OUT, 'spec-ops.json');
export const STAMP = path.join(OUT, 'stamp');
export const MANIFEST = path.join(REPO, 'api/manifest.json');
export const ANNOTATIONS = path.join(REPO, 'api/annotations.json');
export const UNITS = path.join(REPO, 'api/units.json');

/** The trees whose content the recorded corpus depends on. */
const STAMPED = ['ts/src', 'bindings/js', 'tests/spec'];
/** Directories under a stamped tree that do not feed the corpus. */
const UNSTAMPED = new Set(['node_modules', 'generated', 'dist', 'coverage']);

export function fail(tool, message) {
  console.error(`${tool}: ${message}`);
  process.exit(1);
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The per-op corpus file of `op`. */
export function opFile(op) {
  return path.join(OPS_DIR, `${encodeURIComponent(op)}.jsonl`);
}

function filesUnder(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || UNSTAMPED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Hash of every file the recording read: ts/src, bindings/js and tests/spec. */
export function computeStamp() {
  const hash = createHash('sha256');
  const files = STAMPED.flatMap((dir) => filesUnder(path.join(REPO, dir), [])).sort();
  for (const file of files) {
    hash.update(path.relative(REPO, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Fail unless the recorded corpus exists and was recorded from the current sources. */
export function requireFreshCorpus(tool) {
  if (!existsSync(STAMP) || !existsSync(SPEC_OPS)) {
    fail(tool, 'no recorded corpus under tests/corpus/out; run yarn corpus');
  }
  const recorded = readFileSync(STAMP, 'utf8').trim();
  if (recorded !== computeStamp()) {
    fail(
      tool,
      'the recorded corpus is stale (ts/src, bindings/js or tests/spec changed); run yarn corpus',
    );
  }
}

/** The unit that owns the TS file `module` (a path under ts/src or the repo). */
export function unitOf(units, module) {
  const rel = module.replace(/^ts\/src\//, '');
  let best;
  for (const unit of units.units) {
    for (const key of [...unit.modules, ...unit.root_files]) {
      const hit = key.endsWith('.ts') ? rel === key : rel.startsWith(`${key}/`);
      if (hit && (best === undefined || key.length > best.key.length))
        best = { unit: unit.id, key };
    }
  }
  return best?.unit;
}

/** Op names of `unit`, from the manifest's op list and the unit table. */
export function opsOfUnit(manifest, units, unit) {
  if (!units.units.some((u) => u.id === unit)) {
    const ids = units.units.map((u) => u.id).join(', ');
    throw new Error(`unknown unit ${unit}; units are ${ids}`);
  }
  return manifest.ops.filter((op) => unitOf(units, op.module) === unit).map((op) => op.name);
}

/** The C ABI replayer built in `buildDir`. */
export function replayerPath(buildDir = process.env.BUILD_DIR ?? 'build') {
  return path.resolve(REPO, buildDir, 'tests/corpus/cantus_corpus_replay');
}

/** Registered op names, read through the C ABI (`cantus_list_ops`). */
export function registeredOps(tool, buildDir) {
  const replayer = replayerPath(buildDir);
  if (!existsSync(replayer) || !statSync(replayer).isFile()) {
    fail(tool, `${path.relative(REPO, replayer)} is missing; run make build`);
  }
  const out = execFileSync(replayer, ['--list'], { encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}

/** JSON text of `value` as the repo's biome configuration formats `file`. */
export function formatJson(file, value) {
  return execFileSync(
    path.join(REPO, 'node_modules/.bin/biome'),
    ['format', `--stdin-file-path=${file}`],
    {
      cwd: REPO,
      input: `${JSON.stringify(value, null, 2)}\n`,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  );
}

/** Recorded call count per op, from the merged corpus. */
export function recordedCalls() {
  const counts = new Map();
  if (!existsSync(OPS_DIR)) return counts;
  for (const name of readdirSync(OPS_DIR)) {
    if (!name.endsWith('.jsonl')) continue;
    const text = readFileSync(path.join(OPS_DIR, name), 'utf8');
    const lines = text.split('\n').filter(Boolean).length;
    counts.set(decodeURIComponent(name.slice(0, -'.jsonl'.length)), lines);
  }
  return counts;
}

/** Op names the corpus records for a call (builtins aside). */
export function isRecordedOp(op) {
  return !op.startsWith('$') || op.startsWith('$const:');
}
