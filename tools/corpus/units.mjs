#!/usr/bin/env node
/**
 * Check api/units.json against the tree and list the ops each unit owns.
 *
 * Every ts/src/**\/*.ts file must map to a unit, every key in the table must name an existing
 * file or directory, and every op in api/manifest.json must map to a unit.
 *
 * Usage: node tools/corpus/units.mjs [--check]
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fail, MANIFEST, opsOfUnit, REPO, readJson, UNITS, unitOf } from './lib.mjs';

const TOOL = 'units';
const SRC = path.join(REPO, 'ts/src');

function tsFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(full, out);
    else if (entry.name.endsWith('.ts'))
      out.push(path.relative(SRC, full).split(path.sep).join('/'));
  }
  return out;
}

function main() {
  const units = readJson(UNITS);
  const manifest = readJson(MANIFEST);
  const problems = [];
  for (const unit of units.units) {
    for (const key of [...unit.modules, ...unit.root_files]) {
      if (!existsSync(path.join(SRC, key)))
        problems.push(`${unit.id}: ${key} does not exist under ts/src`);
    }
  }
  const unmapped = tsFiles(SRC).filter((file) => unitOf(units, file) === undefined);
  if (unmapped.length > 0) problems.push(`ts/src files with no unit: ${unmapped.join(', ')}`);
  const orphanOps = manifest.ops.filter((op) => unitOf(units, op.module) === undefined);
  if (orphanOps.length > 0)
    problems.push(`ops with no unit: ${orphanOps.map((op) => op.name).join(', ')}`);
  for (const p of problems) process.stderr.write(`${TOOL}: ${p}\n`);
  if (problems.length > 0) process.exit(1);
  let total = 0;
  for (const unit of units.units) {
    const n = opsOfUnit(manifest, units, unit.id).length;
    total += n;
    process.stdout.write(`${unit.id.padEnd(4)} ${String(n).padStart(4)} ops\n`);
  }
  if (total !== manifest.ops.length)
    fail(TOOL, `units own ${total} ops, the manifest lists ${manifest.ops.length}`);
  process.stdout.write(
    `${TOOL}: ${units.units.length} units, ${total} ops, every ts/src file mapped\n`,
  );
}

main();
