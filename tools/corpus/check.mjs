#!/usr/bin/env node
/**
 * `make corpus-check`: a unit's ops are all registered, and every recorded call of them replays
 * through the C ABI with a byte-identical normalized result.
 *
 * The registry check runs first and needs no corpus. The replay then needs a fresh corpus
 * (`yarn corpus`) and must replay at least the unit's `expected.replay` calls (api/units.json),
 * and never zero. `--unit all` checks every op.
 *
 * Usage: node tools/corpus/check.mjs --unit ID [--build-dir DIR]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  fail,
  MANIFEST,
  opFile,
  opsOfUnit,
  readJson,
  registeredOps,
  replayerPath,
  requireFreshCorpus,
  UNITS,
} from './lib.mjs';

const TOOL = 'corpus-check';

function parseArgs(argv) {
  const args = { unit: undefined, buildDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--unit') args.unit = argv[++i];
    else if (argv[i] === '--build-dir') args.buildDir = argv[++i];
    else fail(TOOL, `unknown argument ${argv[i]}`);
  }
  if (!args.unit) fail(TOOL, '--unit is required');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(MANIFEST);
  const units = readJson(UNITS);
  let ops;
  try {
    ops =
      args.unit === 'all'
        ? manifest.ops.map((op) => op.name)
        : opsOfUnit(manifest, units, args.unit);
  } catch (error) {
    fail(TOOL, error.message);
  }
  if (ops.length === 0) fail(TOOL, `unit ${args.unit} owns no ops`);
  const registered = registeredOps(TOOL, args.buildDir);
  const missing = ops.filter((op) => !registered.has(op));
  if (missing.length > 0) {
    const shown = missing.slice(0, 20).join(', ');
    fail(
      TOOL,
      `${missing.length} ops not registered (of ${ops.length} in ${args.unit}): ${shown}${missing.length > 20 ? ', ...' : ''}`,
    );
  }
  requireFreshCorpus(TOOL);
  const files = ops.map(opFile).filter((f) => existsSync(f));
  if (files.length === 0) fail(TOOL, `no recorded calls for the ops of ${args.unit}`);
  const expected =
    args.unit === 'all' ? null : units.units.find((u) => u.id === args.unit)?.expected?.replay;
  const min = Math.max(1, expected ?? 1);
  const run = spawnSync(replayerPath(args.buildDir), ['--min', String(min), ...files], {
    stdio: 'inherit',
  });
  if (run.status !== 0) fail(TOOL, `replay failed for ${args.unit}`);
  process.stdout.write(
    `corpus-check: ${args.unit}: ${ops.length} ops registered, ${files.length} recorded op files replayed\n`,
  );
}

main();
